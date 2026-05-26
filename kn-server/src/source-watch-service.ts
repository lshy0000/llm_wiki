import type { FileTreeNode } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import type { SourceService } from "./source-service.js"
import type { StorageProvider } from "./storage.js"

export class SourceWatchService {
  private timer: NodeJS.Timeout | undefined
  private scanning = false

  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly storage: StorageProvider,
    private readonly source: SourceService,
    private readonly onQueued: () => Promise<void>,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.scanAll()
    }, 5000)
    void this.scanAll()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async scanAll(): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      for (const kb of await this.repo.listKnowledgeBases()) {
        await this.scanKb(kb.id)
      }
    } finally {
      this.scanning = false
    }
  }

  async scanKnowledgeBase(kbId: string): Promise<void> {
    await this.scanKb(kbId)
  }

  private async scanKb(kbId: string): Promise<void> {
    const known = new Set((await this.repo.listSources(kbId)).map((source) => source.storageKey))
    const files = this.flatten(await this.storage.listTree(kbId, "raw/sources"))
    let queued = false
    for (const file of files) {
      if (file.isDirectory || known.has(file.path)) continue
      const bytes = await this.storage.readObject(kbId, file.path)
      await this.source.registerExisting({ kbId, storageKey: file.path, bytes })
      queued = true
    }
    if (queued) await this.onQueued()
  }

  private flatten(nodes: FileTreeNode[]): FileTreeNode[] {
    return nodes.flatMap((node) => [node, ...(node.children ? this.flatten(node.children) : [])])
  }
}
