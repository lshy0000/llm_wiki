import neo4j, { type Driver } from "neo4j-driver"
import type { KnowledgeRepository } from "./repository.js"
import type { KnowledgeBase, PageChunk, PageSource, SourceDocument, WikiLink, WikiPage } from "./types.js"
import { isStructuralWikiPage, WikiLinkResolver, wikiLinksForPage } from "./wiki-link-resolver.js"

export interface GraphPath {
  nodes: Array<{ id: string; kind: string; label: string }>
  rels: Array<{ type: string; weight?: number }>
}

export interface GraphRecallSeed {
  pageId: string
  score: number
}

export interface GraphRecallHit {
  pageId: string
  score: number
  reason: string
  graphPath?: GraphPath
}

export interface GraphIndexSnapshot {
  kb: KnowledgeBase
  pages: WikiPage[]
  sources: SourceDocument[]
  pageSources: PageSource[]
  chunks: PageChunk[]
  links: WikiLink[]
}

export interface GraphIndex {
  readonly enabled: boolean
  ensureReady(): Promise<boolean>
  syncKnowledgeBase(snapshot: GraphIndexSnapshot): Promise<boolean>
  deleteKnowledgeBase(kbId: string): Promise<boolean>
  recallPageNeighborhood(kbId: string, seeds: GraphRecallSeed[], limit: number): Promise<GraphRecallHit[]>
  close(): Promise<void>
}

type Logger = {
  info(input: unknown, message?: string): void
  warn(input: unknown, message?: string): void
  error(input: unknown, message?: string): void
}

export class NoopGraphIndex implements GraphIndex {
  readonly enabled = false

  async ensureReady(): Promise<boolean> {
    return false
  }

  async syncKnowledgeBase(): Promise<boolean> {
    return false
  }

  async deleteKnowledgeBase(): Promise<boolean> {
    return false
  }

  async recallPageNeighborhood(): Promise<GraphRecallHit[]> {
    return []
  }

  async close(): Promise<void> {}
}

interface Neo4jConfig {
  uri: string
  username: string
  password: string
  database?: string
}

export function createGraphIndexFromEnv(logger: Logger): GraphIndex {
  const uri = process.env.KN_NEO4J_URI?.trim()
  if (!uri) return new NoopGraphIndex()
  return new Neo4jGraphIndex(
    {
      uri,
      username: process.env.KN_NEO4J_USERNAME?.trim() || "neo4j",
      password: process.env.KN_NEO4J_PASSWORD ?? "",
      database: process.env.KN_NEO4J_DATABASE?.trim() || undefined,
    },
    logger,
  )
}

export async function buildGraphIndexSnapshot(repo: KnowledgeRepository, kbId: string): Promise<GraphIndexSnapshot> {
  const kb = await repo.getKnowledgeBase(kbId)
  if (!kb) throw new Error("Knowledge base not found")
  const [pages, sources, pageSources, chunks] = await Promise.all([
    repo.listPages(kbId),
    repo.listSources(kbId),
    repo.listPageSources(kbId),
    repo.listChunks(kbId),
  ])
  const linkPages = pages.filter((page) => page.type !== "query" && !isStructuralWikiPage(page))
  const resolver = new WikiLinkResolver(linkPages)
  const links = linkPages.flatMap((page) => wikiLinksForPage(page, resolver))
  return { kb, pages, sources, pageSources, chunks, links }
}

export async function syncGraphIndexForKnowledgeBase(repo: KnowledgeRepository, graphIndex: GraphIndex, kbId: string): Promise<boolean> {
  if (!graphIndex.enabled) return false
  return graphIndex.syncKnowledgeBase(await buildGraphIndexSnapshot(repo, kbId))
}

export async function syncAllGraphIndexes(repo: KnowledgeRepository, graphIndex: GraphIndex, logger: Logger): Promise<void> {
  if (!graphIndex.enabled) return
  const kbs = await repo.listKnowledgeBases()
  for (const kb of kbs) {
    const synced = await syncGraphIndexForKnowledgeBase(repo, graphIndex, kb.id)
    if (synced) logger.info({ kbId: kb.id }, "Neo4j graph index synced")
  }
}

class Neo4jGraphIndex implements GraphIndex {
  readonly enabled = true
  private readonly driver: Driver
  private ready = false
  private lastFailureAt = 0

