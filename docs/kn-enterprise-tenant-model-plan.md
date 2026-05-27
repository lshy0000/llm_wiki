---
title: "KN 企业级租户、公司与模型池设计计划"
date: 2026-05-26
tags: ["KN", "企业化", "多租户", "RBAC", "模型池", "LDAP"]
summary: "在浏览器知识库 Phase 1 的基础上，设计企业级管理员、公司、公司成员、默认公司、公司知识库、公司模型池和个人中心。"
---

# KN 企业级租户、公司与模型池设计计划

## 0. 指导思想

KN 的企业化不是给当前单体知识库补几个字段，而是把“知识库”变成公司级资产。所有知识、文件、图谱、队列、审核、召回、模型调用都必须落在清晰的企业边界内：

```
Platform
  -> Company / Tenant
    -> Members
    -> Knowledge Bases
    -> Model Pool
    -> Audit / Jobs / Reviews
```

本阶段只设计企业级概念和落地路径，原则如下：

1. 不兼容桌面客户端。
2. 不按本地目录隔离数据，按 `company_id` / `tenant_id` 隔离。
3. 默认登录用户看到的是“所在公司”的知识库，不是个人私有库。
4. 公司管理员管理公司内成员、知识库、模型池和默认模型。
5. 平台管理员管理所有公司、默认公司、全局模型模板和系统配置。
6. LDAP 登录用户自动进入默认公司。
7. 模型调用必须从“公司模型池”解析，不再从前端用户配置里直接读 API Key。

## 1. 参考结论

### 1.1 Clawith 可借鉴

Clawith 的企业化结构清晰，适合 KN 参考：

- `Identity` 和 `User` 分离：一个自然人可以在多个租户下有不同成员身份。
- `Tenant` 是隔离边界，核心业务表都带 `tenant_id`。
- `User.role` 有 `platform_admin`、`org_admin`、`member` 等角色。
- LDAP 登录可以把未绑定用户挂到默认租户。
- `LLMModel` 支持 `tenant_id = null` 的平台模型和 `tenant_id = company_id` 的公司模型。
- `TenantDefaultModel` 单独保存默认 LLM、Embedding、Vision 模型。
- `OrgDepartment` / `OrgMember` 缓存企业组织结构。
- 企业知识文件以 `tenant_id + relative_path` 唯一约束登记。

### 1.2 Yuxi 可借鉴

Yuxi 的知识库和模型配置方式适合 KN 吸收：

- `knowledge_bases` 保存知识库元数据、embedding 信息、LLM 信息、query 参数和分享配置。
- `knowledge_files` 用 `parent_id`、`is_folder`、`path` 表达文件树。
- 模型 Provider UI 支持内置 Provider、自定义 Provider、测试连接、选择模型。
- repository/service 边界清晰，路由不应直接操作存储模型。

### 1.3 KN 自己要坚持

KN 不是普通 RAG 平台。企业化之后仍必须保留 llm_wiki 的核心：

- 两步式摄取。
- wiki 页面和源追溯。
- 4-Signal 图谱。
- Louvain 社区。
- 图洞察。
- RRF 混合检索。
- 多模态图片摄取。
- 持久化队列。
- 异步审核。

## 2. 角色与身份模型

### 2.1 角色定义

| 角色 | 范围 | 能力 |
|---|---|---|
| 平台管理员 `platform_admin` | 全平台 | 管理公司、默认公司、全局模型模板、系统设置、审计查看 |
| 公司管理员 `company_admin` | 单公司 | 管理公司成员、知识库、模型池、默认模型、公司级任务和审核 |
| 公司成员 `member` | 单公司 | 查看全公司知识库、上传文档、搜索、问答、查看图谱 |
| 访客 `viewer` | 单公司，可选 | 只读查看知识库和召回结果，不能上传和触发摄取 |

第一阶段企业化只需要 `platform_admin`、`company_admin`、`member`。`viewer` 可预留。

### 2.2 Identity 与 Membership 分离

不要把登录账号和公司成员混成一张表。建议模型：

```
identities
  id
  email
  phone
  username
  password_hash
  is_platform_admin
  is_active

companies
  id
  name
  slug
  status
  is_default
  ldap_domain
  created_at

company_members
  id
  identity_id
  company_id
  display_name
  avatar_url
  title
  employee_id
  external_id
  role
  status
  joined_at
```

这样可以支持：

