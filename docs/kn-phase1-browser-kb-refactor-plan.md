---
title: "KN Phase 1：浏览器知识库服务化重构计划"
date: 2026-05-26
tags: ["KN", "重构计划", "服务化", "Fastify", "浏览器知识库"]
summary: "从当前 Tauri 桌面版源码出发，制定第一阶段单体服务端改造计划：浏览器中新建知识库、上传文档、查看文件目录和知识结构、查看图谱，并支持简单问答或召回。"
---

# KN Phase 1：浏览器知识库服务化重构计划

## 0. 结论

第一阶段不要做“企业级平台”，而是先做一个能跑通完整闭环的浏览器知识库单体服务端：

```
Browser Web UI
  -> Fastify REST API
  -> ProjectService / SourceService / IngestService / RetrievalService / SearchService / GraphService / ToolService / AgentService / LintService
  -> StorageProvider + IndexRepository + LlmGateway
```

用户闭环只验收 6 件事：

1. 在浏览器中新建知识库。
2. 在知识库里上传文档。
3. 查看原始文件目录。
4. 查看 LLM 生成后的知识库结构。
5. 查看知识图谱。
6. 做简单问答或召回，并能看到引用来源。

核心策略是：保留 llm_wiki 的高价值领域逻辑，替换桌面基础设施。第一阶段的重点不是把所有企业组件一次性接上，而是把核心链路从 Tauri/WebView/Rust invoke 中拆出来，放到可独立运行的服务端边界里。

## 1. 当前源码判断

| 产品能力 | 当前实现 | 问题 | 第一阶段目标 |
|---|---|---|---|
| 新建知识库 | `create-project-dialog.tsx` 调 Tauri `create_project`，Rust 创建本地目录和模板 | 知识库等同用户本地目录，不能作为服务端资源管理 | `ProjectService.createKnowledgeBase()` 创建服务端知识库记录、默认模板、存储根目录 |
| 上传文档 | `SourcesView` 选择本地文件，`source-lifecycle.ts` 复制到 `raw/sources`，再进 `ingest-queue.ts` | 依赖 Tauri dialog、本地文件复制、前端队列 | `POST /sources` multipart 上传，服务端保存 source 并创建 ingest job |
| 文档解析 | Rust `fs.rs` 的 `read_file/preprocess_file` 负责 PDF/Office/文本化 | 解析能力耦合 Tauri command | 抽 `DocumentParser`，MVP 先支持 md/txt/pdf/docx，后续补齐 Office/HTML/音视频 |
| 摄入 | `ingest.ts` 两步 CoT、FILE/REVIEW blocks 解析、写 wiki、review、embedding | 核心优秀，但直接读写 `@/commands/fs` 和前端 store | 移植为 `IngestService`，注入 Storage/Repository/LLM，不直接依赖 UI store |
| 文件目录 | `FileTree` 调 `listDirectory(project.path)` 扫本地目录 | 浏览器不能读用户本地工程目录 | `FileService` 从 `StorageProvider` 返回 raw/wiki 目录树 |
| 知识结构 | `KnowledgeTree` 扫 `wiki/*.md` 解析 frontmatter/type/title | 每次扫描 markdown，缺少服务端索引 | 写入/更新 wiki 页时同步 `wiki_pages` 索引，树从索引生成 |
| 搜索 | TS `search.ts` 调 Rust `search_project`，Rust WalkDir 扫 wiki + LanceDB + RRF | 检索绑定本地文件扫描和嵌入式 LanceDB | `SearchService` 从索引库召回，保留 tokenizer/RRF；向量后端第一阶段做接口，第二阶段接 pgvector |
| 图谱 | `wiki-graph.ts` 扫 wiki，`graph-relevance.ts` 4 信号，graphology Louvain | 算法好，但数据源是 markdown 扫描和内存图 | `GraphService` 从 page/link/source 索引读数据，第一阶段仍可内存计算 Louvain，第二阶段接 Neo4j |
| 问答 | `chat-panel.tsx` 在前端做 RAG 编排，再直接 `streamChat`；旧 Rust 本地 API 的 chat 槽位未承载主流程 | 业务逻辑在 UI，桌面本地 API 不适合作为知识库 Agent 主入口 | `AgentService` 通过 `ToolService` 编排 `retrieve_kb` / `get_mindmap` / `read_kb_file`，最后生成答案并返回 citations / trace |
| Lint/Review | `lint.ts` 扫 markdown，review 存 Zustand + `.llm-wiki/review.json` | 结果和状态在前端/本地 JSON | `LintService` + `ReviewRepository` 服务端化 |
| HTTP API | Rust `api_server.rs` tiny_http，提供 health/files/search/graph/rescan，chat 未实现 | 只是桌面伴生 API，不适合继续扩 | 用 Fastify 重建 API，不在 tiny_http 上继续堆功能 |

