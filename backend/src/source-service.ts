import type { IngestJob, SourceDocument } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import type { StorageProvider } from "./storage.js"
import { classifySourceBytes, isAutoIngestAdmission, sourceContentType, type SourceAdmission } from "./source-formats.js"
import { fileNameOf, folderContextFor, id, normalizeStorageKey, nowIso, parentStoragePathOf, sha256 } from "./wiki-utils.js"

export type SourceSaveResult =
  | { accepted: true; source: SourceDocument; job?: IngestJob; admission: SourceAdmission }
  | { accepted: false; relativePath: string; fileName: string; admission: SourceAdmission; reason: string }

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
  }): Promise<SourceSaveResult> {
    const kb = await this.repo.getKnowledgeBase(input.kbId)
    if (!kb) throw new Error("Knowledge base not found")
    const now = nowIso()
    const relativePath = normalizeStorageKey(input.relativePath || input.fileName)
    const admission = classifySourceBytes(relativePath, input.bytes)
    if (!admission.supported) {
      return {
        accepted: false,
        relativePath,
        fileName: fileNameOf(relativePath),
        admission,
        reason: admission.reason ?? "unsupported source",
      }
    }
    const sourceId = id("src")
    const storageKey = normalizeStorageKey(`raw/${relativePath}`)
    await this.storage.writeObject(input.kbId, storageKey, input.bytes)
    const shouldQueue = isAutoIngestAdmission(admission)

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
      contentType: input.contentType || sourceContentType(admission),
      size: input.bytes.length,
      sha256: sha256(input.bytes),
      status: shouldQueue ? "queued" : "ingested",
      folderContext: folderContextFor(relativePath, { root: "raw", uploadBatchId: input.uploadBatchId }),
      createdAt: now,
      updatedAt: now,
    }
    const savedSource = await this.repo.saveSource(source)
    if (!shouldQueue) return { accepted: true, source: savedSource, admission }

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
    return { accepted: true, source: savedSource, job, admission }
  }

  async registerExisting(input: {
    kbId: string
    storageKey: string
    bytes: Buffer
    contentType?: string
  }): Promise<SourceSaveResult> {
    const kb = await this.repo.getKnowledgeBase(input.kbId)
    if (!kb) throw new Error("Knowledge base not found")
    const relativePath = normalizeStorageKey(input.storageKey).replace(/^raw\//, "")
    const admission = classifySourceBytes(relativePath, input.bytes)
    if (!admission.supported) {
      return {
        accepted: false,
        relativePath,
        fileName: fileNameOf(relativePath),
        admission,
        reason: admission.reason ?? "unsupported source",
      }
    }
    const now = nowIso()
    const sourceId = id("src")
    const shouldQueue = isAutoIngestAdmission(admission)
    const source: SourceDocument = {
      id: sourceId,
      companyId: kb.companyId,
      kbId: input.kbId,
      root: "raw",
      fileName: fileNameOf(relativePath),
      relativePath,
      parentPath: parentStoragePathOf(relativePath),
      storageKey: normalizeStorageKey(input.storageKey),
      contentType: input.contentType || sourceContentType(admission),
      size: input.bytes.length,
      sha256: sha256(input.bytes),
      status: shouldQueue ? "queued" : "ingested",
      folderContext: folderContextFor(relativePath, { root: "raw" }),
      createdAt: now,
      updatedAt: now,
    }
    const savedSource = await this.repo.saveSource(source)
    if (!shouldQueue) return { accepted: true, source: savedSource, admission }
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
    return { accepted: true, source: savedSource, job, admission }
  }

  async listSources(kbId: string): Promise<SourceDocument[]> {
    return this.repo.listSources(kbId)
  }
}
