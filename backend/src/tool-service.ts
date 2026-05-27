import type { GraphService } from "./graph-service.js"
import type { ProjectService } from "./project-service.js"
import type { RetrievalService } from "./retrieval-service.js"
import type { StorageProvider } from "./storage.js"
import type { CustomHttpToolConfig, ToolConfigState } from "./tool-config-service.js"
import type { AuthContext, KnowledgeBase } from "./types.js"
import { normalizeStorageKey } from "./wiki-utils.js"

export type ToolScope = "global" | "knowledge_base"
export type ToolCategory = "knowledge" | "retrieval" | "storage" | "external"
export type ToolJsonType = "string" | "number" | "integer" | "boolean" | "array" | "object"
export type ToolSource = "builtin" | "custom"

export interface ToolParameterProperty {
  type: ToolJsonType
  description?: string
  enum?: string[]
  default?: unknown
  minimum?: number
  maximum?: number
  items?: ToolParameterProperty
}

export interface ToolParametersSchema {
  type: "object"
  properties: Record<string, ToolParameterProperty>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolDefinition {
  name: string
  displayName: string
  description: string
  category: ToolCategory
  scope: ToolScope
  readOnly: boolean
  source: ToolSource
  enabled: boolean
  agentEnabled: boolean
  triggers?: string[]
  parameters: ToolParametersSchema
}

export interface ToolRunSuccess {
  tool: string
  ok: true
  result: unknown
}

export interface ToolServiceDependencies {
  project: ProjectService
  retrieval: RetrievalService
  graph: GraphService
  storage: StorageProvider
}

export interface ToolExecutionContext {
  auth: AuthContext
  kb?: KnowledgeBase
}

type ToolArguments = Record<string, unknown>
type ToolHandler = (context: ToolExecutionContext, args: ToolArguments) => Promise<unknown>

interface RegisteredTool {
  definition: ToolDefinition
  handler: ToolHandler
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
  }
}

export class ToolService {
  private readonly tools = new Map<string, RegisteredTool>()
  private readonly customToolNames = new Set<string>()

  constructor(
    private readonly deps: ToolServiceDependencies,
    config: ToolConfigState = { customTools: [] },
  ) {
    this.registerBuiltIns()
    this.applyConfig(config)
  }

  listDefinitions(input: { kbScoped?: boolean; includeDisabled?: boolean } = {}): ToolDefinition[] {
    return [...this.tools.values()]
      .map((tool) => tool.definition)
      .filter((definition) => input.includeDisabled || definition.enabled)
      .filter((definition) => input.kbScoped || definition.scope === "global")
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition
  }

  async run(name: string, context: ToolExecutionContext, args: unknown = {}): Promise<ToolRunSuccess> {
    const tool = this.tools.get(name)
    if (!tool) throw new ToolError("Tool not found", 404)
    if (!tool.definition.enabled) throw new ToolError("Tool is disabled", 403)
    if (tool.definition.scope === "knowledge_base" && !context.kb) {
      throw new ToolError("Knowledge base context is required")
    }
    return {
      tool: tool.definition.name,
      ok: true,
      result: await tool.handler(context, isObject(args) ? args : {}),
    }
  }

  agentDefinitions(input: { kbScoped?: boolean } = {}): ToolDefinition[] {
    return this.listDefinitions({ kbScoped: input.kbScoped }).filter((definition) => definition.agentEnabled)
  }

  applyConfig(config: ToolConfigState): void {
    for (const name of this.customToolNames) this.tools.delete(name)
    this.customToolNames.clear()
    for (const customTool of config.customTools) this.registerCustomTool(customTool)
  }

