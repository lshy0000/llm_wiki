import type {
  AuthPayload,
  AgentConversation,
  AgentConversationDetail,
  BackgroundTask,
  Capabilities,
  ChatResponse,
  CompanyModel,
  CustomHttpToolConfig,
  FileTreeNode,
  GraphResponse,
  IngestJob,
  KnowledgeBase,
  ModelProviderTestResult,
  ReviewItem,
  ReviewStatus,
  SearchResponse,
  SourceDocument,
  SourceUploadResponse,
  ToolDefinition,
  ToolConfigResponse,
  ToolRunResponse,
  UserApiKey,
  UserApiKeyCreated,
  WikiPage,
  WikiTreeGroup,
} from "./types"

/**
 * 前端所有服务端接口固定请求同源 `/api`。
 * 开发和 preview 环境由 vite.config.ts 代理到 KN_PORT，生产环境必须由反向代理转发；
 * 这里不要再拼 `http://127.0.0.1:8787` 之类的后端地址，否则桌面壳的 Origin 会触发 CORS 预检。
 */
export const API_BASE = ""
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
  if (init?.body != null && !(init.body instanceof FormData)) headers.set("content-type", "application/json")
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
  listApiKeys: () => request<UserApiKey[]>("/api/auth/me/api-keys"),
  createApiKey: (name: string) =>
    request<UserApiKeyCreated>("/api/auth/me/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  updateApiKey: (keyId: string, name: string) =>
    request<UserApiKey>(`/api/auth/me/api-keys/${encodeURIComponent(keyId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteApiKey: (keyId: string) =>
    request<{ ok: true }>(`/api/auth/me/api-keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    }),
  listKbs: () => request<KnowledgeBase[]>("/api/kbs"),
  companyModels: () => request<CompanyModel[]>("/api/company/models"),
  saveCompanyModel: (model: Partial<Omit<CompanyModel, "apiKeySet">> & { name: string; model: string; apiKey?: string }) =>
    request<CompanyModel>("/api/company/models", {
      method: "POST",
      body: JSON.stringify(model),
    }),
  deleteCompanyModel: (modelId: string) =>
    request<{ ok: true }>(`/api/company/models/${encodeURIComponent(modelId)}`, {
      method: "DELETE",
    }),
  testCompanyModel: (model: Pick<Partial<CompanyModel>, "provider" | "protocol" | "endpoint" | "model"> & { apiKey?: string }) =>
    request<ModelProviderTestResult>("/api/company/models/test", {
      method: "POST",
      body: JSON.stringify(model),
    }),
  createKb: (
    name: string,
    description: string,
    visibility: "company" | "creator_only",
    embeddingModelId?: string,
  ) =>
    request<KnowledgeBase>("/api/kbs", {
      method: "POST",
      body: JSON.stringify({ name, description, visibility, embeddingModelId }),
    }),
  updateKbEmbeddingModel: (kbId: string, embeddingModelId: string | null) =>
    request<KnowledgeBase>(`/api/kbs/${encodeURIComponent(kbId)}`, {
      method: "PATCH",
      body: JSON.stringify({ embeddingModelId }),
    }),
  deleteKb: (kbId: string) =>
    request<{ ok: true }>(`/api/kbs/${encodeURIComponent(kbId)}`, {
      method: "DELETE",
    }),
  uploadFiles: (kbId: string, files: Array<{ file: File; relativePath: string }>) => {
    const form = new FormData()
    for (const item of files) {
      form.append("relativePath", item.relativePath)
      form.append("file", item.file, item.relativePath)
    }
    return request<SourceUploadResponse>(`/api/kbs/${kbId}/sources`, {
      method: "POST",
      body: form,
    })
  },
  uploadFilesWithProgress: (
    kbId: string,
    files: Array<{ file: File; relativePath: string }>,
    onProgress: (progress: number) => void,
  ) =>
    new Promise<SourceUploadResponse>((resolve, reject) => {
      const form = new FormData()
      for (const item of files) {
        form.append("relativePath", item.relativePath)
        form.append("file", item.file, item.relativePath)
      }
      const xhr = new XMLHttpRequest()
      xhr.open("POST", `${API_BASE}/api/kbs/${encodeURIComponent(kbId)}/sources`)
      const token = getAuthToken()
      if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`)
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total <= 0) return
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100)
          try {
            resolve(JSON.parse(xhr.responseText) as SourceUploadResponse)
          } catch (err) {
            reject(err)
          }
          return
        }
        reject(new Error(xhr.responseText || `HTTP ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error("Upload failed"))
      xhr.onabort = () => reject(new Error("Upload aborted"))
      xhr.send(form)
    }),
  uploadFile: (kbId: string, file: File, relativePath: string) => {
    const form = new FormData()
    form.append("relativePath", relativePath)
    form.append("file", file, relativePath)
    return request<SourceUploadResponse>(`/api/kbs/${kbId}/sources`, {
      method: "POST",
      body: form,
    })
  },
  listSources: (kbId: string) => request<SourceDocument[]>(`/api/kbs/${kbId}/sources`),
  listJobs: (kbId: string) => request<IngestJob[]>(`/api/kbs/${kbId}/jobs`),
  listTasks: (kbId?: string) =>
    request<BackgroundTask[]>(kbId ? `/api/kbs/${encodeURIComponent(kbId)}/tasks` : "/api/tasks"),
  cancelJob: (jobId: string) => request<IngestJob | undefined>(`/api/jobs/${jobId}/cancel`, { method: "POST" }),
  retryJob: (jobId: string) => request<IngestJob | undefined>(`/api/jobs/${jobId}/retry`, { method: "POST" }),
  cancelTask: (taskId: string) => request<BackgroundTask | undefined>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" }),
  retryTask: (taskId: string) => request<BackgroundTask | undefined>(`/api/tasks/${encodeURIComponent(taskId)}/retry`, { method: "POST" }),
  fileTree: (kbId: string, root: "raw" | "wiki") => request<FileTreeNode[]>(`/api/kbs/${kbId}/files?root=${root}`),
  wikiTree: (kbId: string) => request<WikiTreeGroup[]>(`/api/kbs/${kbId}/wiki/tree`),
  wikiPage: (kbId: string, pageId: string) => request<WikiPage>(`/api/kbs/${kbId}/wiki/pages/${pageId}`),
  search: (kbId: string, query: string, input?: { topK?: number; queryEmbedding?: number[] }) =>
    request<SearchResponse>(`/api/kbs/${kbId}/search`, {
      method: "POST",
      body: JSON.stringify({ query, topK: input?.topK, queryEmbedding: input?.queryEmbedding }),
    }),
  listTools: () => request<ToolDefinition[]>("/api/tools"),
  toolConfig: () => request<ToolConfigResponse>("/api/tools/config"),
  saveCustomTool: (tool: CustomHttpToolConfig) =>
    request<CustomHttpToolConfig>("/api/tools/custom", {
      method: "POST",
      body: JSON.stringify(tool),
    }),
  deleteCustomTool: (toolName: string) =>
    request<{ ok: true }>(`/api/tools/custom/${encodeURIComponent(toolName)}`, { method: "DELETE" }),
  runTool: (toolName: string, args?: Record<string, unknown>) =>
    request<ToolRunResponse>(`/api/tools/${encodeURIComponent(toolName)}/run`, {
      method: "POST",
      body: JSON.stringify({ arguments: args ?? {} }),
    }),
  listKbTools: (kbId: string) => request<ToolDefinition[]>(`/api/kbs/${kbId}/tools`),
  runKbTool: (kbId: string, toolName: string, args?: Record<string, unknown>) =>
    request<ToolRunResponse>(`/api/kbs/${kbId}/tools/${encodeURIComponent(toolName)}/run`, {
      method: "POST",
      body: JSON.stringify({ arguments: args ?? {} }),
    }),
  reindexRetrieval: (kbId: string) =>
    request<{ ok: boolean }>(`/api/kbs/${kbId}/retrieval/reindex`, { method: "POST" }),
  graph: (kbId: string) => request<GraphResponse>(`/api/kbs/${kbId}/graph`),
  graphInsights: (kbId: string) => request<ReviewItem[]>(`/api/kbs/${kbId}/graph/insights`, { method: "POST" }),
  listConversations: (kbId: string) =>
    request<AgentConversation[]>(`/api/kbs/${encodeURIComponent(kbId)}/conversations`),
  conversationDetail: (kbId: string, conversationId: string) =>
    request<AgentConversationDetail>(`/api/kbs/${encodeURIComponent(kbId)}/conversations/${encodeURIComponent(conversationId)}`),
  chat: (kbId: string, question: string, conversationId?: string) =>
    request<ChatResponse>(`/api/kbs/${kbId}/chat`, {
      method: "POST",
      body: JSON.stringify({ question, conversationId }),
    }),
  lint: (kbId: string) => request<ReviewItem[]>(`/api/kbs/${kbId}/lint`, { method: "POST" }),
  reviews: (kbId: string) => request<ReviewItem[]>(`/api/kbs/${kbId}/reviews`),
  updateReviewStatus: (kbId: string, reviewId: string, status: ReviewStatus) =>
    request<ReviewItem>(`/api/kbs/${kbId}/reviews/${encodeURIComponent(reviewId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
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
