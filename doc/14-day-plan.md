# KN Server — 14 天核心服务化开发计划

> 基于 [KN 企业改造方案](./kn-transformation-from-nashsu.md) Phase 1 路线图，
> 目标：将 nashsu/llm_wiki 核心链路在 Fastify 服务端跑通，Docker 一键部署。

| 天数 | 任务 | 关键动作 | 产出物 |
|:---:|---|------|---|
| D1 | **项目骨架搭建** | 初始化 `kn-server/`：Fastify + TypeScript + Vitest + ESLint + Dockerfile；建立目录结构（`lib/` `services/` `routes/` `test/`） | 项目模板可启动，单测框架就绪 |
| D2 | **存储抽象层** | 设计 `StorageProvider` 接口（`readFile/writeFile/deleteFile/listDirectory`）；实现 `LocalStorageProvider`；全模块注入替换 `@/commands/fs` | 18 个依赖模块统一通过 `ctx.storage` 访问文件 |
| D3 | **LLM 调用层移植** | 从 `src/lib/` 移植 `llm-providers.ts` + `llm-client.ts`；替换 `tauri-fetch.ts` → `undici`；封装 `LlmGateway`（provider 路由 + 速率限制） | OpenAI/Anthropic/Gemini/Ollama 全兼容 |
| D4 | **摄入管线 — 提示词移植** | 移植 `ingest.ts` 核心：`buildAnalysisPrompt()` + `buildGenerationPrompt()` + `parseFileBlocks()`；剥离 `tryReadFile` → `ctx.storage.readFile` | CoT 两步摄入提示词逻辑可运行 |
| D5 | **文本分块与嵌入** | 移植 `text-chunker.ts`（CJK bigram + English word）+ `embedding.ts`；对接 OpenAI text-embedding-3-small；剥离 Tauri `invoke()` | `EmbeddingService`：任意文本 → 向量 |
| D6 | **全文搜索 + 向量搜索** | 翻译 `search.rs` RRF 融合逻辑为 TS；PostgreSQL `tsvector`（含 `zhparser` CJK 分词）；pgvector `ivfflat` 索引；三类检索：关键词 / 语义向量 / RRF 融合 | `SearchService`：三合一混合检索 |
| D7 | **图谱引擎移植** | 移植 `graph-relevance.ts`（4 信号关联度）+ `wiki-graph.ts`（Louvain 社区检测 + `graphology` 内存版）；改数据源从 `ctx.storage` 读 wiki 页面 | `GraphService`：关联度矩阵 + 社区检测 + 惊奇连接 |
| D8 | **Lint 引擎移植** | 移植 `lint.ts` 7 项检查规则 + `review-utils.ts` + `sweep-reviews.ts`；改数据源从 PG 读取；新增企业检查骨架（权限一致性、合规检查） | `LintService`：健康分 + 问题清单 |
| D9 | **REST API 端点（上）** | 实现 Fastify 路由：`/health`、`/projects` CRUD、`/projects/:id/files`、`/projects/:id/search`；参考 `api_server.rs` 端点和错误格式 | 5 个基础端点可用 |
| D10 | **REST API 端点（下）** | 实现 `/projects/:id/ingest`（触发摄入）、`/projects/:id/chat`（RAG 对话）、`/projects/:id/lint`（健康检查）、`/projects/:id/graph`；增加请求限流（`@fastify/rate-limit`） | 4 个业务端点 + 限流 |
| D11 | **Docker Compose 一键部署** | 编写 `docker-compose.yml`：kn-server + PostgreSQL（pgvector）+ Redis；初始化 SQL 脚本（建表 + 扩展）；`.env.template` 环境变量模板 | `docker compose up -d` 即用 |
| D12 | **端到端集成测试** | 覆盖完整链路：源文件 → 摄入 → 搜索 → 图谱 → 对话；10 份测试文档（Markdown/PDF/URL）；Vitest 集成测试套件 | E2E 测试 100% 通过 |
| D13 | **Web UI 基础接入** | 剥离 nashsu 前端的 Tauri 组件，接入 KN REST API；文件树、Wiki 页面渲染、搜索框可用；Next.js 或 Vite dev server 验证 | 浏览器可浏览 wiki 页面 |
| D14 | **文档整理与演示** | 补全 `README.md`（架构图 + 快速开始）；API 文档（Scraper/Swagger）；准备演示数据（3 个知识域，每域 5+ 文档）；录制演示链路 | 可演示 MVP |