- 一个自然人属于多个公司。
- 同一个人在 A 公司是管理员，在 B 公司只是成员。
- LDAP/OIDC/手机号/本地账号都统一到 `identities`。
- 登录后选择或自动进入一个 `company_member` 上下文。

## 3. 公司与默认公司

### 3.1 Company / Tenant

公司是 KN 的租户边界。所有企业数据必须带 `company_id`：

- knowledge bases
- sources
- wiki pages
- chunks
- graph nodes / edges
- ingest jobs
- reviews
- chat messages
- model pool
- audit logs

禁止通过前端传来的 `company_id` 直接决定权限。服务端必须从登录 token 的 member context 得到当前公司。

### 3.2 默认公司

默认公司用于 LDAP 登录：

1. 平台管理员在系统设置中指定唯一默认公司。
2. LDAP 登录成功后，如果 identity 没有任何公司成员身份，则自动创建默认公司的 `company_members`。
3. 默认角色为 `member`。
4. 如果 LDAP 返回 department、title、employeeId，则写入成员资料。
5. 如果 identity 已经属于公司，则进入最近使用公司或默认公司上下文。

默认公司不是“公共租户”。它只是未显式分配公司时的落点。

## 4. 公司知识库

### 4.1 一公司多知识库

知识库必须绑定公司：

```
knowledge_bases
  id
  company_id
  name
  description
  visibility
  created_by_member_id
  default_llm_model_id
  default_embedding_model_id
  default_vision_model_id
  created_at
  updated_at
```

默认规则：

- 公司成员登录后可见本公司所有知识库。
- 公司成员可以搜索、问答、查看图谱。
- 上传和删除是否开放给普通成员由公司配置决定，默认允许上传，删除仅公司管理员。
- 知识库不跨公司共享。

### 4.2 文件与目录

文件树应从 DB 索引生成，而不是每次扫描对象存储：

```
source_files
  id
  company_id
  knowledge_base_id
  parent_id
  relative_path
  original_name
  storage_key
  is_folder
  content_type
  size_bytes
  content_hash
  status
  uploaded_by_member_id
```

约束：

- `unique(company_id, knowledge_base_id, relative_path)`
- 文件夹导入保留目录结构。
- 文件夹上下文继续进入摄取提示词。
- raw/sources watcher 只能扫描公司知识库的 storage prefix。

## 5. 公司模型池

### 5.1 模型池分层

模型池分两层：

1. 平台模型模板：平台管理员维护，给所有公司可见或可复制。
2. 公司模型：公司管理员维护，保存本公司可用的 API Key、base URL、模型名和能力标签。

数据模型：

```
model_providers
  id
  scope              -- platform | company
  company_id
  name
  provider_type      -- openai | anthropic | gemini | azure | ollama | custom
  base_url
  encrypted_api_key
  enabled

models
  id
  provider_id
  company_id
  display_name
  model_name
  capability         -- llm | embedding | vision | rerank
  context_window
  max_output_tokens
  supports_streaming
  supports_reasoning
  enabled
  cost_input
  cost_output

company_default_models
  company_id
  default_llm_model_id
  default_embedding_model_id
  default_vision_model_id
  default_rerank_model_id

knowledge_base_model_overrides
  knowledge_base_id
  llm_model_id
  embedding_model_id
  vision_model_id
```

### 5.2 模型解析顺序

每次摄取、搜索、问答都不能直接拿前端模型配置。统一走 `ModelResolver`：

1. 知识库 override。
2. 默认模型。
3. 平台允许的默认模型。
4. 缺失则返回明确错误，不能静默调用任意环境变量。

多模态摄取时：

- 两步式文本摄取用 `llm`。
- 图片 caption 用 `vision`。
- 向量检索用 `embedding`。
- 未来 rerank 用 `rerank`。

### 5.3 权限

| 操作 | 平台管理员 | 公司管理员 | 公司成员 |
|---|---|---|---|
| 查看公司模型池 | 可看所有 | 可看本公司 | 可看模型显示名和能力，不可看密钥 |
| 新增/修改公司模型 | 可 | 可 | 不可 |
| 设置默认模型 | 可 | 可 | 不可 |
| 设置知识库模型 override | 可 | 可 | 不可 |
| 测试连接 | 可 | 可 | 不可 |

API Key 必须加密存储，前端永远不返回明文。

## 6. 权限策略

### 6.1 核心规则

服务端每个请求都得到：

