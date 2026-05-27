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
  path: string
  title: string
  snippet: string
  score: number
  keywordScore: number
  vectorScore?: number
  titleMatch: boolean
  sources: string[]
  images: ImageAsset[]
}

export interface SearchResponse {
  mode: "keyword" | "vector" | "hybrid"
  results: SearchResult[]
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
