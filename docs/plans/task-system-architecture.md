# Task System Architecture

## 目标

任务系统用于把用户的一次后台操作变成可追踪、可重试、可展示的任务。

当前第一类任务是上传后的 source ingest。它拆成两个阶段：

1. 上传文件或文件夹。后端完整接收并保存 raw 文件。
2. 创建后台任务，把本次操作产生的 source 加入后续摄入流程。

关键边界：上传接收期间不是后台任务。只有后端完成文件保存后，才创建任务并启动摄入。

## 核心对象

### BackgroundTask

`BackgroundTask` 对应用户的一次操作，持久化在 `ingest_tasks`。

主要字段：

| 字段 | 说明 |
|---|---|
| `id` | 任务 ID |
| `companyId` | 公司隔离字段 |
| `kbId` | 知识库 ID |
| `kind` | 当前为 `source_ingest` |
| `title` | 任务中心展示标题 |
| `uploadBatchId` | 上传批次 ID |
| `status` | `queued` / `running` / `completed` / `failed` / `cancelled` |
| `progress` | 聚合进度 |
| `stage` | 当前阶段文案 |
| `sourceIds` | 本次操作创建或覆盖的 source |
| `jobIds` | 任务下属 ingest job |
| `sourcePaths` | 展示用 source 路径，由查询时补齐 |
| `jobs` | 展示和聚合用子 job 列表 |

### IngestJob

`IngestJob` 对应一个 source 的摄入执行单元，持久化在 `ingest_jobs`。

它通过 `taskId` 归属于某个 `BackgroundTask`。摄入服务仍然按 job 串行处理，任务只是用户视角的聚合层。

### SourceDocument

`SourceDocument` 是 raw 文件记录，持久化在 `sources`。

上传完成后，支持摄入的 source 会先保存为 `uploaded`，创建任务后再进入 `queued`。不需要摄入的文件保存为 `ingested`，仍然可以属于本次任务。

## 上传到任务的流程

```text
Browser
  -> 选择 raw 目标文件夹
  -> 选择文件或文件夹
  -> multipart upload /api/kbs/:kbId/sources
  -> 后端保存所有 raw 文件
  -> 后端生成可选 __folder_structure.md
  -> 后端创建 ingest_tasks
  -> 后端为可摄入 source 创建 ingest_jobs
  -> IngestService.processQueue()
  -> 前端任务中心轮询 /api/tasks
```

前端上传期间使用 `XMLHttpRequest.upload.onprogress` 显示上传进度。上传弹框存在时，上传按钮禁用，避免同一客户端重复发起上传。

后端返回成功代表文件已经接收并保存，后台任务已创建。此时用户可以继续下一次上传，任务在后台继续运行。

## 状态流转

### BackgroundTask

```text
queued
  -> running
  -> completed

queued/running
  -> cancelled

running
  -> failed

failed/cancelled
  -> queued  (retry)
```

任务状态由下属 job 聚合得出：

| 子 job 情况 | 任务状态 |
|---|---|
| 任一 job `running` | `running` |
| 无 running 且任一 job `queued` | `queued` |
| 任一 job `failed` | `failed` |
| 无 failed 且任一 job `cancelled` | `cancelled` |
| 全部 job `completed` | `completed` |
| 没有 job | `completed` |

任务进度为所有子 job 进度平均值；没有 job 的任务进度为 100。

### IngestJob

```text
queued
  -> running
  -> completed

queued/running
  -> cancelled

running
  -> failed

failed/cancelled
  -> queued  (retry)
```

### SourceDocument

```text
uploaded
  -> queued
  -> parsing
  -> ingested

queued/parsing
  -> failed
```

`uploaded` 表示 raw 文件已经保存，但还没有进入摄入 job。这个状态用于明确区分“文件接收完成”和“后续摄入开始”。

## API

### 上传 sources

`POST /api/kbs/:kbId/sources`

multipart 字段：

