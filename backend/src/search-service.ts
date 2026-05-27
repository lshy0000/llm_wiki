import type { ImageAsset, SearchResult, WikiPage } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import { LlmGateway } from "./llm-gateway.js"
import { buildSnippet, tokenize } from "./wiki-utils.js"

export class SearchService {
  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly llm: LlmGateway,
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
    const queryEmbedding = await this.llm.embedForKnowledgeBase(kbId, query)
    if (!queryEmbedding) return []
    const pageById = new Map(pages.map((page) => [page.id, page]))
    return (await this.repo.searchPagesByVector(kbId, queryEmbedding, 20))
      .map((item) => ({ page: pageById.get(item.pageId), score: item.score }))
      .filter((item): item is { page: WikiPage; score: number } => Boolean(item.page))
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
