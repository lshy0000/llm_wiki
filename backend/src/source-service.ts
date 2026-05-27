import type { BackgroundTask, IngestJob, SourceDocument } from "./types.js"
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
      status: shouldQueue ? "uploaded" : "ingested",
      folderContext: folderContextFor(relativePath, { root: "raw", uploadBatchId: input.uploadBatchId }),
      createdAt: now,
      updatedAt: now,
    }
    const savedSource = await this.repo.saveSource(source)
    return { accepted: true, source: savedSource, admission }
  }

  async createIngestTask(input: {
    kbId: string
    uploadBatchId?: string
    title?: string
    items: Array<Extract<SourceSaveResult, { accepted: true }>>
  }): Promise<BackgroundTask> {
    const kb = await this.repo.getKnowledgeBase(input.kbId)
    if (!kb) throw new Error("Knowledge base not found")
    const now = nowIso()
    const sourceIds = [...new Set(input.items.map((item) => item.source.id))]
    const queueItems = input.items.filter((item) => isAutoIngestAdmission(item.admission))
    let task: BackgroundTask = {
      id: id("tsk"),
      companyId: kb.companyId,
      kbId: input.kbId,
      kind: "source_ingest",
      title: input.title ?? `Ingest ${input.items.length} uploaded source${input.items.length === 1 ? "" : "s"}`,
      uploadBatchId: input.uploadBatchId,
      status: queueItems.length > 0 ? "queued" : "completed",
      progress: queueItems.length > 0 ? 0 : 100,
      stage: queueItems.length > 0 ? "Queued for source ingest" : "Upload accepted; no ingest required",
      sourceIds,
      jobIds: [],
      createdAt: now,
      updatedAt: now,
      completedAt: queueItems.length > 0 ? undefined : now,
      sourcePaths: [],
      jobs: [],
    }
    task = await this.repo.saveTask(task)

    const jobs: IngestJob[] = []
    for (const item of queueItems) {
      await this.repo.saveSource({ ...item.source, status: "queued", updatedAt: now, error: undefined })
      const job: IngestJob = {
        id: id("job"),
        companyId: kb.companyId,
        kbId: input.kbId,
        taskId: task.id,
        sourceId: item.source.id,
        status: "queued",
        progress: 0,
        stage: "Queued by upload task",
        attempts: 0,
        cached: false,
        createdAt: now,
        updatedAt: now,
        writtenPageIds: [],
      }
      jobs.push(await this.repo.saveJob(job))
    }

    task = {
      ...task,
      jobIds: jobs.map((job) => job.id),
      jobs,
      status: jobs.length > 0 ? "queued" : "completed",
      progress: jobs.length > 0 ? 0 : 100,
      stage: jobs.length > 0 ? "Queued for source ingest" : "Upload accepted; no ingest required",
      completedAt: jobs.length > 0 ? undefined : now,
      updatedAt: now,
    }
    return this.repo.saveTask(task)
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
      status: shouldQueue ? "uploaded" : "ingested",
      folderContext: folderContextFor(relativePath, { root: "raw" }),
      createdAt: now,
      updatedAt: now,
    }
    const savedSource = await this.repo.saveSource(source)
    if (!shouldQueue) return { accepted: true, source: savedSource, admission }
    const task = await this.createIngestTask({
      kbId: input.kbId,
      title: `Raw source ingest: ${relativePath}`,
      items: [{ accepted: true, source: savedSource, admission }],
    })
    const job = task.jobs[0]
    return { accepted: true, source: savedSource, job, admission }
  }

  async listSources(kbId: string): Promise<SourceDocument[]> {
    return this.repo.listSources(kbId)
  }
}