| 字段 | 说明 |
|---|---|
| `relativePath` | raw 内相对路径。前端会把选中的目标文件夹拼入路径 |
| `file` | 文件内容 |

响应：

```ts
type SourceUploadResponse = {
  created: SourceUploadAccepted[]
  skipped: SourceUploadSkipped[]
  task?: BackgroundTask
}
```

语义：

- 后端完整读取并保存所有文件后，才创建 `BackgroundTask`。
- 如果上传的是文件夹或有跳过文件，会生成 `__folder_structure.md`。
- 支持摄入的 source 会创建子 `IngestJob`。
- 没有可摄入 job 时，任务直接完成。

### 查询任务

`GET /api/tasks`

返回当前用户可见范围内的任务。平台管理员可看全部，普通用户按公司隔离。

`GET /api/tasks?kbId=:kbId`

返回某个知识库下的任务。

### 重试任务

`POST /api/tasks/:taskId/retry`

只重试任务下状态为 `failed` 或 `cancelled` 的子 job。重试会把对应 source 重新置为 `queued`。

### 取消任务

`POST /api/tasks/:taskId/cancel`

取消任务下状态为 `queued` 或 `running` 的子 job。已完成 job 不回滚。

### 旧 job API

`GET /api/kbs/:kbId/jobs`、`POST /api/jobs/:jobId/cancel`、`POST /api/jobs/:jobId/retry` 仍保留。它们是 job 级接口，主要用于低层调试和兼容当前服务内部调用，不作为任务中心的主要展示接口。

## 前端交互

知识库详情页：

- raw 文件树中点击文件夹，设置上传目标目录。
- 上传文件或文件夹时，前端把目标目录拼入 `relativePath`。
- 上传中展示模态进度条。
- 上传中禁用上传文件、上传文件夹、刷新按钮。
- 上传成功后刷新 raw tree、wiki tree、source 列表和任务列表。
- 页面底部展示最近后台任务。

任务中心：

- 从侧边栏打开。
- 轮询 `GET /api/tasks`。
- 支持 `全部`、`未完成`、`已完成`、`失败` 筛选。
- 失败和取消任务可以重试。

## 后端实现位置

| 文件 | 职责 |
|---|---|
| `backend/sql/001_init.sql` | 创建 `ingest_tasks`，给 `ingest_jobs` 增加 `task_id` |
| `backend/src/types.ts` | 定义 `BackgroundTask`、`IngestJob.taskId` |
| `backend/src/repository.ts` | task CRUD、任务聚合、schema 兜底 SQL |
| `backend/src/source-service.ts` | 保存上传 source，创建任务和子 job |
| `backend/src/ingest-service.ts` | job 执行、任务刷新、任务重试和取消 |
| `backend/src/app.ts` | 上传接口、任务查询、任务重试和取消路由 |
| `frontend/src/web/api.ts` | task API 和带进度上传 |
| `frontend/src/web/types.ts` | 前端 task 类型 |
| `frontend/src/components/knowledge-base/knowledge-base-detail.tsx` | 指定目录上传、上传进度、详情页任务摘要 |
| `frontend/src/components/app-shell.tsx` | 任务中心 |

## 约束

- 不使用 alembic。schema 变化通过 SQL 文件和启动时的 SQL 兜底完成。
- 任务是用户操作维度，job 是 source 摄入维度，不要把二者混成一个概念。
- 上传进度只表示浏览器到后端的传输和后端响应完成，不表示摄入进度。
- 任务重试不重新上传文件，只重新排队失败或取消的 ingest job。
- 任务取消不删除已经上传的 raw 文件，也不回滚已完成的 wiki 输出。

## 后续扩展

后续可以把 `BackgroundTask.kind` 扩展到更多后台操作：

- `graph_insight`
- `lint`
- `deep_research`
- `file_sync`

扩展时保持同一原则：用户一次操作对应一个 task，内部执行细节可以拆成多个 job 或 step。
