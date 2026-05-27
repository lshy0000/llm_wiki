import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import cors from "@fastify/cors"
import pino from "pino"
import multipart from "@fastify/multipart"
import Fastify from "fastify"
import type { FastifyReply, FastifyRequest } from "fastify"
import { AgentService } from "./agent-service.js"
import { AuthService, extractBearerToken } from "./auth-service.js"
import { DocumentParser } from "./document-parser.js"
import { buildGraphIndexSnapshot, createGraphIndexFromEnv, syncAllGraphIndexes, syncGraphIndexForKnowledgeBase, type GraphIndex } from "./graph-index-service.js"
import { GraphService } from "./graph-service.js"
import { IngestService } from "./ingest-service.js"
import { PostgresRepository } from "./repository.js"
import type { KnowledgeRepository } from "./repository.js"
import { LintService } from "./lint-service.js"
import { LlmGateway } from "./llm-gateway.js"
import {
  modelProviderManifests,
  normalizeModelEndpoint,
  normalizeModelProtocol,
  normalizeProvider,
  testModelProvider,
  validateRuntimeModelCapabilities,
} from "./model-providers.js"
import { ProjectService } from "./project-service.js"
import { RetrievalService } from "./retrieval-service.js"
import { ResearchService } from "./research-service.js"
import { SearchService } from "./search-service.js"
import { SourceWatchService } from "./source-watch-service.js"
import { SourceService, type SourceSaveResult } from "./source-service.js"
import { LocalStorageProvider } from "./storage.js"
import { ToolConfigService, type CustomHttpToolConfig } from "./tool-config-service.js"
import { ToolError, ToolService } from "./tool-service.js"
import type { AuthContext, CompanyModel, KnowledgeBase, ReviewStatus } from "./types.js"
import { id, normalizeStorageKey, nowIso, objectContentTypeForFile } from "./wiki-utils.js"

export interface AppServices {
  repo: KnowledgeRepository
  auth: AuthService
  storage: LocalStorageProvider
  project: ProjectService
  source: SourceService
  ingest: IngestService
  search: SearchService
  graph: GraphService
  graphIndex: GraphIndex
  lint: LintService
  research: ResearchService
  sourceWatch: SourceWatchService
  llm: LlmGateway
  retrieval: RetrievalService
  tools: ToolService
  toolConfig: ToolConfigService
  agent: AgentService
}

function createLogger(): pino.Logger {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const logFile = process.env.KN_LOG_FILE?.trim() || path.join(backendRoot, "server.log")
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  return pino(
    { level: "info" },
    pino.multistream([
      { stream: process.stdout },
      { stream: pino.destination({ dest: logFile, append: true, mkdir: true }) },
    ]),
  )
}

function createAppInstance() {
  return Fastify({ loggerInstance: createLogger() })
}

function modelEndpointKey(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "").toLowerCase()
}

type AppInstance = ReturnType<typeof createAppInstance>

