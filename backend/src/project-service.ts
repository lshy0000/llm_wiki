import type { KnowledgeBase, WikiPage } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import type { StorageProvider } from "./storage.js"
import { defaultWikiFiles, id, nowIso, parseFrontmatter, pageIdFromPath, sha256 } from "./wiki-utils.js"

export class ProjectService {
  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly storage: StorageProvider,
  ) {}

  async createKnowledgeBase(input: {
    companyId: string
    createdBy: string
    name: string
    description?: string
    visibility?: KnowledgeBase["visibility"]
    embeddingModelId?: string
  }): Promise<KnowledgeBase> {
    const now = nowIso()
    const embeddingModelId = await this.resolveEmbeddingModelId(input.companyId, input.embeddingModelId)
    const kb: KnowledgeBase = {
      id: id("kb"),
      companyId: input.companyId,
      createdBy: input.createdBy,
      visibility: input.visibility ?? "company",
      type: "llm_wiki",
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      embeddingModelId,
      createdAt: now,
      updatedAt: now,
    }
    await this.repo.saveKnowledgeBase(kb)

    for (const file of defaultWikiFiles(kb.name)) {
      await this.storage.writeObject(kb.id, file.key, file.content)
      if (file.key.startsWith("wiki/") && file.key.endsWith(".md")) {
        await this.repo.upsertPage(this.pageFromContent(kb, file.key, file.content, now))
      }
    }
    await this.repo.touchKnowledgeBase(kb.id)
    return (await this.repo.getKnowledgeBase(kb.id)) ?? kb
  }

  async listKnowledgeBases(companyId?: string, identityId?: string): Promise<KnowledgeBase[]> {
    return this.repo.listKnowledgeBases(companyId, identityId)
  }

  async getKnowledgeBase(kbId: string): Promise<KnowledgeBase> {
    const kb = await this.repo.getKnowledgeBase(kbId)
    if (!kb) throw new Error("Knowledge base not found")
    return kb
  }

  async deleteKnowledgeBase(kbId: string): Promise<void> {
    const kb = await this.repo.getKnowledgeBase(kbId)
    if (!kb) throw new Error("Knowledge base not found")
    // 先删除数据库主记录，让 PostgreSQL 通过 ON DELETE CASCADE 清理 sources/jobs/pages/chunks/reviews 等索引数据；
    // 再删除磁盘目录，避免目录已删但数据库仍指向不存在文件。路由层已完成公司权限校验。
    await this.repo.deleteKnowledgeBase(kbId)
    await this.storage.deleteKnowledgeBase(kbId)
  }

  async updateKnowledgeBaseEmbeddingModel(kbId: string, embeddingModelId?: string): Promise<KnowledgeBase> {
    const kb = await this.repo.getKnowledgeBase(kbId)
    if (!kb) throw new Error("Knowledge base not found")
    let resolved: string | undefined
    if (embeddingModelId) {
      const model = await this.repo.getCompanyModel(kb.companyId, embeddingModelId)
      if (!model) throw new Error("Embedding model not found")
      if (!model.capabilities.includes("embedding")) throw new Error("Model does not support embedding")
      resolved = model.id
    }
    const updated: KnowledgeBase = {
      ...kb,
      embeddingModelId: resolved,
      updatedAt: nowIso(),
    }
    return this.repo.saveKnowledgeBase(updated)
  }

  private async resolveEmbeddingModelId(companyId: string, embeddingModelId?: string): Promise<string | undefined> {
    if (embeddingModelId) {
      const model = await this.repo.getCompanyModel(companyId, embeddingModelId)
      if (!model) throw new Error("Embedding model not found")
      if (!model.capabilities.includes("embedding")) throw new Error("Model does not support embedding")
      return model.id
    }
    // 创建知识库时把当时的默认 embedding 模型固化到 KB 上；
    // 后续公司默认模型变化不会悄悄改变已有知识库的向量空间，避免检索时新旧向量混用。
    const fallback = await this.repo.getDefaultCompanyModel(companyId, "embedding")
    return fallback?.id
  }

  private pageFromContent(kb: KnowledgeBase, key: string, content: string, now: string): WikiPage {
    const fm = parseFrontmatter(content)
    return {
      id: pageIdFromPath(key),
      companyId: kb.companyId,
      kbId: kb.id,
      path: key,
      title: fm.title,
      type: fm.type,
      content,
      sha256: sha256(content),
      sources: fm.sources,
      images: [],
      createdAt: now,
      updatedAt: now,
    }
  }
}
