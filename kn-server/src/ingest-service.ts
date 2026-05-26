import type { ImageAsset, IngestJob, PageChunk, ReviewItem, WikiLink, WikiPage } from "./types.js"
import { DocumentParser } from "./document-parser.js"
import { LlmGateway } from "./llm-gateway.js"
import type { KnowledgeRepository } from "./repository.js"
import type { StorageProvider } from "./storage.js"
import {
  buildFallbackWikiPage,
  chunkText,
  extractWikiLinks,
  id,
  imageMarkdown,
  normalizeStorageKey,
  nowIso,
  pageIdFromPath,
  parseFileBlocks,
  parseFrontmatter,
  pathJoinKey,
  safeWikiPath,
  sha256,
  tokenize,
} from "./wiki-utils.js"

export class IngestService {
  private running = false
  private cancelled = new Set<string>()

  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly storage: StorageProvider,
    private readonly parser: DocumentParser,
    private readonly llm: LlmGateway,
  ) {}

  async recoverAndStart(): Promise<void> {
    await this.processQueue()
  }

  async enqueueExisting(job: IngestJob): Promise<void> {
    await this.repo.saveJob({ ...job, status: "queued", stage: "Queued for retry", updatedAt: nowIso() })
    await this.processQueue()
  }

  async cancel(jobId: string): Promise<IngestJob | undefined> {
    const job = await this.repo.getJob(jobId)
    if (!job || job.status === "completed" || job.status === "failed") return job
    this.cancelled.add(jobId)
    const cancelled = { ...job, status: "cancelled" as const, stage: "Cancelled", cancelledAt: nowIso(), updatedAt: nowIso() }
    await this.repo.saveJob(cancelled)
    return cancelled
  }

  async processQueue(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (true) {
        const next = (await this.repo.listQueuedJobs())[0]
        if (!next) return
        await this.runJob(next)
      }
    } finally {
      this.running = false
    }
  }

  private async runJob(initialJob: IngestJob): Promise<void> {
    let job: IngestJob = {
      ...initialJob,
      status: "running" as const,
      attempts: initialJob.attempts + 1,
      startedAt: nowIso(),
      updatedAt: nowIso(),
    }
    await this.repo.saveJob(job)

    const update = async (patch: Partial<IngestJob>) => {
      job = { ...job, ...patch, updatedAt: nowIso() }
      await this.repo.saveJob(job)
    }

    try {
      const source = await this.repo.getSource(job.sourceId)
      if (!source) throw new Error("Source document not found")
      await update({ progress: 8, stage: "Parsing source document" })

      const cached = await this.repo.getIngestCache(job.kbId, source.id)
      if (cached?.sourceHash === source.sha256) {
        await update({
          status: "completed",
          progress: 100,
          cached: true,
          stage: "Skipped by incremental cache",
          completedAt: nowIso(),
          writtenPageIds: cached.pageIds,
        })
        return
      }

      const sourceBytes = await this.storage.readObject(job.kbId, source.storageKey)
      const parsed = await this.parser.parse(source.fileName, sourceBytes)
      await this.repo.saveSource({ ...source, status: "parsing", updatedAt: nowIso() })

      await update({ progress: 20, stage: "Captioning multimodal images" })
      const imageAssets: ImageAsset[] = []
      let imageSection = ""
      for (const extracted of parsed.images) {
        this.ensureNotCancelled(job.id)
        const imageId = id("img")
        const mediaKey = pathJoinKey("wiki/media", source.id, extracted.fileName)
        await this.storage.writeObject(job.kbId, mediaKey, extracted.bytes)
        const caption = await this.llm.captionImage({
          fileName: extracted.fileName,
          mediaType: extracted.mediaType,
          bytes: extracted.bytes,
          sourceName: source.fileName,
        })
        const asset: ImageAsset = {
          id: imageId,
          kbId: job.kbId,
          sourceId: source.id,
          storageKey: mediaKey,
          fileName: extracted.fileName,
          mediaType: extracted.mediaType,
          caption,
          origin: extracted.origin,
          sourcePage: extracted.sourcePage,
          createdAt: nowIso(),
        }
        await this.repo.saveImage(asset)
        imageAssets.push(asset)
        imageSection += `\n\n### Image: ${asset.fileName}\n\n${caption}\n\n${imageMarkdown(asset)}\n`
      }

      const sourceContext = [
        `Source id: ${source.id}`,
        `Source file: ${source.relativePath}`,
        source.folderContext ? `Folder context: ${source.folderContext}` : "",
        parsed.text,
        imageSection ? `\n## Extracted Images\n${imageSection}` : "",
      ].filter(Boolean).join("\n\n")

      await update({ progress: 36, stage: "Step 1: LLM analysis" })
      this.ensureNotCancelled(job.id)
      const analysis = await this.llm.complete(
        [
          {
            role: "system",
            content:
              "You are the analysis stage of an llm_wiki ingest pipeline. Identify source claims, entities, concepts, contradictions, and likely wiki page updates. Do not write final pages yet.",
          },
          { role: "user", content: sourceContext.slice(0, 40_000) },
        ],
        this.fallbackAnalysis(source.relativePath, parsed.text, imageAssets),
      )

      await update({ progress: 58, stage: "Step 2: wiki page generation", analysis })
      this.ensureNotCancelled(job.id)
      const generation = await this.llm.complete(
        [
          {
            role: "system",
            content:
              "Generate llm_wiki FILE and REVIEW blocks. FILE blocks must be fenced as ```FILE wiki/...md. Every page must include YAML frontmatter with type, title, and sources. Use [[wikilink]] relations and cite the source id.",
          },
          {
            role: "user",
            content: [
              `Analysis:\n${analysis}`,
              `Source context:\n${sourceContext.slice(0, 30_000)}`,
            ].join("\n\n---\n\n"),
          },
        ],
        this.fallbackGeneration(source.relativePath, parsed.text, source.id, imageAssets),
        3200,
      )

      await update({ progress: 72, stage: "Writing wiki pages and review items" })
      const blocks = parseFileBlocks(generation)
      const fileBlocks = blocks.filter((block) => block.kind === "file" && block.path)
      if (fileBlocks.length === 0) {
        const fallback = buildFallbackWikiPage(source.fileName, parsed.text + imageSection, source.id)
        fileBlocks.push({ kind: "file", path: fallback.path, content: fallback.content })
      }

      const pages = await this.repo.listPages(job.kbId)
      const pageIds = new Set(pages.map((page) => page.id))
      const writtenPageIds: string[] = []
      for (const block of fileBlocks) {
        this.ensureNotCancelled(job.id)
        const pagePath = safeWikiPath(block.path ?? "")
        let content = block.content
        if (imageAssets.length > 0 && !content.includes("wiki/media/")) {
          content += `\n\n## Source Images\n\n${imageAssets.map(imageMarkdown).join("\n\n")}\n`
        }
        await this.storage.writeObject(job.kbId, pagePath, content)
        const page = this.buildPage(job.kbId, pagePath, content, source.id, imageAssets)
        await this.repo.upsertPage(page)
        await this.repo.replacePageSources(job.kbId, page.id, [{ kbId: job.kbId, pageId: page.id, sourceId: source.id }])
        const links: WikiLink[] = extractWikiLinks(content).map((raw) => ({
          kbId: job.kbId,
          sourcePageId: page.id,
          targetPageId: this.resolveTarget(raw, pageIds),
          targetRaw: raw,
        }))
        await this.repo.replacePageLinks(job.kbId, page.id, links)
        await this.repo.replaceChunks(job.kbId, page.id, await this.buildChunks(job.kbId, page.id, content))
        writtenPageIds.push(page.id)
        pageIds.add(page.id)
      }

      for (const block of blocks.filter((item) => item.kind === "review")) {
        const review: ReviewItem = {
          id: id("rev"),
          kbId: job.kbId,
          sourceId: source.id,
          kind: "llm-review",
          title: "LLM review item",
          description: block.content,
          status: "open",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        await this.repo.addReview(review)
      }

      await this.rebuildIndexPage(job.kbId)
      await this.repo.setIngestCache(job.kbId, source.id, source.sha256, writtenPageIds)
      await this.repo.saveSource({ ...source, status: "ingested", updatedAt: nowIso(), error: undefined })
      await this.repo.bumpDataVersion(job.kbId)
      await update({
        status: "completed",
        progress: 100,
        stage: "Completed",
        completedAt: nowIso(),
        writtenPageIds,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const source = await this.repo.getSource(job.sourceId)
      if (source) await this.repo.saveSource({ ...source, status: "failed", updatedAt: nowIso(), error: message })
      await update({
        status: this.cancelled.has(job.id) ? "cancelled" : "failed",
        progress: this.cancelled.has(job.id) ? job.progress : 100,
        stage: this.cancelled.has(job.id) ? "Cancelled" : "Failed",
        error: message,
        completedAt: nowIso(),
      })
    } finally {
      this.cancelled.delete(job.id)
    }
  }

  private fallbackAnalysis(sourcePath: string, text: string, images: ImageAsset[]): string {
    const tokens = tokenize(text).slice(0, 12)
    return [
      `Source ${sourcePath} should become a source page with traceable frontmatter.`,
      tokens.length > 0 ? `Potential concepts: ${tokens.join(", ")}.` : "No strong concepts were extracted.",
      images.length > 0 ? `The source includes ${images.length} image asset(s) that need factual captions and image-aware retrieval.` : "",
    ].filter(Boolean).join("\n")
  }

  private fallbackGeneration(sourcePath: string, text: string, sourceId: string, images: ImageAsset[]): string {
    const page = buildFallbackWikiPage(sourcePath, text, sourceId)
    const imageText = images.length > 0
      ? `\n\n## Multimodal Image Notes\n\n${images.map((image) => `- ${image.caption}`).join("\n")}`
      : ""
    return [
      "```FILE " + page.path,
      page.content + imageText,
      "```",
      "```REVIEW",
      `Check whether ${sourcePath} should also create entity or concept pages.`,
      "```",
    ].join("\n")
  }

  private buildPage(kbId: string, pagePath: string, content: string, sourceId: string, images: ImageAsset[]): WikiPage {
    const fm = parseFrontmatter(content)
    const now = nowIso()
    return {
      id: pageIdFromPath(pagePath),
      kbId,
      path: pagePath,
      title: fm.title,
      type: fm.type,
      content,
      sha256: sha256(content),
      sources: fm.sources.length > 0 ? fm.sources : [sourceId],
      images: images.map((image) => ({ ...image, pageId: pageIdFromPath(pagePath) })),
      createdAt: now,
      updatedAt: now,
    }
  }

  private async buildChunks(kbId: string, pageId: string, content: string): Promise<PageChunk[]> {
    const chunks: PageChunk[] = []
    let ordinal = 0
    for (const text of chunkText(content)) {
      chunks.push({
        id: id("chk"),
        kbId,
        pageId,
        text,
        ordinal,
        tokens: tokenize(text),
        embedding: await this.llm.embed(text),
      })
      ordinal += 1
    }
    return chunks
  }

  private resolveTarget(raw: string, existingIds: Set<string>): string {
    if (existingIds.has(raw)) return raw
    const slug = normalizeStorageKey(raw).toLowerCase().replace(/\s+/g, "-")
    for (const idValue of existingIds) {
      const lower = idValue.toLowerCase()
      if (lower === slug || lower === raw.toLowerCase()) return idValue
    }
    return slug
  }

  private async rebuildIndexPage(kbId: string): Promise<void> {
    const pages = (await this.repo.listPages(kbId)).filter((page) => page.path !== "wiki/index.md")
    const groups = new Map<string, WikiPage[]>()
    for (const page of pages) groups.set(page.type, [...(groups.get(page.type) ?? []), page])
    const sections = ["entity", "concept", "source", "query", "comparison", "synthesis", "overview"]
      .map((type) => {
        const items = (groups.get(type) ?? []).sort((a, b) => a.title.localeCompare(b.title))
        const title = type.slice(0, 1).toUpperCase() + type.slice(1)
        return `## ${title}\n\n${items.map((page) => `- [[${page.id}]] - ${page.title}`).join("\n")}`
      })
      .join("\n\n")
    const content = `# Wiki Index\n\n${sections}\n`
    await this.storage.writeObject(kbId, "wiki/index.md", content)
    await this.repo.upsertPage(this.buildPage(kbId, "wiki/index.md", content, "system", []))
  }

  private ensureNotCancelled(jobId: string): void {
    if (this.cancelled.has(jobId)) throw new Error("Job cancelled")
  }
}