export async function buildApp(dataDir = path.resolve(process.cwd(), ".kn-data")): Promise<{
  app: AppInstance
  services: AppServices
}> {
  const app = createAppInstance()
  await app.register(cors, {
    origin: true,
    // 浏览器预检必须明确允许 DELETE/PATCH，否则模型删除、知识库删除和嵌入模型切换会被 CORS 挡在后端之前。
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type"],
  })
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 128 } })

  const databaseUrl = process.env.KN_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("KN_DATABASE_URL or DATABASE_URL is required. PostgreSQL with pgvector is the server storage backend.")
  }
  const repo = new PostgresRepository(databaseUrl)
  await repo.init()
  await repo.ensureDefaultCompany()
  const storage = new LocalStorageProvider(path.join(dataDir, "database"))
  const llm = new LlmGateway(repo)
  const graphIndex = createGraphIndexFromEnv(app.log)
  await graphIndex.ensureReady()
  const auth = new AuthService(repo)
  await auth.ensureBuiltInAccounts()
  const project = new ProjectService(repo, storage)
  const source = new SourceService(repo, storage)
  const ingest = new IngestService(repo, storage, new DocumentParser(), llm, graphIndex)
  const retrieval = new RetrievalService(repo, graphIndex)
  const search = new SearchService(retrieval)
  const graph = new GraphService(repo)
  const lint = new LintService(repo)
  const research = new ResearchService(repo, source, llm)
  const sourceWatch = new SourceWatchService(repo, storage, source, () => ingest.processQueue())
  sourceWatch.start()
  const toolConfig = new ToolConfigService(path.join(dataDir, "config", "tools.json"))
  const toolConfigState = await toolConfig.init()
  const tools = new ToolService({ project, retrieval, graph, storage }, toolConfigState)
  const agent = new AgentService(repo, llm, tools)
  const services: AppServices = { repo, auth, storage, project, source, ingest, search, graph, graphIndex, lint, research, sourceWatch, llm, retrieval, tools, toolConfig, agent }

  registerRoutes(app, services)
  setTimeout(() => void ingest.recoverAndStart(), 0)
  setTimeout(() => void syncAllGraphIndexes(repo, graphIndex, app.log), 0)
  return { app, services }
}

