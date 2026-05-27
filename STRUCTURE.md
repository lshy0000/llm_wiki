# 项目目录结构

```
xc_llm_wiki/
├── frontend/              # Web 前端（React + Vite）
│   ├── src/               # 源码（含 src/assets/logo.png 侧边栏图标）
│   ├── public/logo.png    # 静态资源，页面 /logo.png
│   ├── package.json       # 前端依赖与脚本
│   └── tsconfig.json
├── backend/               # API 服务（Fastify + PostgreSQL）
│   ├── src/
│   ├── sql/
│   ├── .kn-data/          # 知识库文件落盘
│   └── server.log         # 服务日志
├── desktop/               # Tauri 桌面 + Chrome 插件
├── deploy/                # 部署说明
├── docs/                  # 文档
│   ├── assets/            # README 截图（不参与构建）
│   └── logo.png           # README 用 logo
├── .env                   # 环境变量（根目录，Vite envDir 指向此处）
├── .env.example
├── package.json           # monorepo 入口：npm 脚本与全部依赖
├── package-lock.json
└── tsconfig.json          # 工作区引用（指向前端/后端 tsconfig）
```

## 根目录文件说明

| 文件 | 位置 | 原因 |
|------|------|------|
| `package.json` / `package-lock.json` | **仓库根** | npm 单仓多模块惯例；`npm run dev` 等从根执行 |
| `tsconfig.json` | **仓库根** | 仅聚合 `frontend` / `backend` 的 TypeScript 工程引用 |
| `.env` / `.env.example` | **仓库根** | 前后端共用；Vite 通过 `envDir` 读取 |

## 常用命令

```bash
cp .env.example .env   # 首次

npm run server:dev     # 日志 → backend/server.log
npm run dev            # 前端 http://0.0.0.0:1420（局域网可访问）
npm run dev:all
```

PostgreSQL 使用公司内网数据库，连接信息放在根目录 `.env`。

## 旧日志删不掉？

若根目录出现 `.kn-server-*.log` / `.kn-web-*.log`，说明有**未退出的旧 dev 进程**占用了文件（常见于改目录结构前启动的 `kn-server` / `vite`）。结束对应 `node` 进程后即可删除；新启动的日志应写在 `backend/server.log`。
