import fs from "node:fs/promises"
import { fileURLToPath } from "node:url"
import pg from "pg"
import type { Pool as PgPool, PoolClient } from "pg"
import type {
  AuthContext,
  AuthSession,
  ChatMessage,
  Company,
  CompanyModel,
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
  UserApiKey,
  WikiLink,
  WikiPage,
} from "./types.js"
import {
  normalizeModelProtocol,
} from "./model-providers.js"
import { id, nowIso } from "./wiki-utils.js"

const { Pool } = pg
const DEFAULT_COMPANY_NAME = "祥承科技"
const DEFAULT_COMPANY_SLUG = "xiangcheng-tech"
const API_KEY_AUTH_EXPIRES_AT = "9999-12-31T23:59:59.999Z"

export interface KnowledgeRepository {
  init(): Promise<void>
  close(): Promise<void>
  ensureDefaultCompany(): Promise<Company>
  upsertIdentity(input: {
    provider: "ldap" | "local"
    providerSubject: string
    username: string
    displayName: string
    email?: string
    passwordHash?: string
    isPlatformAdmin?: boolean
  }): Promise<Identity>
  findIdentityByLoginIdentifier(loginIdentifier: string): Promise<Identity | undefined>
  countCompanyMembers(companyId: string): Promise<number>
  ensureCompanyMember(companyId: string, identityId: string, role: CompanyMemberRole): Promise<CompanyMember>
  listCompanyModels(companyId: string): Promise<CompanyModel[]>
  getCompanyModel(companyId: string, modelId: string): Promise<CompanyModel | undefined>
  getDefaultCompanyModel(companyId: string, capability: "llm" | "embedding" | "vision"): Promise<CompanyModel | undefined>
  saveCompanyModel(model: CompanyModel): Promise<CompanyModel>
  deleteCompanyModel(companyId: string, modelId: string): Promise<boolean>
  createSession(input: {
    tokenHash: string
    identityId: string
    companyId: string
    memberId: string
    expiresAt: string
  }): Promise<AuthSession>
  getSessionByTokenHash(tokenHash: string): Promise<AuthContext | undefined>
  deleteSession(tokenHash: string): Promise<void>
  listApiKeys(identityId: string, companyId: string): Promise<UserApiKey[]>
  createApiKey(input: {
    identityId: string
    companyId: string
    name: string
    keyHash: string
    keyHint: string
  }): Promise<UserApiKey>
  updateApiKey(identityId: string, companyId: string, keyId: string, name: string): Promise<UserApiKey | undefined>
  deleteApiKey(identityId: string, companyId: string, keyId: string): Promise<boolean>
  getApiKeyAuthContextByTokenHash(tokenHash: string): Promise<AuthContext | undefined>
  listKnowledgeBases(companyId?: string, identityId?: string): Promise<KnowledgeBase[]>
  getKnowledgeBase(kbId: string): Promise<KnowledgeBase | undefined>
  saveKnowledgeBase(kb: KnowledgeBase): Promise<KnowledgeBase>
  touchKnowledgeBase(kbId: string): Promise<void>
  deleteKnowledgeBase(kbId: string): Promise<void>
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
    await this.ensureSchemaCompatibility()
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
    const desiredName = process.env.KN_DEFAULT_COMPANY_NAME?.trim() || DEFAULT_COMPANY_NAME
    const desiredSlug = process.env.KN_DEFAULT_COMPANY_SLUG?.trim() || DEFAULT_COMPANY_SLUG
    if (existing.rows[0]) {
      if (String(existing.rows[0].name) !== desiredName || String(existing.rows[0].slug) !== desiredSlug) {
        const updated = await this.pool.query<Row>(
          "UPDATE companies SET name = $1, slug = $2, updated_at = $3 WHERE id = $4 RETURNING *",
          [desiredName, desiredSlug, nowIso(), existing.rows[0].id],
        )
        return this.mapCompany(updated.rows[0])
      }
      return this.mapCompany(existing.rows[0])
    }

