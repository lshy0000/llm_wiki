import fs from "node:fs/promises"
import { fileURLToPath } from "node:url"
import pg from "pg"
import type { Pool as PgPool, PoolClient } from "pg"
import type {
  AuthContext,
  AuthSession,
  ChatMessage,
  Company,
  CompanyMember,
  CompanyMemberRole,
  Identity,
  ImageAsset,
  IngestJob,
  KnowledgeBase,
  PageChunk,
  PageSource,
  ReviewItem,
  SourceDocument,
  WikiLink,
  WikiPage,
} from "./types.js"
import { id, nowIso } from "./wiki-utils.js"

const { Pool } = pg

export interface KnowledgeRepository {
  init(): Promise<void>
  close(): Promise<void>
  ensureDefaultCompany(): Promise<Company>
  upsertIdentity(input: {
    provider: "ldap"
    providerSubject: string
    username: string
    displayName: string
    email?: string
  }): Promise<Identity>
  countCompanyMembers(companyId: string): Promise<number>
  ensureCompanyMember(companyId: string, identityId: string, role: CompanyMemberRole): Promise<CompanyMember>
  createSession(input: {
    tokenHash: string
    identityId: string
    companyId: string
    memberId: string
    expiresAt: string
  }): Promise<AuthSession>
  getSessionByTokenHash(tokenHash: string): Promise<AuthContext | undefined>
  deleteSession(tokenHash: string): Promise<void>
  listKnowledgeBases(companyId?: string): Promise<KnowledgeBase[]>
  getKnowledgeBase(kbId: string): Promise<KnowledgeBase | undefined>
  saveKnowledgeBase(kb: KnowledgeBase): Promise<KnowledgeBase>
  bumpDataVersion(kbId: string): Promise<void>
  saveSource(source: SourceDocument): Promise<SourceDocument>
  listSources(kbId: string): Promise<SourceDocument[]>
  getSource(sourceId: string): Promise<SourceDocument | undefined>
  saveJob(job: IngestJob): Promise<IngestJob>
  listJobs(kbId?: string): Promise<IngestJob[]>
  getJob(jobId: string): Promise<IngestJob | undefined>
  listQueuedJobs(): Promise<IngestJob[]>
  upsertPage(page: WikiPage): Promise<WikiPage>
  listPages(kbId: string): Promise<WikiPage[]>
  getPage(kbId: string, pageId: string): Promise<WikiPage | undefined>
  replacePageLinks(kbId: string, pageId: string, links: WikiLink[]): Promise<void>
  listLinks(kbId: string): Promise<WikiLink[]>
  replacePageSources(kbId: string, pageId: string, pageSources: PageSource[]): Promise<void>
  listPageSources(kbId: string): Promise<PageSource[]>
  replaceChunks(kbId: string, pageId: string, chunks: PageChunk[]): Promise<void>
  listChunks(kbId: string): Promise<PageChunk[]>
  searchPagesByVector(kbId: string, embedding: number[], limit: number): Promise<Array<{ pageId: string; score: number }>>
  saveImage(image: ImageAsset): Promise<ImageAsset>
  listImages(kbId: string): Promise<ImageAsset[]>
  addReview(review: ReviewItem): Promise<ReviewItem>
  listReviews(kbId: string): Promise<ReviewItem[]>
  updateReviewStatus(kbId: string, reviewId: string, status: ReviewItem["status"]): Promise<ReviewItem | undefined>
  addChatMessage(message: ChatMessage): Promise<ChatMessage>
  listChatMessages(kbId: string, conversationId: string): Promise<ChatMessage[]>
  getIngestCache(kbId: string, sourceId: string): Promise<{ sourceHash: string; pageIds: string[] } | undefined>
  setIngestCache(kbId: string, sourceId: string, sourceHash: string, pageIds: string[]): Promise<void>
}

type Row = Record<string, unknown>

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string") return new Date(value).toISOString()
  return nowIso()
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function optionalIso(value: unknown): string | undefined {
  return value ? iso(value) : undefined
}

function parseImages(value: unknown): ImageAsset[] {
  return Array.isArray(value) ? value as ImageAsset[] : []
}

function parseCitations(value: unknown): ChatMessage["citations"] {
  return Array.isArray(value) ? value as ChatMessage["citations"] : []
}