  private registerBuiltIns(): void {
    this.register({
      definition: {
        name: "list_kbs",
        displayName: "List knowledge bases",
        description: "List knowledge bases visible to the current user.",
        category: "knowledge",
        scope: "global",
        readOnly: true,
        source: "builtin",
        enabled: true,
        agentEnabled: false,
        parameters: objectSchema({}),
      },
      handler: (context) => this.listKbs(context.auth),
    })

    this.register({
      definition: {
        name: "retrieve_kb",
        displayName: "Retrieve knowledge base",
        description: "Run fast graph-first retrieval against the selected knowledge base.",
        category: "retrieval",
        scope: "knowledge_base",
        readOnly: true,
        source: "builtin",
        enabled: true,
        agentEnabled: true,
        triggers: ["search", "recall", "retrieve", "检索", "召回"],
        parameters: objectSchema(
          {
            query: { type: "string", description: "Search phrase supplied by the caller." },
            topK: { type: "integer", description: "Maximum number of recall results.", default: 8, minimum: 1, maximum: 30 },
            queryEmbedding: {
              type: "array",
              description: "Optional embedding vector supplied by the caller.",
              items: { type: "number" },
            },
          },
          ["query"],
        ),
      },
      handler: (context, args) => this.retrieveKb(context, args),
    })

    this.register({
      definition: {
        name: "get_mindmap",
        displayName: "Get mindmap",
        description: "Return a compact graph/community overview for the selected knowledge base.",
        category: "knowledge",
        scope: "knowledge_base",
        readOnly: true,
        source: "builtin",
        enabled: true,
        agentEnabled: true,
        triggers: ["graph", "mindmap", "overview", "结构", "图谱", "概览", "关系"],
        parameters: objectSchema({
          maxNodesPerCommunity: {
            type: "integer",
            description: "Maximum nodes returned for each community.",
            default: 8,
            minimum: 1,
            maximum: 30,
          },
          maxEdges: { type: "integer", description: "Maximum strong edges returned.", default: 20, minimum: 0, maximum: 80 },
        }),
      },
      handler: (context, args) => this.getMindmap(context, args),
    })

    this.register({
      definition: {
        name: "list_kb_files",
        displayName: "List KB files",
        description: "List raw or wiki files stored inside the selected knowledge base.",
        category: "storage",
        scope: "knowledge_base",
        readOnly: true,
        source: "builtin",
        enabled: true,
        agentEnabled: false,
        parameters: objectSchema({
          root: { type: "string", description: "Storage root to list.", enum: ["raw", "wiki"], default: "wiki" },
          prefix: { type: "string", description: "Optional path below the root.", default: "" },
        }),
      },
      handler: (context, args) => this.listKbFiles(context, args),
    })

    this.register({
      definition: {
        name: "read_kb_file",
        displayName: "Read KB file",
        description: "Read a text file from raw/ or wiki/ storage with a size cap.",
        category: "storage",
        scope: "knowledge_base",
        readOnly: true,
        source: "builtin",
        enabled: true,
        agentEnabled: true,
        triggers: ["read", "file", "source", "evidence", "读取", "原文", "依据", "证据"],
        parameters: objectSchema(
          {
            key: { type: "string", description: "Storage key, for example wiki/index.md." },
            maxBytes: {
              type: "integer",
              description: "Maximum bytes returned from the file.",
              default: 20000,
              minimum: 1,
              maximum: 64000,
            },
          },
          ["key"],
        ),
      },
      handler: (context, args) => this.readKbFile(context, args),
    })
  }