    const now = nowIso()
    const inserted = await this.pool.query<Row>(
      `INSERT INTO companies (id, name, slug, is_default, created_at, updated_at)
       VALUES ($1, $2, $3, TRUE, $4, $4)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_default = TRUE, updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [id("cmp"), desiredName, desiredSlug, now],
    )
    return this.mapCompany(inserted.rows[0])
  }

  private async ensureSchemaCompatibility(): Promise<void> {
    await this.pool.query(`
      ALTER TABLE identities ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE identities ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS company_models (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('openai', 'qwen', 'deepseek', 'kimi', 'claudecode', 'ollama', 'custom')),
        protocol TEXT NOT NULL DEFAULT 'openai_compatible' CHECK (protocol IN ('openai_compatible', 'anthropic_messages')),
        model TEXT NOT NULL,
        endpoint TEXT NOT NULL DEFAULT '',
        api_key TEXT,
        capabilities TEXT[] NOT NULL DEFAULT '{}',
        is_default_llm BOOLEAN NOT NULL DEFAULT FALSE,
        is_default_embedding BOOLEAN NOT NULL DEFAULT FALSE,
        is_default_vision BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS company_models_company_idx ON company_models(company_id, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS company_models_default_llm_uidx ON company_models(company_id) WHERE is_default_llm;
      CREATE UNIQUE INDEX IF NOT EXISTS company_models_default_embedding_uidx ON company_models(company_id) WHERE is_default_embedding;
      CREATE UNIQUE INDEX IF NOT EXISTS company_models_default_vision_uidx ON company_models(company_id) WHERE is_default_vision;

      CREATE TABLE IF NOT EXISTS user_api_keys (
        id TEXT PRIMARY KEY,
        identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_hint TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS user_api_keys_identity_company_idx ON user_api_keys(identity_id, company_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS user_api_keys_key_hash_uidx ON user_api_keys(key_hash);

      ALTER TABLE company_models ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'openai_compatible';
      ALTER TABLE company_models DROP CONSTRAINT IF EXISTS company_models_protocol_check;
      UPDATE company_models SET protocol = 'anthropic_messages' WHERE provider = 'claudecode';
      ALTER TABLE company_models
        ADD CONSTRAINT company_models_protocol_check
        CHECK (protocol IN ('openai_compatible', 'anthropic_messages'));

      ALTER TABLE company_members DROP CONSTRAINT IF EXISTS company_members_role_check;
      UPDATE company_members SET role = 'org_admin' WHERE role = 'company_admin';
      ALTER TABLE company_members
        ADD CONSTRAINT company_members_role_check
        CHECK (role IN ('platform_admin', 'org_admin', 'agent_admin', 'member'));

      ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES identities(id) ON DELETE SET NULL;
      ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'company';
      ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'llm_wiki';
      ALTER TABLE knowledge_bases DROP CONSTRAINT IF EXISTS knowledge_bases_visibility_check;
      ALTER TABLE knowledge_bases ADD CONSTRAINT knowledge_bases_visibility_check CHECK (visibility IN ('company', 'creator_only'));
      ALTER TABLE knowledge_bases DROP CONSTRAINT IF EXISTS knowledge_bases_type_check;
      ALTER TABLE knowledge_bases ADD CONSTRAINT knowledge_bases_type_check CHECK (type = 'llm_wiki');
      ALTER TABLE knowledge_bases DROP COLUMN IF EXISTS data_version;
      ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS embedding_model_id TEXT REFERENCES company_models(id) ON DELETE SET NULL;

      ALTER TABLE sources ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      ALTER TABLE sources ADD COLUMN IF NOT EXISTS root TEXT NOT NULL DEFAULT 'raw';
      ALTER TABLE sources ADD COLUMN IF NOT EXISTS parent_path TEXT NOT NULL DEFAULT '';
      ALTER TABLE sources ADD COLUMN IF NOT EXISTS upload_batch_id TEXT;
      UPDATE sources s SET company_id = kb.company_id FROM knowledge_bases kb WHERE s.kb_id = kb.id AND s.company_id IS NULL;
      UPDATE sources SET root = 'raw' WHERE root IS NULL OR root = '';
      UPDATE sources SET parent_path = regexp_replace(relative_path, '/[^/]+$', '') WHERE parent_path = '' AND relative_path LIKE '%/%';
      ALTER TABLE sources ALTER COLUMN company_id SET NOT NULL;
      ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_root_check;
      ALTER TABLE sources ADD CONSTRAINT sources_root_check CHECK (root IN ('raw', 'wiki'));

      ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      UPDATE ingest_jobs j SET company_id = kb.company_id FROM knowledge_bases kb WHERE j.kb_id = kb.id AND j.company_id IS NULL;
      ALTER TABLE ingest_jobs ALTER COLUMN company_id SET NOT NULL;

      ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      UPDATE wiki_pages p SET company_id = kb.company_id FROM knowledge_bases kb WHERE p.kb_id = kb.id AND p.company_id IS NULL;
      ALTER TABLE wiki_pages ALTER COLUMN company_id SET NOT NULL;

      ALTER TABLE wiki_links ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      UPDATE wiki_links l SET company_id = kb.company_id FROM knowledge_bases kb WHERE l.kb_id = kb.id AND l.company_id IS NULL;
      ALTER TABLE wiki_links ALTER COLUMN company_id SET NOT NULL;

      ALTER TABLE page_sources ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      UPDATE page_sources ps SET company_id = kb.company_id FROM knowledge_bases kb WHERE ps.kb_id = kb.id AND ps.company_id IS NULL;
      ALTER TABLE page_sources ALTER COLUMN company_id SET NOT NULL;

      ALTER TABLE page_chunks ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      UPDATE page_chunks pc SET company_id = kb.company_id FROM knowledge_bases kb WHERE pc.kb_id = kb.id AND pc.company_id IS NULL;
      ALTER TABLE page_chunks ALTER COLUMN company_id SET NOT NULL;

      ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      UPDATE image_assets i SET company_id = kb.company_id FROM knowledge_bases kb WHERE i.kb_id = kb.id AND i.company_id IS NULL;
      ALTER TABLE image_assets ALTER COLUMN company_id SET NOT NULL;

      ALTER TABLE review_items ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      UPDATE review_items r SET company_id = kb.company_id FROM knowledge_bases kb WHERE r.kb_id = kb.id AND r.company_id IS NULL;
      ALTER TABLE review_items ALTER COLUMN company_id SET NOT NULL;

      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      UPDATE chat_messages c SET company_id = kb.company_id FROM knowledge_bases kb WHERE c.kb_id = kb.id AND c.company_id IS NULL;
      ALTER TABLE chat_messages ALTER COLUMN company_id SET NOT NULL;

      ALTER TABLE ingest_cache ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      UPDATE ingest_cache ic SET company_id = kb.company_id FROM knowledge_bases kb WHERE ic.kb_id = kb.id AND ic.company_id IS NULL;
      ALTER TABLE ingest_cache ALTER COLUMN company_id SET NOT NULL;

      WITH ranked_sources AS (
        SELECT id, row_number() OVER (
          PARTITION BY company_id, kb_id, root, relative_path
          ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS rn
        FROM sources
      )
      DELETE FROM sources s USING ranked_sources r WHERE s.id = r.id AND r.rn > 1;
      CREATE UNIQUE INDEX IF NOT EXISTS sources_scope_path_uidx ON sources(company_id, kb_id, root, relative_path);
    `)
  }

  async upsertIdentity(input: {
    provider: "ldap" | "local"
    providerSubject: string
    username: string
    displayName: string
    email?: string
    passwordHash?: string
    isPlatformAdmin?: boolean
  }): Promise<Identity> {
    const now = nowIso()
    const result = await this.pool.query<Row>(
      `INSERT INTO identities
         (id, provider, provider_subject, username, display_name, email, password_hash, is_platform_admin, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (provider, provider_subject)
       DO UPDATE SET username = EXCLUDED.username,
                     display_name = EXCLUDED.display_name,
                     email = EXCLUDED.email,
                     password_hash = COALESCE(EXCLUDED.password_hash, identities.password_hash),
                     is_platform_admin = identities.is_platform_admin OR EXCLUDED.is_platform_admin,
                     updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        id("idn"),
        input.provider,
        input.providerSubject,
        input.username,
        input.displayName,
        input.email ?? null,
        input.passwordHash ?? null,
        input.isPlatformAdmin ?? false,
        now,
      ],
    )
    return this.mapIdentity(result.rows[0])
  }

  async findIdentityByLoginIdentifier(loginIdentifier: string): Promise<Identity | undefined> {
    const value = loginIdentifier.trim()
    if (!value) return undefined
    const result = await this.pool.query<Row>(
      `SELECT *
       FROM identities
       WHERE username = $1
          OR lower(email) = lower($1)
          OR ($2 = FALSE AND lower(email) LIKE lower($1 || '@%'))
       ORDER BY is_platform_admin DESC, (password_hash IS NOT NULL) DESC, (provider = 'local') DESC, created_at ASC
       LIMIT 1`,
      [value, value.includes("@")],
    )
    return result.rows[0] ? this.mapIdentity(result.rows[0]) : undefined
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
       DO UPDATE SET role = CASE
                              WHEN company_members.role = 'platform_admin' OR EXCLUDED.role = 'platform_admin' THEN 'platform_admin'
                              WHEN company_members.role = 'org_admin' OR EXCLUDED.role = 'org_admin' THEN 'org_admin'
                              WHEN company_members.role = 'agent_admin' OR EXCLUDED.role = 'agent_admin' THEN 'agent_admin'
                              ELSE 'member'
                            END,
                     updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [id("mem"), companyId, identityId, role, now],
    )
    return this.mapMember(result.rows[0])
  }

  async listCompanyModels(companyId: string): Promise<CompanyModel[]> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM company_models WHERE company_id = $1 ORDER BY updated_at DESC, created_at DESC",
      [companyId],
    )
    return result.rows.map((row) => this.mapCompanyModel(row))
  }

