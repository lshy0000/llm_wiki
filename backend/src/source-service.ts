import type { IngestJob, SourceDocument } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import type { StorageProvider } from "./storage.js"
import { fileNameOf, folderContextFor, id, normalizeStorageKey, nowIso, parentStoragePathOf, sha256 } from "./wiki-utils.js"

export class SourceService {
  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly storage: StorageProvider,
  ) {}

  async saveUpload(input: {
    kbId: string
    fileName: string
    relativePath?: string
    contentType?: string
    bytes: Buffer
    uploadBatchId?: string
  }): Promise<{ source: SourceDocument; job: IngestJob }> {
    const kb = await this.repo.getKnowledgeBase(input.kbId)
    if (!kb) throw new Error("Knowledge base not found")
    const now = nowIso()
    const relativePath = normalizeStorageKey(input.relativePath || input.fileName)
    const sourceId = id("src")
    const storageKey = normalizeStorageKey(`raw/${relativePath}`)
    await this.storage.writeObject(input.kbId, storageKey, input.bytes)

    const source: SourceDocument = {
      id: sourceId,
      companyId: kb.companyId,
      kbId: input.kbId,
      root: "raw",
      fileName: fileNameOf(relativePath),
      relativePath,
      parentPath: parentStoragePathOf(relativePath),
      uploadBatchId: input.uploadBatchId,
      storageKey,
      contentType: input.contentType || "application/octet-stream",
      size: input.bytes.length,
      sha256: sha256(input.bytes),
      status: "queued",
      folderContext: folderContextFor(relativePath, { root: "raw", uploadBatchId: input.uploadBatchId }),
      createdAt: now,
      updatedAt: now,
    }
    const savedSource = await this.repo.saveSource(source)

    const job: IngestJob = {
      id: id("job"),
      companyId: kb.companyId,
      kbId: input.kbId,
      sourceId: savedSource.id,
      status: "queued",
      progress: 0,
      stage: "Queued for two-step ingest",
      attempts: 0,
      cached: false,
      createdAt: now,
      updatedAt: now,
      writtenPageIds: [],
    }
    await this.repo.saveJob(job)
    return { source: savedSource, job }
  }

  async registerExisting(input: {
    kbId: string
    storageKey: string
    bytes: Buffer
    contentType?: string
  }): Promise<{ source: SourceDocument; job: IngestJob }> {
    const kb = await this.repo.getKnowledgeBase(input.kbId)
    if (!kb) throw new Error("Knowledge base not found")
    const relativePath = normalizeStorageKey(input.storageKey).replace(/^raw\//, "")
    const now = nowIso()
    const sourceId = id("src")
    const source: SourceDocument = {
      id: sourceId,
      companyId: kb.companyId,
      kbId: input.kbId,
      root: "raw",
      fileName: fileNameOf(relativePath),
      relativePath,
      parentPath: parentStoragePathOf(relativePath),
      storageKey: normalizeStorageKey(input.storageKey),
      contentType: input.contentType || "application/octet-stream",
      size: input.bytes.length,
      sha256: sha256(input.bytes),
      status: "queued",
      folderContext: folderContextFor(relativePath, { root: "raw" }),
      createdAt: now,
      updatedAt: now,
    }
    const savedSource = await this.repo.saveSource(source)
    const job: IngestJob = {
      id: id("job"),
      companyId: kb.companyId,
      kbId: input.kbId,
      sourceId: savedSource.id,
      status: "queued",
      progress: 0,
      stage: "Queued by raw/sources watcher",
      attempts: 0,
      cached: false,
      createdAt: now,
      updatedAt: now,
      writtenPageIds: [],
    }
    await this.repo.saveJob(job)
    return { source: savedSource, job }
  }

  async listSources(kbId: string): Promise<SourceDocument[]> {
    return this.repo.listSources(kbId)
  }
}
