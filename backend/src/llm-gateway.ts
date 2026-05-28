import {
  companyModelToRuntime,
  completeDetailedWithProvider,
  completeWithProvider,
  embedWithProvider,
  isRuntimeModelConfigured,
  type ModelCompletion,
  type ModelMessage,
  type RuntimeModelConfig,
} from "./model-providers.js"
import type { CompanyModel } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"

export type LlmMessage = ModelMessage

export class LlmGateway {
  constructor(private readonly repo?: KnowledgeRepository) {}

  async complete(messages: LlmMessage[], fallback: string, maxTokens = 1800): Promise<string> {
    return this.completeWithConfig(undefined, messages, fallback, maxTokens)
  }

  async completeForCompany(companyId: string, messages: LlmMessage[], fallback: string, maxTokens = 1800): Promise<string> {
    return this.completeWithConfig(await this.resolveModel(companyId, "llm"), messages, fallback, maxTokens)
  }

  async completeDetailedForCompany(companyId: string, messages: LlmMessage[], fallback: string, maxTokens = 1800): Promise<ModelCompletion> {
    return this.completeDetailedWithConfig(await this.resolveModel(companyId, "llm"), messages, fallback, maxTokens)
  }

  private async completeWithConfig(model: RuntimeModelConfig | undefined, messages: LlmMessage[], fallback: string, maxTokens: number): Promise<string> {
    return completeWithProvider(model, messages, fallback, maxTokens)
  }

  private async completeDetailedWithConfig(model: RuntimeModelConfig | undefined, messages: LlmMessage[], fallback: string, maxTokens: number): Promise<ModelCompletion> {
    return completeDetailedWithProvider(model, messages, fallback, maxTokens)
  }

  async captionImage(input: {
    fileName: string
    mediaType: string
    bytes: Buffer
    sourceName: string
  }): Promise<string> {
    const fallback = `Image extracted from ${input.sourceName}: ${input.fileName}.`
    return this.completeWithConfig(
      undefined,
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
    return this.embedWithConfig(undefined, text)
  }

  async embedForCompany(companyId: string, text: string): Promise<number[] | undefined> {
    return this.embedWithConfig(await this.resolveModel(companyId, "embedding"), text)
  }

  async embedForKnowledgeBase(kbId: string, text: string): Promise<number[] | undefined> {
    return this.embedWithConfig(await this.resolveEmbeddingModelForKb(kbId), text)
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
    const llm = companyId ? await this.resolveModel(companyId, "llm") : undefined
    const embedding = companyId ? await this.resolveModel(companyId, "embedding") : undefined
    const vision = companyId ? await this.resolveModel(companyId, "vision") : undefined
    return {
      chatConfigured: isRuntimeModelConfigured(llm),
      embeddingConfigured: isRuntimeModelConfigured(embedding),
      model: llm?.model ?? "",
      embeddingModel: embedding?.model ?? "",
      visionModel: vision?.model ?? "",
    }
  }

  private async resolveModel(companyId: string, capability: "llm" | "embedding" | "vision"): Promise<RuntimeModelConfig | undefined> {
    const companyModel = await this.repo?.getDefaultCompanyModel(companyId, capability)
    if (companyModel) return this.toRuntimeModel(companyModel)
    return undefined
  }

  private async resolveEmbeddingModelForKb(kbId: string): Promise<RuntimeModelConfig | undefined> {
    const kb = await this.repo?.getKnowledgeBase(kbId)
    if (!kb) return undefined
    // 向量检索必须和摄取时使用同一个 embedding 模型，否则 query 向量和 page chunk 向量维度/语义空间可能不一致。
    // 知识库显式绑定模型时优先使用绑定模型；绑定模型被删除或不再支持 embedding 时，回退到公司默认模型。
    if (kb.embeddingModelId) {
      const model = await this.repo?.getCompanyModel(kb.companyId, kb.embeddingModelId)
      if (model?.capabilities.includes("embedding")) return this.toRuntimeModel(model)
    }
    return this.resolveModel(kb.companyId, "embedding")
  }

  private toRuntimeModel(model: CompanyModel): RuntimeModelConfig {
    return companyModelToRuntime(model)
  }
}