  constructor(
    private readonly config: Neo4jConfig,
    private readonly logger: Logger,
  ) {
    this.driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password))
  }

  async ensureReady(): Promise<boolean> {
    if (this.ready) return true
    if (Date.now() - this.lastFailureAt < 10_000) return false
    try {
      await this.driver.verifyConnectivity()
      const session = this.session()
      try {
        for (const statement of NEO4J_INDEX_STATEMENTS) {
          await session.run(statement)
        }
      } finally {
        await session.close()
      }
      this.ready = true
      this.logger.info({ uri: this.config.uri, database: this.config.database }, "Neo4j graph index ready")
      return true
    } catch (err) {
      this.lastFailureAt = Date.now()
      this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Neo4j graph index unavailable")
      return false
    }
  }

  async syncKnowledgeBase(snapshot: GraphIndexSnapshot): Promise<boolean> {
    if (!(await this.ensureReady())) return false
    const session = this.session()
    try {
      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          MATCH (n)
          WHERE n.kbId = $kbId
          DETACH DELETE n
          `,
          { kbId: snapshot.kb.id },
        )
        await tx.run("MATCH (kb:KnowledgeBase {id: $kbId}) DETACH DELETE kb", { kbId: snapshot.kb.id })
        await tx.run(
          `
          MERGE (kb:KnowledgeBase {id: $kbId})
          SET kb.companyId = $companyId,
              kb.name = $name,
              kb.visibility = $visibility,
              kb.updatedAt = $updatedAt
          `,
          {
            kbId: snapshot.kb.id,
            companyId: snapshot.kb.companyId,
            name: snapshot.kb.name,
            visibility: snapshot.kb.visibility,
            updatedAt: snapshot.kb.updatedAt,
          },
        )
        await tx.run(
          `
          UNWIND $sources AS source
          MATCH (kb:KnowledgeBase {id: $kbId})
          MERGE (s:Source {kbId: $kbId, id: source.id})
          SET s.companyId = source.companyId,
              s.fileName = source.fileName,
              s.relativePath = source.relativePath,
              s.parentPath = source.parentPath,
              s.folderContext = source.folderContext,
              s.status = source.status,
              s.updatedAt = source.updatedAt
          MERGE (kb)-[:HAS_SOURCE]->(s)
          `,
          {
            kbId: snapshot.kb.id,
            sources: snapshot.sources.map((source) => ({
              id: source.id,
              companyId: source.companyId,
              fileName: source.fileName,
              relativePath: source.relativePath,
              parentPath: source.parentPath,
              folderContext: source.folderContext,
              status: source.status,
              updatedAt: source.updatedAt,
            })),
          },
        )
        await tx.run(
          `
          UNWIND $pages AS page
          MATCH (kb:KnowledgeBase {id: $kbId})
          MERGE (p:Page {kbId: $kbId, id: page.id})
          SET p.companyId = page.companyId,
              p.title = page.title,
              p.path = page.path,
              p.type = page.type,
              p.sha256 = page.sha256,
              p.sourceIds = page.sources,
              p.updatedAt = page.updatedAt
          MERGE (kb)-[:HAS_PAGE]->(p)
          `,
          {
            kbId: snapshot.kb.id,
            pages: snapshot.pages.map((page) => ({
              id: page.id,
              companyId: page.companyId,
              title: page.title,
              path: page.path,
              type: page.type,
              sha256: page.sha256,
              sources: page.sources,
              updatedAt: page.updatedAt,
            })),
          },
        )
        await tx.run(
          `
          UNWIND $pageSources AS item
          MATCH (p:Page {kbId: $kbId, id: item.pageId})
          MATCH (s:Source {kbId: $kbId, id: item.sourceId})
          MERGE (p)-[r:DERIVED_FROM]->(s)
          SET r.weight = 12.0
          `,
          {
            kbId: snapshot.kb.id,
            pageSources: snapshot.pageSources.map((item) => ({ pageId: item.pageId, sourceId: item.sourceId })),
          },
        )
        await tx.run(
          `
          UNWIND $links AS link
          MATCH (source:Page {kbId: $kbId, id: link.sourcePageId})
          MATCH (target:Page {kbId: $kbId, id: link.targetPageId})
          MERGE (source)-[r:LINKS_TO]->(target)
          SET r.raw = link.targetRaw,
              r.weight = 34.0
          `,
          {
            kbId: snapshot.kb.id,
            links: snapshot.links.map((link) => ({
              sourcePageId: link.sourcePageId,
              targetPageId: link.targetPageId,
              targetRaw: link.targetRaw,
            })),
          },
        )
        await tx.run(
          `
          UNWIND $chunks AS chunk
          MATCH (p:Page {kbId: $kbId, id: chunk.pageId})
          MERGE (c:Chunk {kbId: $kbId, id: chunk.id})
          SET c.companyId = chunk.companyId,
              c.pageId = chunk.pageId,
              c.ordinal = chunk.ordinal,
              c.textPreview = chunk.textPreview,
              c.tokenCount = chunk.tokenCount
          MERGE (p)-[r:CONTAINS]->(c)
          SET r.weight = 4.0
          `,
          {
            kbId: snapshot.kb.id,
            chunks: snapshot.chunks.map((chunk) => ({
              id: chunk.id,
              companyId: chunk.companyId,
              pageId: chunk.pageId,
              ordinal: chunk.ordinal,
              textPreview: chunk.text.slice(0, 2000),
              tokenCount: chunk.tokens.length,
            })),
          },
        )
      })
      return true
    } catch (err) {
      this.logger.warn({ err: err instanceof Error ? err.message : String(err), kbId: snapshot.kb.id }, "Neo4j graph index sync failed")
      return false
    } finally {
      await session.close()
    }
  }

  async deleteKnowledgeBase(kbId: string): Promise<boolean> {
    if (!(await this.ensureReady())) return false
    const session = this.session()
    try {
      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          MATCH (n)
          WHERE n.kbId = $kbId
          DETACH DELETE n
          `,
          { kbId },
        )
        await tx.run("MATCH (kb:KnowledgeBase {id: $kbId}) DETACH DELETE kb", { kbId })
      })
      return true
    } catch (err) {
      this.logger.warn({ err: err instanceof Error ? err.message : String(err), kbId }, "Neo4j graph index delete failed")
      return false
    } finally {
      await session.close()
    }
  }

  async recallPageNeighborhood(kbId: string, seeds: GraphRecallSeed[], limit: number): Promise<GraphRecallHit[]> {
    if (seeds.length === 0 || !(await this.ensureReady())) return []
    const session = this.session()
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          UNWIND $seeds AS seedInput
          MATCH (seed:Page {kbId: $kbId, id: seedInput.pageId})
          MATCH path = (seed)-[rels:LINKS_TO|DERIVED_FROM|CONTAINS*1..2]-(page:Page {kbId: $kbId})
          WHERE page.id <> seed.id
          WITH seedInput, page, path, rels,
               reduce(relScore = 0.0, rel IN rels |
                 relScore + CASE type(rel)
                   WHEN 'LINKS_TO' THEN 34.0
                   WHEN 'DERIVED_FROM' THEN 12.0
                   WHEN 'CONTAINS' THEN 4.0
                   ELSE 6.0
                 END
               ) AS relScore
          WITH page,
               (relScore / size(rels)) + (toFloat(seedInput.score) * 0.12) AS score,
               path
          ORDER BY score DESC
          WITH page, collect({score: score, path: path}) AS paths
          WITH page, paths[0] AS best
          ORDER BY best.score DESC
          LIMIT $limit
          RETURN page.id AS pageId,
                 best.score AS score,
                 [node IN nodes(best.path) | {
                   id: node.id,
                   kind: toLower(labels(node)[0]),
                   label: coalesce(node.title, node.fileName, node.relativePath, node.id)
                 }] AS nodes,
                 [rel IN relationships(best.path) | {
                   type: type(rel),
                   weight: CASE type(rel)
                     WHEN 'LINKS_TO' THEN 34.0
                     WHEN 'DERIVED_FROM' THEN 12.0
                     WHEN 'CONTAINS' THEN 4.0
                     ELSE 6.0
                   END
                 }] AS rels
          `,
          { kbId, seeds, limit: neo4j.int(Math.max(1, limit)) },
        ),
      )
      return result.records.map((record) => ({
        pageId: String(record.get("pageId")),
        score: asNumber(record.get("score")),
        reason: "neo4j graph neighborhood",
        graphPath: {
          nodes: parseGraphNodes(record.get("nodes")),
          rels: parseGraphRels(record.get("rels")),
        },
      }))
    } catch (err) {
      this.logger.warn({ err: err instanceof Error ? err.message : String(err), kbId }, "Neo4j graph recall failed")
      return []
    } finally {
      await session.close()
    }
  }

  async close(): Promise<void> {
    await this.driver.close()
  }

  private session() {
    return this.driver.session({ database: this.config.database })
  }
}

const NEO4J_INDEX_STATEMENTS = [
  "CREATE INDEX kn_page_lookup IF NOT EXISTS FOR (n:Page) ON (n.kbId, n.id)",
  "CREATE INDEX kn_source_lookup IF NOT EXISTS FOR (n:Source) ON (n.kbId, n.id)",
  "CREATE INDEX kn_chunk_lookup IF NOT EXISTS FOR (n:Chunk) ON (n.kbId, n.id)",
  "CREATE INDEX kn_page_title IF NOT EXISTS FOR (n:Page) ON (n.kbId, n.title)",
]

function asNumber(value: unknown): number {
  if (neo4j.isInt(value)) return value.toNumber()
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function parseGraphNodes(value: unknown): GraphPath["nodes"] {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    id: String(item?.id ?? ""),
    kind: String(item?.kind ?? ""),
    label: String(item?.label ?? item?.id ?? ""),
  }))
}

function parseGraphRels(value: unknown): GraphPath["rels"] {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    type: String(item?.type ?? ""),
    weight: item?.weight === undefined ? undefined : asNumber(item.weight),
  }))
}