  async getCompanyModel(companyId: string, modelId: string): Promise<CompanyModel | undefined> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM company_models WHERE company_id = $1 AND id = $2",
      [companyId, modelId],
    )
    return result.rows[0] ? this.mapCompanyModel(result.rows[0]) : undefined
  }

  async getDefaultCompanyModel(companyId: string, capability: "llm" | "embedding" | "vision"): Promise<CompanyModel | undefined> {
    const column = capability === "llm" ? "is_default_llm" : capability === "embedding" ? "is_default_embedding" : "is_default_vision"
    const result = await this.pool.query<Row>(
      `SELECT * FROM company_models
       WHERE company_id = $1
         AND ${column} = TRUE
         AND $2 = ANY(capabilities)
       ORDER BY updated_at DESC
       LIMIT 1`,
      [companyId, capability],
    )
    return result.rows[0] ? this.mapCompanyModel(result.rows[0]) : undefined
  }

  async saveCompanyModel(model: CompanyModel): Promise<CompanyModel> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      if (model.isDefaultLlm) {
        await client.query("UPDATE company_models SET is_default_llm = FALSE, updated_at = $2 WHERE company_id = $1", [model.companyId, model.updatedAt])
      }
      if (model.isDefaultEmbedding) {
        await client.query("UPDATE company_models SET is_default_embedding = FALSE, updated_at = $2 WHERE company_id = $1", [model.companyId, model.updatedAt])
      }
      if (model.isDefaultVision) {
        await client.query("UPDATE company_models SET is_default_vision = FALSE, updated_at = $2 WHERE company_id = $1", [model.companyId, model.updatedAt])
      }
      const result = await client.query<Row>(
        `INSERT INTO company_models
           (id, company_id, name, provider, protocol, model, endpoint, api_key, capabilities,
            is_default_llm, is_default_embedding, is_default_vision, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id)
         DO UPDATE SET name = EXCLUDED.name,
                       provider = EXCLUDED.provider,
                       protocol = EXCLUDED.protocol,
                       model = EXCLUDED.model,
                       endpoint = EXCLUDED.endpoint,
                       api_key = COALESCE(EXCLUDED.api_key, company_models.api_key),
                       capabilities = EXCLUDED.capabilities,
                       is_default_llm = EXCLUDED.is_default_llm,
                       is_default_embedding = EXCLUDED.is_default_embedding,
                       is_default_vision = EXCLUDED.is_default_vision,
                       updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          model.id,
          model.companyId,
          model.name,
          model.provider,
          model.protocol,
          model.model,
          model.endpoint,
          model.apiKey ?? null,
          model.capabilities,
          model.isDefaultLlm,
          model.isDefaultEmbedding,
          model.isDefaultVision,
          model.createdAt,
          model.updatedAt,
        ],
      )
      await client.query("COMMIT")
      return this.mapCompanyModel(result.rows[0])
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }
  }

  async deleteCompanyModel(companyId: string, modelId: string): Promise<boolean> {
    // company_models 被知识库引用时使用 ON DELETE SET NULL；删除模型只移除这个调用配置，
    // 不会级联删除知识库。默认模型标记也随记录一起消失，前端会真实显示“暂无可选/待配置”。
    const result = await this.pool.query(
      "DELETE FROM company_models WHERE company_id = $1 AND id = $2",
      [companyId, modelId],
    )
    return (result.rowCount ?? 0) > 0
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
         i.id AS identity_id, i.provider, i.provider_subject, i.username, i.display_name, i.email, i.password_hash, i.is_platform_admin,
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
        passwordHash: row.password_hash ? String(row.password_hash) : undefined,
        isPlatformAdmin: Boolean(row.is_platform_admin),
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

  async listApiKeys(identityId: string, companyId: string): Promise<UserApiKey[]> {
    const result = await this.pool.query<Row>(
      `SELECT *
       FROM user_api_keys
       WHERE identity_id = $1 AND company_id = $2
       ORDER BY created_at DESC`,
      [identityId, companyId],
    )
    return result.rows.map((row) => this.mapApiKey(row))
  }

  async createApiKey(input: {
    identityId: string
    companyId: string
    name: string
    keyHash: string
    keyHint: string
  }): Promise<UserApiKey> {
    const now = nowIso()
    const result = await this.pool.query<Row>(
      `INSERT INTO user_api_keys (id, identity_id, company_id, name, key_hash, key_hint, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [id("key"), input.identityId, input.companyId, input.name, input.keyHash, input.keyHint, now],
    )
    return this.mapApiKey(result.rows[0])
  }

  async updateApiKey(identityId: string, companyId: string, keyId: string, name: string): Promise<UserApiKey | undefined> {
    const result = await this.pool.query<Row>(
      `UPDATE user_api_keys
       SET name = $4, updated_at = $5
       WHERE id = $1 AND identity_id = $2 AND company_id = $3
       RETURNING *`,
      [keyId, identityId, companyId, name, nowIso()],
    )
    return result.rows[0] ? this.mapApiKey(result.rows[0]) : undefined
  }

  async deleteApiKey(identityId: string, companyId: string, keyId: string): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM user_api_keys WHERE id = $1 AND identity_id = $2 AND company_id = $3",
      [keyId, identityId, companyId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async getApiKeyAuthContextByTokenHash(tokenHash: string): Promise<AuthContext | undefined> {
    const result = await this.pool.query<Row>(
      `SELECT
         k.id AS api_key_id, k.key_hash, k.identity_id AS key_identity_id, k.company_id AS key_company_id,
         k.created_at AS key_created_at, k.updated_at AS key_updated_at,
         i.id AS identity_id, i.provider, i.provider_subject, i.username, i.display_name, i.email, i.password_hash, i.is_platform_admin,
         i.created_at AS identity_created_at, i.updated_at AS identity_updated_at,
         c.id AS company_id, c.name AS company_name, c.slug, c.is_default,
         c.created_at AS company_created_at, c.updated_at AS company_updated_at,
         m.id AS company_member_id, m.role, m.status, m.joined_at, m.updated_at AS member_updated_at
       FROM user_api_keys k
       JOIN identities i ON i.id = k.identity_id
       JOIN companies c ON c.id = k.company_id
       JOIN company_members m ON m.company_id = k.company_id AND m.identity_id = k.identity_id
       WHERE k.key_hash = $1 AND m.status = 'active'
       LIMIT 1`,
      [tokenHash],
    )
    const row = result.rows[0]
    if (!row) return undefined
    return {
      session: {
        id: String(row.api_key_id),
        tokenHash: String(row.key_hash),
        identityId: String(row.key_identity_id),
        companyId: String(row.key_company_id),
        memberId: String(row.company_member_id),
        expiresAt: API_KEY_AUTH_EXPIRES_AT,
        createdAt: iso(row.key_created_at),
        lastSeenAt: iso(row.key_updated_at),
      },
      identity: {
        id: String(row.identity_id),
        provider: String(row.provider) as Identity["provider"],
        providerSubject: String(row.provider_subject),
        username: String(row.username),
        displayName: String(row.display_name),
        email: row.email ? String(row.email) : undefined,
        passwordHash: row.password_hash ? String(row.password_hash) : undefined,
        isPlatformAdmin: Boolean(row.is_platform_admin),
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

  async listKnowledgeBases(companyId?: string, identityId?: string): Promise<KnowledgeBase[]> {
    const result = companyId
      ? await this.pool.query<Row>(
        `SELECT * FROM knowledge_bases
         WHERE company_id = $1
           AND ($2::text IS NULL OR visibility = 'company' OR created_by = $2)
         ORDER BY updated_at DESC`,
        [companyId, identityId ?? null],
      )
      : await this.pool.query<Row>("SELECT * FROM knowledge_bases ORDER BY updated_at DESC")
    return result.rows.map((row) => this.mapKnowledgeBase(row))
  }

  async getKnowledgeBase(kbId: string): Promise<KnowledgeBase | undefined> {
    const result = await this.pool.query<Row>("SELECT * FROM knowledge_bases WHERE id = $1", [kbId])
    return result.rows[0] ? this.mapKnowledgeBase(result.rows[0]) : undefined
  }

  async saveKnowledgeBase(kb: KnowledgeBase): Promise<KnowledgeBase> {
    const result = await this.pool.query<Row>(
      `INSERT INTO knowledge_bases
         (id, company_id, created_by, visibility, type, name, description, embedding_model_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id)
       DO UPDATE SET company_id = EXCLUDED.company_id,
                     created_by = EXCLUDED.created_by,
                     visibility = EXCLUDED.visibility,
                     type = EXCLUDED.type,
                     name = EXCLUDED.name,
                     description = EXCLUDED.description,
                     embedding_model_id = EXCLUDED.embedding_model_id,
                     updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [kb.id, kb.companyId, kb.createdBy, kb.visibility, kb.type, kb.name, kb.description, kb.embeddingModelId ?? null, kb.createdAt, kb.updatedAt],
    )
    return this.mapKnowledgeBase(result.rows[0])
  }

  async touchKnowledgeBase(kbId: string): Promise<void> {
    await this.pool.query("UPDATE knowledge_bases SET updated_at = $1 WHERE id = $2", [nowIso(), kbId])
  }

  async deleteKnowledgeBase(kbId: string): Promise<void> {
    await this.pool.query("DELETE FROM knowledge_bases WHERE id = $1", [kbId])
  }

  async saveSource(source: SourceDocument): Promise<SourceDocument> {
    const result = await this.pool.query<Row>(
      `INSERT INTO sources
         (id, company_id, kb_id, root, file_name, relative_path, parent_path, upload_batch_id, storage_key,
          content_type, size, sha256, status, folder_context, created_at, updated_at, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (company_id, kb_id, root, relative_path)
       DO UPDATE SET file_name = EXCLUDED.file_name,
                     parent_path = EXCLUDED.parent_path,
                     upload_batch_id = EXCLUDED.upload_batch_id,
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
        source.companyId,
        source.kbId,
        source.root,
        source.fileName,
        source.relativePath,
        source.parentPath,
        source.uploadBatchId ?? null,
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
         (id, company_id, kb_id, source_id, status, progress, stage, attempts, cached, created_at, updated_at,
          started_at, completed_at, cancelled_at, error, written_page_ids, analysis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
        job.companyId,
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
         (id, company_id, kb_id, path, title, page_type, content, sha256, sources, images, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
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
        page.companyId,
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
          "INSERT INTO wiki_links (company_id, kb_id, source_page_id, target_page_id, target_raw) VALUES ($1, $2, $3, $4, $5)",
          [link.companyId, link.kbId, link.sourcePageId, link.targetPageId, link.targetRaw],
        )
      }
    })
  }

  async listLinks(kbId: string): Promise<WikiLink[]> {
    const result = await this.pool.query<Row>("SELECT * FROM wiki_links WHERE kb_id = $1", [kbId])
    return result.rows.map((row) => ({
      companyId: String(row.company_id),
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
          `INSERT INTO page_sources (company_id, kb_id, page_id, source_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (kb_id, page_id, source_id) DO NOTHING`,
          [source.companyId, source.kbId, source.pageId, source.sourceId],
        )
      }
    })
  }

  async listPageSources(kbId: string): Promise<PageSource[]> {
    const result = await this.pool.query<Row>("SELECT * FROM page_sources WHERE kb_id = $1", [kbId])
    return result.rows.map((row) => ({
      companyId: String(row.company_id),
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
          `INSERT INTO page_chunks (id, company_id, kb_id, page_id, text, ordinal, tokens, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
          [chunk.id, chunk.companyId, chunk.kbId, chunk.pageId, chunk.text, chunk.ordinal, chunk.tokens, vectorLiteral(chunk.embedding)],
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
         (id, company_id, kb_id, source_id, page_id, storage_key, file_name, media_type, caption, origin, source_page, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        image.companyId,
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
         (id, company_id, kb_id, source_id, page_id, kind, title, description, action, query, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        review.companyId,
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
      `INSERT INTO chat_messages (id, company_id, kb_id, conversation_id, role, content, citations, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING *`,
      [message.id, message.companyId, message.kbId, message.conversationId, message.role, message.content, JSON.stringify(message.citations), message.createdAt],
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
    const companyId = await this.companyIdForKnowledgeBase(kbId)
    await this.pool.query(
      `INSERT INTO ingest_cache (company_id, kb_id, source_id, source_hash, page_ids, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (kb_id, source_id)
       DO UPDATE SET source_hash = EXCLUDED.source_hash,
                     page_ids = EXCLUDED.page_ids,
                     updated_at = EXCLUDED.updated_at`,
      [companyId, kbId, sourceId, sourceHash, pageIds, nowIso()],
    )
  }

  private async companyIdForKnowledgeBase(kbId: string): Promise<string> {
    const result = await this.pool.query<Row>("SELECT company_id FROM knowledge_bases WHERE id = $1", [kbId])
    const companyId = result.rows[0]?.company_id
    if (!companyId) throw new Error(`Knowledge base not found: ${kbId}`)
    return String(companyId)
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

  private mapCompanyModel(row: Row): CompanyModel {
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      name: String(row.name),
      provider: String(row.provider) as CompanyModel["provider"],
      protocol: normalizeModelProtocol(String(row.provider) as CompanyModel["provider"], String(row.protocol ?? "")),
      model: String(row.model),
      endpoint: String(row.endpoint ?? ""),
      apiKey: row.api_key ? String(row.api_key) : undefined,
      capabilities: textArray(row.capabilities) as CompanyModel["capabilities"],
      isDefaultLlm: Boolean(row.is_default_llm),
      isDefaultEmbedding: Boolean(row.is_default_embedding),
      isDefaultVision: Boolean(row.is_default_vision),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
  }

  private mapIdentity(row: Row): Identity {
    return {
      id: String(row.id),
      provider: String(row.provider) as Identity["provider"],
      providerSubject: String(row.provider_subject),
      username: String(row.username),
      displayName: String(row.display_name),
      email: row.email ? String(row.email) : undefined,
      passwordHash: row.password_hash ? String(row.password_hash) : undefined,
      isPlatformAdmin: Boolean(row.is_platform_admin),
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

  private mapApiKey(row: Row): UserApiKey {
    return {
      id: String(row.id),
      identityId: String(row.identity_id),
      companyId: String(row.company_id),
      name: String(row.name),
      keyHash: String(row.key_hash),
      keyHint: String(row.key_hint ?? ""),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
  }

  private mapKnowledgeBase(row: Row): KnowledgeBase {
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      createdBy: String(row.created_by ?? ""),
      visibility: String(row.visibility ?? "company") as KnowledgeBase["visibility"],
      type: "llm_wiki",
      name: String(row.name),
      description: String(row.description ?? ""),
      embeddingModelId: row.embedding_model_id ? String(row.embedding_model_id) : undefined,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
  }

  private mapSource(row: Row): SourceDocument {
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      kbId: String(row.kb_id),
      root: String(row.root ?? "raw") as SourceDocument["root"],
      fileName: String(row.file_name),
      relativePath: String(row.relative_path),
      parentPath: String(row.parent_path ?? ""),
      uploadBatchId: row.upload_batch_id ? String(row.upload_batch_id) : undefined,
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
      companyId: String(row.company_id),
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
      companyId: String(row.company_id),
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
      companyId: String(row.company_id),
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
      companyId: String(row.company_id),
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
      companyId: String(row.company_id),
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
      companyId: String(row.company_id),
      kbId: String(row.kb_id),
      conversationId: String(row.conversation_id),
      role: String(row.role) as ChatMessage["role"],
      content: String(row.content),
      citations: parseCitations(row.citations),
      createdAt: iso(row.created_at),
    }
  }
}
