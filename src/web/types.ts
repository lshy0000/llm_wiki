export interface KnowledgeBase {
  id: string
  companyId: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  dataVersion: number
}

export interface AuthPayload {
  token?: string
  expiresAt: string
  user: {
    id: string
    username: string
    displayName: string
    email?: string
    role: "company_admin" | "member"
  }
  company: {
    id: string
    name: string
    slug: string
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
  fileName: string
  relativePath: string
  status: string
  folderContext: string
  size: number
  error?: string
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
  }
  searchProviders: Record<string, boolean>
}
