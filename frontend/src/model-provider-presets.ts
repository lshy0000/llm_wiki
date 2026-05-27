import type { CompanyModel } from "@/web/types"

export type ModelProviderPreset = {
  provider: CompanyModel["provider"]
  label: string
  protocol: CompanyModel["protocol"]
  endpoint: string
  suggestedModel: string
  defaultCapabilities: CompanyModel["capabilities"]
  description: string
}

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    provider: "openai",
    label: "OpenAI",
    protocol: "openai_compatible",
    endpoint: "https://api.openai.com/v1",
    suggestedModel: "gpt-4o-mini",
    defaultCapabilities: ["llm", "vision"],
    description: "官方 OpenAI API，适合 LLM 和视觉模型。",
  },
  {
    provider: "qwen",
    label: "千问 DashScope",
    protocol: "openai_compatible",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    suggestedModel: "qwen-plus",
    defaultCapabilities: ["llm", "vision"],
    description: "阿里云百炼 DashScope 模式，填写 DashScope API Key 和模型名。",
  },
  {
    provider: "deepseek",
    label: "DeepSeek",
    protocol: "openai_compatible",
    endpoint: "https://api.deepseek.com",
    suggestedModel: "deepseek-v4-flash",
    defaultCapabilities: ["llm"],
    description: "DeepSeek 官方端点，后端对 v4 模型做专用 thinking 控制。",
  },
  {
    provider: "kimi",
    label: "Kimi / Moonshot",
    protocol: "openai_compatible",
    endpoint: "https://api.moonshot.cn/v1",
    suggestedModel: "kimi-k2.6",
    defaultCapabilities: ["llm"],
    description: "月之暗面 Moonshot 官方端点。",
  },
  {
    provider: "claudecode",
    label: "Claude / Anthropic",
    protocol: "anthropic_messages",
    endpoint: "https://api.anthropic.com",
    suggestedModel: "claude-sonnet-4-5-20250929",
    defaultCapabilities: ["llm", "vision"],
    description: "Anthropic Messages 协议，填写 Anthropic API Key 和 Claude 模型名。",
  },
  {
    provider: "ollama",
    label: "Ollama",
    protocol: "openai_compatible",
    endpoint: "http://localhost:11434/v1",
    suggestedModel: "llama3.1",
    defaultCapabilities: ["llm"],
    description: "本地 Ollama /v1 端点，通常不需要 API Key。",
  },
  {
    provider: "custom",
    label: "自定义",
    protocol: "openai_compatible",
    endpoint: "",
    suggestedModel: "",
    defaultCapabilities: ["llm"],
    description: "自定义服务需要填写 Base URL，并选择 API 模式。",
  },
]

export function modelProviderPreset(provider: CompanyModel["provider"]): ModelProviderPreset {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.provider === provider) ?? MODEL_PROVIDER_PRESETS[MODEL_PROVIDER_PRESETS.length - 1]
}

export function protocolLabel(protocol: CompanyModel["protocol"]): string {
  return protocol === "anthropic_messages" ? "Messages" : "Chat Completions"
}

export function embeddingModelLabel(model: CompanyModel): string {
  return model.name
}
