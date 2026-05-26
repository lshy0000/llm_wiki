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
  }): Promise<KnowledgeBase> {
    const now = nowIso()
    const kb: KnowledgeBase = {
      id: id("kb"),
      companyId: input.companyId,
      createdBy: input.createdBy,
      visibility: input.visibility ?? "company",
      type: "llm_wiki",
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      createdAt: now,
      updatedAt: now,
      dataVersion: 1,
    }
    await this.repo.saveKnowledgeBase(kb)

    for (const file of defaultWikiFiles(kb.name)) {
      await this.storage.writeObject(kb.id, file.key, file.content)
      if (file.key.startsWith("wiki/") && file.key.endsWith(".md")) {
        await this.repo.upsertPage(this.pageFromContent(kb, file.key, file.content, now))
      }
    }
    await this.repo.bumpDataVersion(kb.id)
    return (await this.repo.getKnowledgeBase(kb.id)) ?? kb
  }

  async listKnowledgeBases(companyId: string, identityId: string): Promise<KnowledgeBase[]> {
    return this.repo.listKnowledgeBases(companyId, identityId)
  }

  async getKnowledgeBase(kbId: string): Promise<KnowledgeBase> {
    const kb = await this.repo.getKnowledgeBase(kbId)
    if (!kb) throw new Error("Knowledge base not found")
    return kb
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
