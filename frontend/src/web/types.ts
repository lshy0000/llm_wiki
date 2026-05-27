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

export interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  size: number
  updatedAt: string
  children?: FileTreeNode[]
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

export interface ReviewItem {
  id: string
  kind: string
  title: string
  description: string
  action?: string
  query?: string
  status: string
  createdAt: string
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
