import type { LlmGateway, LlmMessage } from "./llm-gateway.js"
import type { KnowledgeRepository } from "./repository.js"
import type { ToolDefinition, ToolService } from "./tool-service.js"
import type { AuthContext, ChatMessage, KnowledgeBase, SearchDiagnostics } from "./types.js"
import { id, nowIso } from "./wiki-utils.js"

export type AgentTraceType = "plan" | "tool" | "observation" | "answer"

export interface AgentTraceStep {
  id: string
  type: AgentTraceType
  title: string
  detail: string
  toolName?: string
  latencyMs?: number
  input?: unknown
  outputSummary?: unknown
}

export interface AgentChatResponse {
  conversationId: string
  answer: string
  citations: ChatMessage["citations"]
  trace: AgentTraceStep[]
}

interface AgentAskInput {
  auth: AuthContext
  kb: KnowledgeBase
  question: string
  conversationId?: string
}

interface RetrievalToolResult {
  mode?: string
  diagnostics?: SearchDiagnostics
  results: RetrievalItem[]
}

interface RetrievalItem {
  pageId: string
  path: string
  title: string
  snippet: string
  score: number
  reasons?: string[]
}

interface FileToolResult {
  key: string
  content: string
  bytes: number
  truncated: boolean
}

interface MindmapToolResult {
  markdown?: string
  summary?: {
    pageCount: number
    edgeCount: number
    communityCount: number
  }
}

interface EvidenceFile {
  key: string
  content: string
  truncated: boolean
}

interface CustomToolEvidence {
  toolName: string
  result: unknown
}

const HISTORY_LIMIT = 8
const SNIPPET_RESULT_LIMIT = 8
const DEFAULT_TOP_K = 8
const DEEP_TOP_K = 12
const MAX_FILE_READS = 3
const FILE_READ_BYTES = 12000

