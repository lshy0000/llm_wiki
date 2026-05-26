import type { CompanyModel } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"

export interface LlmMessage {
  role: "system" | "user" | "assistant"
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image"; mediaType: string; dataBase64: string }
      >
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>
}

export class LlmGateway {
  readonly chatConfigured: boolean
  readonly embeddingConfigured: boolean

  private readonly chatEndpoint = process.env.KN_LLM_ENDPOINT ?? process.env.LLM_ENDPOINT ?? ""
  private readonly chatApiKey = process.env.KN_LLM_API_KEY ?? process.env.LLM_API_KEY ?? ""
  private readonly chatModel = process.env.KN_LLM_MODEL ?? process.env.LLM_MODEL ?? "gpt-4o-mini"
  private readonly embeddingEndpoint = process.env.KN_EMBEDDING_ENDPOINT ?? process.env.KN_LLM_ENDPOINT ?? ""
  private readonly embeddingApiKey = process.env.KN_EMBEDDING_API_KEY ?? this.chatApiKey
  private readonly embeddingModel = process.env.KN_EMBEDDING_MODEL ?? "text-embedding-3-small"

  constructor(private readonly repo?: KnowledgeRepository) {
    this.chatConfigured = this.chatEndpoint.length > 0
    this.embeddingConfigured = this.embeddingEndpoint.length > 0
  }

  async complete(messages: LlmMessage[], fallback: string, maxTokens = 1800): Promise<string> {
    return this.completeWithConfig(this.envModel("llm"), messages, fallback, maxTokens)
  }

  async completeForCompany(companyId: string, messages: LlmMessage[], fallback: string, maxTokens = 1800): Promise<string> {
    return this.completeWithConfig(await this.resolveModel(companyId, "llm"), messages, fallback, maxTokens)
  }

  private async completeWithConfig(model: RuntimeModel | undefined, messages: LlmMessage[], fallback: string, maxTokens: number): Promise<string> {
    if (!model?.endpoint) return fallback
    try {
      const response = await fetch(this.chatUrl(model.endpoint), {
        method: "POST",
        headers: this.headers(model.apiKey ?? ""),
        body: JSON.stringify({
          model: model.model,
          messages: messages.map((message) => ({
            role: message.role,
            content: Array.isArray(message.content)
              ? message.content.map((block) =>
                  block.type === "text"
                    ? { type: "text", text: block.text }
                    : { type: "image_url", image_url: { url: `data:${block.mediaType};base64,${block.dataBase64}` } },
                )
              : message.content,
          })),
          temperature: 0.2,
          max_tokens: maxTokens,
        }),
      })
      if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`)
      const json = (await response.json()) as ChatResponse
      return json.choices?.[0]?.message?.content?.trim() || fallback
    } catch (err) {
      return `${fallback}\n\n> LLM fallback used because provider call failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  async captionImage(input: {
    fileName: string
    mediaType: string
    bytes: Buffer
    sourceName: string
  }): Promise<string> {
    const fallback = `Image extracted from ${input.sourceName}: ${input.fileName}.`
    return this.completeWithConfig(
      this.envModel("vision"),
      [
        {
          role: "system",
          content:
            "Describe the image factually for a knowledge-base index. Mention visible text, chart axes, entities, numbers, and why it may matter. Do not speculate.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Source file: ${input.sourceName}. Image file: ${input.fileName}.` },
            { type: "image", mediaType: input.mediaType, dataBase64: input.bytes.toString("base64") },
          ],
        },
      ],
      fallback,
      500,
    )
  }

  async captionImageForCompany(companyId: string, input: {
    fileName: string
    mediaType: string
    bytes: Buffer
    sourceName: string
  }): Promise<string> {
    const fallback = `Image extracted from ${input.sourceName}: ${input.fileName}.`
    return this.completeWithConfig(
      await this.resolveModel(companyId, "vision"),
      [
        {
          role: "system",
          content:
            "Describe the image factually for a knowledge-base index. Mention visible text, chart axes, entities, numbers, and why it may matter. Do not speculate.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Source file: ${input.sourceName}. Image file: ${input.fileName}.` },
            { type: "image", mediaType: input.mediaType, dataBase64: input.bytes.toString("base64") },
          ],
        },
      ],
      fallback,
      500,
    )
  }

  async embed(text: string): Promise<number[] | undefined> {
    return this.embedWithConfig(this.envModel("embedding"), text)
  }

  async embedForCompany(companyId: string, text: string): Promise<number[] | undefined> {
    return this.embedWithConfig(await this.resolveModel(companyId, "embedding"), text)
  }

  private async embedWithConfig(model: RuntimeModel | undefined, text: string): Promise<number[] | undefined> {
    if (!model?.endpoint) return undefined
    try {
      const response = await fetch(this.embeddingUrl(model.endpoint), {
        method: "POST",
        headers: this.headers(model.apiKey ?? ""),
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

  async capabilities(companyId?: string): Promise<{
    chatConfigured: boolean
    embeddingConfigured: boolean
    model: string
    embeddingModel: string
    visionModel: string
  }> {
    const llm = companyId ? await this.resolveModel(companyId, "llm") : this.envModel("llm")
    const embedding = companyId ? await this.resolveModel(companyId, "embedding") : this.envModel("embedding")
    const vision = companyId ? await this.resolveModel(companyId, "vision") : this.envModel("vision")
    return {
      chatConfigured: Boolean(llm?.endpoint),
      embeddingConfigured: Boolean(embedding?.endpoint),
      model: llm?.model ?? this.chatModel,
      embeddingModel: embedding?.model ?? this.embeddingModel,
      visionModel: vision?.model ?? llm?.model ?? this.chatModel,
    }
  }

  private async resolveModel(companyId: string, capability: "llm" | "embedding" | "vision"): Promise<RuntimeModel | undefined> {
    const companyModel = await this.repo?.getDefaultCompanyModel(companyId, capability)
    if (companyModel) return this.toRuntimeModel(companyModel)
    return this.envModel(capability)
  }

  private toRuntimeModel(model: CompanyModel): RuntimeModel {
    return {
      endpoint: model.endpoint,
      apiKey: model.apiKey,
      model: model.model,
    }
  }

  private envModel(capability: "llm" | "embedding" | "vision"): RuntimeModel | undefined {
    if (capability === "embedding") {
      return { endpoint: this.embeddingEndpoint, apiKey: this.embeddingApiKey, model: this.embeddingModel }
    }
    return { endpoint: this.chatEndpoint, apiKey: this.chatApiKey, model: this.chatModel }
  }

  private chatUrl(endpoint: string): string {
    return endpoint.endsWith("/chat/completions")
      ? endpoint
      : `${endpoint.replace(/\/$/, "")}/v1/chat/completions`
  }

  private embeddingUrl(endpoint: string): string {
    return endpoint.endsWith("/embeddings")
      ? endpoint
      : `${endpoint.replace(/\/$/, "")}/v1/embeddings`
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    }
  }
}

interface RuntimeModel {
  endpoint: string
  apiKey?: string
  model: string
}
