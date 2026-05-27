import {
  companyModelToRuntime,
  completeWithProvider,
  defaultEndpointForProvider,
  embedWithProvider,
  isRuntimeModelConfigured,
  normalizeModelProtocol,
  providerFromModel,
  type ModelMessage,
  type RuntimeModelConfig,
} from "./model-providers.js"
import type { CompanyModel } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"

export type LlmMessage = ModelMessage

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

  private async completeWithConfig(model: RuntimeModelConfig | undefined, messages: LlmMessage[], fallback: string, maxTokens: number): Promise<string> {
    return completeWithProvider(model, messages, fallback, maxTokens)
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

  private async embedWithConfig(model: RuntimeModelConfig | undefined, text: string): Promise<number[] | undefined> {
    return embedWithProvider(model, text)
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
      chatConfigured: isRuntimeModelConfigured(llm),
      embeddingConfigured: isRuntimeModelConfigured(embedding),
      model: llm?.model ?? this.chatModel,
      embeddingModel: embedding?.model ?? this.embeddingModel,
      visionModel: vision?.model ?? llm?.model ?? this.chatModel,
    }
  }

  private async resolveModel(companyId: string, capability: "llm" | "embedding" | "vision"): Promise<RuntimeModelConfig | undefined> {
    const companyModel = await this.repo?.getDefaultCompanyModel(companyId, capability)
    if (companyModel) return this.toRuntimeModel(companyModel)
    return this.envModel(capability)
  }

  private toRuntimeModel(model: CompanyModel): RuntimeModelConfig {
    return companyModelToRuntime(model)
  }

  private envModel(capability: "llm" | "embedding" | "vision"): RuntimeModelConfig | undefined {
    const endpoint = capability === "embedding" ? this.embeddingEndpoint : this.chatEndpoint
    const apiKey = capability === "embedding" ? this.embeddingApiKey : this.chatApiKey
    const model = capability === "embedding" ? this.embeddingModel : this.chatModel
    const provider = providerFromModel(model, endpoint)
    const resolvedEndpoint = endpoint || defaultEndpointForProvider(provider)
    return {
      provider,
      protocol: normalizeModelProtocol(provider),
      endpoint: resolvedEndpoint,
      apiKey,
      model,
    }
  }
}
