import type { SearchDiagnostics, SearchResult } from "./types.js"
import { RetrievalService, type RetrievalMode } from "./retrieval-service.js"

export class SearchService {
  constructor(private readonly retrieval: RetrievalService) {}

  async search(kbId: string, query: string, topK = 20, options: { queryEmbedding?: number[] } = {}): Promise<{
    mode: RetrievalMode
    results: SearchResult[]
    diagnostics: SearchDiagnostics
  }> {
    return this.retrieval.retrieve(kbId, query, {
      topK,
      queryEmbedding: options.queryEmbedding,
    })
  }
}
