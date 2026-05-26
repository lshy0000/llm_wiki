import type { ImageAsset, SearchResult, WikiPage } from "./types.js"
import { JsonIndexRepository } from "./repository.js"
import { LlmGateway } from "./llm-gateway.js"
import { buildSnippet, tokenize } from "./wiki-utils.js"

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let aMag = 0
  let bMag = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    aMag += a[i] * a[i]
    bMag += b[i] * b[i]
  }
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag) || 1)
}

export class SearchService {
  constructor(
    private readonly repo: JsonIndexRepository,
    private readonly llm: LlmGateway,
    private readonly dataDir: string,
  ) {}

  async search(kbId: string, query: string, topK = 20): Promise<{
    mode: "keyword" | "vector" | "hybrid"
    results: SearchResult[]
  }> {
    const pages = await this.repo.listPages(kbId)
    const images = await this.repo.listImages(kbId)
    const tokens = tokenize(query)
    const keywordRank = this.keywordRank(pages, images, tokens, query)
    const vectorRank = await this.vectorRank(kbId, pages, query)
    const merged = this.rrf(keywordRank, vectorRank).slice(0, topK)
    const results = merged.map((entry) => {
      const keyword = keywordRank.find((item) => item.page.id === entry.page.id)
      const vector = vectorRank.find((item) => item.page.id === entry.page.id)
      return {
        pageId: entry.page.id,
        path: entry.page.path,
        title: entry.page.title,
        snippet: buildSnippet(entry.page.content, query),
        score: entry.score,
        keywordScore: keyword?.score ?? 0,
        vectorScore: vector?.score,
        titleMatch: keyword?.titleMatch ?? false,
        sources: entry.page.sources,
        images: entry.page.images,
      }
    })
    return {
      mode: vectorRank.length > 0 && keywordRank.length > 0 ? "hybrid" : vectorRank.length > 0 ? "vector" : "keyword",
      results,
    }
  }

  private keywordRank(
    pages: WikiPage[],
    images: ImageAsset[],
    tokens: string[],
    query: string,
  ): Array<{ page: WikiPage; score: number; titleMatch: boolean }> {
    const queryLower = query.toLowerCase()
    return pages
      .map((page) => {
        const titleLower = page.title.toLowerCase()
        const contentLower = page.content.toLowerCase()
        const imageText = images
          .filter((image) => image.pageId === page.id || page.sources.includes(image.sourceId))
          .map((image) => `${image.caption} ${image.fileName}`)
          .join("\n")
          .toLowerCase()
        const titleMatch = titleLower.includes(queryLower) || tokens.some((token) => titleLower.includes(token))
        let score = titleMatch ? 12 : 0
        for (const token of tokens) {
          if (contentLower.includes(token)) score += 2
          if (imageText.includes(token)) score += 3
        }
        return { page, score, titleMatch }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
  }

  private async vectorRank(kbId: string, pages: WikiPage[], query: string): Promise<Array<{ page: WikiPage; score: number }>> {
    const queryEmbedding = await this.llm.embed(query)
    if (!queryEmbedding) return []
    const chunks = await this.repo.listChunks(kbId)
    const lance = await this.lanceRank(kbId, pages, chunks, queryEmbedding)
    if (lance.length > 0) return lance
    const pageById = new Map(pages.map((page) => [page.id, page]))
    const best = new Map<string, number>()
    for (const chunk of chunks) {
      if (!chunk.embedding) continue
      const score = cosine(queryEmbedding, chunk.embedding)
      if (score > (best.get(chunk.pageId) ?? -Infinity)) best.set(chunk.pageId, score)
    }
    return [...best.entries()]
      .map(([pageId, score]) => ({ page: pageById.get(pageId), score }))
      .filter((item): item is { page: WikiPage; score: number } => Boolean(item.page))
      .sort((a, b) => b.score - a.score)
  }

  private async lanceRank(
    kbId: string,
    pages: WikiPage[],
    chunks: Array<{ id: string; pageId: string; text: string; embedding?: number[] }>,
    queryEmbedding: number[],
  ): Promise<Array<{ page: WikiPage; score: number }>> {
    const rows = chunks
      .filter((chunk) => chunk.embedding && chunk.embedding.length === queryEmbedding.length)
      .map((chunk) => ({
        id: chunk.id,
        pageId: chunk.pageId,
        text: chunk.text,
        vector: chunk.embedding,
      }))
    if (rows.length === 0) return []

    try {
      const lancedb = await import("@lancedb/lancedb")
      const db = await lancedb.connect(`${this.dataDir}/lancedb`)
      const tableName = `chunks_${kbId.replace(/[^a-zA-Z0-9_]/g, "_")}`
      const names = await db.tableNames()
      const table = names.includes(tableName)
        ? await db.openTable(tableName)
        : await db.createTable(tableName, rows)
      if (names.includes(tableName)) await table.add(rows, { mode: "overwrite" })
      const nearest = await table.query().nearestTo(queryEmbedding).limit(20).toArray()
      const pageById = new Map(pages.map((page) => [page.id, page]))
      const best = new Map<string, number>()
      for (const row of nearest as Array<{ pageId?: string; _distance?: number }>) {
        if (!row.pageId) continue
        const score = 1 / (1 + (row._distance ?? 0))
        if (score > (best.get(row.pageId) ?? 0)) best.set(row.pageId, score)
      }
      return [...best.entries()]
        .map(([pageId, score]) => ({ page: pageById.get(pageId), score }))
        .filter((item): item is { page: WikiPage; score: number } => Boolean(item.page))
        .sort((a, b) => b.score - a.score)
    } catch {
      return []
    }
  }

  private rrf(
    keyword: Array<{ page: WikiPage; score: number }>,
    vector: Array<{ page: WikiPage; score: number }>,
  ): Array<{ page: WikiPage; score: number }> {
    const scores = new Map<string, { page: WikiPage; score: number }>()
    const add = (items: Array<{ page: WikiPage; score: number }>, weight: number) => {
      items.forEach((item, index) => {
        const current = scores.get(item.page.id) ?? { page: item.page, score: 0 }
        current.score += weight / (60 + index + 1)
        scores.set(item.page.id, current)
      })
    }
    add(keyword, 1)
    add(vector, 1.2)
    return [...scores.values()].sort((a, b) => b.score - a.score)
  }
}
