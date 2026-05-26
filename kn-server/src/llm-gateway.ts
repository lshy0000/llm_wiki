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

  constructor() {
    this.chatConfigured = this.chatEndpoint.length > 0
    this.embeddingConfigured = this.embeddingEndpoint.length > 0
  }

  async complete(messages: LlmMessage[], fallback: string, maxTokens = 1800): Promise<string> {
    if (!this.chatConfigured) return fallback
    try {
      const response = await fetch(this.chatUrl(), {
        method: "POST",
        headers: this.headers(this.chatApiKey),
        body: JSON.stringify({
          model: this.chatModel,
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
    if (!this.chatConfigured) return fallback
    return this.complete(
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
    if (!this.embeddingConfigured) return undefined
    try {
      const response = await fetch(this.embeddingUrl(), {
        method: "POST",
        headers: this.headers(this.embeddingApiKey),
        body: JSON.stringify({
          model: this.embeddingModel,
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

  capabilities(): {
    chatConfigured: boolean
    embeddingConfigured: boolean
    model: string
    embeddingModel: string
  } {
    return {
      chatConfigured: this.chatConfigured,
      embeddingConfigured: this.embeddingConfigured,
      model: this.chatModel,
      embeddingModel: this.embeddingModel,
    }
  }

  private chatUrl(): string {
    return this.chatEndpoint.endsWith("/chat/completions")
      ? this.chatEndpoint
      : `${this.chatEndpoint.replace(/\/$/, "")}/v1/chat/completions`
  }

  private embeddingUrl(): string {
    return this.embeddingEndpoint.endsWith("/embeddings")
      ? this.embeddingEndpoint
      : `${this.embeddingEndpoint.replace(/\/$/, "")}/v1/embeddings`
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    }
  }
}

