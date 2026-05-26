import type { ReviewItem } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import type { SourceService } from "./source-service.js"
import { LlmGateway } from "./llm-gateway.js"
import { id, nowIso } from "./wiki-utils.js"

export class ResearchService {
  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly sourceService: SourceService,
    private readonly llm: LlmGateway,
  ) {}

  async run(kbId: string, topic: string): Promise<{
    queries: string[]
    imported: number
    review: ReviewItem
  }> {
    const kb = await this.repo.getKnowledgeBase(kbId)
    if (!kb) throw new Error("Knowledge base not found")
    const optimized = await this.llm.completeForCompany(
      kb.companyId,
      [
        {
          role: "system",
          content: "Generate 3 concise web search queries for deep research. Return one query per line.",
        },
        { role: "user", content: topic },
      ],
      `${topic}\n${topic} overview\n${topic} recent research`,
      300,
    )
    const queries = optimized.split(/\r?\n/).map((line) => line.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean).slice(0, 3)
    const findings = await this.searchWeb(queries)
    let imported = 0
    if (findings.trim()) {
      const bytes = Buffer.from(`# Deep Research: ${topic}\n\n${findings}\n`, "utf-8")
      await this.sourceService.saveUpload({
        kbId,
        fileName: `${topic.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "-") || "deep-research"}.md`,
        relativePath: `deep-research/${Date.now()}-${topic}.md`,
        contentType: "text/markdown",
        bytes,
      })
      imported = 1
    }

    const review = await this.repo.addReview({
      id: id("rev"),
      companyId: kb.companyId,
      kbId,
      kind: "deep-research",
      title: "Deep research queued",
      description: findings.trim()
        ? `Imported web findings for topic: ${topic}`
        : `No search provider was configured. Planned queries: ${queries.join("; ")}`,
      query: topic,
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    return { queries, imported, review }
  }

  private async searchWeb(queries: string[]): Promise<string> {
    if (process.env.TAVILY_API_KEY) return this.searchTavily(queries)
    if (process.env.SEARXNG_URL) return this.searchSearxng(queries)
    return ""
  }

  private async searchTavily(queries: string[]): Promise<string> {
    const outputs: string[] = []
    for (const query of queries) {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 5 }),
      })
      if (!response.ok) continue
      const json = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> }
      outputs.push(`## Query: ${query}`)
      for (const item of json.results ?? []) outputs.push(`- ${item.title ?? item.url}: ${item.content ?? ""}\n  ${item.url ?? ""}`)
    }
    return outputs.join("\n\n")
  }

  private async searchSearxng(queries: string[]): Promise<string> {
    const base = process.env.SEARXNG_URL?.replace(/\/$/, "")
    if (!base) return ""
    const outputs: string[] = []
    for (const query of queries) {
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`
      const response = await fetch(url)
      if (!response.ok) continue
      const json = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> }
      outputs.push(`## Query: ${query}`)
      for (const item of json.results?.slice(0, 5) ?? []) outputs.push(`- ${item.title ?? item.url}: ${item.content ?? ""}\n  ${item.url ?? ""}`)
    }
    return outputs.join("\n\n")
  }
}