```
AuthContext {
  identityId
  memberId
  companyId
  role
}
```

然后所有 repository 查询都必须带 `company_id`：

```
WHERE company_id = ctx.companyId
```

平台管理员访问公司数据时必须显式选择公司，禁止默认“全公司查询”。

### 6.2 权限矩阵

| 资源 | member | company_admin | platform_admin |
|---|---:|---:|---:|
| 公司知识库列表 | 读 | 读写 | 指定公司读写 |
| 文档上传 | 默认可写 | 可写 | 指定公司可写 |
| 文档删除 | 不可 | 可写 | 指定公司可写 |
| 摄取任务查看 | 本公司 | 本公司 | 指定公司 |
| 摄取任务取消/重试 | 自己创建的任务 | 本公司 | 指定公司 |
| 图谱/搜索/问答 | 本公司 | 本公司 | 指定公司 |
| Review resolve/dismiss | 可建议，不直接关闭 | 可关闭 | 可关闭 |
| 公司成员管理 | 不可 | 可 | 可 |
| 公司模型池 | 不可 | 可 | 可 |
| 公司设置 | 不可 | 可 | 可 |

## 7. 前端信息架构

### 7.1 顶层导航

登录后进入公司空间：

```
左侧：
  知识库
  审核中心
  模型池（管理员）
  成员管理（管理员）
  公司设置（管理员）

右上：
  公司切换
  个人中心
```

### 7.2 知识库页面

公司成员默认看到全公司知识库列表：

- 卡片或表格视图。
- 显示知识库名称、最近摄取时间、文档数、wiki 页数、图谱节点数、默认模型。
- 点击进入当前已实现的详情页：目录、wiki 结构、图谱、召回问答、审核。

### 7.3 管理员页面

公司管理员需要这些页面：

- 成员管理：成员列表、角色变更、禁用、LDAP 同步状态。
- 公司模型池：Provider 列表、模型列表、测试连接、设置默认模型。
- 公司设置：是否允许成员上传、是否允许成员创建知识库、默认语言、默认摄取策略。
- 审核中心：全公司 review、lint、图洞察、深度研究任务。

平台管理员需要：

- 公司列表。
- 创建/禁用公司。
- 指定默认公司。
- 全局模型模板。
- LDAP/OIDC 配置。
- 系统审计。

### 7.4 个人中心

个人中心不管理知识库所有权，只管理用户上下文：

- 基本资料：姓名、头像、邮箱、手机号。
- 当前公司和角色。
- 可切换公司列表。
- API Key / 个人访问令牌。
- 通知偏好。
- 最近问答和最近访问知识库。

## 8. 后台模块拆分

建议新增这些服务：

```
AuthService
IdentityService
CompanyService
CompanyMemberService
ModelProviderService
ModelResolver
CompanyKnowledgeBaseService
AuditService
```

现有 Phase 1 服务调整：

| 当前服务 | 企业化改造 |
|---|---|
| `ProjectService` | 改名或包装为 `KnowledgeBaseService`，所有方法加 `companyId` |
| `SourceService` | 文件、目录、source 都加 `companyId` |
| `IngestService` | job 加 `companyId`，模型调用走 `ModelResolver` |
| `SearchService` | 查询加 `companyId`，向量表按 company/kb 隔离 |
| `GraphService` | 节点、边、洞察按 company/kb 隔离 |
| `ChatService` | conversation 加 `companyId` 和 `memberId` |
| `LintService` | review 加 `companyId`，resolve 需要权限 |
| `LlmGateway` | 不直接读 env，接收 resolved model credential |

## 9. SQL 迁移计划

遵守仓库规则：不用 Alembic，使用 SQL。

### 9.1 第一批 SQL

```
001_enterprise_identity_company.sql
002_company_knowledge_base_binding.sql
003_company_model_pool.sql
004_company_audit_review.sql
```

### 9.2 表创建顺序

1. `identities`
2. `companies`
3. `company_members`
4. `model_providers`
5. `models`
6. `company_default_models`
7. 为现有知识库相关表添加 `company_id`
8. 为 job/review/chat/graph/search/chunk 添加 `company_id`
9. `audit_logs`

目前 Phase 1 仍是 JSON 索引，企业化实施时应切 PostgreSQL。不要在 JSON 索引上模拟完整 RBAC。

## 10. API 草案

### Auth