export class AgentService {
  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly llm: LlmGateway,
    private readonly tools: ToolService,
  ) {}

  async ask(input: AgentAskInput): Promise<AgentChatResponse> {
    const question = input.question.trim()
    if (!question) throw new Error("question is required")

    const conversationId = input.conversationId?.trim() || id("conv")
    const trace: AgentTraceStep[] = []
    const context = { auth: input.auth, kb: input.kb }
    const history = await this.repo.listChatMessages(input.kb.id, conversationId)

    trace.push(step("plan", "规划", this.routeSummary(question)))

    await this.repo.addChatMessage({
      id: id("msg"),
      companyId: input.kb.companyId,
      kbId: input.kb.id,
      conversationId,
      role: "user",
      content: question,
      citations: [],
      createdAt: nowIso(),
    })

    if (isGreeting(question)) {
      const answer = await this.answerGreeting(input.kb.companyId, question)
      await this.storeAssistant(input.kb, conversationId, answer, [])
      trace.push(step("answer", "直接回答", "识别为寒暄，不调用知识库工具。"))
      return { conversationId, answer, citations: [], trace }
    }

    const needsGraph = shouldUseMindmap(question)
    const topK = needsGraph ? DEEP_TOP_K : DEFAULT_TOP_K
    const retrievalRun = this.runTool(context, trace, "retrieve_kb", { query: question, topK })
    const mindmapRun = needsGraph
      ? this.runTool(context, trace, "get_mindmap", { maxNodesPerCommunity: 8, maxEdges: 24 })
      : Promise.resolve(undefined)

    let retrieval = asRetrievalResult((await retrievalRun).result)
    const mindmap = asMindmapResult((await mindmapRun)?.result)
    const customToolResults = await this.runMatchedCustomTools(context, trace, question)

    if (isWeakRecall(retrieval, question)) {
      const embedding = await this.llm.embedForKnowledgeBase(input.kb.id, question)
      if (embedding) {
        trace.push(step("observation", "弱召回重试", "首次召回信号较弱，追加一次向量召回。"))
        retrieval = asRetrievalResult((await this.runTool(context, trace, "retrieve_kb", {
          query: question,
          topK: DEEP_TOP_K,
          queryEmbedding: embedding,
        })).result)
      } else {
        trace.push(step("observation", "弱召回", "首次召回信号较弱，未找到可用向量模型，继续使用关键词和图谱结果。"))
      }
    }

    const files = await this.readEvidenceFiles(context, trace, retrieval, shouldReadEvidence(question, retrieval))
    const citations = citationsFrom(retrieval)
    const fallback = fallbackAnswer(question, retrieval, files)
    const answer = await this.generateAnswer(input.kb, question, history, retrieval, mindmap, files, customToolResults, fallback)

    await this.storeAssistant(input.kb, conversationId, answer, citations)
    trace.push(step("answer", "生成回答", `基于 ${retrieval.results.length} 条召回结果和 ${files.length} 个页面片段生成答案。`, {
      outputSummary: { citations: citations.length },
    }))

    return { conversationId, answer, citations, trace }
  }

  private async answerGreeting(companyId: string, question: string): Promise<string> {
    return this.llm.completeForCompany(
      companyId,
      [
        {
          role: "system",
          content: "Reply briefly and naturally. The user is chatting inside a knowledge-base assistant.",
        },
        { role: "user", content: question },
      ],
      "你好，我可以基于当前知识库帮你检索、归纳和回答问题。",
      240,
    )
  }

  private async generateAnswer(
    kb: KnowledgeBase,
    question: string,
    history: ChatMessage[],
    retrieval: RetrievalToolResult,
    mindmap: MindmapToolResult | undefined,
    files: EvidenceFile[],
    customToolResults: CustomToolEvidence[],
    fallback: string,
  ): Promise<string> {
    const messages: LlmMessage[] = [
      {
        role: "system",
        content: [
          "You are a fast knowledge-base agent.",
          "Answer using only the provided knowledge-base evidence.",
          "If the evidence is insufficient, say what is missing instead of inventing facts.",
          "Use the user's language.",
          "Cite relevant page titles or paths inline when useful.",
          "Do not reveal hidden chain-of-thought. The UI shows public tool execution separately.",
        ].join("\n"),
      },
      ...history.slice(-HISTORY_LIMIT).map((message): LlmMessage => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: "user",
        content: renderAgentPrompt(kb, question, retrieval, mindmap, files, customToolResults),
      },
    ]
    return this.llm.completeForCompany(kb.companyId, messages, fallback, 1800)
  }

  private async readEvidenceFiles(
    context: { auth: AuthContext; kb: KnowledgeBase },
    trace: AgentTraceStep[],
    retrieval: RetrievalToolResult,
    detailed: boolean,
  ): Promise<EvidenceFile[]> {
    const limit = detailed ? MAX_FILE_READS : Math.min(2, MAX_FILE_READS)
    const keys = unique(
      retrieval.results
        .map((result) => result.path)
        .filter((path) => path.startsWith("wiki/") || path.startsWith("raw/")),
    ).slice(0, limit)
    const files: EvidenceFile[] = []
    for (const key of keys) {
      const response = await this.runTool(context, trace, "read_kb_file", { key, maxBytes: FILE_READ_BYTES }).catch((err) => {
        trace.push(step("observation", "读取跳过", err instanceof Error ? err.message : String(err), { outputSummary: { key } }))
        return undefined
      })
      const file = asFileResult(response?.result)
      if (file) files.push({ key: file.key, content: file.content, truncated: file.truncated })
    }
    return files
  }

  private async runMatchedCustomTools(
    context: { auth: AuthContext; kb: KnowledgeBase },
    trace: AgentTraceStep[],
    question: string,
  ): Promise<CustomToolEvidence[]> {
    const candidates = this.tools.agentDefinitions({ kbScoped: true })
      .filter((definition) => definition.source === "custom")
      .filter((definition) => definition.scope === "global" || context.kb)
      .filter((definition) => canAutoFill(definition) && matchesCustomTool(question, definition))
      .slice(0, 3)
    const results: CustomToolEvidence[] = []
    for (const definition of candidates) {
      try {
        const response = await this.runTool(context, trace, definition.name, autoFillArgs(definition, question, context.kb.id))
        results.push({ toolName: definition.name, result: response.result })
      } catch (err) {
        trace.push(step("observation", "自定义工具跳过", err instanceof Error ? err.message : String(err), {
          toolName: definition.name,
        }))
      }
    }
    return results
  }

  private async runTool(
    context: { auth: AuthContext; kb: KnowledgeBase },
    trace: AgentTraceStep[],
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ result: unknown }> {
    const started = Date.now()
    const response = await this.tools.run(toolName, context, args)
    const latencyMs = Date.now() - started
    trace.push(step("tool", toolName, toolDetail(toolName, response.result), {
      toolName,
      latencyMs,
      input: summarizeToolInput(args),
      outputSummary: summarizeToolOutput(response.result),
    }))
    return { result: response.result }
  }

  private async storeAssistant(kb: KnowledgeBase, conversationId: string, answer: string, citations: ChatMessage["citations"]): Promise<void> {
    await this.repo.addChatMessage({
      id: id("msg"),
      companyId: kb.companyId,
      kbId: kb.id,
      conversationId,
      role: "assistant",
      content: answer,
      citations,
      createdAt: nowIso(),
    })
  }

  private routeSummary(question: string): string {
    if (isGreeting(question)) return "寒暄问题走直接回答。"
    if (shouldUseMindmap(question)) return "问题需要结构化理解，将并行使用召回和知识图谱概览。"
    return "先执行快速召回；如果召回弱，再自动加深。"
  }
}