## 2. 第一阶段边界

### 必须保留

- 两步 CoT 摄入：`buildAnalysisPrompt()` + `buildGenerationPrompt()`。
- FILE/REVIEW blocks 解析、安全路径限制、页面合并和 review 生成。
- wiki 页面生成范式：`entities/concepts/sources/queries/comparisons/synthesis`。
- 4 信号图谱关联：直接链接、共同来源、共同邻居、类型亲和。
- Louvain 社区检测。
- RRF 混合检索的排序思想。
- context budget 组装方式。
- structural lint + semantic lint。
- `llm-providers.ts` 的 provider 配置和消息格式能力。

### 必须替换

- Tauri/Rust invoke 作为业务边界。
- Tauri dialog、plugin-store、plugin-http、event listener。
- 用户本地项目目录作为应用状态源。
- 前端内存/本地 JSON 队列。
- Rust `tiny_http` API。
- 请求时 WalkDir 扫 markdown 作为搜索/图谱主数据源。
- WebView 内的 RAG orchestration。

### 暂不进入主线

- 多模态图片能力：按 `plans/multimodal-images.md` 独立推进，未来作为 `DocumentParser` 和 `IngestService` 的扩展输入。
- 多租户、JWT/RBAC、SSO、审计。
- Redis/BullMQ、MinIO、Neo4j、PostgreSQL/pgvector 的生产化部署。
- MCP Server。
- 实时协同编辑。

## 3. 目标架构

```
Browser
  |
  | REST / SSE
  v
Fastify App
  |
  +-- ProjectService       知识库创建、列表、配置
  +-- SourceService        上传、解析、source 状态
  +-- IngestService        两步 CoT、wiki 页面生成、review、索引更新
  +-- SearchService        关键词召回、向量接口、RRF 融合
  +-- RetrievalService     查询时零 LLM 的图优先召回核心
  +-- GraphService         link 图、4 信号权重、Louvain、图谱 API
  +-- ToolService          Agent 可调用的确定性工具注册表
  +-- AgentService         工具编排、最终回答、引用来源、执行 trace
  +-- LintService          结构/语义 lint、review 写入
  +-- LlmGateway           provider 路由，服务端 fetch/undici
  |
  +-- StorageProvider      raw/wiki/media 文件存储抽象
  +-- IndexRepository      pages/links/chunks/jobs/reviews 索引仓储
```

第一阶段允许使用单进程和本机存储，但必须是“服务端管理的存储”，不是“用户选择一个本地文件夹后前端直接扫”。这一区别很重要：

- 可以使用 `LocalStorageProvider` 保存上传文件和生成的 markdown。
- 可以使用 SQLite 或轻量 SQL 索引库保存 page/link/chunk/job/review 元数据。
- 不要让 SearchService/GraphService 在请求路径里重新 WalkDir 扫整棵 wiki。
- 数据访问必须经过 Repository 接口，给第二阶段 PostgreSQL/pgvector/Neo4j 留替换点。

## 4. 建议目录结构

```
kn-server/
  package.json
  src/
    app.ts
    config/
    routes/
      knowledge-bases.ts
      sources.ts
      files.ts
      search.ts
      graph.ts
      chat.ts
      lint.ts
    services/
      project-service.ts
      source-service.ts
      ingest-service.ts
      retrieval-service.ts
      search-service.ts
      graph-service.ts
      tool-service.ts
      tool-config-service.ts
      agent-service.ts
      lint-service.ts
      llm-gateway.ts
    providers/
      storage-provider.ts
      local-storage-provider.ts
      document-parser.ts
    repositories/
      index-repository.ts
      sqlite-index-repository.ts
    domain/
      wiki-page.ts
      source-document.ts
      graph.ts
      search.ts
    migrations/
      001_initial.sql
  tests/
```

不要把服务端代码混在 `src/components` 或 Tauri command 下面。当前 `src/lib` 中的纯逻辑可以迁移或复制到 `kn-server/src/domain` / `kn-server/src/services`，迁移时先切断 `@/commands/fs`、Zustand store、Tauri import。

