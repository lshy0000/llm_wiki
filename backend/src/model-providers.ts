import type { CompanyModel, ModelCapability, ModelProtocol, ModelProvider } from "./types.js"

export interface ModelMessage {
  role: "system" | "user" | "assistant"
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image"; mediaType: string; dataBase64: string }
      >
}

export interface RuntimeModelConfig {
  provider: ModelProvider
  protocol: ModelProtocol
  endpoint: string
  apiKey?: string
  model: string
}

export interface ModelProviderManifest {
  provider: ModelProvider
  label: string
  endpoint: string
  protocol: ModelProtocol
  selectableProtocol: boolean
  apiKeyRequired: boolean
  suggestedModel: string
  defaultCapabilities: ModelCapability[]
  description: string
}

export interface ModelProviderTestInput {
  provider?: string
  protocol?: string
  endpoint?: string
  apiKey?: string
  model?: string
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

type JsonRecord = Record<string, unknown>

interface ChatResponse {
  choices?: Array<{ message?: { content?: string; reasoning?: string; reasoning_content?: string } }>
  usage?: {
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
  }
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string; thinking?: string }>
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>
}

export interface ModelCompletion {
  content: string
  reasoning?: string
  usage?: {
    promptCacheHitTokens?: number
    promptCacheMissTokens?: number
  }
}

const MODEL_SAVE_VALIDATION_TIMEOUT_MS = 20_000

export const MODEL_PROVIDER_MANIFESTS: Record<ModelProvider, ModelProviderManifest> = {
  openai: {
    provider: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    protocol: "openai_compatible",
    selectableProtocol: false,
    apiKeyRequired: true,
    suggestedModel: "gpt-4o-mini",
    defaultCapabilities: ["llm", "vision"],
    description: "OpenAI 官方 API，由后端按 OpenAI Chat Completions / Embeddings 协议调用。",
  },
  qwen: {
    provider: "qwen",
    label: "千问 DashScope",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "openai_compatible",
    selectableProtocol: false,
    apiKeyRequired: true,
    suggestedModel: "qwen-plus",
    defaultCapabilities: ["llm", "vision"],
    description: "阿里云百炼 DashScope 模式，使用 DashScope API Key。",
  },
  deepseek: {
    provider: "deepseek",
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com",
    protocol: "openai_compatible",
    selectableProtocol: false,
    apiKeyRequired: true,
    suggestedModel: "deepseek-v4-flash",
    defaultCapabilities: ["llm"],
    description: "DeepSeek 官方 API。使用 /chat/completions，并上报上下文缓存命中。",
  },
  kimi: {
    provider: "kimi",
    label: "Kimi / Moonshot",
    endpoint: "https://api.moonshot.cn/v1",
    protocol: "openai_compatible",
    selectableProtocol: false,
    apiKeyRequired: true,
    suggestedModel: "kimi-k2.6",
    defaultCapabilities: ["llm"],
    description: "月之暗面 Kimi 官方 API，使用 Moonshot API Key。",
  },
  claudecode: {
    provider: "claudecode",
    label: "Claude / Anthropic",
    endpoint: "https://api.anthropic.com",
    protocol: "anthropic_messages",
    selectableProtocol: false,
    apiKeyRequired: true,
    suggestedModel: "claude-sonnet-4-5-20250929",
    defaultCapabilities: ["llm", "vision"],
    description: "Anthropic 官方 Messages API，后端按 Anthropic 原生消息格式调用。",
  },
  ollama: {
    provider: "ollama",
    label: "Ollama",
    endpoint: "http://localhost:11434/v1",
    protocol: "openai_compatible",
    selectableProtocol: false,
    apiKeyRequired: false,
    suggestedModel: "llama3.1",
    defaultCapabilities: ["llm"],
    description: "本地 Ollama /v1 接口，通常不需要 API Key。",
  },
  custom: {
    provider: "custom",
    label: "自定义",
    endpoint: "",
    protocol: "openai_compatible",
    selectableProtocol: true,
    apiKeyRequired: false,
    suggestedModel: "",
    defaultCapabilities: ["llm"],
    description: "自定义服务只在这里选择 API 模式。",
  },
}

