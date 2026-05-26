import type {
  Capabilities,
  FileTreeNode,
  GraphResponse,
  IngestJob,
  KnowledgeBase,
  ReviewItem,
  SearchResponse,
  SourceDocument,
  WikiTreeGroup,
} from "./types"

export const API_BASE = import.meta.env.VITE_KN_API_BASE || "http://127.0.0.1:8787"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData
      ? init.headers
      : { "content-type": "application/json", ...init?.headers },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(detail || `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  capabilities: () => request<Capabilities>("/api/capabilities"),
  listKbs: () => request<KnowledgeBase[]>("/api/kbs"),
  createKb: (name: string, description: string) =>
    request<KnowledgeBase>("/api/kbs", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  uploadFile: (kbId: string, file: File, relativePath: string) => {
    const form = new FormData()
    form.append("relativePath", relativePath)
    form.append("file", file, relativePath)
    return request<{ created: Array<{ source: SourceDocument; job: IngestJob }> }>(`/api/kbs/${kbId}/sources`, {
      method: "POST",
      body: form,
    })
  },
  listSources: (kbId: string) => request<SourceDocument[]>(`/api/kbs/${kbId}/sources`),
  listJobs: (kbId: string) => request<IngestJob[]>(`/api/kbs/${kbId}/jobs`),
  cancelJob: (jobId: string) => request<IngestJob | undefined>(`/api/jobs/${jobId}/cancel`, { method: "POST" }),
  retryJob: (jobId: string) => request<IngestJob | undefined>(`/api/jobs/${jobId}/retry`, { method: "POST" }),
  fileTree: (kbId: string, root: "raw" | "wiki") => request<FileTreeNode[]>(`/api/kbs/${kbId}/files?root=${root}`),
  wikiTree: (kbId: string) => request<WikiTreeGroup[]>(`/api/kbs/${kbId}/wiki/tree`),
  search: (kbId: string, query: string) =>
    request<SearchResponse>(`/api/kbs/${kbId}/search`, {
      method: "POST",
      body: JSON.stringify({ query }),
    }),
  graph: (kbId: string) => request<GraphResponse>(`/api/kbs/${kbId}/graph`),
  graphInsights: (kbId: string) => request<ReviewItem[]>(`/api/kbs/${kbId}/graph/insights`, { method: "POST" }),
  chat: (kbId: string, question: string, conversationId?: string) =>
    request<{ conversationId: string; answer: string; citations: SearchResponse["results"] }>(`/api/kbs/${kbId}/chat`, {
      method: "POST",
      body: JSON.stringify({ question, conversationId }),
    }),
  lint: (kbId: string) => request<ReviewItem[]>(`/api/kbs/${kbId}/lint`, { method: "POST" }),
  reviews: (kbId: string) => request<ReviewItem[]>(`/api/kbs/${kbId}/reviews`),
  research: (kbId: string, topic: string) =>
    request<{ queries: string[]; imported: number; review: ReviewItem }>(`/api/kbs/${kbId}/research`, {
      method: "POST",
      body: JSON.stringify({ topic }),
    }),
  objectUrl: (kbId: string, storageKey: string) => `${API_BASE}/api/kbs/${kbId}/objects/${encodeURIComponent(storageKey)}`,
}

