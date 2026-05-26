import fs from "node:fs/promises"
import path from "node:path"
import type {
  ChatMessage,
  ImageAsset,
  IngestJob,
  KnowledgeBase,
  PageChunk,
  PageSource,
  ReviewItem,
  SourceDocument,
  WikiLink,
  WikiPage,
} from "./types.js"
import { nowIso } from "./wiki-utils.js"

interface RepoData {
  knowledgeBases: KnowledgeBase[]
  sources: SourceDocument[]
  jobs: IngestJob[]
  pages: WikiPage[]
  links: WikiLink[]
  pageSources: PageSource[]
  chunks: PageChunk[]
  images: ImageAsset[]
  reviews: ReviewItem[]
  chats: ChatMessage[]
  ingestCache: Record<string, { sourceHash: string; pageIds: string[]; updatedAt: string }>
}

function emptyData(): RepoData {
  return {
    knowledgeBases: [],
    sources: [],
    jobs: [],
    pages: [],
    links: [],
    pageSources: [],
    chunks: [],
    images: [],
    reviews: [],
    chats: [],
    ingestCache: {},
  }
}

export class JsonIndexRepository {
  private readonly filePath: string
  private lock: Promise<void> = Promise.resolve()

  constructor(rootDir: string) {
    this.filePath = path.join(rootDir, "index.json")
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      await fs.access(this.filePath)
    } catch {
      await this.save(emptyData())
    }
    await this.mutate((data) => {
      const now = nowIso()
      for (const job of data.jobs) {
        if (job.status === "running" || job.status === "queued") {
          job.status = "queued"
          job.stage = "Recovered after server restart"
          job.updatedAt = now
        }
      }
    })
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    return this.read().then((data) => [...data.knowledgeBases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  }

  async getKnowledgeBase(kbId: string): Promise<KnowledgeBase | undefined> {
    return this.read().then((data) => data.knowledgeBases.find((kb) => kb.id === kbId))
  }

  async saveKnowledgeBase(kb: KnowledgeBase): Promise<KnowledgeBase> {
    await this.mutate((data) => {
      const index = data.knowledgeBases.findIndex((item) => item.id === kb.id)
      if (index >= 0) data.knowledgeBases[index] = kb
      else data.knowledgeBases.push(kb)
    })
    return kb
  }

  async bumpDataVersion(kbId: string): Promise<void> {
    await this.mutate((data) => {
      const kb = data.knowledgeBases.find((item) => item.id === kbId)
      if (!kb) return
      kb.dataVersion += 1
      kb.updatedAt = nowIso()
    })
  }

  async saveSource(source: SourceDocument): Promise<SourceDocument> {
    await this.mutate((data) => {
      const index = data.sources.findIndex((item) => item.id === source.id)
      if (index >= 0) data.sources[index] = source
      else data.sources.push(source)
    })
    return source
  }

  async listSources(kbId: string): Promise<SourceDocument[]> {
    return this.read().then((data) =>
      data.sources.filter((source) => source.kbId === kbId).sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    )
  }

  async getSource(sourceId: string): Promise<SourceDocument | undefined> {
    return this.read().then((data) => data.sources.find((source) => source.id === sourceId))
  }

  async saveJob(job: IngestJob): Promise<IngestJob> {
    await this.mutate((data) => {
      const index = data.jobs.findIndex((item) => item.id === job.id)
      if (index >= 0) data.jobs[index] = job
      else data.jobs.push(job)
    })
    return job
  }

  async listJobs(kbId?: string): Promise<IngestJob[]> {
    return this.read().then((data) =>
      data.jobs
        .filter((job) => !kbId || job.kbId === kbId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    )
  }

  async getJob(jobId: string): Promise<IngestJob | undefined> {
    return this.read().then((data) => data.jobs.find((job) => job.id === jobId))
  }

  async listQueuedJobs(): Promise<IngestJob[]> {
    return this.read().then((data) =>
      data.jobs
        .filter((job) => job.status === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    )
  }

  async upsertPage(page: WikiPage): Promise<WikiPage> {
    await this.mutate((data) => {
      const index = data.pages.findIndex((item) => item.kbId === page.kbId && item.id === page.id)
      if (index >= 0) data.pages[index] = page
      else data.pages.push(page)
    })
    return page
  }

  async listPages(kbId: string): Promise<WikiPage[]> {
    return this.read().then((data) =>
      data.pages.filter((page) => page.kbId === kbId).sort((a, b) => a.path.localeCompare(b.path)),
    )
  }

  async getPage(kbId: string, pageId: string): Promise<WikiPage | undefined> {
    return this.read().then((data) => data.pages.find((page) => page.kbId === kbId && page.id === pageId))
  }

  async replacePageLinks(kbId: string, pageId: string, links: WikiLink[]): Promise<void> {
    await this.mutate((data) => {
      data.links = data.links.filter((link) => !(link.kbId === kbId && link.sourcePageId === pageId))
      data.links.push(...links)
    })
  }

  async listLinks(kbId: string): Promise<WikiLink[]> {
    return this.read().then((data) => data.links.filter((link) => link.kbId === kbId))
  }

  async replacePageSources(kbId: string, pageId: string, pageSources: PageSource[]): Promise<void> {
    await this.mutate((data) => {
      data.pageSources = data.pageSources.filter((source) => !(source.kbId === kbId && source.pageId === pageId))
      data.pageSources.push(...pageSources)
    })
  }

  async listPageSources(kbId: string): Promise<PageSource[]> {
    return this.read().then((data) => data.pageSources.filter((source) => source.kbId === kbId))
  }

  async replaceChunks(kbId: string, pageId: string, chunks: PageChunk[]): Promise<void> {
    await this.mutate((data) => {
      data.chunks = data.chunks.filter((chunk) => !(chunk.kbId === kbId && chunk.pageId === pageId))
      data.chunks.push(...chunks)
    })
  }

  async listChunks(kbId: string): Promise<PageChunk[]> {
    return this.read().then((data) => data.chunks.filter((chunk) => chunk.kbId === kbId))
  }

  async saveImage(image: ImageAsset): Promise<ImageAsset> {
    await this.mutate((data) => {
      const index = data.images.findIndex((item) => item.id === image.id)
      if (index >= 0) data.images[index] = image
      else data.images.push(image)
    })
    return image
  }

  async listImages(kbId: string): Promise<ImageAsset[]> {
    return this.read().then((data) => data.images.filter((image) => image.kbId === kbId))
  }

  async addReview(review: ReviewItem): Promise<ReviewItem> {
    await this.mutate((data) => {
      const index = data.reviews.findIndex((item) => item.id === review.id)
      if (index >= 0) data.reviews[index] = review
      else data.reviews.push(review)
    })
    return review
  }

  async listReviews(kbId: string): Promise<ReviewItem[]> {
    return this.read().then((data) =>
      data.reviews.filter((review) => review.kbId === kbId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    )
  }

  async updateReviewStatus(kbId: string, reviewId: string, status: ReviewItem["status"]): Promise<ReviewItem | undefined> {
    let result: ReviewItem | undefined
    await this.mutate((data) => {
      const review = data.reviews.find((item) => item.kbId === kbId && item.id === reviewId)
      if (!review) return
      review.status = status
      review.updatedAt = nowIso()
      result = review
    })
    return result
  }

  async addChatMessage(message: ChatMessage): Promise<ChatMessage> {
    await this.mutate((data) => {
      data.chats.push(message)
    })
    return message
  }

  async listChatMessages(kbId: string, conversationId: string): Promise<ChatMessage[]> {
    return this.read().then((data) =>
      data.chats
        .filter((message) => message.kbId === kbId && message.conversationId === conversationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    )
  }

  async getIngestCache(kbId: string, sourceId: string): Promise<{ sourceHash: string; pageIds: string[] } | undefined> {
    return this.read().then((data) => data.ingestCache[`${kbId}:${sourceId}`])
  }

  async setIngestCache(kbId: string, sourceId: string, sourceHash: string, pageIds: string[]): Promise<void> {
    await this.mutate((data) => {
      data.ingestCache[`${kbId}:${sourceId}`] = { sourceHash, pageIds, updatedAt: nowIso() }
    })
  }

  private async read(): Promise<RepoData> {
    const raw = await fs.readFile(this.filePath, "utf-8")
    return { ...emptyData(), ...JSON.parse(raw) } as RepoData
  }

  private async save(data: RepoData): Promise<void> {
    await fs.writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`)
  }

  private async mutate(mutator: (data: RepoData) => void | Promise<void>): Promise<void> {
    this.lock = this.lock.then(async () => {
      const data = await this.read()
      await mutator(data)
      await this.save(data)
    })
    await this.lock
  }
}

