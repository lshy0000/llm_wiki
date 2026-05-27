# 异步审核操作闭环方案

## 背景

知识库详情页已经把 LLM 摄取、lint、图洞察和深度研究产生的审核项汇总到同一个列表，但当前界面只展示 `open` 等状态文本，没有提供处理按钮。后端已经提供审核状态更新接口：

- `GET /api/kbs/:kbId/reviews`
- `PATCH /api/kbs/:kbId/reviews/:reviewId`

因此本次目标是补齐前端审核闭环，不引入新的数据库结构和后端业务分支。

## 目标

1. 审核列表可按状态查看：待处理、已解决、已忽略、全部。
2. 每个审核项都有明确操作：
   - `open`：标记解决、忽略。
   - `resolved` / `dismissed`：重新打开。
3. 操作后以前端重新拉取服务端数据为准，避免本地状态和数据库状态漂移。
4. 单个审核项更新期间只锁定该项按钮，不影响其它审核项。
5. lint 和深度研究仍进入同一审核队列，运行完成后刷新列表。

## 状态语义

| 状态 | 含义 | 常见来源 |
| --- | --- | --- |
| `open` | 仍需人工判断或处理 | LLM review、lint、graph insight、deep research |
| `resolved` | 人工确认问题已处理或无需进一步动作 | 已检查、已通过其它方式修复 |
| `dismissed` | 人工判断该项无价值或误报 | LLM 自检摘要、低价值建议、重复噪声 |

状态更新不删除数据。历史仍可在“全部”或对应状态里看到，便于后续审计。

## 前端实现

### API 层

在 `frontend/src/web/api.ts` 增加：

```ts
updateReviewStatus(kbId, reviewId, status)
```

调用已有 PATCH 接口，body 为 `{ status }`。

在 `frontend/src/web/types.ts` 收紧类型：

```ts
type ReviewStatus = "open" | "resolved" | "dismissed"
type ReviewKind = "llm-review" | "lint" | "graph-insight" | "deep-research"
```

### UI 层

在 `ReviewsPanel` 中增加：

- `statusFilter`：当前筛选状态。
- `loading`：首次和刷新加载。
- `error`：列表、lint、research、状态更新失败时展示。
- `updatingReviewId`：当前正在更新的审核项。
- `runningLint` / `runningResearch`：避免重复触发。

列表顶部显示状态筛选按钮和数量。审核项底部显示操作按钮：

- `open` 项显示“标记解决”和“忽略”。
- 非 `open` 项显示“重新打开”。

## 边界处理

1. PATCH 失败时保留原列表，展示错误信息。
2. 研究主题为空时不提交请求。
3. 刷新、lint、research 都复用同一个 `load`，服务端是最终数据源。
4. 空列表按当前筛选状态展示空态，不误导用户以为全局没有审核项。

## 验收标准

1. 进入“审核研究”页签后，能看到待处理、已解决、已忽略和全部数量。
2. `open` 审核项点击“标记解决”后变为 `resolved`，从待处理筛选中消失。
3. `open` 审核项点击“忽略”后变为 `dismissed`，从待处理筛选中消失。
4. 已解决或已忽略审核项点击“重新打开”后回到 `open`。
5. lint 和深度研究按钮执行期间有明确 loading 状态，完成后刷新审核列表。
6. 前端 TypeScript 类型检查通过。

## 不做的事

1. 不新增审核类型。
2. 不新增删除审核项接口。
3. 不把“标记解决”绑定到自动创建页面或自动修复逻辑。
4. 不改 LLM 生成审核项的策略；误报治理后续单独处理。
