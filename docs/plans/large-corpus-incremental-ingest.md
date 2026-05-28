# 大库增量摄入架构计划

## 背景

这里的“大库”不是一次上传几万份文件，而是知识库长期累计到几万份 source。真正危险的是：总量变大后，每次新增或修改 1 个文件都触发全库扫描、全库上下文、全库链接和图谱重建。

目标是让单次摄入成本稳定在：

```text
O(当前变更文件 + 少量相关页面)
```

而不是：

```text
O(知识库全部 source/page/chunk)
```

## 现状

后端当前摄入链路在 `backend/src/ingest-service.ts`：

- 每个 job 只处理一个 source，队列串行，稳定但吞吐有限。
- `ingest_cache` 已经按 source hash 跳过未变化文件。
- 每次生成阶段会读取现有 wiki page catalog。
- 每次写入后会重建 `wiki/index.md`、重建页面链接，并在 Neo4j 开启时同步整库图谱。

主要风险：

- `SourceWatchService` 每 5 秒扫描所有 KB，并对每个 KB 做 `listSources + listTree(raw)`。
- 摄入单文件时 `listPages(kbId)` 会把全库页面作为上下文候选。
- `rebuildIndexPage` 每次按全库 page 重写 index。
- `rebuildPageLinks` 在原路径下按全库 page 重建 links。
- `syncGraphIndexForKnowledgeBase` 会构造全量 graph snapshot。

这些在小库合理，在总量几万后会让小变更被全库规模拖慢。

## 阈值策略

以 source 数量作为切换条件：

```text
source_count > 150 -> large-corpus incremental mode
source_count <= 150 -> full mode
```

150 是工程阈值，不是业务语义。它的作用是尽早暴露大库路径问题，避免等到几万文件才发现全库操作已经写死在主流程里。

## 大库摄入路径

### 1. 只选相关上下文

大库模式下，LLM 不再接收全库 page catalog，而是接收 related page catalog。

相关页来源：

- source 文件名
- source relative path
- folder context
- 解析出的正文前段
- 已有 `page_chunks.tokens`
- 可用时叠加 embedding 向量检索

默认只取前 50 个相关页面。LLM prompt 必须知道这是“相关子集”，不能假设它看到了全库。

### 2. 只更新 touched pages

本次 LLM 写出的页面称为 touched pages。大库模式下只对 touched pages 做：

- page upsert
- page_sources replace
- page_chunks replace
- wiki_links replace

链接解析使用：

- touched pages
- related pages

不会为了一个新增文件重建全库 links。

### 3. 不在主摄入路径重建全局 index

大库模式下不在每个 job 末尾重写 `wiki/index.md`。全局 index 变成后台维护对象：

- 可低频重建
- 可手动触发
- 可中断恢复

搜索和问答依赖数据库索引与 chunks，不依赖 markdown index 的实时完整性。

### 4. 不在主摄入路径全量同步 Neo4j

当前 Neo4j 接口只有全量 `syncKnowledgeBase(snapshot)`。大库模式下主摄入路径跳过该全量同步。

后续需要补一个真正的增量 graph API：

- upsert source
- upsert touched pages
- replace touched page links
- replace touched page chunks
- delete stale relationships for touched pages only

### 5. SourceWatch 降频

总 source 超过 150 后，自动 watch 不再每 5 秒做全量目录扫描。

第一版策略：

- 手动 rescan 仍然立即执行。
- 自动 scan 在大库模式下降频。
- 后续再改成事件驱动或目录游标。

## 数据库索引

已有 `page_chunks.tokens`，大库相关页召回应加 GIN 索引：

```sql
CREATE INDEX IF NOT EXISTS page_chunks_tokens_gin_idx
  ON page_chunks USING GIN(tokens);
```

这让 source token 到已有 chunk/page 的相关召回可以走数据库索引。

pgvector 维度目前未固定，暂不在第一版添加 ivfflat/hnsw 索引。等 embedding 维度固定后，再为目标维度加专用向量索引。

## 第一阶段编码范围

第一阶段只改后端，避免扩大行为面：

- `KnowledgeRepository` 增加：
  - `countSources(kbId)`
  - `findRelatedPagesForIngest(kbId, input)`
- `PostgresRepository` 实现 source count 和 related page SQL。
- `page_chunks.tokens` 增加 GIN 索引。
- `IngestService` 增加 150 阈值判断。
- 大库模式下生成 prompt 使用 related page catalog。
- 大库模式下只重建 touched page links。
- 大库模式下跳过 per-job 全量 index rebuild 和 Neo4j full sync。
- `SourceWatchService` 在大库模式下降低自动全量扫描频率。

## 后续阶段

第二阶段：

- 后台 index rebuild task。
- 后台 graph incremental sync。
- sources/jobs/tasks API 分页。
- chat retrieval 去掉 `listPages/listChunks/listSources` 全量内存检索。

第三阶段：

- source 文件事件驱动监听。
- 大库 compaction job。
- page/chunk 删除后的增量清理。
- 固定 embedding 维度后的 pgvector hnsw/ivfflat 索引。
