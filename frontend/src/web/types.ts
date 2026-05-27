export interface KnowledgeBase {
  id: string
  companyId: string
  createdBy: string
  visibility: "company" | "creator_only"
  type: "llm_wiki"
  name: string
  description: string
  embeddingModelId?: string
  createdAt: string
  updatedAt: string
}

/** 知识库类型在界面上的展示名（后端 type 仍为 llm_wiki）。 */
export const KB_TYPE_LABEL: Record<KnowledgeBase["type"], string> = {
  llm_wiki: "KN",
}

export interface AuthPayload {
  token?: string
  expiresAt: string
  user: {
    id: string
    username: string
    displayName: string
    email?: string
    role: "platform_admin" | "org_admin" | "agent_admin" | "member"
    isPlatformAdmin: boolean
  }
  company: {
    id: string
    name: string
    slug: string
    isDefault: boolean
  }
}

export interface UserApiKey {
  id: string
  name: string
  keyHint: string
  createdAt: string
  updatedAt: string
}

export interface UserApiKeyCreated extends UserApiKey {
  key: string
}

export interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  size: number
  updatedAt: string
  children?: FileTreeNode[]
}

/** 目录树排序：文件夹在前，同类型按名称（与桌面端、Sources 视图一致）。 */
export function sortFileTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes]
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .map((node) =>
      node.children ? { ...node, children: sortFileTreeNodes(node.children) } : node,
    )
}

export interface SourceDocument {
  id: string
  companyId: string
  kbId: string
  root: "raw" | "wiki"
  fileName: string
  relativePath: string
  parentPath: string
  uploadBatchId?: string
  storageKey: string
  contentType: string
  status: string
  folderContext: string
  size: number
  createdAt: string
  updatedAt: string
  error?: string
}

export interface SourceAdmission {
  path: string
  fileName: string
  extension: string
  kind: string
  mode: string
  supported: boolean
  autoIngest: boolean
  reason?: string
}

export interface SourceUploadAccepted {
  accepted: true
  source: SourceDocument
  job?: IngestJob
  admission: SourceAdmission
}

export interface SourceUploadSkipped {
  accepted: false
  relativePath: string
  fileName: string
  admission: SourceAdmission
  reason: string
}

export interface SourceUploadResponse {
  created: SourceUploadAccepted[]
  skipped: SourceUploadSkipped[]
  task?: BackgroundTask
}

export type ModelProvider = "openai" | "qwen" | "deepseek" | "kimi" | "claudecode" | "ollama" | "custom"
export type ModelCapability = "llm" | "embedding" | "vision"
export type ModelProtocol = "openai_compatible" | "anthropic_messages"

export interface CompanyModel {
  id: string
  companyId: string
  name: string
  provider: ModelProvider
  protocol: ModelProtocol
  model: string
  endpoint: string
  apiKeySet: boolean
  capabilities: ModelCapability[]
  isDefaultLlm: boolean
  isDefaultEmbedding: boolean
  isDefaultVision: boolean
  createdAt: string
  updatedAt: string
}

export interface ModelProviderTestResult {
  ok: boolean
  provider: ModelProvider
  protocol: ModelProtocol
  endpoint: string
  checked: "models"
  modelCount: number
  models: string[]
  selectedModelAvailable?: boolean
  message: string
}

export interface IngestJob {
  id: string
  taskId?: string
  sourceId: string
  status: string
  progress: number
  stage: string
  cached: boolean
  attempts: number
  error?: string
  writtenPageIds: string[]
  updatedAt: string
}

export interface BackgroundTask {
  id: string
  companyId: string
  kbId: string
  kind: "source_ingest"
  title: string
  uploadBatchId?: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  progress: number
  stage: string
  sourceIds: string[]
  jobIds: string[]
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  error?: string
  sourcePaths: string[]
  jobs: IngestJob[]
}

export interface ImageAsset {
  id: string
  kbId: string
  sourceId: string
  pageId?: string
  storageKey: string
  fileName: string
  mediaType: string
  caption: string
  origin: string
}

