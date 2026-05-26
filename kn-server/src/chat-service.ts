import type { ChatMessage, SearchResult } from "./types.js"
import { JsonIndexRepository } from "./repository.js"
import { GraphService } from "./graph-service.js"
import { LlmGateway } from "./llm-gateway.js"
import { SearchService } from "./search-service.js"
import { id, nowIso } from "./wiki-utils.js"

function isGreeting(text: string): boolean {
  return /^(hi|hello|hey|你好|您好|嗨)[!！。.\s]*$/i.test(text.trim())
}

export class ChatService {
  constructor(
    private readonly repo: JsonIndexRepository,
    private readonly search: SearchService,
    private readonly graph: GraphService,
    private readonly llm: LlmGateway,
  ) {}

  async ask(input: { kbId: string; conversationId?: string; question: string }): Promise<{
    conversationId: string
    answer: string
    citations: SearchResult[]
  }> {
    const conversationId = input.conversationId || id("conv")
    await this.repo.addChatMessage({
      id: id("msg"),
      kbId: input.kbId,
      conversationId,
      role: "user",
      content: input.question,
      citations: [],
      createdAt: nowIso(),
    })

    if (isGreeting(input.question)) {
      const answer = "你好，我可以基于这个知识库做召回、解释图谱关系，或回答具体问题。"
      await this.persistAssistant(input.kbId, conversationId, answer, [])
      return { conversationId, answer, citations: [] }
    }

    const search = await this.search.search(input.kbId, input.question, 8)
    const graph = await this.graph.buildGraph(input.kbId)
    const expandedIds = new Set<string>()
    for (const result of search.results.slice(0, 5)) {
      for (const edge of graph.edges.filter((edge) => edge.source === result.pageId || edge.target === result.pageId).slice(0, 2)) {
        expandedIds.add(edge.source === result.pageId ? edge.target : edge.source)
      }
    }
    const pages = await this.repo.listPages(input.kbId)
    const expanded = pages
      .filter((page) => expandedIds.has(page.id) && !search.results.some((result) => result.pageId === page.id))
      .slice(0, 3)

    const contexts = [
      ...search.results.slice(0, 6).map((result, index) => ({
        number: index + 1,
        title: result.title,
        path: result.path,
        content: pages.find((page) => page.id === result.pageId)?.content.slice(0, 5000) ?? result.snippet,
      })),
      ...expanded.map((page, index) => ({
        number: search.results.length + index + 1,
        title: page.title,
        path: page.path,
        content: page.content.slice(0, 3000),
      })),
    ]

    const fallback = this.fallbackAnswer(input.question, search.results)
    const answer = await this.llm.complete(
      [
        {
          role: "system",
          content: [
            "You are a browser knowledge-base assistant using the llm_wiki retrieval pipeline.",
            "Answer only from the numbered wiki pages. If evidence is insufficient, say so.",
            "Use citations like [1], [2]. Prefer concise Chinese unless the user asks otherwise.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Question: ${input.question}`,
            "Wiki pages:",
            contexts.map((ctx) => `### [${ctx.number}] ${ctx.title}\nPath: ${ctx.path}\n\n${ctx.content}`).join("\n\n---\n\n"),
          ].join("\n\n"),
        },
      ],
      fallback,
      1400,
    )

    await this.persistAssistant(input.kbId, conversationId, answer, search.results)
    return { conversationId, answer, citations: search.results.slice(0, 6) }
  }

  private fallbackAnswer(question: string, results: SearchResult[]): string {
    if (results.length === 0) {
      return `没有从当前知识库召回到足够内容来回答：“${question}”。`
    }
    return [
      `根据当前召回结果，问题“${question}”最相关的是：`,
      ...results.slice(0, 5).map((result, index) => `${index + 1}. ${result.title}（${result.path}）：${result.snippet}`),
      "",
      "这是本地召回答案；配置 KN_LLM_ENDPOINT 后会由 LLM 基于这些页面生成完整回答。",
    ].join("\n")
  }

  private async persistAssistant(kbId: string, conversationId: string, answer: string, citations: SearchResult[]): Promise<ChatMessage> {
    return this.repo.addChatMessage({
      id: id("msg"),
      kbId,
      conversationId,
      role: "assistant",
      content: answer,
      citations: citations.slice(0, 6).map((result) => ({
        pageId: result.pageId,
        title: result.title,
        path: result.path,
      })),
      createdAt: nowIso(),
    })
  }
}

