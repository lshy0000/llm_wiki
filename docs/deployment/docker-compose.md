# Docker Compose 部署说明

这套部署文件借鉴了 `yuxi` 的方式：用 Compose 编排应用和基础设施，容器数据统一落在 `docker/volumes`，前端生产包由 Nginx 托管并反向代理后端 `/api`。

当前项目不需要照搬 yuxi 的 Redis、MinIO、Milvus。我们的服务依赖收敛为：

- `frontend`: Nginx 托管 Vite 构建产物，并把 `/api` 转发到后端。
- `backend`: Node/Fastify 服务。
- `postgres`: PostgreSQL + pgvector，负责业务数据和向量字段。
- `neo4j`: 图召回索引。

## 文件

- `docker-compose.yml`: 生产部署编排。
- `.env.docker.example`: 部署环境变量模板。
- `docker/backend.Dockerfile`: 后端镜像。
- `docker/frontend.Dockerfile`: 前端构建和 Nginx 镜像。
- `docker/nginx/default.conf`: 前端路由和 `/api` 反向代理。

## 端口

这些端口刻意避开了 yuxi 的默认端口，也避开本机常见开发端口：

| 服务 | 容器内端口 | 宿主机默认端口 |
| --- | ---: | ---: |
| Web/Nginx | 80 | 18880 |
| Backend | 8787 | 18787 |
| PostgreSQL | 5432 | 15432 |
| Neo4j HTTP | 7474 | 17474 |
| Neo4j Bolt | 7687 | 17687 |

如果部署机器上端口冲突，改 `.env.docker` 里的 `*_HOST_PORT`，不要改容器内部端口。

## 部署步骤

在真正的部署机器上执行，不需要在当前电脑执行：

```powershell
Copy-Item .env.docker.example .env.docker
```

先编辑 `.env.docker`，至少改掉：

- `POSTGRES_PASSWORD`
- `NEO4J_PASSWORD`
- `KN_ADMIN_PASSWORD`
- `KN_DEBUG_BACKDOOR_PASSWORD`，生产环境建议留空
- 对外访问端口，如果服务器已有冲突

启动：

```powershell
docker compose --env-file .env.docker up -d --build
```

查看状态：

```powershell
docker compose --env-file .env.docker ps
```

访问：

- Web: `http://服务器IP:18880`
- Backend health: `http://服务器IP:18787/api/health`
- Neo4j Browser: `http://服务器IP:17474`

## 数据目录

Compose 会把持久化数据写到：

- `docker/volumes/postgres`
- `docker/volumes/neo4j/data`
- `docker/volumes/neo4j/logs`
- `docker/volumes/backend/data`
- `docker/volumes/backend/logs`

这些目录不要提交到 Git，也不要在未备份前删除。迁移服务器时优先停容器，再整体备份 `docker/volumes`。

## Neo4j 和召回

后端容器内固定使用：

```text
KN_NEO4J_URI=bolt://neo4j:7687
```

宿主机调试 Neo4j 时使用：

```text
bolt://127.0.0.1:17687
```

后端启动后会尝试同步已有知识库的图索引。需要手动重建某个知识库图索引时，调用后端已有接口：

```text
POST /api/kbs/{kbId}/retrieval/reindex
```

这个接口需要登录态和公司管理员权限。

## 注意事项

- PostgreSQL 镜像使用 `pgvector/pgvector:pg16`，因为初始化 SQL 会执行 `CREATE EXTENSION IF NOT EXISTS vector;`。
- 不要把 PostgreSQL 和 Neo4j 端口直接暴露到公网。需要远程维护时，优先用安全组、内网、SSH 隧道或 VPN。
- `.env.docker` 是真实部署密钥文件，已经加入 `.gitignore`，不要提交。
- 本部署没有引入 yuxi 的 Milvus。当前向量能力来自 PostgreSQL 的 pgvector。
- 查询链路是否使用 LLM 不由 Docker 决定。这里部署的是工具服务和检索基础设施，图召回依赖 Neo4j，向量字段依赖 pgvector。
- 当前任务没有在本机运行 Docker，也没有执行部署验证。
