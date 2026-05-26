import path from "node:path"
import cors from "@fastify/cors"
import multipart from "@fastify/multipart"
import Fastify from "fastify"
import type { FastifyInstance } from "fastify"
import { ChatService } from "./chat-service.js"
import { DocumentParser } from "./document-parser.js"
import { GraphService } from "./graph-service.js"
import { IngestService } from "./ingest-service.js"
import { JsonIndexRepository } from "./repository.js"
import { LintService } from "./lint-service.js"
import { LlmGateway } from "./llm-gateway.js"
import { ProjectService } from "./project-service.js"
import { ResearchService } from "./research-service.js"
import { SearchService } from "./search-service.js"
import { SourceWatchService } from "./source-watch-service.js"
import { SourceService } from "./source-service.js"
import { LocalStorageProvider } from "./storage.js"
import { normalizeStorageKey } from "./wiki-utils.js"

export interface AppServices {
  repo: JsonIndexRepository
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

export async function buildApp(dataDir = path.resolve(process.cwd(), ".kn-data")): Promise<{
  app: FastifyInstance
  services: AppServices
}> {
  const app = Fastify({ logger: true })
  await app.register(cors, { origin: true })
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 128 } })

  const repo = new JsonIndexRepository(dataDir)
  await repo.init()
  const storage = new LocalStorageProvider(path.join(dataDir, "objects"))
  const llm = new LlmGateway()
  const project = new ProjectService(repo, storage)
  const source = new SourceService(repo, storage)
  const ingest = new IngestService(repo, storage, new DocumentParser(), llm)
  const search = new SearchService(repo, llm, dataDir)
  const graph = new GraphService(repo)
  const chat = new ChatService(repo, search, graph, llm)
  const lint = new LintService(repo)
  const research = new ResearchService(repo, source, llm)
  const sourceWatch = new SourceWatchService(repo, storage, source, () => ingest.processQueue())
  sourceWatch.start()
  const services: AppServices = { repo, storage, project, source, ingest, search, graph, chat, lint, research, sourceWatch, llm }

  registerRoutes(app, services)
  setTimeout(() => void ingest.recoverAndStart(), 0)
  return { app, services }
}

function registerRoutes(app: FastifyInstance, services: AppServices): void {
  app.get("/api/health", async () => ({ ok: true, service: "kn-server" }))

  app.get("/api/capabilities", async () => ({
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
    providers: services.llm.capabilities(),
    searchProviders: {
      tavily: Boolean(process.env.TAVILY_API_KEY),
      searxng: Boolean(process.env.SEARXNG_URL),
      serpApi: Boolean(process.env.SERPAPI_API_KEY),
    },
  }))

  app.get("/api/kbs", async () => services.project.listKnowledgeBases())
  app.post<{ Body: { name?: string; description?: string } }>("/api/kbs", async (request, reply) => {
    const name = request.body?.name?.trim()
    if (!name) return reply.code(400).send({ error: "name is required" })
    return services.project.createKnowledgeBase({ name, description: request.body.description })
  })
  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId", async (request) => services.project.getKnowledgeBase(request.params.kbId))

  app.post<{ Params: { kbId: string } }>("/api/kbs/:kbId/sources", async (request, reply) => {
    const kb = await services.project.getKnowledgeBase(request.params.kbId)
    let relativePath = ""
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
      })
      created.push(saved)
      relativePath = ""
    }
    await services.ingest.processQueue()
    if (created.length === 0) return reply.code(400).send({ error: "No file uploaded" })
    return { created }
  })

  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/sources", async (request) => services.source.listSources(request.params.kbId))
  app.post<{ Params: { kbId: string } }>("/api/kbs/:kbId/sources/rescan", async () => {
    await services.sourceWatch.scanAll()
    return { ok: true }
  })
  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/jobs", async (request) => services.repo.listJobs(request.params.kbId))
  app.post<{ Params: { jobId: string } }>("/api/jobs/:jobId/cancel", async (request) => services.ingest.cancel(request.params.jobId))
  app.post<{ Params: { jobId: string } }>("/api/jobs/:jobId/retry", async (request, reply) => {
    const job = await services.repo.getJob(request.params.jobId)
    if (!job) return reply.code(404).send({ error: "Job not found" })
    await services.ingest.enqueueExisting(job)
    return services.repo.getJob(job.id)
  })

  app.get<{ Params: { kbId: string }; Querystring: { root?: string } }>("/api/kbs/:kbId/files", async (request) => {
    const root = request.query.root === "wiki" ? "wiki" : "raw"
    return services.storage.listTree(request.params.kbId, root)
  })

  app.get<{ Params: { kbId: string; key: string } }>("/api/kbs/:kbId/objects/:key", async (request, reply) => {
    const key = normalizeStorageKey(decodeURIComponent(request.params.key))
    const bytes = await services.storage.readObject(request.params.kbId, key)
    const lower = key.toLowerCase()
    if (lower.endsWith(".png")) reply.header("content-type", "image/png")
    else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) reply.header("content-type", "image/jpeg")
    else if (lower.endsWith(".webp")) reply.header("content-type", "image/webp")
    else reply.header("content-type", "application/octet-stream")
    return reply.send(bytes)
  })

  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/wiki/tree", async (request) => {
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
    const page = await services.repo.getPage(request.params.kbId, request.params.pageId)
    if (!page) return reply.code(404).send({ error: "Page not found" })
    return page
  })

  app.post<{ Params: { kbId: string }; Body: { query?: string; topK?: number } }>("/api/kbs/:kbId/search", async (request, reply) => {
    if (!request.body.query?.trim()) return reply.code(400).send({ error: "query is required" })
    return services.search.search(request.params.kbId, request.body.query, request.body.topK ?? 20)
  })

  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/graph", async (request) => services.graph.buildGraph(request.params.kbId))
  app.post<{ Params: { kbId: string } }>("/api/kbs/:kbId/graph/insights", async (request) => services.graph.insights(request.params.kbId))

  app.post<{ Params: { kbId: string }; Body: { question?: string; conversationId?: string } }>("/api/kbs/:kbId/chat", async (request, reply) => {
    if (!request.body.question?.trim()) return reply.code(400).send({ error: "question is required" })
    return services.chat.ask({
      kbId: request.params.kbId,
      conversationId: request.body.conversationId,
      question: request.body.question,
    })
  })

  app.post<{ Params: { kbId: string } }>("/api/kbs/:kbId/lint", async (request) => services.lint.run(request.params.kbId))
  app.get<{ Params: { kbId: string } }>("/api/kbs/:kbId/reviews", async (request) => services.repo.listReviews(request.params.kbId))
  app.patch<{ Params: { kbId: string; reviewId: string }; Body: { status?: "open" | "resolved" | "dismissed" } }>(
    "/api/kbs/:kbId/reviews/:reviewId",
    async (request, reply) => {
      if (!request.body.status) return reply.code(400).send({ error: "status is required" })
      const review = await services.repo.updateReviewStatus(request.params.kbId, request.params.reviewId, request.body.status)
      if (!review) return reply.code(404).send({ error: "Review not found" })
      return review
    },
  )

  app.post<{ Params: { kbId: string }; Body: { topic?: string } }>("/api/kbs/:kbId/research", async (request, reply) => {
    if (!request.body.topic?.trim()) return reply.code(400).send({ error: "topic is required" })
    const result = await services.research.run(request.params.kbId, request.body.topic)
    await services.ingest.processQueue()
    return result
  })
}
