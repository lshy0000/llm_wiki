import type {
  AuthPayload,
  Capabilities,
  CompanyModel,
  FileTreeNode,
  GraphResponse,
  IngestJob,
  KnowledgeBase,
  ModelProviderTestResult,
  ReviewItem,
  SearchResponse,
  SourceDocument,
  WikiPage,
  WikiTreeGroup,
} from "./types"

export const API_BASE = import.meta.env.VITE_KN_API_BASE || "http://127.0.0.1:8787"
const TOKEN_KEY = "kn.auth.token"

export function getAuthToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY)
}

function setAuthToken(token: string | undefined): void {
  if (token) window.localStorage.setItem(TOKEN_KEY, token)
}

export function clearAuthToken(): void {
  window.localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const headers = new Headers(init?.headers)
  if (!(init?.body instanceof FormData)) headers.set("content-type", "application/json")
  if (token) headers.set("authorization", `Bearer ${token}`)
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(detail || `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function requestText(path: string, init?: RequestInit): Promise<string> {
  const token = getAuthToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set("authorization", `Bearer ${token}`)
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(detail || `HTTP ${response.status}`)
  }
  return response.text()
}

export const api = {
  capabilities: () => request<Capabilities>("/api/capabilities"),
  ldapLogin: async (username: string, password: string) => {
    const payload = await request<AuthPayload>("/api/auth/ldap-login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    })
    setAuthToken(payload.token)
    return payload
  },
  me: () => request<AuthPayload>("/api/auth/me"),
  logout: async () => {
    await request<{ ok: true }>("/api/auth/logout", { method: "POST" }).catch(() => undefined)
    clearAuthToken()
  },
  listKbs: () => request<KnowledgeBase[]>("/api/kbs"),
  companyModels: () => request<CompanyModel[]>("/api/company/models"),
  saveCompanyModel: (model: Partial<Omit<CompanyModel, "apiKeySet">> & { name: string; model: string; apiKey?: string }) =>
    request<CompanyModel>("/api/company/models", {
      method: "POST",
      body: JSON.stringify(model),
    }),
  testCompanyModel: (model: Pick<Partial<CompanyModel>, "provider" | "protocol" | "endpoint" | "model"> & { apiKey?: string }) =>
    request<ModelProviderTestResult>("/api/company/models/test", {
      method: "POST",
      body: JSON.stringify(model),
    }),
  createKb: (name: string, description: string, visibility: "company" | "creator_only") =>
    request<KnowledgeBase>("/api/kbs", {
      method: "POST",
      body: JSON.stringify({ name, description, visibility }),
    }),
  uploadFiles: (kbId: string, files: Array<{ file: File; relativePath: string }>) => {
    const form = new FormData()
    for (const item of files) {
      form.append("relativePath", item.relativePath)
      form.append("file", item.file, item.relativePath)
    }
    return request<{ created: Array<{ source: SourceDocument; job: IngestJob }> }>(`/api/kbs/${kbId}/sources`, {
      method: "POST",
      body: form,
    })
  },
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
  wikiPage: (kbId: string, pageId: string) => request<WikiPage>(`/api/kbs/${kbId}/wiki/pages/${pageId}`),
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
  objectUrl: (kbId: string, storageKey: string) => {
    const token = getAuthToken()
    const query = token ? `?access_token=${encodeURIComponent(token)}` : ""
    return `${API_BASE}/api/kbs/${kbId}/objects/${encodeURIComponent(storageKey)}${query}`
  },
  objectText: (kbId: string, storageKey: string) =>
    requestText(`/api/kbs/${kbId}/objects/${encodeURIComponent(storageKey)}`),
}