export function modelProviderManifests(): ModelProviderManifest[] {
  return Object.values(MODEL_PROVIDER_MANIFESTS)
}

export function providerManifest(provider: ModelProvider): ModelProviderManifest {
  return MODEL_PROVIDER_MANIFESTS[provider]
}

export function normalizeProvider(provider?: string): ModelProvider {
  const value = provider ?? "custom"
  if (["openai", "qwen", "deepseek", "kimi", "claudecode", "ollama", "custom"].includes(value)) {
    return value as ModelProvider
  }
  return "custom"
}

export function normalizeModelProtocol(provider: ModelProvider, protocol?: string): ModelProtocol {
  if (provider !== "custom") return providerManifest(provider).protocol
  return protocol === "anthropic_messages" ? "anthropic_messages" : "openai_compatible"
}

export function normalizeModelEndpoint(provider: ModelProvider, endpoint?: string): string {
  if (provider !== "custom") return providerManifest(provider).endpoint
  return endpoint?.trim().replace(/\/+$/, "") ?? ""
}

export function defaultEndpointForProvider(provider: ModelProvider): string {
  return providerManifest(provider).endpoint
}

export function providerFromModel(model: string, endpoint: string): ModelProvider {
  const value = `${model} ${endpoint}`.toLowerCase()
  if (value.includes("qwen") || value.includes("dashscope") || value.includes("aliyun")) return "qwen"
  if (value.includes("deepseek")) return "deepseek"
  if (value.includes("kimi") || value.includes("moonshot")) return "kimi"
  if (value.includes("claude") || value.includes("anthropic")) return "claudecode"
  if (value.includes("ollama") || endpoint.includes("11434")) return "ollama"
  if (value.includes("openai") || value.includes("gpt-") || value.includes("text-embedding-3")) return "openai"
  return "custom"
}

export function resolveRuntimeModel(input: {
  provider?: string
  protocol?: string
  endpoint?: string
  apiKey?: string
  model: string
}): RuntimeModelConfig {
  const provider = normalizeProvider(input.provider)
  const protocol = normalizeModelProtocol(provider, input.protocol)
  const endpoint = normalizeModelEndpoint(provider, input.endpoint)
  return {
    provider,
    protocol,
    endpoint,
    apiKey: input.apiKey?.trim() || undefined,
    model: input.model.trim(),
  }
}

export function companyModelToRuntime(model: CompanyModel): RuntimeModelConfig {
  return resolveRuntimeModel({
    provider: model.provider,
    protocol: model.protocol,
    endpoint: model.endpoint,
    apiKey: model.apiKey,
    model: model.model,
  })
}

export function isRuntimeModelConfigured(model: RuntimeModelConfig | undefined): boolean {
  if (!model?.endpoint) return false
  if (!providerManifest(model.provider).apiKeyRequired) return true
  return Boolean(model.apiKey)
}

export async function completeWithProvider(
  model: RuntimeModelConfig | undefined,
  messages: ModelMessage[],
  fallback: string,
  maxTokens: number,
): Promise<string> {
  return (await completeDetailedWithProvider(model, messages, fallback, maxTokens)).content
}