## 5. 核心接口

### 5.1 StorageProvider

```ts
export interface StorageProvider {
  writeObject(input: {
    kbId: string
    key: string
    content: Buffer | string
    contentType?: string
  }): Promise<void>

  readObject(input: {
    kbId: string
    key: string
  }): Promise<Buffer>

  deleteObject(input: {
    kbId: string
    key: string
  }): Promise<void>

  listObjects(input: {
    kbId: string
    prefix: string
  }): Promise<Array<{
    key: string
    size: number
    updatedAt: string
    isDirectory: boolean
  }>>
}
```

第一阶段 `LocalStorageProvider` 负责落盘。第二阶段可以替换成 MinIO/S3，不影响 Ingest/Search/Graph 的业务代码。

### 5.2 IndexRepository

索引库至少保存这些数据：

| 表/集合 | 用途 |
|---|---|
| `knowledge_bases` | 知识库元数据、名称、描述、配置 |
| `sources` | 上传文件、解析状态、hash、source identity |
| `ingest_jobs` | 摄入任务状态、错误、耗时、写入页面 |
| `wiki_pages` | wiki 页路径、title、type、frontmatter、content hash |
| `wiki_links` | wikilink 出入边，供图谱和召回扩展 |
| `page_sources` | wiki 页和原始 source 的来源关系 |
| `chunks` | 页面 chunk、关键词索引字段、embedding 占位字段 |
| `graph_edges` | 预计算权重，或 GraphService 缓存结果 |
| `reviews` | FILE/REVIEW、lint、人工处理状态 |
| `chat_conversations` / `chat_messages` | 简单问答历史，可后置但接口要预留 |

迁移脚本使用 SQL 文件，不引入 Alembic。

## 6. REST API 草案

| API | 说明 |
|---|---|
| `GET /api/health` | 服务健康检查 |
| `POST /api/kbs` | 新建知识库 |
| `GET /api/kbs` | 知识库列表 |
| `GET /api/kbs/:kbId` | 知识库详情 |
| `PATCH /api/kbs/:kbId` | 更新名称、purpose、schema 或配置 |
| `POST /api/kbs/:kbId/sources` | 上传文档，返回 source 和 job |
| `GET /api/kbs/:kbId/sources` | 查看 source 列表和解析/摄入状态 |
| `POST /api/kbs/:kbId/sources/:sourceId/ingest` | 手动重跑摄入 |
| `GET /api/kbs/:kbId/jobs/:jobId` | 查询摄入任务状态 |
| `GET /api/kbs/:kbId/files?root=raw|wiki` | 文件目录树 |
| `GET /api/kbs/:kbId/wiki/tree` | 知识结构树，按 type/title 分组 |
| `GET /api/kbs/:kbId/wiki/pages/:pageId` | 页面内容 |
| `POST /api/kbs/:kbId/search` | 简单召回，返回页面、片段、分数 |
| `GET /api/kbs/:kbId/graph` | 图谱节点、边、社区 |
| `POST /api/kbs/:kbId/chat` | Agent 问答，返回 `answer`、`citations`、公开 `trace` |
| `POST /api/kbs/:kbId/lint` | 运行 lint |
| `GET /api/kbs/:kbId/reviews` | review/lint 问题列表 |
| `PATCH /api/kbs/:kbId/reviews/:reviewId` | resolve/dismiss/reopen |

第一阶段可以不做认证，但 API 形状不要把单用户假设写死。即使只有一个用户，也用 `kbId` 作为所有资源的边界。

## 7. 服务拆分计划

### 7.1 ProjectService

目标：让“知识库”成为服务端资源，而不是一个本地目录。

输入：名称、描述、可选模板配置。

输出：`kbId`、默认 `purpose.md`、`schema.md`、`wiki/index.md`、`wiki/overview.md`。

复用点：

- Rust `create_project` 中的目录结构和模板内容。
- `src/lib/templates.ts` 中的前端模板逻辑。

改造点：

- 不暴露真实本地路径给浏览器。
- 文件写入必须走 `StorageProvider`。
- 知识库记录必须写入 `knowledge_bases`。

### 7.2 SourceService + DocumentParser

目标：浏览器上传文档后，服务端保存、解析、排队摄入。

第一阶段支持顺序：

