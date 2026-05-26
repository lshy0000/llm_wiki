import type { KnowledgeBase, WikiPage } from "./types.js"
import { JsonIndexRepository } from "./repository.js"
import type { StorageProvider } from "./storage.js"
import { defaultWikiFiles, id, nowIso, parseFrontmatter, pageIdFromPath, sha256 } from "./wiki-utils.js"

export class ProjectService {
  constructor(
    private readonly repo: JsonIndexRepository,
    private readonly storage: StorageProvider,
  ) {}

  async createKnowledgeBase(input: { name: string; description?: string }): Promise<KnowledgeBase> {
    const now = nowIso()
    const kb: KnowledgeBase = {
      id: id("kb"),
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
        await this.repo.upsertPage(this.pageFromContent(kb.id, file.key, file.content, now))
      }
    }
    await this.repo.bumpDataVersion(kb.id)
    return (await this.repo.getKnowledgeBase(kb.id)) ?? kb
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    return this.repo.listKnowledgeBases()
  }

  async getKnowledgeBase(kbId: string): Promise<KnowledgeBase> {
    const kb = await this.repo.getKnowledgeBase(kbId)
    if (!kb) throw new Error("Knowledge base not found")
    return kb
  }

  private pageFromContent(kbId: string, key: string, content: string, now: string): WikiPage {
    const fm = parseFrontmatter(content)
    return {
      id: pageIdFromPath(key),
      kbId,
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

