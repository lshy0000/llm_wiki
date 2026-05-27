# Graph-first Retrieval Architecture

## 背景

这里讨论的是检索工具，不是最终查询 Agent。

最终查询 Agent 可以决定怎么拆问题、怎么调用工具、怎么组织答案；本层只负责在给定输入下快速返回可解释、可追溯的候选证据。检索路径中不调用生成式 LLM，也不做 query-time LLM keyword extraction。所有需要 LLM 的工作只能发生在写入/摄取阶段，例如抽取实体、关系、别名、页面和证据。

这条边界很重要：

- **检索**：确定性工具。输入 query / filters / optional external signals，输出 pages / chunks / sources / graph paths / scores / reasons。
- **查询**：面向任务的推理过程。由未来的查询 Agent 负责，可以多轮调用检索工具、读页面、做路径探索、再决定如何回答。

## 设计目标

1. 查询时不调用生成式 LLM。
2. 默认召回以图为核心，而不是 chunk 向量为核心。
3. 返回结果必须能落到 evidence：page、chunk、source、graph path。
4. 检索结果要可解释：每个结果带 signals 和 reasons。
5. 写入阶段可以重一些，查询阶段必须快。
6. Neo4j 作为图召回索引，Postgres 仍然是业务主库。

## 从 LightRAG 借鉴什么