1. `.md` / `.txt`
2. `.pdf`
3. `.docx`
4. `.pptx` / `.xlsx` / `.html` 后续补齐

复用点：

- `source-lifecycle.ts` 的 source identity、扩展名过滤、删除级联思路。
- Rust `fs.rs` 的解析行为作为对照。

改造点：

- Tauri dialog 删除，换 multipart upload。
- `raw/sources` 改成服务端 storage key。
- 解析结果写 `sources.parsed_text` 或对应 object key。
- 删除 source 时要清理 page_sources、reviews、chunks、links。

### 7.3 IngestService

目标：把当前最有价值的“读文档 -> 两步 CoT -> 写 wiki -> review -> 索引”搬到服务端。

保留：

- `autoIngest` 的两阶段思路。
- `buildAnalysisPrompt`、`buildGenerationPrompt`。
- `parseFileBlocks`、`isSafeIngestPath`。
- FILE/REVIEW block 合约。
- 页面 merge、index/log 更新、review 生成。
- reasoning model 禁用策略。

替换：

- `readFile/writeFile/listDirectory` 改为 `StorageProvider` + `IndexRepository`。
- `useWikiStore/useReviewStore/useActivityStore` 改为显式 service 参数和 repository。
- `.llm-wiki/ingest-cache.json` 改为 `ingest_jobs` / `ingest_cache` 表。
- `ingest-queue.ts` 改为服务端 job runner。第一阶段可以单进程串行，但必须持久化 job 状态。

摄入完成后必须触发索引更新：

1. upsert `wiki_pages`
2. extract frontmatter
3. extract wikilinks -> `wiki_links`
4. extract sources -> `page_sources`
5. chunk page -> `chunks`
6. optionally embedding -> vector provider
7. invalidate graph/search cache

### 7.4 SearchService

目标：让召回从“扫描本地 markdown + LanceDB”变成“查询服务端索引”。

第一阶段能力：

- 关键词 tokenizer 复用当前 CJK bigram + English word。
- 查询 `wiki_pages` / `chunks` 的索引字段。
- 保留 title match boost。
- 保留 RRF 合并接口。
- embedding provider 可以先做可选能力；没有 embedding 时退化为 keyword search。

关键约束：

- 不允许 SearchService 每次请求 WalkDir 扫 wiki。
- 搜索结果必须返回 page id/path/title/snippet/score/sourceRefs。
- 向量检索接口先抽象为 `VectorIndexProvider`，第二阶段接 pgvector。

第二阶段替换：

- keyword -> PostgreSQL `tsvector` / `pg_trgm` / 中文分词方案。
- vector -> pgvector。
- rerank -> 可选 cross-encoder。

### 7.5 GraphService

目标：图谱算法复用，数据源改为索引库。

第一阶段数据来源：

- 节点：`wiki_pages`
- 边：`wiki_links`
- 来源重叠：`page_sources`
- 类型：`wiki_pages.type`

保留：

- 4 信号权重：direct link、source overlap、common neighbor、type affinity。
- Louvain community detection。
- GraphView 需要的 nodes/edges/communities 数据结构。

改造：

- `buildRetrievalGraph(projectPath)` 改成 `buildRetrievalGraph(kbId)`。
- 不从 markdown 文件系统重建节点。
- 图谱可以在内存中计算，但输入必须来自 `IndexRepository`。
- 写入 wiki 页面时增量更新 links/sources；GraphService 只负责计算和缓存。

第二阶段替换：

- Neo4j 持久化边和节点。
- 4 信号可预计算到关系属性。
- Louvain 可迁移到 Neo4j GDS，或继续导出子图到 graphology 计算。

### 7.6 AgentService

目标：把 `chat-panel.tsx` 里的 RAG 编排搬到服务端，并改成 Agent 使用工具的主路径。

服务端流程：

1. 接收 question、kbId、conversationId。
2. 判断 greeting，必要时跳过召回。
3. 调 `retrieve_kb` 做图优先召回。
4. 对结构型问题可调 `get_mindmap`。
5. 首次召回弱且有 embedding 模型时，补一次带 `queryEmbedding` 的召回。
6. 对需要精确证据的问题调 `read_kb_file`。
7. 命中 `agentEnabled` 且 triggers 匹配的自定义 HTTP 工具时，自动补充外部证据。
8. 调 `LlmGateway.completeForCompany()` 生成最终答案；无可用 LLM 时返回基于召回证据的 fallback。
9. 返回 `answer`、`citations`、公开 `trace`。
10. 保存 user/assistant chat message 和引用页。