export async function completeDetailedWithProvider(
  model: RuntimeModelConfig | undefined,
  messages: ModelMessage[],
  fallback: string,
  maxTokens: number,
): Promise<ModelCompletion> {
  if (!model?.endpoint) return { content: fallback }
  try {
    return await completeStrictDetailed(model, messages, fallback, maxTokens)
  } catch (err) {
    return {
      content: `${fallback}\n\n> LLM fallback used because provider call failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export async function embedWithProvider(model: RuntimeModelConfig | undefined, text: string): Promise<number[] | undefined> {
  if (!model?.endpoint || model.protocol !== "openai_compatible") return undefined
  try {
    return await embedOpenAiCompatible(model, text)
  } catch {
    return undefined
  }
}

export async function validateRuntimeModelCapabilities(model: RuntimeModelConfig, capabilities: ModelCapability[]): Promise<void> {
  if (capabilities.length < 1 || capabilities.length > 2) {
    throw new Error("模型能力必须选择 1 到 2 项")
  }
  if (!model.endpoint) throw new Error("Base URL is required")
  if (providerManifest(model.provider).apiKeyRequired && !model.apiKey) {
    throw new Error(`${providerManifest(model.provider).label} requires an API Key`)
  }

  if (capabilities.includes("llm")) {
    try {
      const answer = await withValidationTimeout(
        completeStrict(model, [{ role: "user", content: "你好" }], "", 80),
        "LLM 校验超时",
      )
      if (!answer.trim()) throw new Error("没有返回内容")
    } catch (err) {
      throw new Error(`LLM 校验失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (capabilities.includes("embedding")) {
    try {
      if (model.protocol !== "openai_compatible") throw new Error("Embedding 只支持 OpenAI-compatible 协议")
      const vector = await withValidationTimeout(embedOpenAiCompatible(model, "你好"), "Embedding 校验超时")
      if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
        throw new Error("返回的向量为空或包含非数字")
      }
    } catch (err) {
      throw new Error(`Embedding 校验失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export async function testModelProvider(input: ModelProviderTestInput): Promise<ModelProviderTestResult> {
  const model = resolveRuntimeModel({
    provider: input.provider,
    protocol: input.protocol,
    endpoint: input.endpoint,
    apiKey: input.apiKey,
    model: input.model?.trim() || providerManifest(normalizeProvider(input.provider)).suggestedModel || "test-model",
  })
  if (!model.endpoint) throw new Error("Base URL is required")
  if (providerManifest(model.provider).apiKeyRequired && !model.apiKey) {
    throw new Error(`${providerManifest(model.provider).label} requires an API Key`)
  }

  const models = await listProviderModels(model)
  const selectedModelAvailable = model.model ? models.includes(model.model) : undefined
  return {
    ok: true,
    provider: model.provider,
    protocol: model.protocol,
    endpoint: model.endpoint,
    checked: "models",
    modelCount: models.length,
    models,
    selectedModelAvailable,
    message: selectedModelAvailable === false
      ? `连接成功，发现 ${models.length} 个模型，但当前模型名未出现在列表中。`
      : `连接成功，发现 ${models.length} 个模型。`,
  }
}

async function completeStrict(
  model: RuntimeModelConfig,
  messages: ModelMessage[],
  fallback: string,
  maxTokens: number,
): Promise<string> {
  return (await completeStrictDetailed(model, messages, fallback, maxTokens)).content
}

async function completeStrictDetailed(
  model: RuntimeModelConfig,
  messages: ModelMessage[],
  fallback: string,
  maxTokens: number,
): Promise<ModelCompletion> {
  if (model.protocol === "anthropic_messages") {
    return completeAnthropicDetailed(model, messages, fallback, maxTokens)
  }
  return completeOpenAiCompatibleDetailed(model, messages, fallback, maxTokens)
}

async function completeOpenAiCompatibleDetailed(
  model: RuntimeModelConfig,
  messages: ModelMessage[],
  fallback: string,
  maxTokens: number,
): Promise<ModelCompletion> {
  const response = await fetch(openAiChatUrl(model), {
    method: "POST",
    headers: openAiHeaders(model),
    body: JSON.stringify(openAiBody(model, messages, maxTokens)),
  })
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`)
  const json = (await response.json()) as ChatResponse
  const message = json.choices?.[0]?.message
  const contentParts = splitThinkingFromContent(message?.content ?? "")
  return {
    content: contentParts.content || fallback,
    reasoning: joinReasoning(message?.reasoning_content, message?.reasoning, contentParts.reasoning),
    usage: deepSeekUsage(json),
  }
}

async function completeAnthropicDetailed(
  model: RuntimeModelConfig,
  messages: ModelMessage[],
  fallback: string,
  maxTokens: number,
): Promise<ModelCompletion> {
  const system = messages.filter((message) => message.role === "system").map((message) => textFromMessage(message)).join("\n\n")
  const conversation = messages.filter((message) => message.role !== "system")
  const response = await fetch(anthropicMessagesUrl(model), {
    method: "POST",
    headers: anthropicHeaders(model),
    body: JSON.stringify({
      model: model.model,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: conversation.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: anthropicContent(message.content),
      })),
    }),
  })
  if (!response.ok) throw new Error(`Anthropic HTTP ${response.status}: ${await response.text()}`)
  const json = (await response.json()) as AnthropicResponse
  const content = json.content?.filter((item) => item.type !== "thinking").map((item) => item.text ?? "").join("") ?? ""
  const thinking = json.content?.filter((item) => item.type === "thinking").map((item) => item.thinking ?? item.text ?? "").join("\n\n")
  const contentParts = splitThinkingFromContent(content)
  return {
    content: contentParts.content || fallback,
    reasoning: joinReasoning(thinking, contentParts.reasoning),
  }
}

