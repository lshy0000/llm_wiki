import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import cors from "@fastify/cors"
import pino from "pino"
import multipart from "@fastify/multipart"
import Fastify from "fastify"
import type { FastifyReply, FastifyRequest } from "fastify"
import { AuthService, extractBearerToken } from "./auth-service.js"
import { ChatService } from "./chat-service.js"
import { DocumentParser } from "./document-parser.js"
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
} from "./model-providers.js"
import { ProjectService } from "./project-service.js"
import { ResearchService } from "./research-service.js"
import { SearchService } from "./search-service.js"
import { SourceWatchService } from "./source-watch-service.js"
import { SourceService } from "./source-service.js"
import { LocalStorageProvider } from "./storage.js"
import type { AuthContext, CompanyModel, KnowledgeBase } from "./types.js"
import { id, normalizeStorageKey, nowIso } from "./wiki-utils.js"

export interface AppServices {
  repo: KnowledgeRepository
  auth: AuthService
  storage: LocalStorageProvider
  project: ProjectService
  source: SourceService
  ingest: IngestService
  search: SearchService
  graph: GraphService
  chat: ChatService
  lint: LintService
  research: ResearchService
  sourceWatch: SourceWatchService
  llm: LlmGateway
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

type AppInstance = ReturnType<typeof createAppInstance>

export async function buildApp(dataDir = path.resolve(process.cwd(), ".kn-data")): Promise<{
  app: AppInstance
  services: AppServices
}> {
  const app = createAppInstance()
  await app.register(cors, { origin: true })
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 128 } })

  const databaseUrl = process.env.KN_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("KN_DATABASE_URL or DATABASE_URL is required. PostgreSQL with pgvector is the server storage backend.")
  }
  const repo = new PostgresRepository(databaseUrl)
  await repo.init()
  const defaultCompany = await repo.ensureDefaultCompany()
  await repo.ensureEnvironmentModels(defaultCompany.id)
  const storage = new LocalStorageProvider(path.join(dataDir, "database"))
  const llm = new LlmGateway(repo)
  const auth = new AuthService(repo)
  await auth.ensureBuiltInAccounts()
  const project = new ProjectService(repo, storage)
  const source = new SourceService(repo, storage)
  const ingest = new IngestService(repo, storage, new DocumentParser(), llm)
  const search = new SearchService(repo, llm)
  const graph = new GraphService(repo)
  const chat = new ChatService(repo, search, graph, llm)
  const lint = new LintService(repo)
  const research = new ResearchService(repo, source, llm)
  const sourceWatch = new SourceWatchService(repo, storage, source, () => ingest.processQueue())
  sourceWatch.start()
  const services: AppServices = { repo, auth, storage, project, source, ingest, search, graph, chat, lint, research, sourceWatch, llm }

  registerRoutes(app, services)
  setTimeout(() => void ingest.recoverAndStart(), 0)
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
    const model: CompanyModel = {
      id: body.id || id("mdl"),
      companyId: auth.company.id,
      name,
      provider,
      protocol,
      model: modelName,
      endpoint,
      apiKey: body.apiKey?.trim() || undefined,
      capabilities,
      isDefaultLlm: Boolean(body.isDefaultLlm) && capabilities.includes("llm"),
      isDefaultEmbedding: Boolean(body.isDefaultEmbedding) && capabilities.includes("embedding"),
      isDefaultVision: Boolean(body.isDefaultVision) && capabilities.includes("vision"),
      createdAt: now,
      updatedAt: now,
    }
    return sanitizeCompanyModel(await services.repo.saveCompanyModel(model))
  })

  app.get("/api/kbs", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    return services.project.listKnowledgeBases(isPlatformAdmin(auth) ? undefined : auth.company.id, isPlatformAdmin(auth) ? undefined : auth.identity.id)
  })
  app.post<{ Body: { name?: string; description?: string; visibility?: "company" | "creator_only" } }>("/api/kbs", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    const name = request.body?.name?.trim()
    if (!name) return reply.code(400).send({ error: "name is required" })
    const visibility = request.body.visibility === "creator_only" ? "creator_only" : "company"
    return services.project.createKnowledgeBase({
      companyId: auth.company.id,
      createdBy: auth.identity.id,
      name,
      description: request.body.description,
      visibility,
    })
  })
  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    return getCompanyKnowledgeBase(services, auth, request.params.kbId, reply)
  })

  app.post<{ Params: { kbId: string } }>("/api/kbs/:kbId/sources", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth) return
    const kb = await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply)
    if (!kb) return
    let relativePath = ""
    const uploadBatchId = id("upl")
    const created = []
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
      created.push(saved)
      relativePath = ""
    }
    await services.ingest.processQueue()
    if (created.length === 0) return reply.code(400).send({ error: "No file uploaded" })
    return { created }
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
    const lower = key.toLowerCase()
    if (lower.endsWith(".png")) reply.header("content-type", "image/png")
    else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) reply.header("content-type", "image/jpeg")
    else if (lower.endsWith(".webp")) reply.header("content-type", "image/webp")
    else reply.header("content-type", "application/octet-stream")
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

  app.post<{ Params: { kbId: string }; Body: { query?: string; topK?: number } }>("/api/kbs/:kbId/search", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    if (!request.body.query?.trim()) return reply.code(400).send({ error: "query is required" })
    return services.search.search(request.params.kbId, request.body.query, request.body.topK ?? 20)
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

  app.post<{ Params: { kbId: string }; Body: { question?: string; conversationId?: string } }>("/api/kbs/:kbId/chat", async (request, reply) => {
    const auth = await requireAuth(request, reply, services)
    if (!auth || !(await getCompanyKnowledgeBase(services, auth, request.params.kbId, reply))) return
    if (!request.body.question?.trim()) return reply.code(400).send({ error: "question is required" })
    return services.chat.ask({
      kbId: request.params.kbId,
      conversationId: request.body.conversationId,
      question: request.body.question,
    })
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
      if (!request.body.status) return reply.code(400).send({ error: "status is required" })
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

function tokenFromRequest(request: FastifyRequest): string | undefined {
  const query = request.query as { access_token?: string } | undefined
  return extractBearerToken(request.headers.authorization) ?? query?.access_token
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

function normalizeModelCapabilities(capabilities?: string[]): CompanyModel["capabilities"] {
  const values = new Set<CompanyModel["capabilities"][number]>()
  for (const capability of capabilities ?? []) {
    if (capability === "llm" || capability === "embedding" || capability === "vision") values.add(capability)
  }
  return values.size > 0 ? [...values] : ["llm"]
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