不要让浏览器自己读 wiki 页面、自己拼 prompt、自己调 LLM。浏览器只负责展示消息、引用和执行 trace。

### 7.7 LintService

目标：把结构 lint 和语义 lint 服务端化。

第一阶段：

- structural lint 从 `wiki_pages/wiki_links` 计算 orphan、broken-link、no-outlinks。
- semantic lint 复用 `runSemanticLint` 的 prompt 逻辑，但输入来自 repository。
- lint 结果写 `reviews`。

后续：

- 加 stale source、contradiction、duplicate page、missing citation 等规则。
- lint 任务可以接入 BullMQ。

## 8. 前端改造方向

当前 React 组件可以继续复用布局和交互，但数据边界必须换成 REST API。

| 当前组件/模块 | 第一阶段改造 |
|---|---|
| `WelcomeScreen` / `CreateProjectDialog` | 改为创建/打开服务端知识库，不再选择本地路径 |
| `SourcesView` | 改为文件上传组件，展示 source/job 状态 |
| `FileTree` | 调 `GET /files` |
| `KnowledgeTree` | 调 `GET /wiki/tree` |
| `GraphView` | 调 `GET /graph`，保留 sigma.js 渲染 |
| `SearchView` | 调 `POST /search` |
| `ChatPanel` | 只保留 UI 状态和响应展示，RAG/工具编排移入 `AgentService` |
| `LintView` / `ReviewView` | 调 lint/review API |
| `project-store.ts` | 删除 Tauri Store 依赖，改服务端 KB 列表 |
| `tauri-fetch.ts` | 浏览器端不再用于 LLM；服务端用 undici/fetch |

前端迁移完成的标志：浏览器构建不再需要 `@tauri-apps/*` 才能跑通核心知识库流程。

## 9. 里程碑

### M0：服务端骨架

交付：

- `kn-server` Fastify + TypeScript。
- `GET /api/health`。
- 统一错误结构、日志、配置加载。
- SQL migration 机制。
- Vitest 基础测试环境。

验收：

- `npm run dev` 启动服务。
- health API 可访问。

### M1：知识库和存储

交付：

- `StorageProvider` + `LocalStorageProvider`。
- `IndexRepository` 初版。
- `ProjectService`。
- `POST /api/kbs`、`GET /api/kbs`、`GET /api/kbs/:kbId`。
- 默认 schema/purpose/index/overview 写入 storage 和索引。

验收：

- 浏览器能新建知识库。
- 不需要 Tauri，不需要选择本地目录。

### M2：上传和基础摄入

交付：

- multipart 上传。
- `SourceService`。
- `DocumentParser` 初版。
- 持久化 ingest job。
- `IngestService` 移植两步 CoT、FILE/REVIEW blocks 解析和 wiki 写入。

验收：

- 上传一个 md/txt/pdf/docx 后，服务端生成 wiki 页面。
- 可以查询 job 状态。
- 生成页面写入 `wiki_pages/wiki_links/page_sources`。

### M3：目录、知识结构、lint/review

交付：

- `GET /files` 返回 raw/wiki 目录树。
- `GET /wiki/tree` 返回按类型分组的知识结构。
- `LintService` 初版。
- review API。

验收：

- 浏览器能看到上传文件目录。
- 浏览器能看到生成后的知识结构。
- lint/review 能列出并处理问题。

### M4：搜索和图谱

交付：

- `SearchService` keyword search + RRF 接口。
- `GraphService` 从索引库构图。
- 4 信号权重和 Louvain 社区。
- `POST /search`、`GET /graph`。

验收：

- 浏览器能搜索到 wiki 页面和片段。
- 浏览器能看到图谱节点、边、社区。
- Search/Graph 请求路径不扫描本地 markdown。

### M5：问答闭环

交付：

- `AgentService`。
- `POST /api/kbs/:kbId/chat` 返回 answer / citations / trace。
- `retrieve_kb` + `get_mindmap` + `read_kb_file` 工具编排。
- 弱召回 embedding retry + LLM fallback。
- chat history 存储。

验收：

- 用户能基于知识库简单问答。
- 回答只基于召回页面。
- 返回引用页，前端能展示来源。
- greeting 不触发完整召回。

### M6：浏览器 UI 主流程替换