function renderAgentPrompt(
  kb: KnowledgeBase,
  question: string,
  retrieval: RetrievalToolResult,
  mindmap: MindmapToolResult | undefined,
  files: EvidenceFile[],
  customToolResults: CustomToolEvidence[],
): string {
  return [
    `Knowledge base: ${kb.name}`,
    `User question: ${question}`,
    "",
    "Recall results:",
    ...retrieval.results.slice(0, SNIPPET_RESULT_LIMIT).map((result, index) => [
      `${index + 1}. ${result.title} (${result.path}) score=${result.score}`,
      `Snippet: ${result.snippet}`,
      result.reasons?.length ? `Reasons: ${result.reasons.join(", ")}` : "",
    ].filter(Boolean).join("\n")),
    mindmap?.markdown ? ["", "Mindmap:", mindmap.markdown.slice(0, 6000)].join("\n") : "",
    customToolResults.length ? [
      "",
      "Custom tool results:",
      ...customToolResults.map((item) => `Tool: ${item.toolName}\n${JSON.stringify(item.result, null, 2).slice(0, 4000)}`),
    ].join("\n\n") : "",
    files.length ? ["", "Page excerpts:", ...files.map((file) => [
      `File: ${file.key}${file.truncated ? " (truncated)" : ""}`,
      file.content.slice(0, FILE_READ_BYTES),
    ].join("\n"))].join("\n\n") : "",
    "",
    "Write the final answer now.",
  ].filter(Boolean).join("\n")
}

function canAutoFill(definition: ToolDefinition): boolean {
  const required = definition.parameters.required ?? []
  return required.every((key) => key === "query" || key === "question" || key === "kbId")
}

function autoFillArgs(definition: ToolDefinition, question: string, kbId: string): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const [key, property] of Object.entries(definition.parameters.properties)) {
    if (property.default !== undefined) args[key] = property.default
  }
  if ("query" in definition.parameters.properties) args.query = question
  if ("question" in definition.parameters.properties) args.question = question
  if ("kbId" in definition.parameters.properties) args.kbId = kbId
  return args
}

function matchesCustomTool(question: string, definition: ToolDefinition): boolean {
  const lower = question.toLowerCase()
  const triggers = definition.triggers?.length
    ? definition.triggers
    : [definition.name, definition.displayName]
  return triggers.some((trigger) => trigger && lower.includes(trigger.toLowerCase()))
}

function fallbackAnswer(question: string, retrieval: RetrievalToolResult, files: EvidenceFile[]): string {
  if (retrieval.results.length === 0) {
    return `我没有在当前知识库中找到足够证据回答“${question}”。可以换一个更具体的关键词，或先补充相关资料。`
  }
  const lines = [
    `我先根据当前知识库召回到的内容回答“${question}”：`,
    "",
    ...retrieval.results.slice(0, 5).map((result, index) => `${index + 1}. ${result.title} (${result.path})：${result.snippet}`),
  ]
  if (files.length > 0) lines.push("", `已读取 ${files.length} 个页面片段用于核对。`)
  return lines.join("\n")
}

function citationsFrom(retrieval: RetrievalToolResult): ChatMessage["citations"] {
  const seen = new Set<string>()
  const citations: ChatMessage["citations"] = []
  for (const result of retrieval.results) {
    if (seen.has(result.pageId)) continue
    seen.add(result.pageId)
    citations.push({ pageId: result.pageId, title: result.title, path: result.path })
    if (citations.length >= 8) break
  }
  return citations
}

function isGreeting(question: string): boolean {
  const value = question.trim().toLowerCase()
  return /^(hi|hello|hey|你好|您好|嗨|哈喽)[!！。.\s]*$/.test(value)
}

function shouldUseMindmap(question: string): boolean {
  return /(架构|结构|全局|整体|概览|总结|关系|关联|路径|脉络|对比|为什么|如何|怎么|overview|architecture|relationship|compare|summary|summarize|why|how)/i.test(question)
}