| API | 说明 |
|---|---|
| `POST /api/auth/login` | 本地登录 |
| `POST /api/auth/ldap/login` | LDAP 登录，自动进入默认公司 |
| `GET /api/auth/me` | 当前 identity/member/company |
| `POST /api/auth/switch-company` | 切换公司上下文 |

### Company

| API | 说明 |
|---|---|
| `GET /api/companies` | 平台管理员查看公司列表 |
| `POST /api/companies` | 创建公司 |
| `PATCH /api/companies/:companyId` | 修改公司 |
| `POST /api/companies/:companyId/default` | 设为默认公司 |
| `GET /api/company/members` | 当前公司成员 |
| `PATCH /api/company/members/:memberId` | 修改角色/状态 |

### Model Pool

| API | 说明 |
|---|---|
| `GET /api/company/model-providers` | 公司模型 Provider |
| `POST /api/company/model-providers` | 新增 Provider |
| `POST /api/company/model-providers/:id/test` | 测试连接 |
| `GET /api/company/models` | 公司模型列表 |
| `POST /api/company/models` | 新增模型 |
| `PATCH /api/company/default-models` | 设置默认 LLM/Embedding/Vision |

### Knowledge Base

当前 `/api/kbs` 改为当前公司上下文下的知识库：

- `GET /api/kbs` 返回当前公司所有知识库。
- `POST /api/kbs` 在当前公司创建知识库。
- 所有 `kbId` 查询都必须校验 `knowledge_bases.company_id = ctx.companyId`。

## 11. 实施步骤

### M1：认证与默认公司

- 新增 AuthService。
- 新增 identity/company/member SQL。
- 平台初始化时创建默认公司。
- 支持本地登录和 LDAP 登录。
- LDAP 新用户自动挂到默认公司。
- 前端增加登录页和当前用户上下文。

验收：

- LDAP 用户首次登录后成为默认公司 member。
- `GET /api/auth/me` 返回 identity、member、company、role。

### M2：公司知识库隔离

- 所有知识库数据加 `company_id`。
- `/api/kbs` 只返回当前公司知识库。
- 公司成员可见全公司知识库。
- 平台管理员必须显式指定公司上下文。

验收：

- A 公司成员看不到 B 公司知识库。
- 同公司成员能看到彼此创建的知识库。

### M3：公司成员与管理员

- 成员列表。
- 角色调整。
- 禁用成员。
- 公司设置：是否允许成员创建知识库、上传文档。

验收：

- company_admin 可管理本公司成员。
- member 不可进入成员管理和模型池。

### M4：公司模型池

- 模型 Provider CRUD。
- 模型 CRUD。
- API Key 加密。
- 测试连接。
- 默认 LLM / embedding / vision 模型设置。
- Ingest/Search/Chat 改走 ModelResolver。

验收：

- 公司管理员配置模型后，知识库摄取不再依赖环境变量。
- 未配置 vision 模型时，多模态摄取给出明确错误或跳过 caption 并进入 review。

### M5：个人中心

- 用户资料。
- 公司切换。
- 个人 API Key。
- 最近访问。
- 通知偏好。

验收：

- 用户能切换自己所属公司。
- 切换后知识库列表跟随公司变化。

### M6：审计与运营视图

- 记录登录、公司切换、模型配置、上传、删除、摄取、review 操作。
- 平台管理员看全局审计。
- 公司管理员看本公司审计。

验收：

- 关键管理操作都有审计记录。

## 12. 不做的事

第一轮企业化不做：

- 细粒度到单个知识库 ACL。
- 跨公司共享知识库。
- 多级审批流。
- SSO/OIDC 全量实现。
- 计费系统。
- 行级权限策略自动生成器。

这些都可以后续加，但现在先把公司级资产边界做扎实。

## 13. 最终验收标准

企业级基础完成时，应满足：

1. 平台管理员可以创建公司、设置默认公司。
2. LDAP 登录用户自动加入默认公司。
3. 公司管理员可以管理公司成员。
4. 公司成员登录后看到全公司知识库。
5. 一个公司可以拥有多个知识库，每个知识库绑定 `company_id`。
6. 公司管理员可以配置公司模型池。
7. 默认模型包含 LLM、embedding、vision。
8. 摄取、搜索、图谱、问答都从公司上下文和公司模型池解析资源。
9. 前端有个人中心、公司切换、公司设置、模型池、成员管理。
10. 所有服务端查询都有明确租户边界。

