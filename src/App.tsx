import { useEffect, useMemo, useState } from "react"
import type { InputHTMLAttributes, ReactElement } from "react"
import {
  ArrowLeft,
  Bot,
  Brain,
  Building2,
  CheckCircle2,
  CircleHelp,
  Database,
  FileSearch,
  Folder,
  GitBranch,
  Image,
  KeyRound,
  LogOut,
  Network,
  Plus,
  RefreshCw,
  Search,
  Upload,
  UserRound,
  X,
} from "lucide-react"
import { api } from "@/web/api"
import type {
  AuthPayload,
  Capabilities,
  FileTreeNode,
  GraphResponse,
  IngestJob,
  KnowledgeBase,
  ReviewItem,
  SearchResult,
  SourceDocument,
  WikiTreeGroup,
} from "@/web/types"

type DetailTab = "sources" | "structure" | "graph" | "recall" | "reviews"

function App() {
  const [auth, setAuth] = useState<AuthPayload | null>(null)
  const [kbs, setKbs] = useState<KnowledgeBase[]>([])
  const [selected, setSelected] = useState<KnowledgeBase | null>(null)
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadKbs = async () => {
    setLoading(true)
    setError(null)
    try {
      const [items, caps] = await Promise.all([api.listKbs(), api.capabilities()])
      setKbs(items)
      setCapabilities(caps)
      if (selected) {
        setSelected(items.find((kb) => kb.id === selected.id) ?? selected)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.me()
      .then((current) => {
        setAuth(current)
        void loadKbs()
      })
      .catch(() => {
        setAuth(null)
        setLoading(false)
      })
      .finally(() => setAuthLoading(false))
  }, [])

  const handleLoggedIn = (current: AuthPayload) => {
    setAuth(current)
    void loadKbs()
  }

  const logout = async () => {
    await api.logout()
    setAuth(null)
    setSelected(null)
    setKbs([])
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f4] text-sm text-neutral-600">
        正在检查登录状态...
      </main>
    )
  }

  if (!auth) {
    return <LoginPage onLoggedIn={handleLoggedIn} />
  }

  if (selected) {
    return (
      <KnowledgeBaseDetail
        kb={selected}
        auth={auth}
        onBack={() => { setSelected(null); void loadKbs() }}
        onLogout={() => void logout()}
        capabilities={capabilities}
      />
    )
  }

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-neutral-950">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6">
        <header className="flex items-center justify-between border-b border-neutral-300 pb-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-teal-700">Knowledge Network</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">知识库</h1>
          </div>
          <div className="flex items-center gap-2">
            <UserBadge auth={auth} />
            <button
              className="inline-flex h-10 items-center gap-2 border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-100"
              onClick={() => void loadKbs()}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-100"
              onClick={() => void logout()}
            >
              <LogOut className="h-4 w-4" />
              退出
            </button>
          </div>
        </header>

        {error && <div className="mt-4 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        <div className="grid flex-1 grid-cols-[360px_1fr] gap-5 py-5">
          <CreateKnowledgeBase onCreated={(kb) => { setKbs((items) => [kb, ...items]); setSelected(kb) }} />
          <section className="min-h-0">
            {loading ? (
              <div className="border border-neutral-300 bg-white p-6 text-sm text-neutral-600">正在连接 KN 服务端...</div>
            ) : kbs.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {kbs.map((kb) => (
                  <button
                    key={kb.id}
                    className="group border border-neutral-300 bg-white p-4 text-left hover:border-teal-700 hover:bg-teal-50"
                    onClick={() => setSelected(kb)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold">{kb.name}</h2>
                        <p className="mt-1 min-h-10 text-sm leading-5 text-neutral-600">{kb.description || "没有描述"}</p>
                      </div>
                      <Database className="h-5 w-5 text-neutral-500 group-hover:text-teal-800" />
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
                      <span>版本 {kb.dataVersion}</span>
                      <span>{new Date(kb.updatedAt).toLocaleString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <CapabilityStrip capabilities={capabilities} />
      </section>
    </main>
  )
}

function LoginPage({ onLoggedIn }: { onLoggedIn: (auth: AuthPayload) => void }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!username.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      onLoggedIn(await api.ldapLogin(username, password))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f4] px-6 text-neutral-950">
      <section className="w-full max-w-md border border-neutral-300 bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center bg-neutral-950 text-white">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-teal-700">Enterprise Login</p>
            <h1 className="mt-1 text-2xl font-semibold">LDAP 登录</h1>
          </div>
        </div>
        <label className="mt-6 block text-xs font-medium text-neutral-600">账号</label>
        <input
          className="mt-1 h-10 w-full border border-neutral-300 px-3 text-sm outline-none focus:border-teal-700"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void submit() }}
          placeholder="LDAP 用户名"
        />
        <label className="mt-3 block text-xs font-medium text-neutral-600">密码</label>
        <input
          className="mt-1 h-10 w-full border border-neutral-300 px-3 text-sm outline-none focus:border-teal-700"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void submit() }}
          placeholder="LDAP 密码"
          type="password"
        />
        {error && <div className="mt-4 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <button
          className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 bg-neutral-950 px-3 text-sm font-medium text-white disabled:opacity-50"
          disabled={busy || !username.trim() || !password}
          onClick={() => void submit()}
        >
          <UserRound className="h-4 w-4" />
          {busy ? "登录中" : "登录"}
        </button>
      </section>
    </main>
  )
}

