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

CREATE INDEX IF NOT EXISTS user_api_keys_identity_company_idx
  ON user_api_keys(identity_id, company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS user_api_keys_key_hash_uidx
  ON user_api_keys(key_hash);

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES identities(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'company' CHECK (visibility IN ('company', 'creator_only')),
  type TEXT NOT NULL DEFAULT 'llm_wiki' CHECK (type = 'llm_wiki'),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  embedding_model_id TEXT REFERENCES company_models(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS knowledge_bases_company_updated_idx ON knowledge_bases(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  root TEXT NOT NULL DEFAULT 'raw' CHECK (root IN ('raw', 'wiki')),
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  parent_path TEXT NOT NULL DEFAULT '',
  upload_batch_id TEXT,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL CONSTRAINT sources_status_check CHECK (status IN ('uploaded', 'queued', 'parsing', 'ingested', 'failed', 'cancelled')),
  ingest_required BOOLEAN NOT NULL DEFAULT TRUE,
  folder_context TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS sources_kb_path_idx ON sources(kb_id, relative_path);
CREATE INDEX IF NOT EXISTS sources_kb_ingest_status_idx ON sources(kb_id, root, ingest_required, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS sources_kb_ingest_backlog_idx ON sources(kb_id, updated_at DESC)
  WHERE root = 'raw' AND ingest_required AND status IN ('uploaded', 'failed', 'cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS sources_scope_path_uidx ON sources(company_id, kb_id, root, relative_path);

CREATE TABLE IF NOT EXISTS ingest_tasks (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('source_ingest')),
  title TEXT NOT NULL,
  upload_batch_id TEXT,
  status TEXT NOT NULL CONSTRAINT ingest_tasks_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL CONSTRAINT ingest_tasks_progress_check CHECK (progress >= 0 AND progress <= 100),
  stage TEXT NOT NULL,
  source_ids TEXT[] NOT NULL DEFAULT '{}',
  job_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS ingest_tasks_kb_created_idx ON ingest_tasks(kb_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ingest_tasks_company_created_idx ON ingest_tasks(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ingest_tasks_status_created_idx ON ingest_tasks(status, created_at);

CREATE TABLE IF NOT EXISTS ingest_jobs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES ingest_tasks(id) ON DELETE SET NULL,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL CONSTRAINT ingest_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL CONSTRAINT ingest_jobs_progress_check CHECK (progress >= 0 AND progress <= 100),
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
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS task_id TEXT REFERENCES ingest_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ingest_jobs_task_idx ON ingest_jobs(task_id);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
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
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_page_id TEXT NOT NULL,
  target_page_id TEXT NOT NULL,
  target_raw TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS wiki_links_kb_source_idx ON wiki_links(kb_id, source_page_id);
CREATE INDEX IF NOT EXISTS wiki_links_kb_target_idx ON wiki_links(kb_id, target_page_id);

CREATE TABLE IF NOT EXISTS page_sources (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (kb_id, page_id, source_id)
);

CREATE TABLE IF NOT EXISTS page_chunks (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  text TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  tokens TEXT[] NOT NULL DEFAULT '{}',
  embedding vector
);

CREATE INDEX IF NOT EXISTS page_chunks_kb_page_idx ON page_chunks(kb_id, page_id);
CREATE INDEX IF NOT EXISTS page_chunks_tokens_gin_idx ON page_chunks USING GIN(tokens);

CREATE TABLE IF NOT EXISTS image_assets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
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
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
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
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages(kb_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('kb_dedicated', 'configurable')),
  title TEXT NOT NULL,
  created_by TEXT REFERENCES identities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_conversations_kb_updated_idx ON agent_conversations(kb_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_conversations_company_updated_idx ON agent_conversations(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  assistant_message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('kb_dedicated', 'configurable')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  model_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS agent_runs_conversation_started_idx ON agent_runs(kb_id, conversation_id, started_at);
CREATE INDEX IF NOT EXISTS agent_runs_status_started_idx ON agent_runs(status, started_at);

CREATE TABLE IF NOT EXISTS agent_run_steps (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('plan', 'tool', 'observation', 'answer', 'error')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  tool_name TEXT,
  latency_ms INTEGER,
  input JSONB,
  output_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (run_id, ordinal)
);

CREATE INDEX IF NOT EXISTS agent_run_steps_run_ordinal_idx ON agent_run_steps(run_id, ordinal);

CREATE TABLE IF NOT EXISTS ingest_cache (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  page_ids TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (kb_id, source_id)
);