function registerRoutes(app: AppInstance, services: AppServices): void {
  app.get("/api/health", async () => ({ ok: true, service: "kn-backend" }))

  app.post<{ Body: { username?: string; password?: string } }>("/api/auth/ldap-login", async (request, reply) => {
    try {
      return await services.auth.loginWithLdap(request.body?.username ?? "", request.body?.password ?? "")
    } catch (err) {
      return reply.code(401).send({ error: err instanceof Error ? err.message : "LDAP login failed" })
    }
  })

  app.get("/api/auth/me", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    return services.auth.toPayload(auth)
  })

  app.post("/api/auth/logout", async (request) => {
    await services.auth.logout(tokenFromRequest(request))
    return { ok: true }
  })

  app.get("/api/auth/me/api-keys", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    return services.auth.listApiKeys(auth)
  })

  app.post<{ Body: { name?: string } }>("/api/auth/me/api-keys", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    try {
      return await services.auth.createApiKey(auth, request.body?.name)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.patch<{ Params: { keyId: string }; Body: { name?: string } }>("/api/auth/me/api-keys/:keyId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    try {
      const row = await services.auth.updateApiKey(auth, request.params.keyId, request.body?.name)
      if (!row) return reply.code(404).send({ error: "API key not found" })
      return row
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.delete<{ Params: { keyId: string } }>("/api/auth/me/api-keys/:keyId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    const deleted = await services.auth.deleteApiKey(auth, request.params.keyId)
    if (!deleted) return reply.code(404).send({ error: "API key not found" })
    return { ok: true }
  })

  app.get("/api/capabilities", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    return {
      llmWiki: {
        twoStepCotIngest: true,
        multimodalImageIngest: true,
        fourSignalGraph: true,
        louvainCommunityDetection: true,
        graphInsights: true,
        vectorSemanticSearch: true,
        persistentIngestQueue: true,
        folderImport: true,
        rawSourceWatch: true,
        deepResearch: true,
        asyncReview: true,
      },
      providers: await services.llm.capabilities(auth.company.id),
      searchProviders: {
        tavily: Boolean(process.env.TAVILY_API_KEY),
        searxng: Boolean(process.env.SEARXNG_URL),
        serpApi: Boolean(process.env.SERPAPI_API_KEY),
      },
    }
  })

  app.get("/api/tools", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    return services.tools.listDefinitions({ kbScoped: true })
  })

  app.get("/api/tools/config", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    return {
      customTools: services.toolConfig.snapshot().customTools,
      definitions: services.tools.listDefinitions({ kbScoped: true, includeDisabled: true }),
    }
  })

  app.post<{ Body: Partial<CustomHttpToolConfig> }>("/api/tools/custom", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    if (request.body?.name && services.tools.getDefinition(request.body.name)?.source === "builtin") {
      return reply.code(409).send({ error: "Cannot override a built-in tool" })
    }
    try {
      const tool = await services.toolConfig.saveCustomTool(request.body)
      services.tools.applyConfig(services.toolConfig.snapshot())
      return tool
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.delete<{ Params: { toolName: string } }>("/api/tools/custom/:toolName", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    const deleted = await services.toolConfig.deleteCustomTool(request.params.toolName)
    services.tools.applyConfig(services.toolConfig.snapshot())
    if (!deleted) return reply.code(404).send({ error: "Custom tool not found" })
    return { ok: true }
  })

  app.post<{ Params: { toolName: string }; Body: { arguments?: unknown } }>("/api/tools/:toolName/run", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    try {
      return await services.tools.run(request.params.toolName, { auth }, toolArgs(request.body))
    } catch (err) {
      return sendToolError(reply, err)
    }
  })

  app.get("/api/company/models", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    return (await services.repo.listCompanyModels(auth.company.id)).map(sanitizeCompanyModel)
  })

  app.get("/api/company/model-providers", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    return modelProviderManifests()
  })

  app.post<{
    Body: {
      provider?: CompanyModel["provider"]
      protocol?: CompanyModel["protocol"]
      model?: string
      endpoint?: string
      apiKey?: string
    }
  }>("/api/company/models/test", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    const body = request.body ?? {}
    const provider = normalizeProvider(body.provider)
    const protocol = normalizeModelProtocol(provider, body.protocol)
    const endpoint = normalizeModelEndpoint(provider, body.endpoint)
    if (provider === "custom" && !endpoint) return reply.code(400).send({ error: "custom model endpoint is required" })
    try {
      return await testModelProvider({
        provider,
        protocol,
        endpoint,
        apiKey: body.apiKey,
        model: body.model,
      })
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post<{
    Body: {
      id?: string
      name?: string
      provider?: CompanyModel["provider"]
      protocol?: CompanyModel["protocol"]
      model?: string
      endpoint?: string
      apiKey?: string
      capabilities?: CompanyModel["capabilities"]
      isDefaultLlm?: boolean
      isDefaultEmbedding?: boolean
      isDefaultVision?: boolean
    }
  }>("/api/company/models", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    const body = request.body ?? {}
    const name = body.name?.trim()
    const modelName = body.model?.trim()
    if (!name || !modelName) return reply.code(400).send({ error: "name and model are required" })
    const now = nowIso()
    const provider = normalizeProvider(body.provider)
    const protocol = normalizeModelProtocol(provider, body.protocol)
    const endpoint = normalizeModelEndpoint(provider, body.endpoint)
    if (provider === "custom" && !endpoint) return reply.code(400).send({ error: "custom model endpoint is required" })
    const capabilities = normalizeModelCapabilities(body.capabilities)
    if (capabilities.length < 1 || capabilities.length > 2) {
      return reply.code(400).send({ error: "模型能力必须选择 1 到 2 项" })
    }
    // 公司模型的业务唯一键是“最终 endpoint + 模型 ID”。名称只是面向用户展示的主名称，
    // 允许改名，但不能用不同名称重复保存同一个实际调用目标。
    const existingModels = await services.repo.listCompanyModels(auth.company.id)
    const duplicate = existingModels.find((item) =>
      item.id !== body.id &&
      item.model.trim() === modelName &&
      modelEndpointKey(item.endpoint) === modelEndpointKey(endpoint),
    )
    if (duplicate) {
      return reply.code(409).send({ error: `同一 Endpoint 和模型 ID 已存在：${duplicate.name}` })
    }
    const existingModel = body.id ? existingModels.find((item) => item.id === body.id) : undefined
    const apiKey = body.apiKey?.trim() || existingModel?.apiKey
    try {
      await validateRuntimeModelCapabilities(
        {
          provider,
          protocol,
          endpoint,
          apiKey,
          model: modelName,
        },
        capabilities,
      )
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
    const model: CompanyModel = {
      id: body.id || id("mdl"),
      companyId: auth.company.id,
      name,
      provider,
      protocol,
      model: modelName,
      endpoint,
      apiKey,
      capabilities,
      isDefaultLlm: Boolean(body.isDefaultLlm) && capabilities.includes("llm"),
      isDefaultEmbedding: Boolean(body.isDefaultEmbedding) && capabilities.includes("embedding"),
      isDefaultVision: Boolean(body.isDefaultVision) && capabilities.includes("vision"),
      createdAt: now,
      updatedAt: now,
    }
    return sanitizeCompanyModel(await services.repo.saveCompanyModel(model))
  })

  app.delete<{ Params: { modelId: string } }>("/api/company/models/:modelId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    const deleted = await services.repo.deleteCompanyModel(auth.company.id, request.params.modelId)
    if (!deleted) return reply.code(404).send({ error: "model not found" })
    return { ok: true }
  })

  app.get("/api/kbs", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    return services.project.listKnowledgeBases(isPlatformAdmin(auth) ? undefined : auth.company.id, isPlatformAdmin(auth) ? undefined : auth.identity.id)
  })
  app.post<{ Body: { name?: string; description?: string; visibility?: "company" | "creator_only"; embeddingModelId?: string } }>("/api/kbs", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    const name = request.body?.name?.trim()
    if (!name) return reply.code(400).send({ error: "name is required" })
    const visibility = request.body.visibility === "creator_only" ? "creator_only" : "company"
    try {
      const kb = await services.project.createKnowledgeBase({
        companyId: auth.company.id,
        createdBy: auth.identity.id,
        name,
        description: request.body.description,
        visibility,
        embeddingModelId: request.body.embeddingModelId?.trim() || undefined,
      })
      await syncGraphIndexForRoute(services, kb.id)
      return kb
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })
  app.patch<{ Params: { kbId: string }; Body: { embeddingModelId?: string | null } }>("/api/kbs/:kbId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    const kb = await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply)
    if (!kb) return
    const embeddingModelId = request.body?.embeddingModelId === null
      ? undefined
      : request.body?.embeddingModelId?.trim() || undefined
    try {
      return await services.project.updateKnowledgeBaseEmbeddingModel(kb.id, embeddingModelId)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })
  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    return getCompanyKnowledgeBase(services, auth, request.params.kbId, reply)
  })

  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/tools", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    return services.tools.listDefinitions({ kbScoped: true, dedicatedKb: true })
  })

  app.post<{ Params: { kbId: string; toolName: string }; Body: { arguments?: unknown } }>("/api/kbs/:kbId/tools/:toolName/run", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    const kb = auth ? await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply) : undefined
    if (!auth || !kb) return
    const definition = services.tools.getDefinition(request.params.toolName)
    if (!definition || definition.scope !== "knowledge_base") return reply.code(404).send({ error: "Tool not found" })
    try {
      return await services.tools.run(request.params.toolName, { auth, kb }, toolArgs(request.body))
    } catch (err) {
      return sendToolError(reply, err)
    }
  })

  app.delete<{ Params: { kbId: string } }>("/api/kbs/:kbId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    const kb = await services.project.getKnowledgeBase(request.params.kbId).catch(() => undefined)
    if (!kb || (!isPlatformAdmin(auth) && kb.companyId !== auth.company.id)) {
      return reply.code(404).send({ error: "Knowledge base not found" })
    }
    await services.project.deleteKnowledgeBase(kb.id)
    await services.graphIndex.deleteKnowledgeBase(kb.id)
    return { ok: true }
  })

  app.post<{ Params: { kbId: string } }>("/api/kbs/:kbId/sources", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    const kb = await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply)
    if (!kb) return
    let relativePath = ""
    const uploadBatchId = id("upl")
    const created: Array<Extract<SourceSaveResult, { accepted: true }>> = []
    const skipped: Array<Extract<SourceSaveResult, { accepted: false }>> = []
    for await (const part of request.parts()) {
      if (part.type === "field" && part.fieldname === "relativePath") {
        relativePath = String(part.value || "")
        continue
      }
      if (part.type !== "file") continue
      const chunks: Buffer[] = []
      for await (const chunk of part.file) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      const saved = await services.source.saveUpload({
        kbId: kb.id,
        fileName: part.filename,
        relativePath: relativePath || part.filename,
        contentType: part.mimetype,
        bytes,
        uploadBatchId,
      })
      if (saved.accepted) created.push(saved)
      else skipped.push(saved)
      relativePath = ""
    }
    if (created.length > 0 && shouldCreateUploadManifest(created, skipped)) {
      const manifest = buildUploadManifest(uploadBatchId, created, skipped)
      const savedManifest = await services.source.saveUpload({
        kbId: kb.id,
        fileName: "__folder_structure.md",
        relativePath: manifest.relativePath,
        contentType: "text/markdown",
        bytes: manifest.bytes,
        uploadBatchId,
      })
      if (savedManifest.accepted) created.push(savedManifest)
      else skipped.push(savedManifest)
    }
    if (created.length === 0) return reply.code(400).send({ error: "No supported file uploaded", skipped })
    const task = await services.source.createIngestTask({
      kbId: kb.id,
      uploadBatchId,
      title: uploadTaskTitle(created),
      items: created,
    })
    if (task.jobs.length > 0) await services.ingest.processQueue()
    return { created, skipped, task }
  })

  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/sources", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    return services.source.listSources(request.params.kbId)
  })
  app.post<{ Params: { kbId: string } }>("/api/kbs/:kbId/sources/rescan", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    await services.sourceWatch.scanKnowledgeBase(request.params.kbId)
    return { ok: true }
  })
  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/jobs", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    return services.repo.listJobs(request.params.kbId)
  })
  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/tasks", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    return services.repo.listTasks({ kbId: request.params.kbId })
  })
  app.get<{ Querystring: { kbId?: string } }>("/api/tasks", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    if (request.query.kbId) {
      if (!(await getCompanyKnowledgeBase(services, auth, request.query.kbId, reply))) return
      return services.repo.listTasks({ kbId: request.query.kbId })
    }
    return services.repo.listTasks(isPlatformAdmin(auth) ? {} : { companyId: auth.company.id })
  })
  app.post<{ Params: { jobId: string } }>("/api/jobs/:jobId/cancel", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await verifyJobCompany(services, auth, request.params.jobId, reply))) return
    return services.ingest.cancel(request.params.jobId)
  })
  app.post<{ Params: { jobId: string } }>("/api/jobs/:jobId/retry", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await verifyJobCompany(services, auth, request.params.jobId, reply))) return
    const job = await services.repo.getJob(request.params.jobId)
    if (!job) return reply.code(404).send({ error: "Job not found" })
    await services.ingest.enqueueExisting(job)
    return services.repo.getJob(job.id)
  })
  app.post<{ Params: { taskId: string } }>("/api/tasks/:taskId/cancel", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await verifyTaskCompany(services, auth, request.params.taskId, reply))) return
    return services.ingest.cancelTask(request.params.taskId)
  })
  app.post<{ Params: { taskId: string } }>("/api/tasks/:taskId/retry", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await verifyTaskCompany(services, auth, request.params.taskId, reply))) return
    return services.ingest.retryTask(request.params.taskId)
  })

  app.get<{ Params: { kbId: string }; Querystring: { root?: string } }>("/api/kbs/:kbId/files", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    const root = request.query.root === "wiki" ? "wiki" : "raw"
    return services.storage.listTree(request.params.kbId, root)
  })

  app.get<{ Params: { kbId: string; key: string }; Querystring: { access_token?: string } }>("/api/kbs/:kbId/objects/:key", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    const key = normalizeStorageKey(decodeURIComponent(request.params.key))
    const bytes = await services.storage.readObject(request.params.kbId, key)
    reply.header("content-type", objectContentTypeForFile(key))
    return reply.send(bytes)
  })

  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/wiki/tree", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    const pages = await services.repo.listPages(request.params.kbId)
    const groups = new Map<string, typeof pages>()
    for (const page of pages) groups.set(page.type, [...(groups.get(page.type) ?? []), page])
    return [...groups.entries()].map(([type, items]) => ({
      type,
      pages: items.sort((a, b) => a.title.localeCompare(b.title)).map((page) => ({
        id: page.id,
        title: page.title,
        path: page.path,
        sources: page.sources,
        images: page.images,
      })),
    }))
  })
  app.get<{ Params: { kbId: string; pageId: string } }>("/api/kbs/:kbId/wiki/pages/:pageId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    const page = await services.repo.getPage(request.params.kbId, request.params.pageId)
    if (!page) return reply.code(404).send({ error: "Page not found" })
    return page
  })

  app.post<{ Params: { kbId: string }; Body: { query?: string; topK?: number; queryEmbedding?: number[] } }>("/api/kbs/:kbId/search", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    if (!request.body.query?.trim()) return reply.code(400).send({ error: "query is required" })
    return services.search.search(request.params.kbId, request.body.query, request.body.topK ?? 20, {
      queryEmbedding: request.body.queryEmbedding,
    })
  })

  app.post<{ Params: { kbId: string } }>("/api/kbs/:kbId/retrieval/reindex", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    if (!isCompanyAdmin(auth)) return reply.code(403).send({ error: "Company admin is required" })
    if (!services.graphIndex.enabled) return reply.code(400).send({ error: "Neo4j graph index is not configured" })
    const synced = await services.graphIndex.syncKnowledgeBase(await buildGraphIndexSnapshot(services.repo, request.params.kbId))
    return { ok: synced }
  })

  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/graph", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    return services.graph.buildGraph(request.params.kbId)
  })
  app.post<{ Params: { kbId: string } }>("/api/kbs/:kbId/graph/insights", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    return services.graph.insights(request.params.kbId)
  })

  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/conversations", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    return services.repo.listAgentConversations(request.params.kbId)
  })

  app.get<{ Params: { kbId: string; conversationId: string } }>("/api/kbs/:kbId/conversations/:conversationId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    const conversation = await services.repo.getAgentConversation(request.params.kbId, request.params.conversationId)
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" })
    const [messages, runs] = await Promise.all([
      services.repo.listChatMessages(request.params.kbId, request.params.conversationId),
      services.repo.listAgentRunsByConversation(request.params.kbId, request.params.conversationId),
    ])
    const steps = await services.repo.listAgentRunStepsByRunIds(runs.map((run) => run.id))
    const stepsByAssistantMessage = new Map(
      runs
        .filter((run) => run.assistantMessageId)
        .map((run) => [
          run.assistantMessageId!,
          steps
            .filter((item) => item.runId === run.id)
            .map((item) => ({
              id: item.id,
              type: item.type,
              title: item.title,
              detail: item.detail,
              toolName: item.toolName,
              latencyMs: item.latencyMs,
              input: item.input,
              outputSummary: item.outputSummary,
            })),
        ]),
    )
    return {
      conversation,
      messages: messages.map((message) => ({
        ...message,
        trace: message.role === "assistant" ? stepsByAssistantMessage.get(message.id) ?? [] : undefined,
      })),
      runs,
    }
  })

  app.post<{ Params: { kbId: string }; Body: { question?: string; conversationId?: string } }>("/api/kbs/:kbId/chat", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    const kb = auth ? await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply) : undefined
    if (!auth || !kb) return
    if (!request.body.question?.trim()) return reply.code(400).send({ error: "question is required" })
    try {
      return await services.agent.ask({
        auth,
        kb,
        question: request.body.question,
        conversationId: request.body.conversationId,
      })
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post<{ Params: { kbId: string } }>("/api/kbs/:kbId/lint", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    return services.lint.run(request.params.kbId)
  })
  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/reviews", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    return services.repo.listReviews(request.params.kbId)
  })
  app.patch<{ Params: { kbId: string; reviewId: string }; Body: { status?: "open" | "resolved" | "dismissed" } }>(
    "/api/kbs/:kbId/reviews/:reviewId",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, services)
      if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
      if (!isReviewStatus(request.body.status)) return reply.code(400).send({ error: "status must be open, resolved, or dismissed" })
      const review = await services.repo.updateReviewStatus(request.params.kbId, request.params.reviewId, request.body.status)
      if (!review) return reply.code(404).send({ error: "Review not found" })
      return review
    },
  )

  app.post<{ Params: { kbId: string }; Body: { topic?: string } }>("/api/kbs/:kbId/research", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    if (!request.body.topic?.trim()) return reply.code(400).send({ error: "topic is required" })
    const result = await services.research.run(request.params.kbId, request.body.topic)
    await services.ingest.processQueue()
    return result
  })
}