function UserBadge({ auth }: { auth: AuthPayload }) {
  return (
    <div className="flex h-10 items-center gap-3 border border-neutral-300 bg-white px-3 text-sm">
      <UserRound className="h-4 w-4 text-neutral-500" />
      <div className="leading-4">
        <div className="font-medium">{auth.user.displayName}</div>
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <Building2 className="h-3 w-3" />
          {auth.company.name}
        </div>
      </div>
    </div>
  )
}

function CreateKnowledgeBase({ onCreated }: { onCreated: (kb: KnowledgeBase) => void }) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      onCreated(await api.createKb(name, description))
      setName("")
      setDescription("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border border-neutral-300 bg-white p-4">
      <h2 className="text-sm font-semibold">新建知识库</h2>
      <p className="mt-2 text-sm leading-5 text-neutral-600">
        创建后会初始化 llm_wiki 规则、schema、purpose、wiki/index 和 overview。
      </p>
      <label className="mt-5 block text-xs font-medium text-neutral-600">名称</label>
      <input
        className="mt-1 h-10 w-full border border-neutral-300 px-3 text-sm outline-none focus:border-teal-700"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="例如：AI 研究知识库"
      />
      <label className="mt-3 block text-xs font-medium text-neutral-600">描述</label>
      <textarea
        className="mt-1 h-24 w-full resize-none border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-teal-700"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="这个知识库要解决什么问题"
      />
      <button
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 bg-neutral-950 px-3 text-sm font-medium text-white disabled:opacity-50"
        disabled={busy || !name.trim()}
        onClick={() => void submit()}
      >
        <Plus className="h-4 w-4" />
        {busy ? "创建中" : "创建知识库"}
      </button>
    </section>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full min-h-96 items-center justify-center border border-dashed border-neutral-300 bg-white">
      <div className="max-w-md text-center">
        <Brain className="mx-auto h-10 w-10 text-teal-700" />
        <h2 className="mt-4 text-lg font-semibold">还没有知识库</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          从左侧创建第一个知识库，然后上传文档。后台会按两步式摄取生成可追溯 wiki 页面。
        </p>
      </div>
    </div>
  )
}

function CapabilityStrip({ capabilities }: { capabilities: Capabilities | null }) {
  const labels: Array<[keyof Capabilities["llmWiki"], string]> = [
    ["twoStepCotIngest", "两步 CoT 摄取"],
    ["multimodalImageIngest", "多模态图片"],
    ["fourSignalGraph", "4-Signal 图谱"],
    ["louvainCommunityDetection", "Louvain 社区"],
    ["graphInsights", "图洞察"],
    ["vectorSemanticSearch", "向量语义搜索"],
    ["persistentIngestQueue", "持久化队列"],
    ["folderImport", "文件夹导入"],
    ["rawSourceWatch", "raw 自动监视"],
    ["deepResearch", "深度研究"],
    ["asyncReview", "异步审核"],
  ]
  return (
    <footer className="border-t border-neutral-300 pt-4">
      <div className="flex flex-wrap gap-2">
        {labels.map(([key, label]) => (
          <span
            key={String(key)}
            className="inline-flex h-8 items-center gap-2 border border-neutral-300 bg-white px-3 text-xs text-neutral-700"
          >
            <CheckCircle2 className={`h-3.5 w-3.5 ${capabilities?.llmWiki[key] ? "text-teal-700" : "text-neutral-400"}`} />
            {label}
          </span>
        ))}
      </div>
    </footer>
  )
}

