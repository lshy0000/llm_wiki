import type { EvidenceBlock, ImageAsset, IngestJob, PageChunk, ParsedDocument, ReviewItem, SourceDocument, WikiPage } from "./types.js"
import { DocumentParser } from "./document-parser.js"
import { makeEvidenceBlock, renderEvidenceMarkdown } from "./evidence.js"
import { syncGraphIndexForKnowledgeBase, type GraphIndex } from "./graph-index-service.js"
import { LlmGateway } from "./llm-gateway.js"
import type { KnowledgeRepository } from "./repository.js"
import type { StorageProvider } from "./storage.js"
import { isStructuralWikiPage, WikiLinkResolver, wikiLinksForPage } from "./wiki-link-resolver.js"
import {
  buildFallbackWikiPage,
  canonicalWikiPagePath,
  chunkText,
  id,
  imageMarkdown,
  nowIso,
  pageIdFromPath,
  parseFileBlocks,
  parseFrontmatter,
  pathJoinKey,
  sha256,
  tokenize,
} from "./wiki-utils.js"

const LARGE_CORPUS_SOURCE_THRESHOLD = Number(process.env.KN_INCREMENTAL_INGEST_SOURCE_THRESHOLD ?? 150)
const LARGE_CORPUS_RELATED_PAGE_LIMIT = Number(process.env.KN_INCREMENTAL_INGEST_RELATED_PAGE_LIMIT ?? 50)

interface IngestContextScope {
  mode: "full" | "incremental"
  sourceCount: number
  contextPages: WikiPage[]
}