export interface WikiTreeGroup {
  type: string
  pages: Array<{
    id: string
    title: string
    path: string
    sources: string[]
    images: ImageAsset[]
  }>
}

export interface WikiPage {
  id: string
  companyId: string
  kbId: string
  path: string
  title: string
  type: string
  content: string
  sha256: string
  sources: string[]
  images: ImageAsset[]
  createdAt: string
  updatedAt: string
}

export interface SearchResult {
  pageId: string
  chunkId?: string
  chunkOrdinal?: number
  path: string
  title: string
  snippet: string
  score: number
  keywordScore: number
  graphScore?: number
  vectorScore?: number
  titleMatch: boolean
  sources: string[]
  images: ImageAsset[]
  signals?: Record<string, number>
  reasons?: string[]
  graphPaths?: Array<{
    nodes: Array<{ id: string; kind: string; label: string }>
    rels: Array<{ type: string; weight?: number }>
  }>
}

export interface SearchResponse {
  mode: "keyword" | "vector" | "hybrid" | "graph" | "graph-hybrid"
  results: SearchResult[]
  diagnostics?: {
    seeds: number
    graphHits: number
    lexicalHits: number
    vectorHits: number
    graphBackend: "neo4j" | "postgres" | "none"
    llmUsed: false
  }
}

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
  parameters: {
    type: "object"
    properties: Record<string, ToolParameterProperty>
    required?: string[]
    additionalProperties?: boolean
  }
}

export interface CustomHttpToolConfig {
  name: string
  displayName: string
  description: string
  category: ToolCategory
  scope: ToolScope
  readOnly: boolean
  enabled: boolean
  agentEnabled: boolean
  triggers?: string[]
  parameters: ToolDefinition["parameters"]
  http: {
    url: string
    method?: "GET" | "POST"
    headers?: Record<string, string>
    timeoutMs?: number
  }
}

export interface ToolConfigResponse {
  customTools: CustomHttpToolConfig[]
  definitions: ToolDefinition[]
}

export interface ToolRunResponse<T = unknown> {
  tool: string
  ok: true
  result: T
}

export type AgentTraceType = "plan" | "tool" | "observation" | "answer" | "error"

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

export interface ChatCitation {
  pageId: string
  title: string
  path: string
}

export interface ChatResponse {
  conversationId: string
  answer: string
  citations: ChatCitation[]
  trace: AgentTraceStep[]
}

export interface AgentConversation {
  id: string
  companyId: string
  kbId: string
  agentType: "kb_dedicated" | "configurable"
  title: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface AgentChatMessage {
  id: string
  companyId: string
  kbId: string
  conversationId: string
  role: "user" | "assistant"
  content: string
  citations: ChatCitation[]
  trace?: AgentTraceStep[]
  createdAt: string
}

export interface AgentConversationDetail {
  conversation: AgentConversation
  messages: AgentChatMessage[]
  runs: Array<{
    id: string
    status: string
    startedAt: string
    completedAt?: string
    error?: string
  }>
}

export interface GraphResponse {
  nodes: Array<{
    id: string
    label: string
    type: string
    path: string
    linkCount: number
    community: number
  }>
  edges: Array<{
    source: string
    target: string
    weight: number
    signals: {
      directLink: number
      sourceOverlap: number
      commonNeighbor: number
      typeAffinity: number
    }
  }>
  communities: Array<{
    id: number
    nodeCount: number
    cohesion: number
    topNodes: string[]
  }>
}

export type ReviewKind = "llm-review" | "lint" | "graph-insight" | "deep-research"
export type ReviewStatus = "open" | "resolved" | "dismissed"

export interface ReviewItem {
  id: string
  kind: ReviewKind
  title: string
  description: string
  action?: string
  query?: string
  status: ReviewStatus
  createdAt: string
  updatedAt: string
}

export interface Capabilities {
  llmWiki: Record<string, boolean>
  providers: {
    chatConfigured: boolean
    embeddingConfigured: boolean
    model: string
    embeddingModel: string
    visionModel: string
  }
  searchProviders: Record<string, boolean>
}