function KnowledgeBaseDetail({
  kb,
  auth,
  onBack,
  onLogout,
  capabilities,
}: {
  kb: KnowledgeBase
  auth: AuthPayload
  onBack: () => void
  onLogout: () => void
  capabilities: Capabilities | null
}) {
  const [tab, setTab] = useState<DetailTab>("sources")

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-neutral-950">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-5">
        <header className="flex items-center justify-between border-b border-neutral-300 pb-4">
          <div className="flex items-center gap-3">
            <button className="inline-flex h-9 w-9 items-center justify-center border border-neutral-300 bg-white" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-2xl font-semibold">{kb.name}</h1>
              <p className="text-sm text-neutral-600">{kb.description || "浏览器知识库详情"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <UserBadge auth={auth} />
            <div className="px-2 text-right text-xs text-neutral-500">
              <div>数据版本 {kb.dataVersion}</div>
              <div>{new Date(kb.updatedAt).toLocaleString()}</div>
            </div>
            <button className="inline-flex h-9 w-9 items-center justify-center border border-neutral-300 bg-white" onClick={onLogout}>
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="grid flex-1 grid-cols-[220px_1fr] gap-5 py-5">
          <nav className="border border-neutral-300 bg-white p-2">
            <TabButton active={tab === "sources"} icon={<Folder />} label="文档目录" onClick={() => setTab("sources")} />
            <TabButton active={tab === "structure"} icon={<GitBranch />} label="Wiki 结构" onClick={() => setTab("structure")} />
            <TabButton active={tab === "graph"} icon={<Network />} label="知识图谱" onClick={() => setTab("graph")} />
            <TabButton active={tab === "recall"} icon={<Search />} label="召回 / 问答" onClick={() => setTab("recall")} />
            <TabButton active={tab === "reviews"} icon={<CircleHelp />} label="审核 / 研究" onClick={() => setTab("reviews")} />
            <div className="mt-4 border-t border-neutral-200 px-3 pt-4 text-xs leading-5 text-neutral-600">
              <div>LLM: {capabilities?.providers.chatConfigured ? capabilities.providers.model : "未配置，使用本地回退"}</div>
              <div>Embedding: {capabilities?.providers.embeddingConfigured ? capabilities.providers.embeddingModel : "未配置"}</div>
            </div>
          </nav>
          <section className="min-h-0">
            {tab === "sources" && <SourcesPanel kbId={kb.id} />}
            {tab === "structure" && <StructurePanel kbId={kb.id} />}
            {tab === "graph" && <GraphPanel kbId={kb.id} />}
            {tab === "recall" && <RecallPanel kbId={kb.id} />}
            {tab === "reviews" && <ReviewsPanel kbId={kb.id} />}
          </section>
        </div>
      </div>
    </main>
  )
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactElement; label: string; onClick: () => void }) {
  return (
    <button
      className={`mb-1 flex h-10 w-full items-center gap-2 px-3 text-left text-sm ${
        active ? "bg-teal-700 text-white" : "hover:bg-neutral-100"
      }`}
      onClick={onClick}
    >
      <span className="h-4 w-4">{icon}</span>
      {label}
    </button>
  )
}