function shouldCreateUploadManifest(
  created: Array<Extract<SourceSaveResult, { accepted: true }>>,
  skipped: Array<Extract<SourceSaveResult, { accepted: false }>>,
): boolean {
  const paths = [
    ...created.map((item) => item.source.relativePath),
    ...skipped.map((item) => item.relativePath),
  ]
  return skipped.length > 0 || paths.length > 1 || paths.some((item) => item.includes("/"))
}

function uploadTaskTitle(created: Array<Extract<SourceSaveResult, { accepted: true }>>): string {
  if (created.length === 1) return `Upload and ingest: ${created[0].source.relativePath}`
  const paths = created.map((item) => item.source.relativePath)
  const root = commonFolderPrefix(paths)
  return root
    ? `Upload and ingest: ${root} (${created.length} files)`
    : `Upload and ingest ${created.length} files`
}

function buildUploadManifest(
  uploadBatchId: string,
  created: Array<Extract<SourceSaveResult, { accepted: true }>>,
  skipped: Array<Extract<SourceSaveResult, { accepted: false }>>,
): { relativePath: string; bytes: Buffer } {
  const paths = [
    ...created.map((item) => item.source.relativePath),
    ...skipped.map((item) => item.relativePath),
  ]
  const rootPath = commonFolderPrefix(paths)
  const manifestPath = normalizeStorageKey(path.posix.join(rootPath, "__folder_structure.md"))
  const acceptedLines = created
    .map((item) => `- ${item.source.relativePath} (${item.admission.kind}, ${item.admission.mode}, ${item.source.size} bytes)`)
    .join("\n") || "- None"
  const skippedLines = skipped
    .map((item) => `- ${item.relativePath}: ${item.reason}`)
    .join("\n") || "- None"
  const content = [
    "# Folder Import Manifest",
    "",
    `Upload batch: ${uploadBatchId}`,
    `Root: ${rootPath || "/"}`,
    "",
    "## Accepted Files",
    "",
    acceptedLines,
    "",
    "## Skipped Files",
    "",
    skippedLines,
    "",
    "## Directory Tree",
    "",
    renderDirectoryTree(paths),
    "",
  ].join("\n")
  return { relativePath: manifestPath, bytes: Buffer.from(content, "utf-8") }
}