交付：

- 前端核心流程从 Tauri command 切 REST API。
- 新建知识库、上传、目录、知识结构、搜索、图谱、问答可在浏览器完成。

验收：

- 不启动 Tauri app，只启动 Web UI + Fastify server，也能完成 MVP 闭环。

## 10. 关键决策

### 10.1 第一阶段用什么数据库

建议：第一阶段使用 SQLite 作为单体服务端索引库，配合本地 `LocalStorageProvider`。

理由：

- 不引入 PostgreSQL/Redis/Neo4j/MinIO 运维负担。
- 又能避免继续依赖请求时文件扫描。
- SQL schema 能平滑迁移到 PostgreSQL。
- job/review/page/link/chunk 都能先有稳定 repository 边界。

如果团队坚持第一阶段连 SQLite 都不引入，可以退到 JSON index，但这会削弱“搜索/图谱数据源从扫描转索引”的目标，不建议。

### 10.2 第一阶段是否做向量检索

建议：接口先做，能力可分两步。

第一步：

- keyword search + title boost + RRF 接口形状。
- chunk 表保存文本和 metadata。
- embedding 配置、向量字段、provider 接口预留。

第二步：

- 接入本地 embedding provider。
- 临时 flat vector search 或直接进入 pgvector。

不要继续依赖 Rust LanceDB 作为主线，否则服务化边界会被拉回 Tauri/Rust。

### 10.3 第一阶段图谱是否用 Neo4j

不建议。第一阶段 GraphService 可以继续用 graphology/Louvain 计算，但不能从 markdown 文件扫描输入。输入必须来自索引库。

这能保留算法价值，又不提前引入 Neo4j 运维和模型迁移成本。第二阶段再把节点/边/权重写入 Neo4j。

### 10.4 是否继续扩 Rust tiny_http API

不建议。Rust `tiny_http` API 是桌面伴生接口，graph 也是简版 wikilink graph，不包含 4 信号和 Louvain。当前 Agent 聊天主路径已经放到 Fastify `POST /api/kbs/:kbId/chat`；继续扩旧本地 API 会把目标拉回“桌面伴生服务”，不是浏览器知识库服务端。

### 10.5 多模态图片什么时候做

不进服务化主线。多模态图片应作为 `DocumentParser` 的扩展能力接入：

- 图片提取：source parsing 阶段。
- caption：ingest 前增强 source context。
- 图片索引：search/chunk 的扩展字段。

它有独立成本、独立风险和独立验收，应沿 `plans/multimodal-images.md` 单独排期。

## 11. 风险和控制

| 风险 | 控制 |
|---|---|
| 摄入逻辑和 UI/store 耦合太深 | 先抽纯函数和依赖接口，再移植 service；禁止在 service 中 import Zustand |
| 文档解析能力短期不如 Rust | MVP 明确格式范围；复杂 Office/音视频放后续 parser worker |
| 搜索效果下降 | 保留 tokenizer、title boost、RRF；建立小样本回归用例 |
| 图谱请求变慢 | 页面写入时维护 `wiki_links/page_sources`；GraphService 缓存按 dataVersion 失效 |
| LLM 调用从浏览器迁移到服务端后 provider 差异 | `LlmGateway` 复用 `llm-providers.ts`，fetch 改为 undici |
| 多会话同时改代码 | 每个里程碑只改对应边界，不做顺手重构；文档、服务端、前端迁移分提交 |
| 过早企业化 | Phase 1 不上多租户、JWT/RBAC、Neo4j、BullMQ、MinIO、MCP |

## 12. 完成定义

Phase 1 完成时，应该能做到：

- 用户打开浏览器页面，不启动 Tauri，也能新建知识库。
- 用户上传文档后，服务端生成 wiki 页面。
- 用户能看到 raw 文件目录和 wiki 知识结构。
- 用户能看到图谱，图谱有权重和社区。
- 用户能搜索或提问，回答基于召回页面并返回引用。
- ingest/search/graph/chat/lint 都在 Fastify 服务端执行。
- 核心服务不 import `@tauri-apps/*`，不 import `@/commands/fs`，不依赖 Zustand store。
- 搜索和图谱的数据源来自服务端索引，而不是请求时扫描本地 markdown。

这时再进入 Phase 2：PostgreSQL/pgvector、Neo4j、Redis/BullMQ、MinIO、多租户、JWT/RBAC、MCP Server。
