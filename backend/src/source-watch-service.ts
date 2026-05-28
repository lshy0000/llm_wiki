import type { FileTreeNode } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import type { SourceService } from "./source-service.js"
import type { StorageProvider } from "./storage.js"
import { classifySourcePath } from "./source-formats.js"

const LARGE_CORPUS_SOURCE_THRESHOLD = Number(process.env.KN_INCREMENTAL_INGEST_SOURCE_THRESHOLD ?? 150)
const LARGE_CORPUS_AUTO_SCAN_INTERVAL_MS = Number(process.env.KN_LARGE_CORPUS_AUTO_SCAN_INTERVAL_MS ?? 10 * 60 * 1000)

export class SourceWatchService {
  private timer: NodeJS.Timeout | undefined
  private scanning = false
  private lastLargeCorpusAutoScanAt = new Map<string, number>()

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
    await this.scanKb(kbId, { force: true })
  }

  private async scanKb(kbId: string, options: { force?: boolean } = {}): Promise<void> {
    const sourceCount = await this.repo.countSources(kbId)
    if (!options.force && sourceCount > LARGE_CORPUS_SOURCE_THRESHOLD) {
      const lastScanAt = this.lastLargeCorpusAutoScanAt.get(kbId) ?? 0
      if (Date.now() - lastScanAt < LARGE_CORPUS_AUTO_SCAN_INTERVAL_MS) return
      this.lastLargeCorpusAutoScanAt.set(kbId, Date.now())
    }
    const known = new Set((await this.repo.listSources(kbId)).map((source) => source.storageKey))
    const files = this.flatten(await this.storage.listTree(kbId, "raw"))
    let queued = false
    for (const file of files) {
      if (file.isDirectory || known.has(file.path)) continue
      const relativePath = file.path.replace(/^raw\/?/, "")
      const pathAdmission = classifySourcePath(relativePath)
      if (!pathAdmission.supported && pathAdmission.reason !== "missing extension") continue
      const bytes = await this.storage.readObject(kbId, file.path)
      const saved = await this.source.registerExisting({ kbId, storageKey: file.path, bytes })
      if (saved.accepted && saved.job) queued = true
    }
    if (queued) await this.onQueued()
  }

  private flatten(nodes: FileTreeNode[]): FileTreeNode[] {
    return nodes.flatMap((node) => [node, ...(node.children ? this.flatten(node.children) : [])])
  }
}