async function embedOpenAiCompatible(model: RuntimeModelConfig, text: string): Promise<number[]> {
  const response = await fetch(openAiEmbeddingUrl(model), {
    method: "POST",
    headers: openAiHeaders(model),
    body: JSON.stringify({
      model: model.model,
      input: text.slice(0, 8000),
    }),
  })
  if (!response.ok) throw new Error(`Embedding HTTP ${response.status}: ${await compactResponseText(response)}`)
  const json = (await response.json()) as EmbeddingResponse
  const vector = json.data?.[0]?.embedding
  if (!vector) throw new Error("Embedding response did not include a vector")
  return vector
}

async function withValidationTimeout<T>(work: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), MODEL_SAVE_VALIDATION_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function listProviderModels(model: RuntimeModelConfig): Promise<string[]> {
  if (model.protocol === "anthropic_messages") {
    return listModelsFromUrl(anthropicModelsUrl(model), anthropicHeaders(model), model)
  }
  try {
    return await listModelsFromUrl(openAiModelsUrl(model), openAiHeaders(model), model)
  } catch (err) {
    if (model.provider !== "ollama") throw err
    return listModelsFromUrl(ollamaNativeTagsUrl(model), {}, model)
  }
}

async function listModelsFromUrl(url: string, headers: Record<string, string>, model: RuntimeModelConfig): Promise<string[]> {
  if (model.protocol === "anthropic_messages") {
    return listAnthropicModelsFromUrl(url, headers, model)
  }
  return fetchModelsListOnce(url, headers, model)
}

/** Anthropic GET /v1/models：仅使用文档中的 limit + after_id 分页。 */
const ANTHROPIC_MODELS_PAGE_LIMIT = 999

async function listAnthropicModelsFromUrl(url: string, headers: Record<string, string>, model: RuntimeModelConfig): Promise<string[]> {
  const collected: string[] = []
  const visitedUrls = new Set<string>()
  let nextUrl: string | null = withAnthropicModelsLimit(url)
  let lastPageFirstId: string | undefined

  for (let page = 0; page < 100 && nextUrl; page++) {
    if (visitedUrls.has(nextUrl)) break
    visitedUrls.add(nextUrl)

    const json = await fetchModelsListJson(nextUrl, headers, model)
    const pageModels = parseModelList(json)
    if (pageModels.length > 0 && pageModels[0] === lastPageFirstId) break
    if (pageModels.length > 0) lastPageFirstId = pageModels[0]
    if (pageModels.length === 0) break

    collected.push(...pageModels)
    if (!isRecord(json) || json.has_more !== true) break

    const lastId = typeof json.last_id === "string" ? json.last_id : pageModels[pageModels.length - 1]
    nextUrl = lastId ? anthropicModelsNextUrl(nextUrl, lastId) : null
  }

  const models = [...new Set(collected)].sort((a, b) => a.localeCompare(b))
  if (models.length === 0) throw new Error(`${providerManifest(model.provider).label} returned an empty model list`)
  return models
}