  private register(tool: RegisteredTool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Duplicate tool: ${tool.definition.name}`)
    }
    this.tools.set(tool.definition.name, tool)
  }

  private registerCustomTool(tool: CustomHttpToolConfig): void {
    if (this.tools.has(tool.name)) return
    const definition: ToolDefinition = {
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      category: tool.category,
      scope: tool.scope,
      readOnly: tool.readOnly,
      source: "custom",
      enabled: tool.enabled,
      agentEnabled: tool.agentEnabled,
      triggers: tool.triggers,
      parameters: tool.parameters,
    }
    this.tools.set(tool.name, {
      definition,
      handler: (context, args) => this.runCustomHttpTool(tool, context, args),
    })
    this.customToolNames.add(tool.name)
  }

  private async runCustomHttpTool(tool: CustomHttpToolConfig, context: ToolExecutionContext, args: ToolArguments): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), tool.http.timeoutMs ?? 10000)
    try {
      const method = tool.http.method ?? "POST"
      const headers = { ...(tool.http.headers ?? {}) }
      let url = tool.http.url
      let body: string | undefined
      if (method === "GET") {
        const parsed = new URL(url)
        for (const [key, value] of Object.entries(args)) {
          if (value === undefined || value === null) continue
          parsed.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value))
        }
        url = parsed.toString()
      } else {
        headers["content-type"] = headers["content-type"] ?? "application/json"
        body = JSON.stringify({
          arguments: args,
          context: {
            identityId: context.auth.identity.id,
            username: context.auth.identity.username,
            companyId: context.auth.company.id,
            kbId: context.kb?.id,
            kbName: context.kb?.name,
          },
        })
      }
      const response = await fetch(url, { method, headers, body, signal: controller.signal })
      const text = await response.text()
      if (!response.ok) throw new ToolError(`Custom tool HTTP ${response.status}: ${text.slice(0, 1000)}`, 502)
      try {
        return JSON.parse(text) as unknown
      } catch {
        return { text }
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async listKbs(auth: AuthContext): Promise<unknown> {
    const platformWide = auth.identity.isPlatformAdmin || auth.member.role === "platform_admin"
    const items = await this.deps.project.listKnowledgeBases(
      platformWide ? undefined : auth.company.id,
      platformWide ? undefined : auth.identity.id,
    )
    return {
      count: items.length,
      items: items.map(kbSummary),
    }
  }

  private async retrieveKb(context: ToolExecutionContext, args: ToolArguments): Promise<unknown> {
    const kb = requireKb(context)
    const query = requiredString(args, "query")
    const topK = optionalInteger(args, "topK", 8, 1, 30)
    const queryEmbedding = optionalNumberArray(args, "queryEmbedding")
    const response = await this.deps.retrieval.retrieve(kb.id, query, { topK, queryEmbedding })
    return {
      kb: kbSummary(kb),
      query,
      mode: response.mode,
      diagnostics: response.diagnostics,
      results: response.results.map((result) => ({
        pageId: result.pageId,
        chunkId: result.chunkId,
        chunkOrdinal: result.chunkOrdinal,
        path: result.path,
        title: result.title,
        snippet: result.snippet,
        score: result.score,
        keywordScore: result.keywordScore,
        graphScore: result.graphScore,
        vectorScore: result.vectorScore,
        titleMatch: result.titleMatch,
        sources: result.sources,
        images: result.images.map((image) => ({
          id: image.id,
          fileName: image.fileName,
          caption: image.caption,
          storageKey: image.storageKey,
          mediaType: image.mediaType,
        })),
        reasons: result.reasons,
        graphPaths: result.graphPaths,
      })),
    }
  }

  private async getMindmap(context: ToolExecutionContext, args: ToolArguments): Promise<unknown> {
    const kb = requireKb(context)
    const maxNodesPerCommunity = optionalInteger(args, "maxNodesPerCommunity", 8, 1, 30)
    const maxEdges = optionalInteger(args, "maxEdges", 20, 0, 80)
    const graph = await this.deps.graph.buildGraph(kb.id)
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
    const nodesByCommunity = new Map<number, typeof graph.nodes>()
    for (const node of graph.nodes) {
      nodesByCommunity.set(node.community, [...(nodesByCommunity.get(node.community) ?? []), node])
    }
    const communities = graph.communities.map((community) => {
      const nodes = [...(nodesByCommunity.get(community.id) ?? [])]
        .sort((a, b) => b.linkCount - a.linkCount || a.label.localeCompare(b.label))
        .slice(0, maxNodesPerCommunity)
        .map((node) => ({
          id: node.id,
          title: node.label,
          type: node.type,
          path: node.path,
          linkCount: node.linkCount,
        }))
      return {
        id: community.id,
        nodeCount: community.nodeCount,
        cohesion: community.cohesion,
        topNodes: community.topNodes,
        nodes,
      }
    })
    const edges = [...graph.edges]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, maxEdges)
      .map((edge) => ({
        source: edge.source,
        sourceTitle: nodeById.get(edge.source)?.label ?? edge.source,
        target: edge.target,
        targetTitle: nodeById.get(edge.target)?.label ?? edge.target,
        weight: edge.weight,
        signals: edge.signals,
      }))
    const summary = {
      pageCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      communityCount: graph.communities.length,
    }
    return {
      kb: kbSummary(kb),
      summary,
      markdown: renderMindmapMarkdown(kb.name, summary, communities),
      communities,
      edges,
    }
  }

  private async listKbFiles(context: ToolExecutionContext, args: ToolArguments): Promise<unknown> {
    const kb = requireKb(context)
    const root = enumString(args, "root", ["raw", "wiki"], "wiki")
    const prefix = optionalString(args, "prefix", "")
    const key = normalizeRootedPath(root, prefix)
    return {
      kb: kbSummary(kb),
      root,
      prefix: key,
      tree: await this.deps.storage.listTree(kb.id, key),
    }
  }

  private async readKbFile(context: ToolExecutionContext, args: ToolArguments): Promise<unknown> {
    const kb = requireKb(context)
    const key = safeStorageKey(requiredString(args, "key"))
    if (!key.startsWith("raw/") && !key.startsWith("wiki/")) {
      throw new ToolError("key must start with raw/ or wiki/")
    }
    const maxBytes = optionalInteger(args, "maxBytes", 20000, 1, 64000)
    let bytes: Buffer
    try {
      bytes = await this.deps.storage.readObject(kb.id, key)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new ToolError("File not found", 404)
      throw err
    }
    return {
      kb: kbSummary(kb),
      key,
      bytes: bytes.length,
      truncated: bytes.length > maxBytes,
      content: bytes.subarray(0, maxBytes).toString("utf-8"),
    }
  }
}

function objectSchema(properties: Record<string, ToolParameterProperty>, required: string[] = []): ToolParametersSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }
}

function requireKb(context: ToolExecutionContext): KnowledgeBase {
  if (!context.kb) throw new ToolError("Knowledge base context is required")
  return context.kb
}

function kbSummary(kb: KnowledgeBase): unknown {
  return {
    id: kb.id,
    name: kb.name,
    description: kb.description,
    visibility: kb.visibility,
    type: kb.type,
    createdAt: kb.createdAt,
    updatedAt: kb.updatedAt,
  }
}

function requiredString(args: ToolArguments, key: string): string {
  const value = args[key]
  if (typeof value !== "string" || !value.trim()) throw new ToolError(`${key} is required`)
  return value.trim()
}

function optionalString(args: ToolArguments, key: string, fallback: string): string {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== "string") throw new ToolError(`${key} must be a string`)
  return value.trim()
}

function enumString<T extends string>(args: ToolArguments, key: string, values: readonly T[], fallback: T): T {
  const value = optionalString(args, key, fallback)
  if (!values.includes(value as T)) throw new ToolError(`${key} must be one of: ${values.join(", ")}`)
  return value as T
}

function optionalInteger(args: ToolArguments, key: string, fallback: number, min: number, max: number): number {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ToolError(`${key} must be an integer`)
  return Math.min(Math.max(value, min), max)
}

function optionalNumberArray(args: ToolArguments, key: string): number[] | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new ToolError(`${key} must be an array`)
  const numbers = value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) throw new ToolError(`${key} must only contain finite numbers`)
    return item
  })
  return numbers.length > 0 ? numbers : undefined
}

function normalizeRootedPath(root: "raw" | "wiki", prefix: string): string {
  const cleanPrefix = safeStorageKey(prefix)
  return safeStorageKey(cleanPrefix ? `${root}/${cleanPrefix}` : root)
}

function safeStorageKey(key: string): string {
  try {
    return normalizeStorageKey(key)
  } catch (err) {
    throw new ToolError(err instanceof Error ? err.message : String(err))
  }
}

function renderMindmapMarkdown(
  kbName: string,
  summary: { pageCount: number; edgeCount: number; communityCount: number },
  communities: Array<{
    id: number
    nodeCount: number
    cohesion: number
    nodes: Array<{ title: string; type: string; path: string; linkCount: number }>
  }>,
): string {
  const lines = [
    `# ${kbName}`,
    "",
    `Pages: ${summary.pageCount}`,
    `Edges: ${summary.edgeCount}`,
    `Communities: ${summary.communityCount}`,
    "",
  ]
  for (const community of communities) {
    lines.push(`## Community ${community.id} (${community.nodeCount} pages, cohesion ${community.cohesion.toFixed(2)})`)
    for (const node of community.nodes) {
      lines.push(`- ${node.title} [${node.type}] ${node.path} (${node.linkCount} links)`)
    }
    lines.push("")
  }
  return lines.join("\n").trim()
}

function isObject(value: unknown): value is ToolArguments {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