function commonFolderPrefix(paths: string[]): string {
  const folders = paths
    .map((item) => normalizeStorageKey(item).split("/").slice(0, -1))
    .filter((parts) => parts.length > 0)
  if (folders.length === 0) return ""
  const prefix: string[] = []
  for (let index = 0; index < folders[0].length; index += 1) {
    const part = folders[0][index]
    if (folders.every((folder) => folder[index] === part)) prefix.push(part)
    else break
  }
  return prefix.join("/")
}

function renderDirectoryTree(paths: string[]): string {
  if (paths.length === 0) return "- /"
  const sorted = [...new Set(paths.map(normalizeStorageKey))].sort((a, b) => a.localeCompare(b))
  return sorted.map((item) => `- ${item}`).join("\n")
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === "open" || value === "resolved" || value === "dismissed"
}

function tokenFromRequest(request: FastifyRequest): string | undefined {
  const query = request.query as { access_token?: string } | undefined
  return extractBearerToken(request.headers.authorization) ?? query?.access_token
}

function toolArgs(body: { arguments?: unknown } | undefined): unknown {
  return body?.arguments ?? {}
}

function sendToolError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ToolError) return reply.code(err.statusCode).send({ error: err.message })
  return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
}

function isCompanyAdmin(auth: AuthContext): boolean {
  return isPlatformAdmin(auth) || auth.member.role === "org_admin"
}

