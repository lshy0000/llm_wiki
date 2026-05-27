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
  defaultModel: string
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
  choices?: Array<{ message?: { content?: string } }>
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>
}

export const MODEL_PROVIDER_MANIFESTS: Record<ModelProvider, ModelProviderManifest> = {
  openai: {
    provider: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    protocol: "openai_compatible",
    selectableProtocol: false,
    apiKeyRequired: true,
    defaultModel: "gpt-4o-mini",
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
    defaultModel: "qwen-plus",
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
    defaultModel: "deepseek-v4-flash",
    defaultCapabilities: ["llm"],
    description: "DeepSeek 官方 API。v4 模型由后端注入 DeepSeek 专用 thinking 控制。",
  },
  kimi: {
    provider: "kimi",
    label: "Kimi / Moonshot",
    endpoint: "https://api.moonshot.cn/v1",
    protocol: "openai_compatible",
    selectableProtocol: false,
    apiKeyRequired: true,
    defaultModel: "kimi-k2.6",
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
    defaultModel: "claude-sonnet-4-5-20250929",
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
    defaultModel: "llama3.1",
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
    defaultModel: "",
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
  if (!model?.endpoint) return fallback
  try {
    if (model.protocol === "anthropic_messages") {
      return await completeAnthropic(model, messages, fallback, maxTokens)
    }
    return await completeOpenAiCompatible(model, messages, fallback, maxTokens)
  } catch (err) {
    return `${fallback}\n\n> LLM fallback used because provider call failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

export async function embedWithProvider(model: RuntimeModelConfig | undefined, text: string): Promise<number[] | undefined> {
  if (!model?.endpoint || model.protocol !== "openai_compatible") return undefined
  try {
    const response = await fetch(openAiEmbeddingUrl(model), {
      method: "POST",
      headers: openAiHeaders(model),
      body: JSON.stringify({
        model: model.model,
        input: text.slice(0, 8000),
      }),
    })
    if (!response.ok) throw new Error(await response.text())
    const json = (await response.json()) as EmbeddingResponse
    return json.data?.[0]?.embedding
  } catch {
    return undefined
  }
}

export async function testModelProvider(input: ModelProviderTestInput): Promise<ModelProviderTestResult> {
  const model = resolveRuntimeModel({
    provider: input.provider,
    protocol: input.protocol,
    endpoint: input.endpoint,
    apiKey: input.apiKey,
    model: input.model?.trim() || providerManifest(normalizeProvider(input.provider)).defaultModel || "test-model",
  })
  if (!model.endpoint) throw new Error("Base URL is required")
  if (providerManifest(model.provider).apiKeyRequired && !model.apiKey) {
    throw new Error(`${providerManifest(model.provider).label} requires an API Key`)
  }

  const models = await listProviderModels(model)
  const selectedModelAvailable = model.model ? models.includes(model.model) : undefined
  const shown = models.slice(0, 12)
  return {
    ok: true,
    provider: model.provider,
    protocol: model.protocol,
    endpoint: model.endpoint,
    checked: "models",
    modelCount: models.length,
    models: shown,
    selectedModelAvailable,
    message: selectedModelAvailable === false
      ? `连接成功，发现 ${models.length} 个模型，但当前模型名未出现在列表中。`
      : `连接成功，发现 ${models.length} 个模型。`,
  }
}

async function completeOpenAiCompatible(
  model: RuntimeModelConfig,
  messages: ModelMessage[],
  fallback: string,
  maxTokens: number,
): Promise<string> {
  const response = await fetch(openAiChatUrl(model), {
    method: "POST",
    headers: openAiHeaders(model),
    body: JSON.stringify(openAiBody(model, messages, maxTokens)),
  })
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`)
  const json = (await response.json()) as ChatResponse
  return json.choices?.[0]?.message?.content?.trim() || fallback
}

async function completeAnthropic(
  model: RuntimeModelConfig,
  messages: ModelMessage[],
  fallback: string,
  maxTokens: number,
): Promise<string> {
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
  return json.content?.map((item) => item.text ?? "").join("").trim() || fallback
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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`${providerManifest(model.provider).label} models HTTP ${response.status}: ${await compactResponseText(response)}`)
    const json = await response.json()
    const models = parseModelList(json)
    if (models.length === 0) throw new Error(`${providerManifest(model.provider).label} returned an empty model list`)
    return models
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
      content: openAiContent(message.content),
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

function openAiContent(content: ModelMessage["content"]): unknown {
  if (typeof content === "string") return content
  if (content.every((block) => block.type === "text")) {
    return content.map((block) => block.type === "text" ? block.text : "").join("")
  }
  return content.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text }
      : { type: "image_url", image_url: { url: `data:${block.mediaType};base64,${block.dataBase64}` } },
  )
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
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : isRecord(value) && Array.isArray(value.models)
        ? value.models
        : []
  const ids = items
    .map((item) => {
      if (typeof item === "string") return item
      if (!isRecord(item)) return undefined
      if (typeof item.id === "string") return item.id
      if (typeof item.name === "string") return item.name
      if (typeof item.model === "string") return item.model
      return undefined
    })
    .filter((item): item is string => Boolean(item))
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null
}

async function compactResponseText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")
  return text.trim().slice(0, 500) || response.statusText
}