[HKUDS/LightRAG](https://github.com/HKUDS/LightRAG) 的关键不是某个存储后端，而是索引对象从 chunk 提升到 entity / relationship：

- 写入时抽取实体和关系，形成知识图。
- 查询时先围绕实体和关系召回，再回到原文 chunk。
- local retrieval 解决具体实体邻域问题。
- global retrieval 解决主题、社区、全局模式问题。
- mix/hybrid 将图召回和文本/向量召回组合。

我们借鉴这套索引思想，但不照搬查询阶段的 LLM keyword extraction。我们的在线检索只能使用规则、索引、Cypher、SQL 和已存在的向量输入。

## 数据分层

### Postgres 主库

保存业务真相：

- companies / identities / auth
- knowledge_bases
- sources
- wiki_pages
- page_chunks
- page_sources
- image_assets
- ingest_jobs
- review_items
- chat_messages

Postgres 是事务和权限边界。

### Neo4j 图召回索引

保存可遍历知识结构：

```cypher
(:KnowledgeBase {id})
(:Source {id, kbId, path, fileName})
(:Page {id, kbId, title, path, type})
(:Chunk {id, kbId, pageId, ordinal, text, tokenHash})
(:Entity {id, kbId, name, normalized, type})
(:Alias {kbId, value, normalized})
(:Concept {id, kbId, name, normalized})
(:Community {id, kbId, label})
```

关系：

```cypher
(:Page)-[:DERIVED_FROM]->(:Source)
(:Page)-[:CONTAINS]->(:Chunk)
(:Page)-[:LINKS_TO {raw}]->(:Page)
(:Page)-[:MENTIONS {weight, evidenceIds}]->(:Entity)
(:Entity)-[:HAS_ALIAS]->(:Alias)
(:Entity)-[:RELATED_TO {kind, weight, evidenceIds}]->(:Entity)
(:Entity)-[:IN_COMMUNITY]->(:Community)
(:Page)-[:IN_COMMUNITY]->(:Community)
```

不要把所有共同 source 展开成 page-page 完全图。保留 `Page -> Source <- Page`，查询时按 source 扩展，避免大文档制造高噪声完全图。

当前实现已经支持 Neo4j 作为可选图索引。配置如下：

```env
KN_NEO4J_URI=bolt://127.0.0.1:7687
KN_NEO4J_USERNAME=neo4j
KN_NEO4J_PASSWORD=...
KN_NEO4J_DATABASE=
```

如果未配置 Neo4j，检索仍然使用 Postgres 中已经持久化的 `wiki_links`、`page_sources`、`sources` 做图召回。这是运行时健壮性兜底，不改变查询时零 LLM 的边界。

### 向量索引

向量用于补充召回，不作为唯一主路径。

查询时本层不主动调用 embedding 服务。如果调用方已经传入 `queryEmbedding`，检索工具可以使用 pgvector 做向量召回；否则跳过向量分支。

## 写入路径

```text
source uploaded
  -> parse document
  -> generate / update wiki pages
  -> split page chunks
  -> write Postgres
  -> write vector embeddings for chunks if embedding model configured
  -> extract entities / relations / aliases during ingest
  -> upsert Neo4j graph index
  -> update community / centrality / related caches asynchronously
```

允许 LLM 出现在写入阶段，因为这是构建索引，不是在线查询。写入阶段产物必须持久化，查询阶段只读这些产物。

## 在线检索路径

```text
query
  -> normalize / tokenize
  -> exact seed recall
  -> Neo4j graph local recall if configured
  -> Postgres graph fallback if Neo4j has no usable hit
  -> graph global recall
  -> lexical recall
  -> optional vector recall
  -> deterministic fusion
  -> evidence bundle
```

### 1. Exact Seed Recall

不需要 LLM：

- Page title exact / contains
- Page path / id
- Entity normalized name
- Alias normalized value
- Source file name
- Wikilink raw target
- CJK bigram / English token

输出 seed：

```ts
{
  id: string
  kind: "page" | "entity" | "source" | "chunk"
  score: number
  reasons: string[]
}
```

### 2. Graph Local Recall

围绕 seed 做 1-2 跳扩展。

当前在线实现优先使用 Neo4j：

```cypher
MATCH path = (seed)-[:LINKS_TO|DERIVED_FROM|CONTAINS*1..2]-(page:Page {kbId: $kbId})
```

这里刻意不走 `KnowledgeBase -> Page` 这类管理关系，避免把所有页面通过同一个 hub 连成噪声图。Neo4j 没有配置、不可用、或没有召回结果时，再用 Postgres 中的 direct wikilink、shared source、common neighbor 做确定性 fallback。

典型 Cypher：

```cypher
MATCH (seed {kbId: $kbId})
WHERE seed.id IN $seedIds
MATCH path = (seed)-[rels*1..2]-(n)
WHERE n:Page OR n:Chunk OR n:Source OR n:Entity
RETURN n, path
LIMIT $limit
```

打分信号：

- seed score
- hop distance
- relationship type weight
- relationship confidence
- evidence count
- page type weight
- source specificity

### 3. Graph Global Recall

适合“这个领域有什么”“围绕 X 的整体结构”这类召回。

当前基础版先完成 local graph retrieval；global graph retrieval 依赖 entity / relation / community 持久化，放在 Phase 3。

不由检索层判断最终意图；检索层只在 query 命中 broader tokens 或 seed 社区时返回 community evidence：

- seed 所在 community 的核心 page
- centrality 高的 page/entity
- bridge nodes
- sparse community / isolated page signals

### 4. Lexical Recall

用于保底和精确文本查找：

- title/path 权重高
- chunk text 权重中
- source file/folder 权重中
- image caption 权重中
- stop words 降权
- CJK bigram 支持中文

Postgres 阶段可以先用内存实现，后续换成 `tsvector` / trigram / zhparser。

### 5. Optional Vector Recall

只在调用方传入 `queryEmbedding` 时启用。

本层不根据用户 query 调 embedding 模型，因为这属于在线模型参与，会破坏检索工具的低延迟边界。

### 6. Fusion

使用确定性融合，不调用 LLM。

推荐初始权重：

| Signal | Weight |
|---|---:|
| exact title/path/id | 80 |
| entity/alias seed | 60 |
| direct wikilink | 35 |
| relation evidence | 30 |
| same source | 12 |
| community core | 10 |
| chunk lexical | 8 |
| vector | optional |

最终返回 `RetrievalHit`：

```ts
interface RetrievalHit {
  kind: "page" | "chunk" | "source" | "image"
  pageId?: string
  chunkId?: string
  sourceId?: string
  title: string
  path: string
  snippet: string
  score: number
  signals: Record<string, number>
  reasons: string[]
  graphPaths: Array<{
    nodes: Array<{ id: string; kind: string; label: string }>
    rels: Array<{ type: string; weight?: number }>
  }>
}
```

## Tool API

检索工具 API 不返回自然语言答案。

```http
POST /api/kbs/:kbId/search
```

输入：

```json
{
  "query": "模块负责人",
  "topK": 20,
  "mode": "graph",
  "queryEmbedding": [0.1, 0.2]
}
```

`queryEmbedding` 是可选的；如果没有，跳过向量分支。

输出：

```json
{
  "mode": "graph",
  "results": [],
  "diagnostics": {
    "seeds": 3,
    "graphHits": 12,
    "lexicalHits": 8,
    "vectorHits": 0,
    "graphBackend": "neo4j",
    "llmUsed": false
  }
}
```

重建 Neo4j 图索引：

```http
POST /api/kbs/:kbId/retrieval/reindex
```

该接口只把 Postgres 中的 pages / chunks / links / sources 同步到 Neo4j，不调用 LLM。需要公司管理员权限。

Agent-ready tool surface：

```http
GET /api/kbs/:kbId/tools
POST /api/kbs/:kbId/tools/:toolName/run
```

当前检索工具名是 `retrieve_kb`，它只返回结构化候选证据和 diagnostics，不生成答案。

`/api/kbs/:kbId/chat` 已重新开放，但不属于检索层本身；它调用 Agent 编排工具、生成答案并返回 citations / trace。详细设计见 `docs/plans/yuxi-style-agent-chat-architecture.md`。

## 实施阶段

### Phase 1: 无 LLM Retrieval Core（已实现）

- 抽出 `RetrievalService`。
- Search API 改为调用 retrieval core。
- 移除 query-time `embedForKnowledgeBase`。
- 基于现有 Postgres pages/chunks/links/sources 做图优先召回。
- 返回 signals / reasons / diagnostics。

### Phase 2: Neo4j 写入索引（已实现基础版）

- 新增 Neo4j driver 和配置。
- 启动时可同步已有知识库。
- 摄取完成后同步 Page / Source / Chunk / LINKS_TO / DERIVED_FROM。
- 查询优先读 Neo4j。
- Postgres 图召回作为 fallback。
- 提供 `/retrieval/reindex` 手动重建。

### Phase 3: Entity / Relation 索引（下一步）

- 摄取阶段持久化 entity / relation / alias。
- Neo4j fulltext index。
- local/global graph recall。
- community / centrality 预计算。

### Phase 4: Agent-ready Tool Surface（已实现第一组）

- `retrieve_kb`
- `get_mindmap`
- `list_kb_files`
- `read_kb_file`

后续补：

- `read_page`
- `read_chunk`
- `graph_neighbors`
- `graph_path`
- `source_trace`
- `community_overview`

这些都是纯工具，不负责最终回答。

### Phase 5: Agent Chat Main Path（已实现第一版）

- `POST /api/kbs/:kbId/chat` 是当前知识库 Agent 主路径。
- Agent 先调用确定性工具拿证据，再由 `LlmGateway` 生成最终自然语言答案。
- 返回 `answer`、`citations`、`trace`，其中 `trace` 是公开执行轨迹，不是隐藏思维链。
- 旧桌面本地 API `POST /api/v1/projects/{id}/chat` 不代表当前 Agent 主路径。

## 明确不做

- 检索工具不调用 LLM。
- 检索工具不做 LLM keyword extraction。
- 检索工具不生成最终答案。
- 不把 Neo4j 当业务主库。
- 不用向量替代图召回。
