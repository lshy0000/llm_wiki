CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT,
  is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS companies_one_default_idx
  ON companies (is_default)
  WHERE is_default;

CREATE TABLE IF NOT EXISTS company_members (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'org_admin', 'agent_admin', 'member')),
  status TEXT NOT NULL CHECK (status IN ('active')),
  joined_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (company_id, identity_id)
);

CREATE INDEX IF NOT EXISTS company_members_identity_idx ON company_members(identity_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES company_members(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_identity_idx ON auth_sessions(identity_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  data_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS knowledge_bases_company_updated_idx ON knowledge_bases(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  folder_context TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS sources_kb_path_idx ON sources(kb_id, relative_path);

CREATE TABLE IF NOT EXISTS ingest_jobs (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL,
  stage TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  cached BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  error TEXT,
  written_page_ids TEXT[] NOT NULL DEFAULT '{}',
  analysis TEXT
);

CREATE INDEX IF NOT EXISTS ingest_jobs_kb_created_idx ON ingest_jobs(kb_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ingest_jobs_status_created_idx ON ingest_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT NOT NULL,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  page_type TEXT NOT NULL,
  content TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  sources TEXT[] NOT NULL DEFAULT '{}',
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (kb_id, id)
);

CREATE INDEX IF NOT EXISTS wiki_pages_kb_path_idx ON wiki_pages(kb_id, path);
CREATE INDEX IF NOT EXISTS wiki_pages_kb_type_idx ON wiki_pages(kb_id, page_type);

CREATE TABLE IF NOT EXISTS wiki_links (
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_page_id TEXT NOT NULL,
  target_page_id TEXT NOT NULL,
  target_raw TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS wiki_links_kb_source_idx ON wiki_links(kb_id, source_page_id);
CREATE INDEX IF NOT EXISTS wiki_links_kb_target_idx ON wiki_links(kb_id, target_page_id);

CREATE TABLE IF NOT EXISTS page_sources (
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (kb_id, page_id, source_id)
);

CREATE TABLE IF NOT EXISTS page_chunks (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  text TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  tokens TEXT[] NOT NULL DEFAULT '{}',
  embedding vector
);

CREATE INDEX IF NOT EXISTS page_chunks_kb_page_idx ON page_chunks(kb_id, page_id);

CREATE TABLE IF NOT EXISTS image_assets (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page_id TEXT,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  caption TEXT NOT NULL,
  origin TEXT NOT NULL,
  source_page INTEGER,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS image_assets_kb_idx ON image_assets(kb_id);
CREATE INDEX IF NOT EXISTS image_assets_source_idx ON image_assets(source_id);

CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_id TEXT,
  page_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  action TEXT,
  query TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS review_items_kb_created_idx ON review_items(kb_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages(kb_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ingest_cache (
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  page_ids TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (kb_id, source_id)
);