function withAnthropicModelsLimit(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.searchParams.has("limit")) {
      parsed.searchParams.set("limit", String(ANTHROPIC_MODELS_PAGE_LIMIT))
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function anthropicModelsNextUrl(currentUrl: string, lastId: string): string | null {
  try {
    const parsed = new URL(currentUrl)
    if (parsed.searchParams.get("after_id") === lastId) return null
    parsed.searchParams.set("after_id", lastId)
    if (!parsed.searchParams.has("limit")) {
      parsed.searchParams.set("limit", String(ANTHROPIC_MODELS_PAGE_LIMIT))
    }
    return parsed.toString()
  } catch {
    return null
  }
}

async function fetchModelsListOnce(url: string, headers: Record<string, string>, model: RuntimeModelConfig): Promise<string[]> {
  const json = await fetchModelsListJson(url, headers, model)
  const models = parseModelList(json)
  if (models.length === 0) throw new Error(`${providerManifest(model.provider).label} returned an empty model list`)
  return models
}

async function fetchModelsListJson(url: string, headers: Record<string, string>, model: RuntimeModelConfig): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`${providerManifest(model.provider).label} models HTTP ${response.status}: ${await compactResponseText(response)}`)
    return await response.json()
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${providerManifest(model.provider).label} model list request timed out`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function openAiBody(model: RuntimeModelConfig, messages: ModelMessage[], maxTokens: number): JsonRecord {
  const body: JsonRecord = {
    model: model.model,
    messages: messages.map((message) => ({
      role: message.role,
      content: openAiContent(model, message.content),
    })),
  }

  if (usesMaxCompletionTokens(model)) {
    body.max_completion_tokens = maxTokens
  } else {
    body.temperature = 0.2
    body.max_tokens = maxTokens
  }

  if (model.provider === "deepseek" && /^deepseek-v4/i.test(model.model)) {
    body.thinking = { type: "disabled" }
  }

  return body
}

function openAiContent(model: Pick<RuntimeModelConfig, "provider">, content: ModelMessage["content"]): unknown {
  if (typeof content === "string") return content
  if (content.every((block) => block.type === "text")) {
    return content.map((block) => block.type === "text" ? block.text : "").join("")
  }
  if (model.provider === "deepseek") {
    throw new Error("DeepSeek official API does not accept image input")
  }
  return content.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text }
      : { type: "image_url", image_url: { url: `data:${block.mediaType};base64,${block.dataBase64}` } },
  )
}

function deepSeekUsage(json: ChatResponse): ModelCompletion["usage"] {
  const hit = json.usage?.prompt_cache_hit_tokens
  const miss = json.usage?.prompt_cache_miss_tokens
  if (typeof hit !== "number" && typeof miss !== "number") return undefined
  return {
    promptCacheHitTokens: hit ?? 0,
    promptCacheMissTokens: miss ?? 0,
  }
}

function anthropicContent(content: ModelMessage["content"]): unknown {
  if (typeof content === "string") return content
  return content.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text }
      : { type: "image", source: { type: "base64", media_type: block.mediaType, data: block.dataBase64 } },
  )
}

function textFromMessage(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n")
}

function splitThinkingFromContent(content: string): ModelCompletion {
  const reasoning: string[] = []
  let visible = content.replace(/<think(?:ing)?>\s*([\s\S]*?)<\/think(?:ing)?>\s*/gi, (_match, inner: string) => {
    if (inner.trim()) reasoning.push(inner.trim())
    return ""
  })
  visible = visible.replace(/<think(?:ing)?>\s*([\s\S]*)$/gi, (_match, inner: string) => {
    if (inner.trim()) reasoning.push(inner.trim())
    return ""
  })
  return {
    content: visible.trim(),
    reasoning: joinReasoning(...reasoning),
  }
}

function joinReasoning(...parts: unknown[]): string | undefined {
  const value = parts
    .map((part) => typeof part === "string" ? part.trim() : "")
    .filter(Boolean)
    .join("\n\n")
  return value || undefined
}

function usesMaxCompletionTokens(model: RuntimeModelConfig): boolean {
  const name = model.model.toLowerCase()
  return model.provider === "openai" && (/^o\d/.test(name) || name.startsWith("o1") || name.startsWith("gpt-5"))
}

function openAiHeaders(model: RuntimeModelConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(model.apiKey ? { authorization: `Bearer ${model.apiKey}` } : {}),
    ...(model.provider === "ollama" ? { origin: "http://localhost" } : {}),
  }
}

function anthropicHeaders(model: RuntimeModelConfig): Record<string, string> {
  const url = anthropicMessagesUrl(model)
  const bearer = requiresBearerAuth(url)
  return {
    "content-type": "application/json",
    ...(model.apiKey
      ? bearer
        ? { authorization: `Bearer ${model.apiKey}` }
        : { "x-api-key": model.apiKey, "anthropic-version": "2023-06-01" }
      : {}),
  }
}

function openAiChatUrl(model: RuntimeModelConfig): string {
  return appendOpenAiPath(model, "chat/completions")
}

function openAiEmbeddingUrl(model: RuntimeModelConfig): string {
  return appendOpenAiPath(model, "embeddings")
}

function openAiModelsUrl(model: RuntimeModelConfig): string {
  return appendOpenAiPath(model, "models")
}

function appendOpenAiPath(model: RuntimeModelConfig, path: "chat/completions" | "embeddings" | "models"): string {
  const base = stripOpenAiKnownSuffix(model.endpoint)
  if (base.endsWith("/v1") || base.endsWith("/compatible-mode/v1")) return `${base}/${path}`
  if (model.provider === "deepseek") return `${base}/${path}`
  return `${base}/v1/${path}`
}

function stripOpenAiKnownSuffix(endpoint: string): string {
  return cleanEndpoint(endpoint)
    .replace(/\/v1\/chat\/completions$/i, "/v1")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/v1\/embeddings$/i, "/v1")
    .replace(/\/embeddings$/i, "")
    .replace(/\/v1\/models$/i, "/v1")
    .replace(/\/models$/i, "")
}

function anthropicMessagesUrl(model: RuntimeModelConfig): string {
  return appendAnthropicPath(model.endpoint, "messages")
}

function anthropicModelsUrl(model: RuntimeModelConfig): string {
  return appendAnthropicPath(model.endpoint, "models")
}

function appendAnthropicPath(endpoint: string, path: "messages" | "models"): string {
  const base = cleanEndpoint(endpoint)
    .replace(/\/v\d+\/messages$/i, "")
    .replace(/\/v\d+\/models$/i, "")
  if (/\/v\d+$/i.test(base)) return `${base}/${path}`
  return `${base}/v1/${path}`
}

function ollamaNativeTagsUrl(model: RuntimeModelConfig): string {
  const base = cleanEndpoint(model.endpoint)
    .replace(/\/v1$/i, "")
    .replace(/\/api\/tags$/i, "")
  return `${base}/api/tags`
}

function cleanEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "")
}

function requiresBearerAuth(url: string): boolean {
  const normalized = url.toLowerCase().replace(/\/+$/, "")
  return (
    normalized.startsWith("https://api.minimax.io/anthropic") ||
    normalized.startsWith("https://api.minimaxi.com/anthropic") ||
    normalized.startsWith("https://coding.dashscope.aliyuncs.com/apps/anthropic") ||
    /(^https:\/\/|^)token-plan-cn\.xiaomimimo\.com\/anthropic(?:\/|$)/i.test(normalized)
  )
}

function parseModelList(value: unknown): string[] {
  if (Array.isArray(value)) return dedupeModelIds(value.map(extractModelId))
  if (!isRecord(value)) return []

  if (isRecord(value.data)) {
    const nested = parseModelList(value.data)
    if (nested.length > 0) return nested
  }

  const items = Array.isArray(value.data)
    ? value.data
    : Array.isArray(value.models)
      ? value.models
      : Array.isArray(value.list)
        ? value.list
        : isRecord(value.data) && Array.isArray(value.data.models)
          ? value.data.models
          : []

  return dedupeModelIds(items.map(extractModelId))
}

function extractModelId(item: unknown): string | undefined {
  if (typeof item === "string") return item
  if (!isRecord(item)) return undefined
  if (typeof item.id === "string") return item.id
  if (typeof item.name === "string") return item.name
  if (typeof item.model === "string") return item.model
  return undefined
}

function dedupeModelIds(ids: Array<string | undefined>): string[] {
  return [...new Set(ids.filter((item): item is string => Boolean(item)))].sort((a, b) => a.localeCompare(b))
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null
}

async function compactResponseText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")
  return text.trim().slice(0, 500) || response.statusText
}