function shouldReadEvidence(question: string, retrieval: RetrievalToolResult): boolean {
  if (/(依据|证据|来源|原文|细节|具体|展开|source|evidence|detail|quote)/i.test(question)) return true
  if (retrieval.results.length <= 3) return true
  return (retrieval.results[0]?.score ?? 0) < 45
}

function isWeakRecall(retrieval: RetrievalToolResult, question: string): boolean {
  if (question.length < 6) return false
  if (retrieval.results.length === 0) return true
  const topScore = retrieval.results[0]?.score ?? 0
  return topScore < 18 || (retrieval.results.length < 3 && topScore < 35)
}

function asRetrievalResult(value: unknown): RetrievalToolResult {
  if (!isRecord(value)) return { results: [] }
  const results = Array.isArray(value.results)
    ? value.results.filter(isRecord).map((item): RetrievalItem => ({
      pageId: String(item.pageId ?? ""),
      path: String(item.path ?? ""),
      title: String(item.title ?? ""),
      snippet: String(item.snippet ?? ""),
      score: Number(item.score ?? 0),
      reasons: Array.isArray(item.reasons) ? item.reasons.map(String) : undefined,
    })).filter((item) => item.pageId && item.path && item.title)
    : []
  return {
    mode: typeof value.mode === "string" ? value.mode : undefined,
    diagnostics: isSearchDiagnostics(value.diagnostics) ? value.diagnostics : undefined,
    results,
  }
}

function asFileResult(value: unknown): FileToolResult | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.key !== "string" || typeof value.content !== "string") return undefined
  return {
    key: value.key,
    content: value.content,
    bytes: typeof value.bytes === "number" ? value.bytes : value.content.length,
    truncated: Boolean(value.truncated),
  }
}

function asMindmapResult(value: unknown): MindmapToolResult | undefined {
  if (!isRecord(value)) return undefined
  const summary = isRecord(value.summary)
    ? {
      pageCount: Number(value.summary.pageCount ?? 0),
      edgeCount: Number(value.summary.edgeCount ?? 0),
      communityCount: Number(value.summary.communityCount ?? 0),
    }
    : undefined
  return {
    markdown: typeof value.markdown === "string" ? value.markdown : undefined,
    summary,
  }
}

function isSearchDiagnostics(value: unknown): value is SearchDiagnostics {
  return isRecord(value) &&
    typeof value.seeds === "number" &&
    typeof value.graphHits === "number" &&
    typeof value.lexicalHits === "number" &&
    typeof value.vectorHits === "number"
}

function toolDetail(toolName: string, result: unknown): string {
  if (toolName === "retrieve_kb") {
    const retrieval = asRetrievalResult(result)
    return `召回 ${retrieval.results.length} 个候选页面，模式 ${retrieval.mode ?? "unknown"}。`
  }
  if (toolName === "get_mindmap") {
    const mindmap = asMindmapResult(result)
    return `读取图谱概览：${mindmap?.summary?.pageCount ?? 0} 页，${mindmap?.summary?.communityCount ?? 0} 个社区。`
  }
  if (toolName === "read_kb_file") {
    const file = asFileResult(result)
    return file ? `读取 ${file.key}，${file.bytes} bytes${file.truncated ? "，已截断" : ""}。` : "读取文件。"
  }
  return "工具调用完成。"
}

function summarizeToolInput(args: Record<string, unknown>): unknown {
  const copy = { ...args }
  if (Array.isArray(copy.queryEmbedding)) copy.queryEmbedding = `[${copy.queryEmbedding.length} numbers]`
  return copy
}

function summarizeToolOutput(result: unknown): unknown {
  const retrieval = asRetrievalResult(result)
  if (retrieval.results.length > 0) {
    return {
      mode: retrieval.mode,
      count: retrieval.results.length,
      top: retrieval.results.slice(0, 3).map((item) => ({ title: item.title, path: item.path, score: item.score })),
    }
  }
  const mindmap = asMindmapResult(result)
  if (mindmap?.summary) return mindmap.summary
  const file = asFileResult(result)
  if (file) return { key: file.key, bytes: file.bytes, truncated: file.truncated }
  return undefined
}

function step(type: AgentTraceType, title: string, detail: string, extra: Partial<AgentTraceStep> = {}): AgentTraceStep {
  return {
    id: id("step"),
    type,
    title,
    detail,
    ...extra,
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