function vectorLiteral(value?: number[]): string | null {
  if (!value || value.length === 0) return null
  return `[${value.map((item) => Number.isFinite(item) ? String(item) : "0").join(",")}]`
}

function parseVector(value: unknown): number[] | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) return value.map(Number)
  if (typeof value !== "string") return undefined
  const clean = value.trim().replace(/^\[/, "").replace(/\]$/, "")
  if (!clean) return undefined
  return clean.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item))
}

export class PostgresRepository implements KnowledgeRepository {
  private readonly pool: PgPool

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.KN_PG_POOL_SIZE ?? 10),
      ssl: process.env.KN_PG_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    }) as PgPool
  }

  async init(): Promise<void> {
    const schemaPath = fileURLToPath(new URL("../sql/001_init.sql", import.meta.url))
    await this.pool.query(await fs.readFile(schemaPath, "utf-8"))
    await this.ensureDefaultCompany()
    await this.pool.query(
      "UPDATE ingest_jobs SET status = 'queued', stage = 'Recovered after server restart', updated_at = $1 WHERE status IN ('running', 'queued')",
      [nowIso()],
    )
    await this.pool.query("DELETE FROM auth_sessions WHERE expires_at <= now()")
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async ensureDefaultCompany(): Promise<Company> {
    const existing = await this.pool.query<Row>("SELECT * FROM companies WHERE is_default = TRUE LIMIT 1")
    if (existing.rows[0]) return this.mapCompany(existing.rows[0])

    const now = nowIso()
    const inserted = await this.pool.query<Row>(
      `INSERT INTO companies (id, name, slug, is_default, created_at, updated_at)
       VALUES ($1, $2, $3, TRUE, $4, $4)
       ON CONFLICT (slug) DO UPDATE SET is_default = TRUE, updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [id("cmp"), process.env.KN_DEFAULT_COMPANY_NAME ?? "Default Company", "default", now],
    )
    return this.mapCompany(inserted.rows[0])
  }

  async upsertIdentity(input: {
    provider: "ldap"
    providerSubject: string
    username: string
    displayName: string
    email?: string
  }): Promise<Identity> {
    const now = nowIso()
    const result = await this.pool.query<Row>(
      `INSERT INTO identities (id, provider, provider_subject, username, display_name, email, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (provider, provider_subject)
       DO UPDATE SET username = EXCLUDED.username,
                     display_name = EXCLUDED.display_name,
                     email = EXCLUDED.email,
                     updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [id("idn"), input.provider, input.providerSubject, input.username, input.displayName, input.email ?? null, now],
    )
    return this.mapIdentity(result.rows[0])
  }

  async countCompanyMembers(companyId: string): Promise<number> {
    const result = await this.pool.query<Row>("SELECT COUNT(*) AS count FROM company_members WHERE company_id = $1", [companyId])
    return Number(result.rows[0]?.count ?? 0)
  }

  async ensureCompanyMember(companyId: string, identityId: string, role: CompanyMemberRole): Promise<CompanyMember> {
    const now = nowIso()
    const result = await this.pool.query<Row>(
      `INSERT INTO company_members (id, company_id, identity_id, role, status, joined_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $5)
       ON CONFLICT (company_id, identity_id)
       DO UPDATE SET updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [id("mem"), companyId, identityId, role, now],
    )
    return this.mapMember(result.rows[0])
  }

  async createSession(input: {
    tokenHash: string
    identityId: string
    companyId: string
    memberId: string
    expiresAt: string
  }): Promise<AuthSession> {
    const now = nowIso()
    const result = await this.pool.query<Row>(
      `INSERT INTO auth_sessions (id, token_hash, identity_id, company_id, member_id, expires_at, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [id("ses"), input.tokenHash, input.identityId, input.companyId, input.memberId, input.expiresAt, now],
    )
    return this.mapSession(result.rows[0])
  }

  async getSessionByTokenHash(tokenHash: string): Promise<AuthContext | undefined> {
    const result = await this.pool.query<Row>(
      `SELECT
         s.id AS session_id, s.token_hash, s.identity_id AS session_identity_id,
         s.company_id AS session_company_id, s.member_id, s.expires_at, s.created_at AS session_created_at, s.last_seen_at,
         i.id AS identity_id, i.provider, i.provider_subject, i.username, i.display_name, i.email,
         i.created_at AS identity_created_at, i.updated_at AS identity_updated_at,
         c.id AS company_id, c.name AS company_name, c.slug, c.is_default,
         c.created_at AS company_created_at, c.updated_at AS company_updated_at,
         m.id AS company_member_id, m.role, m.status, m.joined_at, m.updated_at AS member_updated_at
       FROM auth_sessions s
       JOIN identities i ON i.id = s.identity_id
       JOIN companies c ON c.id = s.company_id
       JOIN company_members m ON m.id = s.member_id
       WHERE s.token_hash = $1 AND s.expires_at > now()
       LIMIT 1`,
      [tokenHash],
    )
    const row = result.rows[0]
    if (!row) return undefined
    await this.pool.query("UPDATE auth_sessions SET last_seen_at = $1 WHERE token_hash = $2", [nowIso(), tokenHash])
    return {
      session: {
        id: String(row.session_id),
        tokenHash: String(row.token_hash),
        identityId: String(row.session_identity_id),
        companyId: String(row.session_company_id),
        memberId: String(row.member_id),
        expiresAt: iso(row.expires_at),
        createdAt: iso(row.session_created_at),
        lastSeenAt: iso(row.last_seen_at),
      },
      identity: {
        id: String(row.identity_id),
        provider: "ldap",
        providerSubject: String(row.provider_subject),
        username: String(row.username),
        displayName: String(row.display_name),
        email: row.email ? String(row.email) : undefined,
        createdAt: iso(row.identity_created_at),
        updatedAt: iso(row.identity_updated_at),
      },
      company: {
        id: String(row.company_id),
        name: String(row.company_name),
        slug: String(row.slug),
        isDefault: Boolean(row.is_default),
        createdAt: iso(row.company_created_at),
        updatedAt: iso(row.company_updated_at),
      },
      member: {
        id: String(row.company_member_id),
        companyId: String(row.company_id),
        identityId: String(row.identity_id),
        role: String(row.role) as CompanyMemberRole,
        status: "active",
        joinedAt: iso(row.joined_at),
        updatedAt: iso(row.member_updated_at),
      },
    }
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash])
  }

  async listKnowledgeBases(companyId?: string): Promise<KnowledgeBase[]> {
    const result = companyId
      ? await this.pool.query<Row>("SELECT * FROM knowledge_bases WHERE company_id = $1 ORDER BY updated_at DESC", [companyId])
      : await this.pool.query<Row>("SELECT * FROM knowledge_bases ORDER BY updated_at DESC")
    return result.rows.map((row) => this.mapKnowledgeBase(row))
  }

  async getKnowledgeBase(kbId: string): Promise<KnowledgeBase | undefined> {
    const result = await this.pool.query<Row>("SELECT * FROM knowledge_bases WHERE id = $1", [kbId])
    return result.rows[0] ? this.mapKnowledgeBase(result.rows[0]) : undefined
  }

  async saveKnowledgeBase(kb: KnowledgeBase): Promise<KnowledgeBase> {
    const result = await this.pool.query<Row>(
      `INSERT INTO knowledge_bases (id, company_id, name, description, created_at, updated_at, data_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id)
       DO UPDATE SET company_id = EXCLUDED.company_id,
                     name = EXCLUDED.name,
                     description = EXCLUDED.description,
                     updated_at = EXCLUDED.updated_at,
                     data_version = EXCLUDED.data_version
       RETURNING *`,
      [kb.id, kb.companyId, kb.name, kb.description, kb.createdAt, kb.updatedAt, kb.dataVersion],
    )
    return this.mapKnowledgeBase(result.rows[0])
  }

  async bumpDataVersion(kbId: string): Promise<void> {
    await this.pool.query("UPDATE knowledge_bases SET data_version = data_version + 1, updated_at = $1 WHERE id = $2", [nowIso(), kbId])
  }

  async saveSource(source: SourceDocument): Promise<SourceDocument> {
    const result = await this.pool.query<Row>(
      `INSERT INTO sources
         (id, kb_id, file_name, relative_path, storage_key, content_type, size, sha256, status, folder_context, created_at, updated_at, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id)
       DO UPDATE SET file_name = EXCLUDED.file_name,
                     relative_path = EXCLUDED.relative_path,
                     storage_key = EXCLUDED.storage_key,
                     content_type = EXCLUDED.content_type,
                     size = EXCLUDED.size,
                     sha256 = EXCLUDED.sha256,
                     status = EXCLUDED.status,
                     folder_context = EXCLUDED.folder_context,
                     updated_at = EXCLUDED.updated_at,
                     error = EXCLUDED.error
       RETURNING *`,
      [
        source.id,
        source.kbId,
        source.fileName,
        source.relativePath,
        source.storageKey,
        source.contentType,
        source.size,
        source.sha256,
        source.status,
        source.folderContext,
        source.createdAt,
        source.updatedAt,
        source.error ?? null,
      ],
    )
    return this.mapSource(result.rows[0])
  }

  async listSources(kbId: string): Promise<SourceDocument[]> {
    const result = await this.pool.query<Row>("SELECT * FROM sources WHERE kb_id = $1 ORDER BY relative_path", [kbId])
    return result.rows.map((row) => this.mapSource(row))
  }

  async getSource(sourceId: string): Promise<SourceDocument | undefined> {
    const result = await this.pool.query<Row>("SELECT * FROM sources WHERE id = $1", [sourceId])
    return result.rows[0] ? this.mapSource(result.rows[0]) : undefined
  }

  async saveJob(job: IngestJob): Promise<IngestJob> {
    const result = await this.pool.query<Row>(
      `INSERT INTO ingest_jobs
         (id, kb_id, source_id, status, progress, stage, attempts, cached, created_at, updated_at,
          started_at, completed_at, cancelled_at, error, written_page_ids, analysis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id)
       DO UPDATE SET status = EXCLUDED.status,
                     progress = EXCLUDED.progress,
                     stage = EXCLUDED.stage,
                     attempts = EXCLUDED.attempts,
                     cached = EXCLUDED.cached,
                     updated_at = EXCLUDED.updated_at,
                     started_at = EXCLUDED.started_at,
                     completed_at = EXCLUDED.completed_at,
                     cancelled_at = EXCLUDED.cancelled_at,
                     error = EXCLUDED.error,
                     written_page_ids = EXCLUDED.written_page_ids,
                     analysis = EXCLUDED.analysis
       RETURNING *`,
      [
        job.id,
        job.kbId,
        job.sourceId,
        job.status,
        job.progress,
        job.stage,
        job.attempts,
        job.cached,
        job.createdAt,
        job.updatedAt,
        job.startedAt ?? null,
        job.completedAt ?? null,
        job.cancelledAt ?? null,
        job.error ?? null,
        job.writtenPageIds,
        job.analysis ?? null,
      ],
    )
    return this.mapJob(result.rows[0])
  }

  async listJobs(kbId?: string): Promise<IngestJob[]> {
    const result = kbId
      ? await this.pool.query<Row>("SELECT * FROM ingest_jobs WHERE kb_id = $1 ORDER BY created_at DESC", [kbId])
      : await this.pool.query<Row>("SELECT * FROM ingest_jobs ORDER BY created_at DESC")
    return result.rows.map((row) => this.mapJob(row))
  }

  async getJob(jobId: string): Promise<IngestJob | undefined> {
    const result = await this.pool.query<Row>("SELECT * FROM ingest_jobs WHERE id = $1", [jobId])
    return result.rows[0] ? this.mapJob(result.rows[0]) : undefined
  }

  async listQueuedJobs(): Promise<IngestJob[]> {
    const result = await this.pool.query<Row>("SELECT * FROM ingest_jobs WHERE status = 'queued' ORDER BY created_at")
    return result.rows.map((row) => this.mapJob(row))
  }

  async upsertPage(page: WikiPage): Promise<WikiPage> {
    const result = await this.pool.query<Row>(
      `INSERT INTO wiki_pages
         (id, kb_id, path, title, page_type, content, sha256, sources, images, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
       ON CONFLICT (kb_id, id)
       DO UPDATE SET path = EXCLUDED.path,
                     title = EXCLUDED.title,
                     page_type = EXCLUDED.page_type,
                     content = EXCLUDED.content,
                     sha256 = EXCLUDED.sha256,
                     sources = EXCLUDED.sources,
                     images = EXCLUDED.images,
                     updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        page.id,
        page.kbId,
        page.path,
        page.title,
        page.type,
        page.content,
        page.sha256,
        page.sources,
        JSON.stringify(page.images),
        page.createdAt,
        page.updatedAt,
      ],
    )
    return this.mapPage(result.rows[0])
  }

  async listPages(kbId: string): Promise<WikiPage[]> {
    const result = await this.pool.query<Row>("SELECT * FROM wiki_pages WHERE kb_id = $1 ORDER BY path", [kbId])
    return result.rows.map((row) => this.mapPage(row))
  }

  async getPage(kbId: string, pageId: string): Promise<WikiPage | undefined> {
    const result = await this.pool.query<Row>("SELECT * FROM wiki_pages WHERE kb_id = $1 AND id = $2", [kbId, pageId])
    return result.rows[0] ? this.mapPage(result.rows[0]) : undefined
  }

  async replacePageLinks(kbId: string, pageId: string, links: WikiLink[]): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("DELETE FROM wiki_links WHERE kb_id = $1 AND source_page_id = $2", [kbId, pageId])
      for (const link of links) {
        await client.query(
          "INSERT INTO wiki_links (kb_id, source_page_id, target_page_id, target_raw) VALUES ($1, $2, $3, $4)",
          [link.kbId, link.sourcePageId, link.targetPageId, link.targetRaw],
        )
      }
    })
  }

  async listLinks(kbId: string): Promise<WikiLink[]> {
    const result = await this.pool.query<Row>("SELECT * FROM wiki_links WHERE kb_id = $1", [kbId])
    return result.rows.map((row) => ({
      kbId: String(row.kb_id),
      sourcePageId: String(row.source_page_id),
      targetPageId: String(row.target_page_id),
      targetRaw: String(row.target_raw),
    }))
  }

  async replacePageSources(kbId: string, pageId: string, pageSources: PageSource[]): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("DELETE FROM page_sources WHERE kb_id = $1 AND page_id = $2", [kbId, pageId])
      for (const source of pageSources) {
        await client.query(
          `INSERT INTO page_sources (kb_id, page_id, source_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (kb_id, page_id, source_id) DO NOTHING`,
          [source.kbId, source.pageId, source.sourceId],
        )
      }
    })
  }

  async listPageSources(kbId: string): Promise<PageSource[]> {
    const result = await this.pool.query<Row>("SELECT * FROM page_sources WHERE kb_id = $1", [kbId])
    return result.rows.map((row) => ({
      kbId: String(row.kb_id),
      pageId: String(row.page_id),
      sourceId: String(row.source_id),
    }))
  }

  async replaceChunks(kbId: string, pageId: string, chunks: PageChunk[]): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("DELETE FROM page_chunks WHERE kb_id = $1 AND page_id = $2", [kbId, pageId])
      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO page_chunks (id, kb_id, page_id, text, ordinal, tokens, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
          [chunk.id, chunk.kbId, chunk.pageId, chunk.text, chunk.ordinal, chunk.tokens, vectorLiteral(chunk.embedding)],
        )
      }
    })
  }

  async listChunks(kbId: string): Promise<PageChunk[]> {
    const result = await this.pool.query<Row>("SELECT * FROM page_chunks WHERE kb_id = $1 ORDER BY page_id, ordinal", [kbId])
    return result.rows.map((row) => this.mapChunk(row))
  }

  async searchPagesByVector(kbId: string, embedding: number[], limit: number): Promise<Array<{ pageId: string; score: number }>> {
    const vector = vectorLiteral(embedding)
    if (!vector) return []
    const result = await this.pool.query<Row>(
      `SELECT page_id, 1 / (1 + MIN(embedding <=> $2::vector)) AS score
       FROM page_chunks
       WHERE kb_id = $1 AND embedding IS NOT NULL AND vector_dims(embedding) = vector_dims($2::vector)
       GROUP BY page_id
       ORDER BY score DESC
       LIMIT $3`,
      [kbId, vector, limit],
    )
    return result.rows.map((row) => ({ pageId: String(row.page_id), score: Number(row.score) }))
  }

  async saveImage(image: ImageAsset): Promise<ImageAsset> {
    const result = await this.pool.query<Row>(
      `INSERT INTO image_assets
         (id, kb_id, source_id, page_id, storage_key, file_name, media_type, caption, origin, source_page, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id)
       DO UPDATE SET page_id = EXCLUDED.page_id,
                     storage_key = EXCLUDED.storage_key,
                     file_name = EXCLUDED.file_name,
                     media_type = EXCLUDED.media_type,
                     caption = EXCLUDED.caption,
                     origin = EXCLUDED.origin,
                     source_page = EXCLUDED.source_page
       RETURNING *`,
      [
        image.id,
        image.kbId,
        image.sourceId,
        image.pageId ?? null,
        image.storageKey,
        image.fileName,
        image.mediaType,
        image.caption,
        image.origin,
        image.sourcePage ?? null,
        image.createdAt,
      ],
    )
    return this.mapImage(result.rows[0])
  }

  async listImages(kbId: string): Promise<ImageAsset[]> {
    const result = await this.pool.query<Row>("SELECT * FROM image_assets WHERE kb_id = $1 ORDER BY created_at", [kbId])
    return result.rows.map((row) => this.mapImage(row))
  }

  async addReview(review: ReviewItem): Promise<ReviewItem> {
    const result = await this.pool.query<Row>(
      `INSERT INTO review_items
         (id, kb_id, source_id, page_id, kind, title, description, action, query, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id)
       DO UPDATE SET source_id = EXCLUDED.source_id,
                     page_id = EXCLUDED.page_id,
                     kind = EXCLUDED.kind,
                     title = EXCLUDED.title,
                     description = EXCLUDED.description,
                     action = EXCLUDED.action,
                     query = EXCLUDED.query,
                     status = EXCLUDED.status,
                     updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        review.id,
        review.kbId,
        review.sourceId ?? null,
        review.pageId ?? null,
        review.kind,
        review.title,
        review.description,
        review.action ?? null,
        review.query ?? null,
        review.status,
        review.createdAt,
        review.updatedAt,
      ],
    )
    return this.mapReview(result.rows[0])
  }

  async listReviews(kbId: string): Promise<ReviewItem[]> {
    const result = await this.pool.query<Row>("SELECT * FROM review_items WHERE kb_id = $1 ORDER BY created_at DESC", [kbId])
    return result.rows.map((row) => this.mapReview(row))
  }

  async updateReviewStatus(kbId: string, reviewId: string, status: ReviewItem["status"]): Promise<ReviewItem | undefined> {
    const result = await this.pool.query<Row>(
      "UPDATE review_items SET status = $1, updated_at = $2 WHERE kb_id = $3 AND id = $4 RETURNING *",
      [status, nowIso(), kbId, reviewId],
    )
    return result.rows[0] ? this.mapReview(result.rows[0]) : undefined
  }

  async addChatMessage(message: ChatMessage): Promise<ChatMessage> {
    const result = await this.pool.query<Row>(
      `INSERT INTO chat_messages (id, kb_id, conversation_id, role, content, citations, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING *`,
      [message.id, message.kbId, message.conversationId, message.role, message.content, JSON.stringify(message.citations), message.createdAt],
    )
    return this.mapChat(result.rows[0])
  }

  async listChatMessages(kbId: string, conversationId: string): Promise<ChatMessage[]> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM chat_messages WHERE kb_id = $1 AND conversation_id = $2 ORDER BY created_at",
      [kbId, conversationId],
    )
    return result.rows.map((row) => this.mapChat(row))
  }

  async getIngestCache(kbId: string, sourceId: string): Promise<{ sourceHash: string; pageIds: string[] } | undefined> {
    const result = await this.pool.query<Row>("SELECT * FROM ingest_cache WHERE kb_id = $1 AND source_id = $2", [kbId, sourceId])
    const row = result.rows[0]
    return row ? { sourceHash: String(row.source_hash), pageIds: textArray(row.page_ids) } : undefined
  }

  async setIngestCache(kbId: string, sourceId: string, sourceHash: string, pageIds: string[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO ingest_cache (kb_id, source_id, source_hash, page_ids, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (kb_id, source_id)
       DO UPDATE SET source_hash = EXCLUDED.source_hash,
                     page_ids = EXCLUDED.page_ids,
                     updated_at = EXCLUDED.updated_at`,
      [kbId, sourceId, sourceHash, pageIds, nowIso()],
    )
  }

  private async transaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      await work(client)
      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }
  }

  private mapCompany(row: Row): Company {
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      isDefault: Boolean(row.is_default),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
  }

  private mapIdentity(row: Row): Identity {
    return {
      id: String(row.id),
      provider: "ldap",
      providerSubject: String(row.provider_subject),
      username: String(row.username),
      displayName: String(row.display_name),
      email: row.email ? String(row.email) : undefined,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
  }

  private mapMember(row: Row): CompanyMember {
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      identityId: String(row.identity_id),
      role: String(row.role) as CompanyMemberRole,
      status: "active",
      joinedAt: iso(row.joined_at),
      updatedAt: iso(row.updated_at),
    }
  }

  private mapSession(row: Row): AuthSession {
    return {
      id: String(row.id),
      tokenHash: String(row.token_hash),
      identityId: String(row.identity_id),
      companyId: String(row.company_id),
      memberId: String(row.member_id),
      expiresAt: iso(row.expires_at),
      createdAt: iso(row.created_at),
      lastSeenAt: iso(row.last_seen_at),
    }
  }

  private mapKnowledgeBase(row: Row): KnowledgeBase {
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      name: String(row.name),
      description: String(row.description ?? ""),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      dataVersion: Number(row.data_version),
    }
  }

  private mapSource(row: Row): SourceDocument {
    return {
      id: String(row.id),
      kbId: String(row.kb_id),
      fileName: String(row.file_name),
      relativePath: String(row.relative_path),
      storageKey: String(row.storage_key),
      contentType: String(row.content_type),
      size: Number(row.size),
      sha256: String(row.sha256),
      status: String(row.status) as SourceDocument["status"],
      folderContext: String(row.folder_context ?? ""),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      error: row.error ? String(row.error) : undefined,
    }
  }

  private mapJob(row: Row): IngestJob {
    return {
      id: String(row.id),
      kbId: String(row.kb_id),
      sourceId: String(row.source_id),
      status: String(row.status) as IngestJob["status"],
      progress: Number(row.progress),
      stage: String(row.stage),
      attempts: Number(row.attempts),
      cached: Boolean(row.cached),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      startedAt: optionalIso(row.started_at),
      completedAt: optionalIso(row.completed_at),
      cancelledAt: optionalIso(row.cancelled_at),
      error: row.error ? String(row.error) : undefined,
      writtenPageIds: textArray(row.written_page_ids),
      analysis: row.analysis ? String(row.analysis) : undefined,
    }
  }

  private mapPage(row: Row): WikiPage {
    return {
      id: String(row.id),
      kbId: String(row.kb_id),
      path: String(row.path),
      title: String(row.title),
      type: String(row.page_type),
      content: String(row.content),
      sha256: String(row.sha256),
      sources: textArray(row.sources),
      images: parseImages(row.images),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
  }

  private mapChunk(row: Row): PageChunk {
    return {
      id: String(row.id),
      kbId: String(row.kb_id),
      pageId: String(row.page_id),
      text: String(row.text),
      ordinal: Number(row.ordinal),
      tokens: textArray(row.tokens),
      embedding: parseVector(row.embedding),
    }
  }

  private mapImage(row: Row): ImageAsset {
    return {
      id: String(row.id),
      kbId: String(row.kb_id),
      sourceId: String(row.source_id),
      pageId: row.page_id ? String(row.page_id) : undefined,
      storageKey: String(row.storage_key),
      fileName: String(row.file_name),
      mediaType: String(row.media_type),
      caption: String(row.caption),
      origin: String(row.origin) as ImageAsset["origin"],
      sourcePage: row.source_page === null || row.source_page === undefined ? undefined : Number(row.source_page),
      createdAt: iso(row.created_at),
    }
  }

  private mapReview(row: Row): ReviewItem {
    return {
      id: String(row.id),
      kbId: String(row.kb_id),
      sourceId: row.source_id ? String(row.source_id) : undefined,
      pageId: row.page_id ? String(row.page_id) : undefined,
      kind: String(row.kind) as ReviewItem["kind"],
      title: String(row.title),
      description: String(row.description),
      action: row.action ? String(row.action) : undefined,
      query: row.query ? String(row.query) : undefined,
      status: String(row.status) as ReviewItem["status"],
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
  }

  private mapChat(row: Row): ChatMessage {
    return {
      id: String(row.id),
      kbId: String(row.kb_id),
      conversationId: String(row.conversation_id),
      role: String(row.role) as ChatMessage["role"],
      content: String(row.content),
      citations: parseCitations(row.citations),
      createdAt: iso(row.created_at),
    }
  }
}