export class IngestService {
  private running = false
  private cancelled = new Set<string>()

  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly storage: StorageProvider,
    private readonly parser: DocumentParser,
    private readonly llm: LlmGateway,
    private readonly graphIndex?: GraphIndex,
  ) {}

  async recoverAndStart(): Promise<void> {
    await this.processQueue()
  }

  async enqueueExisting(job: IngestJob): Promise<void> {
    await this.repo.saveJob({
      ...job,
      status: "queued",
      progress: 0,
      stage: "Queued for retry",
      error: undefined,
      cancelledAt: undefined,
      completedAt: undefined,
      updatedAt: nowIso(),
    })
    if (job.taskId) await this.repo.refreshTask(job.taskId)
    await this.processQueue()
  }

  async retryTask(taskId: string): Promise<unknown> {
    const task = await this.repo.getTask(taskId)
    if (!task) return undefined
    const jobs = await this.repo.listJobsByTask(taskId)
    for (const job of jobs) {
      if (job.status !== "failed" && job.status !== "cancelled") continue
      const source = await this.repo.getSource(job.sourceId)
      if (source) await this.repo.saveSource({ ...source, status: "queued", error: undefined, updatedAt: nowIso() })
      await this.repo.saveJob({
        ...job,
        status: "queued",
        progress: 0,
        stage: "Queued for retry",
        error: undefined,
        cancelledAt: undefined,
        completedAt: undefined,
        updatedAt: nowIso(),
      })
    }
    const refreshed = await this.repo.refreshTask(taskId)
    await this.processQueue()
    return refreshed
  }

  async cancelTask(taskId: string): Promise<unknown> {
    const task = await this.repo.getTask(taskId)
    if (!task) return undefined
    const jobs = await this.repo.listJobsByTask(taskId)
    for (const job of jobs) {
      if (job.status === "queued" || job.status === "running") {
        await this.cancel(job.id)
      }
    }
    return this.repo.refreshTask(taskId)
  }

  async cancel(jobId: string): Promise<IngestJob | undefined> {
    const job = await this.repo.getJob(jobId)
    if (!job || job.status === "completed" || job.status === "failed") return job
    this.cancelled.add(jobId)
    const cancelled = { ...job, status: "cancelled" as const, stage: "Cancelled", cancelledAt: nowIso(), updatedAt: nowIso() }
    await this.repo.saveJob(cancelled)
    const source = await this.repo.getSource(job.sourceId)
    if (source && source.status !== "ingested") {
      await this.repo.saveSource({ ...source, status: "cancelled", updatedAt: nowIso(), error: undefined })
    }
    if (job.taskId) await this.repo.refreshTask(job.taskId)
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
    if (job.taskId) await this.repo.refreshTask(job.taskId)

    const update = async (patch: Partial<IngestJob>) => {
      job = { ...job, ...patch, updatedAt: nowIso() }
      await this.repo.saveJob(job)
      if (job.taskId) await this.repo.refreshTask(job.taskId)
    }

    try {
      const source = await this.repo.getSource(job.sourceId)
      if (!source) throw new Error("Source document not found")
      await update({ progress: 8, stage: "Parsing source document" })
      await this.repo.saveSource({ ...source, status: "parsing", updatedAt: nowIso(), error: undefined })

      const cached = await this.repo.getIngestCache(job.kbId, source.id)
      if (cached?.sourceHash === source.sha256) {
        await this.repo.saveSource({ ...source, status: "ingested", updatedAt: nowIso(), error: undefined })
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

      await update({ progress: 20, stage: "Captioning multimodal images" })
      const imageAssets: ImageAsset[] = []
      const evidenceBlocks: EvidenceBlock[] = [...parsed.evidence]
      for (const extracted of parsed.images) {
        this.ensureNotCancelled(job.id)
        const imageId = id("img")
        const mediaKey = pathJoinKey("wiki/media", source.id, extracted.fileName)
        await this.storage.writeObject(job.kbId, mediaKey, extracted.bytes)
        const caption = await this.llm.captionImageForCompany(source.companyId, {
          fileName: extracted.fileName,
          mediaType: extracted.mediaType,
          bytes: extracted.bytes,
          sourceName: source.fileName,
        })
        const asset: ImageAsset = {
          id: imageId,
          companyId: source.companyId,
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
        const imageMarkdownText = imageMarkdown(asset)
        evidenceBlocks.push(makeEvidenceBlock({
          kind: "image",
          sourcePath: source.relativePath,
          locator: this.evidenceLocatorForImage(extracted),
          mediaKey,
          text: [`Caption: ${caption}`, imageMarkdownText].join("\n\n"),
          extractor: "vision-caption",
        }))
      }

      const evidenceMarkdown = renderEvidenceMarkdown(evidenceBlocks)
      const fallbackSourceText = parsed.text || evidenceBlocks.map((block) => block.text).join("\n\n")
      const sourceContext = [
        `Source id: ${source.id}`,
        `Source file: ${source.relativePath}`,
        source.folderContext ? `Folder context: ${source.folderContext}` : "",
        evidenceMarkdown,
      ].filter(Boolean).join("\n\n")

      await update({ progress: 30, stage: "Selecting ingest context" })
      const ingestScope = await this.resolveIngestContextScope(job.kbId, source, fallbackSourceText)
      const existingPages = ingestScope.contextPages
      const pageCatalog = this.renderPageCatalog(existingPages)
      const pageCatalogLabel = ingestScope.mode === "incremental"
        ? `Related wiki page catalog (${existingPages.length} pages selected from ${ingestScope.sourceCount} sources; not exhaustive)`
        : "Existing wiki page catalog"
      const comparisonContext = [
        pageCatalog ? `${pageCatalogLabel}:\n${pageCatalog}` : "",
        ingestScope.mode === "incremental"
          ? "Large-corpus incremental mode: compare the source only against the related catalog above. Do not infer that missing pages do not exist elsewhere in the wiki."
          : "",
      ].filter(Boolean).join("\n\n")

      await update({ progress: 36, stage: "Step 1: LLM analysis" })
      this.ensureNotCancelled(job.id)
      const analysis = await this.llm.completeForCompany(
        source.companyId,
        [
          {
            role: "system",
            content:
              "You are the analysis stage of an llm_wiki ingest pipeline. Use the provided Evidence blocks, their IDs, source paths, and locators to identify source claims, entities, concepts, contradictions, and likely wiki page updates. Do not write final pages yet.",
          },
          { role: "user", content: [comparisonContext, sourceContext].filter(Boolean).join("\n\n---\n\n").slice(0, 40_000) },
        ],
        this.fallbackAnalysis(source.relativePath, fallbackSourceText, imageAssets),
      )

      await update({ progress: 58, stage: "Step 2: wiki page generation", analysis })
      this.ensureNotCancelled(job.id)
      const generation = await this.llm.completeForCompany(
        source.companyId,
        [
          {
            role: "system",
            content:
              "Generate llm_wiki FILE and REVIEW blocks. FILE blocks must be fenced as ```FILE wiki/...md. Put pages in canonical directories by type: entity -> wiki/entities, concept -> wiki/concepts, source -> wiki/sources, query -> wiki/queries, comparison -> wiki/comparisons, synthesis -> wiki/synthesis. Use only those page types unless updating a root system page. Every page must include YAML frontmatter with type, title, sources, source_path, and folder_context. Ground factual statements in the provided Evidence IDs and source locators. Create dense [[wikilink]] relations between generated pages and existing wiki pages. Use the exact existing page id when linking to an existing page. Do not wrap source ids such as src_... in [[wikilinks]]; cite source ids as plain text or Evidence references.",
          },
          {
            role: "user",
            content: [
              pageCatalog ? `${pageCatalogLabel}:\n${pageCatalog}` : "",
              ingestScope.mode === "incremental"
                ? "Large-corpus incremental mode: compare the source only against the related catalog above. Do not infer that missing pages do not exist elsewhere in the wiki."
                : "",
              `Analysis:\n${analysis}`,
              `Source context:\n${sourceContext.slice(0, 30_000)}`,
            ].filter(Boolean).join("\n\n---\n\n"),
          },
        ],
        this.fallbackGeneration(source.relativePath, fallbackSourceText, source.id, source.folderContext, imageAssets),
        3200,
      )

      await update({ progress: 72, stage: "Writing wiki pages and review items" })
      const blocks = parseFileBlocks(generation)
      const fileBlocks = blocks.filter((block) => block.kind === "file" && block.path)
      if (fileBlocks.length === 0) {
        const fallback = buildFallbackWikiPage(source.relativePath, `${fallbackSourceText}\n\n${evidenceMarkdown}`, source.id, source.folderContext)
        fileBlocks.push({ kind: "file", path: fallback.path, content: fallback.content })
      }

      const pageById = new Map(existingPages.map((page) => [page.id, page]))
      const writtenPageIds: string[] = []
      const writtenPages: WikiPage[] = []
      for (const block of fileBlocks) {
        this.ensureNotCancelled(job.id)
        let content = block.content
        const pagePath = canonicalWikiPagePath(block.path ?? "", content)
        if (imageAssets.length > 0 && !content.includes("wiki/media/")) {
          content += `\n\n## Source Images\n\n${imageAssets.map(imageMarkdown).join("\n\n")}\n`
        }
        await this.storage.writeObject(job.kbId, pagePath, content)
        const page = this.buildPage(job.kbId, pagePath, content, source.id, imageAssets)
        page.companyId = source.companyId
        const previousPage = pageById.get(page.id) ?? await this.repo.getPage(job.kbId, page.id)
        if (previousPage && previousPage.path !== page.path) {
          await this.storage.deleteObject(job.kbId, previousPage.path)
        }
        const savedPage = await this.repo.upsertPage(page)
        await this.repo.replacePageSources(job.kbId, page.id, [{ companyId: source.companyId, kbId: job.kbId, pageId: page.id, sourceId: source.id }])
        await this.repo.replaceChunks(job.kbId, page.id, await this.buildChunks(job.kbId, page.id, content))
        writtenPageIds.push(page.id)
        writtenPages.push(savedPage)
        pageById.set(savedPage.id, savedPage)
      }

      for (const block of blocks.filter((item) => item.kind === "review")) {
        const review: ReviewItem = {
          id: id("rev"),
          companyId: source.companyId,
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

      if (ingestScope.mode === "incremental") {
        await this.rebuildTouchedPageLinks(job.kbId, writtenPages, this.uniquePages([...existingPages, ...writtenPages]))
      } else {
        pageById.set("index", await this.rebuildIndexPage(job.kbId))
        await this.rebuildPageLinks(job.kbId, [...pageById.values()])
        if (this.graphIndex) await syncGraphIndexForKnowledgeBase(this.repo, this.graphIndex, job.kbId)
      }
      await this.repo.setIngestCache(job.kbId, source.id, source.sha256, writtenPageIds)
      await this.repo.saveSource({ ...source, status: "ingested", updatedAt: nowIso(), error: undefined })
      await this.repo.touchKnowledgeBase(job.kbId)
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
      const cancelled = this.cancelled.has(job.id)
      if (source) await this.repo.saveSource({ ...source, status: cancelled ? "cancelled" : "failed", updatedAt: nowIso(), error: cancelled ? undefined : message })
      await update({
        status: cancelled ? "cancelled" : "failed",
        progress: cancelled ? job.progress : 100,
        stage: cancelled ? "Cancelled" : "Failed",
        error: cancelled ? undefined : message,
        completedAt: nowIso(),
      })
    } finally {
      this.cancelled.delete(job.id)
    }
  }

  private async resolveIngestContextScope(kbId: string, source: SourceDocument, sourceText: string): Promise<IngestContextScope> {
    const sourceCount = await this.repo.countSources(kbId)
    if (sourceCount <= LARGE_CORPUS_SOURCE_THRESHOLD) {
      return {
        mode: "full",
        sourceCount,
        contextPages: await this.repo.listPages(kbId),
      }
    }

    const limit = Math.max(1, Math.min(LARGE_CORPUS_RELATED_PAGE_LIMIT, 100))
    const phrase = source.fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim()
    const queryText = [
      source.fileName,
      source.relativePath,
      source.folderContext,
      sourceText.slice(0, 12_000),
    ].filter(Boolean).join("\n")
    const tokens = tokenize(queryText).slice(0, 96)
    const vectorPages = await this.findVectorRelatedPages(kbId, queryText, limit)
    const lexicalPages = await this.repo.findRelatedPagesForIngest(kbId, {
      phrase,
      tokens,
      limit,
      excludePageIds: vectorPages.map((page) => page.id),
    })

    return {
      mode: "incremental",
      sourceCount,
      contextPages: this.uniquePages([...vectorPages, ...lexicalPages]).slice(0, limit),
    }
  }

  private async findVectorRelatedPages(kbId: string, queryText: string, limit: number): Promise<WikiPage[]> {
    try {
      const embedding = await this.llm.embedForKnowledgeBase(kbId, queryText.slice(0, 4_000))
      if (!embedding) return []
      const hits = await this.repo.searchPagesByVector(kbId, embedding, limit)
      const pages: WikiPage[] = []
      for (const hit of hits) {
        const page = await this.repo.getPage(kbId, hit.pageId)
        if (page && !isStructuralWikiPage(page) && page.type !== "query") pages.push(page)
      }
      return pages
    } catch {
      return []
    }
  }

  private uniquePages(pages: WikiPage[]): WikiPage[] {
    const seen = new Set<string>()
    const out: WikiPage[] = []
    for (const page of pages) {
      if (seen.has(page.id)) continue
      seen.add(page.id)
      out.push(page)
    }
    return out
  }

  private fallbackAnalysis(sourcePath: string, text: string, images: ImageAsset[]): string {
    const tokens = tokenize(text).slice(0, 12)
    return [
      `Source ${sourcePath} should become a source page with traceable frontmatter.`,
      tokens.length > 0 ? `Potential concepts: ${tokens.join(", ")}.` : "No strong concepts were extracted.",
      images.length > 0 ? `The source includes ${images.length} image asset(s) that need factual captions and image-aware retrieval.` : "",
    ].filter(Boolean).join("\n")
  }

  private fallbackGeneration(sourcePath: string, text: string, sourceId: string, folderContext: string, images: ImageAsset[]): string {
    const page = buildFallbackWikiPage(sourcePath, text, sourceId, folderContext)
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
      companyId: images[0]?.companyId ?? "",
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

  private evidenceLocatorForImage(image: ParsedDocument["images"][number]): EvidenceBlock["locator"] | undefined {
    if (image.sourceSlide !== undefined) return { slide: image.sourceSlide }
    if (image.sourceSheet) return { sheet: image.sourceSheet }
    if (image.sourcePage !== undefined) return { page: image.sourcePage }
    return undefined
  }

  private async buildChunks(kbId: string, pageId: string, content: string): Promise<PageChunk[]> {
    const companyId = (await this.repo.getKnowledgeBase(kbId))?.companyId
    if (!companyId) throw new Error("Knowledge base not found")
    const chunks: PageChunk[] = []
    let ordinal = 0
    for (const text of chunkText(content)) {
      chunks.push({
        id: id("chk"),
        companyId,
        kbId,
        pageId,
        text,
        ordinal,
        tokens: tokenize(text),
        embedding: await this.llm.embedForKnowledgeBase(kbId, text),
      })
      ordinal += 1
    }
    return chunks
  }

  private renderPageCatalog(pages: WikiPage[]): string {
    return pages
      .filter((page) => !isStructuralWikiPage(page))
      .slice(0, 240)
      .map((page) => `- ${page.id} [${page.type}] ${page.title} (${page.path})`)
      .join("\n")
  }

  private async rebuildTouchedPageLinks(kbId: string, touchedPages: WikiPage[], resolverPages: WikiPage[]): Promise<void> {
    const linkPages = this.uniquePages(resolverPages).filter((page) => page.type !== "query" && !isStructuralWikiPage(page))
    const resolver = new WikiLinkResolver(linkPages)
    for (const page of touchedPages) {
      if (page.kbId !== kbId) continue
      await this.repo.replacePageLinks(kbId, page.id, wikiLinksForPage(page, resolver))
    }
  }

  private async rebuildPageLinks(kbId: string, pages: WikiPage[]): Promise<void> {
    const resolver = new WikiLinkResolver(pages)
    for (const page of pages) {
      if (page.kbId !== kbId) continue
      await this.repo.replacePageLinks(kbId, page.id, wikiLinksForPage(page, resolver))
    }
  }

  private async rebuildIndexPage(kbId: string): Promise<WikiPage> {
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
    const kb = await this.repo.getKnowledgeBase(kbId)
    if (!kb) throw new Error("Knowledge base not found")
    return this.repo.upsertPage({ ...this.buildPage(kbId, "wiki/index.md", content, "system", []), companyId: kb.companyId })
  }

  private ensureNotCancelled(jobId: string): void {
    if (this.cancelled.has(jobId)) throw new Error("Job cancelled")
  }
}