function SourcesPanel({ kbId }: { kbId: string }) {
  const [rawTree, setRawTree] = useState<FileTreeNode[]>([])
  const [wikiTree, setWikiTree] = useState<FileTreeNode[]>([])
  const [sources, setSources] = useState<SourceDocument[]>([])
  const [jobs, setJobs] = useState<IngestJob[]>([])
  const [uploading, setUploading] = useState(false)

  const load = async () => {
    const [raw, wiki, sourceList, jobList] = await Promise.all([
      api.fileTree(kbId, "raw"),
      api.fileTree(kbId, "wiki"),
      api.listSources(kbId),
      api.listJobs(kbId),
    ])
    setRawTree(raw)
    setWikiTree(wiki)
    setSources(sourceList)
    setJobs(jobList)
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 2500)
    return () => window.clearInterval(timer)
  }, [kbId])

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        await api.uploadFile(kbId, file, relativePath)
      }
      await load()
    } finally {
      setUploading(false)
    }
  }

  const folderInputProps = {
    webkitdirectory: "",
    directory: "",
  } as InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string; directory: string }

  return (
    <div className="grid h-full min-h-[680px] grid-rows-[auto_1fr] gap-4">
      <section className="border border-neutral-300 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">上传和持久化摄取队列</h2>
            <p className="mt-1 text-sm text-neutral-600">支持多文件、文件夹导入，目录上下文会进入 LLM 分类提示。</p>
          </div>
          <div className="flex gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 border border-neutral-300 px-3 text-sm hover:bg-neutral-100">
              <Upload className="h-4 w-4" />
              {uploading ? "上传中" : "上传文件"}
              <input className="hidden" type="file" multiple onChange={(event) => void upload(event.target.files)} />
            </label>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 border border-neutral-300 px-3 text-sm hover:bg-neutral-100">
              <Folder className="h-4 w-4" />
              导入文件夹
              <input className="hidden" type="file" multiple {...folderInputProps} onChange={(event) => void upload(event.target.files)} />
            </label>
            <button className="inline-flex h-10 items-center gap-2 border border-neutral-300 px-3 text-sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </div>
        </div>
      </section>

      <section className="grid min-h-0 grid-cols-[1fr_1fr_360px] gap-4">
        <TreePanel title="raw / sources" nodes={rawTree} />
        <TreePanel title="wiki 目录" nodes={wikiTree} />
        <div className="min-h-0 overflow-auto border border-neutral-300 bg-white">
          <div className="sticky top-0 border-b border-neutral-200 bg-white px-4 py-3">
            <h3 className="text-sm font-semibold">队列和源文件</h3>
          </div>
          <div className="divide-y divide-neutral-200">
            {jobs.map((job) => (
              <div key={job.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase text-neutral-500">{job.status}</span>
                  <span className="text-xs text-neutral-500">{job.progress}%</span>
                </div>
                <div className="mt-2 h-1.5 bg-neutral-200">
                  <div className="h-full bg-teal-700" style={{ width: `${job.progress}%` }} />
                </div>
                <p className="mt-2 text-sm">{job.stage}</p>
                {job.error && <p className="mt-1 text-xs text-red-700">{job.error}</p>}
                <div className="mt-2 flex gap-2">
                  {job.status === "running" || job.status === "queued" ? (
                    <button className="border border-neutral-300 px-2 py-1 text-xs" onClick={() => void api.cancelJob(job.id).then(load)}>
                      取消
                    </button>
                  ) : null}
                  {job.status === "failed" || job.status === "cancelled" ? (
                    <button className="border border-neutral-300 px-2 py-1 text-xs" onClick={() => void api.retryJob(job.id).then(load)}>
                      重试
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {sources.map((source) => (
              <div key={source.id} className="p-3 text-sm">
                <div className="font-medium">{source.relativePath}</div>
                <div className="mt-1 text-xs text-neutral-500">{source.status} · {source.folderContext || "root"}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function TreePanel({ title, nodes }: { title: string; nodes: FileTreeNode[] }) {
  return (
    <div className="min-h-0 overflow-auto border border-neutral-300 bg-white">
      <div className="sticky top-0 border-b border-neutral-200 bg-white px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="p-3">
        {nodes.length === 0 ? <p className="text-sm text-neutral-500">暂无文件</p> : nodes.map((node) => <TreeNodeView key={node.path} node={node} depth={0} />)}
      </div>
    </div>
  )
}

function TreeNodeView({ node, depth }: { node: FileTreeNode; depth: number }) {
  return (
    <div>
      <div className="flex items-center gap-2 py-1 text-sm" style={{ paddingLeft: depth * 14 }}>
        {node.isDirectory ? <Folder className="h-4 w-4 text-amber-700" /> : <FileSearch className="h-4 w-4 text-neutral-500" />}
        <span className="truncate">{node.name}</span>
      </div>
      {node.children?.map((child) => <TreeNodeView key={child.path} node={child} depth={depth + 1} />)}
    </div>
  )
}

function StructurePanel({ kbId }: { kbId: string }) {
  const [groups, setGroups] = useState<WikiTreeGroup[]>([])

  useEffect(() => {
    void api.wikiTree(kbId).then(setGroups)
  }, [kbId])

  return (
    <section className="min-h-[680px] border border-neutral-300 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-base font-semibold">Wiki 规则结构</h2>
        <p className="mt-1 text-sm text-neutral-600">按 llm_wiki page type 组织，保留源追溯和图片资产。</p>
      </div>
      <div className="grid grid-cols-3 gap-3 p-4">
        {groups.map((group) => (
          <section key={group.type} className="border border-neutral-200">
            <h3 className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-semibold">{group.type}</h3>
            <div className="divide-y divide-neutral-200">
              {group.pages.map((page) => (
                <article key={page.id} className="p-3">
                  <div className="text-sm font-medium">{page.title}</div>
                  <div className="mt-1 text-xs text-neutral-500">{page.path}</div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-neutral-600">
                    <span>{page.sources.length} source</span>
                    <span>{page.images.length} image</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

function GraphPanel({ kbId }: { kbId: string }) {
  const [graph, setGraph] = useState<GraphResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => setGraph(await api.graph(kbId))
  useEffect(() => {
    void load()
  }, [kbId])

  const runInsights = async () => {
    setBusy(true)
    try {
      await api.graphInsights(kbId)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const positions = useMemo(() => {
    const nodes = graph?.nodes ?? []
    const centerX = 420
    const centerY = 280
    const radius = 210
    return new Map(nodes.map((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1)
      return [node.id, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius }]
    }))
  }, [graph])

  return (
    <section className="grid min-h-[680px] grid-cols-[1fr_320px] gap-4">
      <div className="border border-neutral-300 bg-white">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">4-Signal 知识图谱</h2>
            <p className="mt-1 text-sm text-neutral-600">直接链接、来源重叠、Adamic-Adar、类型亲和性共同决定边权重。</p>
          </div>
          <button className="inline-flex h-9 items-center gap-2 border border-neutral-300 px-3 text-sm" onClick={() => void runInsights()}>
            <Brain className="h-4 w-4" />
            {busy ? "分析中" : "图洞察"}
          </button>
        </div>
        <svg className="h-[600px] w-full" viewBox="0 0 840 560" role="img">
          {(graph?.edges ?? []).map((edge) => {
            const a = positions.get(edge.source)
            const b = positions.get(edge.target)
            if (!a || !b) return null
            return <line key={`${edge.source}-${edge.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0f766e" strokeOpacity="0.35" strokeWidth={Math.max(1, edge.weight / 2)} />
          })}
          {(graph?.nodes ?? []).map((node) => {
            const pos = positions.get(node.id)
            if (!pos) return null
            const color = ["#0f766e", "#b45309", "#4338ca", "#be123c", "#047857", "#7c2d12"][node.community % 6]
            return (
              <g key={node.id}>
                <circle cx={pos.x} cy={pos.y} r={10 + Math.min(node.linkCount, 10)} fill={color} />
                <text x={pos.x + 14} y={pos.y + 4} fontSize="12" fill="#171717">{node.label}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <aside className="overflow-auto border border-neutral-300 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h3 className="text-sm font-semibold">Louvain 社区</h3>
        </div>
        <div className="divide-y divide-neutral-200">
          {(graph?.communities ?? []).map((community) => (
            <div key={community.id} className="p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">社区 {community.id}</span>
                <span>{community.nodeCount} 节点</span>
              </div>
              <div className="mt-1 text-xs text-neutral-500">凝聚力 {community.cohesion.toFixed(2)}</div>
              <div className="mt-2 text-xs leading-5 text-neutral-700">{community.topNodes.join(" / ")}</div>
            </div>
          ))}
        </div>
      </aside>
    </section>
  )
}

function RecallPanel({ kbId }: { kbId: string }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [mode, setMode] = useState<string>("keyword")
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [lightbox, setLightbox] = useState<SearchResult["images"][number] | null>(null)

  const runSearch = async () => {
    if (!query.trim()) return
    const response = await api.search(kbId, query)
    setMode(response.mode)
    setResults(response.results)
  }

  const ask = async () => {
    if (!question.trim()) return
    const response = await api.chat(kbId, question, conversationId)
    setConversationId(response.conversationId)
    setAnswer(response.answer)
    setResults(response.citations)
  }

  return (
    <section className="grid min-h-[680px] grid-cols-[1fr_420px] gap-4">
      <div className="border border-neutral-300 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-semibold">召回</h2>
          <p className="mt-1 text-sm text-neutral-600">关键词 + 可选向量语义搜索，图片 caption 参与召回。</p>
        </div>
        <div className="flex gap-2 p-4">
          <input className="h-10 flex-1 border border-neutral-300 px-3 text-sm outline-none focus:border-teal-700" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识库" />
          <button className="h-10 bg-neutral-950 px-4 text-sm font-medium text-white" onClick={() => void runSearch()}>搜索</button>
        </div>
        <div className="px-4 pb-2 text-xs text-neutral-500">模式：{mode}</div>
        <div className="divide-y divide-neutral-200">
          {results.map((result) => (
            <article key={result.pageId} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{result.title}</h3>
                  <p className="mt-1 text-xs text-neutral-500">{result.path} · score {result.score.toFixed(4)}</p>
                </div>
                {result.titleMatch && <span className="border border-teal-700 px-2 py-1 text-xs text-teal-800">title</span>}
              </div>
              <p className="mt-3 text-sm leading-6 text-neutral-700">{result.snippet}</p>
              {result.images.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.images.map((image) => (
                    <button key={image.id} className="inline-flex items-center gap-2 border border-neutral-300 px-2 py-1 text-xs" onClick={() => setLightbox(image)}>
                      <Image className="h-3.5 w-3.5" />
                      {image.fileName}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
      <aside className="border border-neutral-300 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-semibold">问答</h2>
          <p className="mt-1 text-sm text-neutral-600">服务端完成搜索、图谱扩展、上下文预算和引用。</p>
        </div>
        <div className="p-4">
          <textarea className="h-32 w-full resize-none border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-teal-700" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="问一个具体问题" />
          <button className="mt-3 inline-flex h-10 items-center gap-2 bg-neutral-950 px-4 text-sm font-medium text-white" onClick={() => void ask()}>
            <Bot className="h-4 w-4" />
            提问
          </button>
          {answer && <pre className="mt-4 max-h-[390px] overflow-auto whitespace-pre-wrap border border-neutral-200 bg-neutral-50 p-3 text-sm leading-6">{answer}</pre>}
        </div>
      </aside>
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={() => setLightbox(null)}>
          <div className="max-h-full max-w-4xl bg-white p-4" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">{lightbox.fileName}</h3>
                <p className="text-xs text-neutral-600">{lightbox.caption}</p>
              </div>
              <button className="h-8 w-8 border border-neutral-300" onClick={() => setLightbox(null)}><X className="mx-auto h-4 w-4" /></button>
            </div>
            <img className="max-h-[70vh] max-w-full object-contain" src={api.objectUrl(kbId, lightbox.storageKey)} alt={lightbox.caption} />
          </div>
        </div>
      )}
    </section>
  )
}

function ReviewsPanel({ kbId }: { kbId: string }) {
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [topic, setTopic] = useState("")

  const load = async () => setReviews(await api.reviews(kbId))
  useEffect(() => {
    void load()
  }, [kbId])

  const runLint = async () => {
    await api.lint(kbId)
    await load()
  }

  const runResearch = async () => {
    if (!topic.trim()) return
    await api.research(kbId, topic)
    setTopic("")
    await load()
  }

  return (
    <section className="grid min-h-[680px] grid-cols-[360px_1fr] gap-4">
      <aside className="border border-neutral-300 bg-white p-4">
        <h2 className="text-base font-semibold">异步审核和深度研究</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          LLM 摄取、lint、图洞察和 deep research 都会进入同一个人工审核队列。
        </p>
        <button className="mt-4 h-10 w-full border border-neutral-300 text-sm" onClick={() => void runLint()}>运行 lint</button>
        <label className="mt-5 block text-xs font-medium text-neutral-600">深度研究主题</label>
        <input className="mt-1 h-10 w-full border border-neutral-300 px-3 text-sm outline-none focus:border-teal-700" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如：RAG 图谱检索" />
        <button className="mt-3 h-10 w-full bg-neutral-950 text-sm font-medium text-white" onClick={() => void runResearch()}>开始深度研究</button>
      </aside>
      <div className="overflow-auto border border-neutral-300 bg-white">
        <div className="sticky top-0 border-b border-neutral-200 bg-white px-4 py-3">
          <h2 className="text-base font-semibold">审核项</h2>
        </div>
        <div className="divide-y divide-neutral-200">
          {reviews.map((review) => (
            <article key={review.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold">{review.title}</h3>
                  <p className="mt-1 text-xs text-neutral-500">{review.kind} · {review.status}</p>
                </div>
                <span className="border border-neutral-300 px-2 py-1 text-xs">{new Date(review.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-neutral-700">{review.description}</p>
              {review.action && <p className="mt-2 text-sm text-teal-800">{review.action}</p>}
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export default App
