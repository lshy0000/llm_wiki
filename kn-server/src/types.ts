export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled"
export type SourceStatus = "uploaded" | "parsing" | "queued" | "ingested" | "failed"
export type ReviewStatus = "open" | "resolved" | "dismissed"
export type CompanyMemberRole = "platform_admin" | "org_admin" | "agent_admin" | "member"
export type ModelProvider = "openai" | "qwen" | "deepseek" | "kimi" | "claudecode" | "ollama" | "custom"
export type ModelCapability = "llm" | "embedding" | "vision"

export interface Identity {
  id: string
  provider: "ldap" | "local"
  providerSubject: string
  username: string
  displayName: string
  email?: string
  passwordHash?: string
  isPlatformAdmin: boolean
  createdAt: string
  updatedAt: string
}

export interface Company {
  id: string
  name: string
  slug: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface CompanyMember {
  id: string
  companyId: string
  identityId: string
  role: CompanyMemberRole
  status: "active"
  joinedAt: string
  updatedAt: string
}

export interface CompanyModel {
  id: string
  companyId: string
  name: string
  provider: ModelProvider
  model: string
  endpoint: string
  apiKey?: string
  capabilities: ModelCapability[]
  isDefaultLlm: boolean
  isDefaultEmbedding: boolean
  isDefaultVision: boolean
  createdAt: string
  updatedAt: string
}

export interface AuthSession {
  id: string
  tokenHash: string
  identityId: string
  companyId: string
  memberId: string
  expiresAt: string
  createdAt: string
  lastSeenAt: string
}

export interface AuthContext {
  session: AuthSession
  identity: Identity
  company: Company
  member: CompanyMember
}

export interface KnowledgeBase {
  id: string
  companyId: string
  createdBy: string
  visibility: "company" | "creator_only"
  type: "llm_wiki"
  name: string
  description: string
  createdAt: string
  updatedAt: string
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
  size: number
  sha256: string
  status: SourceStatus
  folderContext: string
  createdAt: string
  updatedAt: string
  error?: string
}

export interface IngestJob {
  id: string
  companyId: string
  kbId: string
  sourceId: string
  status: JobStatus
  progress: number
  stage: string
  attempts: number
  cached: boolean
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  cancelledAt?: string
  error?: string
  writtenPageIds: string[]
  analysis?: string
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

export interface WikiLink {
  companyId: string
  kbId: string
  sourcePageId: string
  targetPageId: string
  targetRaw: string
}

export interface PageSource {
  companyId: string
  kbId: string
  pageId: string
  sourceId: string
}

export interface PageChunk {
  id: string
  companyId: string
  kbId: string
  pageId: string
  text: string
  ordinal: number
  tokens: string[]
  embedding?: number[]
}

export interface ImageAsset {
  id: string
  companyId: string
  kbId: string
  sourceId: string
  pageId?: string
  storageKey: string
  fileName: string
  mediaType: string
  caption: string
  origin: "pdf-embedded" | "markdown-image" | "standalone-image"
  sourcePage?: number
  createdAt: string
}

export interface ReviewItem {
  id: string
  companyId: string
  kbId: string
  sourceId?: string
  pageId?: string
  kind: "llm-review" | "lint" | "graph-insight" | "deep-research"
  title: string
  description: string
  action?: string
  query?: string
  status: ReviewStatus
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  companyId: string
  kbId: string
  conversationId: string
  role: "user" | "assistant"
  content: string
  citations: Array<{ pageId: string; title: string; path: string }>
  createdAt: string
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

export interface GraphNode {
  id: string
  label: string
  type: string
  path: string
  linkCount: number
  community: number
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
  signals: {
    directLink: number
    sourceOverlap: number
    commonNeighbor: number
    typeAffinity: number
  }
}

export interface CommunityInfo {
  id: number
  nodeCount: number
  cohesion: number
  topNodes: string[]
}

export interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  size: number
  updatedAt: string
  children?: FileTreeNode[]
}

export interface ParsedDocument {
  text: string
  images: Array<{
    fileName: string
    mediaType: string
    bytes: Buffer
    origin: ImageAsset["origin"]
    sourcePage?: number
  }>
}
