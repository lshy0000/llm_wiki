import type { IngestJob, SourceDocument } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import type { StorageProvider } from "./storage.js"
import { fileNameOf, folderContextFor, id, normalizeStorageKey, nowIso, sha256 } from "./wiki-utils.js"

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
  }): Promise<{ source: SourceDocument; job: IngestJob }> {
    const now = nowIso()
    const relativePath = normalizeStorageKey(input.relativePath || input.fileName)
    const sourceId = id("src")
    const storageKey = normalizeStorageKey(`raw/sources/${relativePath}`)
    await this.storage.writeObject(input.kbId, storageKey, input.bytes)

    const source: SourceDocument = {
      id: sourceId,
      kbId: input.kbId,
      fileName: fileNameOf(relativePath),
      relativePath,
      storageKey,
      contentType: input.contentType || "application/octet-stream",
      size: input.bytes.length,
      sha256: sha256(input.bytes),
      status: "queued",
      folderContext: folderContextFor(relativePath),
      createdAt: now,
      updatedAt: now,
    }
    await this.repo.saveSource(source)

    const job: IngestJob = {
      id: id("job"),
      kbId: input.kbId,
      sourceId,
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
    return { source, job }
  }

  async registerExisting(input: {
    kbId: string
    storageKey: string
    bytes: Buffer
    contentType?: string
  }): Promise<{ source: SourceDocument; job: IngestJob }> {
    const relativePath = normalizeStorageKey(input.storageKey).replace(/^raw\/sources\//, "")
    const now = nowIso()
    const sourceId = id("src")
    const source: SourceDocument = {
      id: sourceId,
      kbId: input.kbId,
      fileName: fileNameOf(relativePath),
      relativePath,
      storageKey: normalizeStorageKey(input.storageKey),
      contentType: input.contentType || "application/octet-stream",
      size: input.bytes.length,
      sha256: sha256(input.bytes),
      status: "queued",
      folderContext: folderContextFor(relativePath),
      createdAt: now,
      updatedAt: now,
    }
    await this.repo.saveSource(source)
    const job: IngestJob = {
      id: id("job"),
      kbId: input.kbId,
      sourceId,
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
    return { source, job }
  }

  async listSources(kbId: string): Promise<SourceDocument[]> {
    return this.repo.listSources(kbId)
  }
}