function isPlatformAdmin(auth: AuthContext): boolean {
  return auth.identity.isPlatformAdmin || auth.member.role === "platform_admin"
}

function sanitizeCompanyModel(model: CompanyModel): Omit<CompanyModel, "apiKey"> & { apiKeySet: boolean } {
  const { apiKey, ...rest } = model
  return { ...rest, apiKeySet: Boolean(apiKey) }
}

async function syncGraphIndexForRoute(services: AppServices, kbId: string): Promise<void> {
  await syncGraphIndexForKnowledgeBase(services.repo, services.graphIndex, kbId)
}

function normalizeModelCapabilities(capabilities?: string[]): CompanyModel["capabilities"] {
  const values = new Set<CompanyModel["capabilities"][number]>()
  for (const capability of capabilities ?? []) {
    if (capability === "llm" || capability === "embedding" || capability === "vision") values.add(capability)
  }
  return [...values]
}

async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AppServices,
): Promise<AuthContext | undefined> {
  const auth = await services.auth.authenticate(tokenFromRequest(request))
  if (!auth) {
    reply.code(401).send({ error: "Unauthorized" })
    return undefined
  }
  return auth
}

async function getCompanyKnowledgeBase(
  services: AppServices,
  auth: AuthContext,
  kbId: string,
  reply: FastifyReply,
): Promise<KnowledgeBase | undefined> {
  const kb = await services.project.getKnowledgeBase(kbId).catch(() => undefined)
  if (!kb || (!isPlatformAdmin(auth) && (kb.companyId !== auth.company.id || (kb.visibility === "creator_only" && kb.createdBy !== auth.identity.id)))) {
    reply.code(404).send({ error: "Knowledge base not found" })
    return undefined
  }
  return kb
}

async function verifyJobCompany(
  services: AppServices,
  auth: AuthContext,
  jobId: string,
  reply: FastifyReply,
): Promise<boolean> {
  const job = await services.repo.getJob(jobId)
  if (!job) {
    reply.code(404).send({ error: "Job not found" })
    return false
  }
  const kb = await services.repo.getKnowledgeBase(job.kbId)
  if (!kb || (!isPlatformAdmin(auth) && (kb.companyId !== auth.company.id || (kb.visibility === "creator_only" && kb.createdBy !== auth.identity.id)))) {
    reply.code(404).send({ error: "Job not found" })
    return false
  }
  return true
}

async function verifyTaskCompany(
  services: AppServices,
  auth: AuthContext,
  taskId: string,
  reply: FastifyReply,
): Promise<boolean> {
  const task = await services.repo.getTask(taskId)
  if (!task) {
    reply.code(404).send({ error: "Task not found" })
    return false
  }
  const kb = await services.repo.getKnowledgeBase(task.kbId)
  if (!kb || (!isPlatformAdmin(auth) && (kb.companyId !== auth.company.id || (kb.visibility === "creator_only" && kb.createdBy !== auth.identity.id)))) {
    reply.code(404).send({ error: "Task not found" })
    return false
  }
  return true
}
