import { useEffect, useMemo, useState } from "react"
import type { InputHTMLAttributes, ReactElement, ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Bot,
  Blocks,
  Brain,
  Building2,
  Check,
  CheckCircle2,
  ChevronUp,
  ClipboardList,
  Database,
  Download,
  Eye,
  FileSearch,
  FileText,
  Folder,
  Globe2,
  HardDrive,
  Image,
  KeyRound,
  LibraryBig,
  LogOut,
  MessageSquare,
  Moon,
  Network,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Upload,
  UserRound,
  X,
} from "lucide-react"
import { API_BASE, api, getAuthToken } from "@/web/api"
import type {
  AuthPayload,
  Capabilities,
  CompanyModel,
  FileTreeNode,
  GraphResponse,
  IngestJob,
  KnowledgeBase,
  ReviewItem,
  SearchResult,
  SourceDocument,
  WikiPage,
  WikiTreeGroup,
} from "@/web/types"

type DetailTab = "sources" | "structure" | "graph" | "recall" | "reviews"
type FileSelection = {
  root: "raw" | "wiki"
  path: string
  name: string
  kind: "markdown" | "text" | "image" | "pdf" | "binary"
  text?: string
  imageUrl?: string
}
type AppRoute =
  | { page: "home" }
  | { page: "database" }
  | { page: "detail"; kbId: string }
  | { page: "extensions" }
  | { page: "companySettings" }

function App() {
  const [auth, setAuth] = useState<AuthPayload | null>(null)
  const [kbs, setKbs] = useState<KnowledgeBase[]>([])
  const [route, setRoute] = useState<AppRoute>(() => readRoute())
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = route.page === "detail" ? kbs.find((kb) => kb.id === route.kbId) ?? null : null

  const navigate = (path: string) => {
    window.history.pushState(null, "", path)
    setRoute(readRoute())
  }

  const loadKbs = async () => {
    setLoading(true)
    setError(null)
    try {
      const [items, caps] = await Promise.all([api.listKbs(), api.capabilities()])
      setKbs(items)
      setCapabilities(caps)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const onPopState = () => setRoute(readRoute())
    window.addEventListener("popstate", onPopState)
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
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const handleLoggedIn = (current: AuthPayload) => {
    setAuth(current)
    navigate("/")
    void loadKbs()
  }

  const logout = async () => {
    await api.logout()
    setAuth(null)
    setKbs([])
    navigate("/")
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

  if (route.page === "home") {
    return <LandingPage auth={auth} capabilities={capabilities} onStart={() => navigate("/database")} onLogout={() => void logout()} />
  }

  if (route.page === "detail" && selected) {
    return (
      <AppShell auth={auth} route={route} onNavigate={navigate} onLogout={() => void logout()}>
        <KnowledgeBaseDetail
          kb={selected}
          onBack={() => { navigate("/database"); void loadKbs() }}
          capabilities={capabilities}
        />
      </AppShell>
    )
  }

  if (route.page === "detail" && loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f4] text-sm text-neutral-600">
        正在加载知识库...
      </main>
    )
  }

  if (route.page === "detail" && !selected) {
    return (
      <AppShell auth={auth} route={route} onNavigate={navigate} onLogout={() => void logout()}>
        <section className="flex h-full items-center justify-center px-6 text-neutral-950">
          <div className="border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">知识库不存在或无权访问</h1>
          <button className="mt-4 h-10 rounded-md border border-neutral-200 px-4 text-sm" onClick={() => navigate("/database")}>
            返回知识库列表
          </button>
          </div>
        </section>
      </AppShell>
    )
  }

  if (route.page === "extensions") {
    return (
      <AppShell auth={auth} route={route} onNavigate={navigate} onLogout={() => void logout()}>
        <ExtensionsPage />
      </AppShell>
    )
  }

  if (route.page === "companySettings") {
    return (
      <AppShell auth={auth} route={route} onNavigate={navigate} onLogout={() => void logout()}>
        <CompanySettingsPage auth={auth} capabilities={capabilities} />
      </AppShell>
    )
  }

  return (
    <AppShell auth={auth} route={route} onNavigate={navigate} onLogout={() => void logout()}>
      <DatabaseListPage
        error={error}
        kbs={kbs}
        loading={loading}
        onCreate={() => setCreateOpen(true)}
        onOpen={(kbId) => navigate(`/database/${encodeURIComponent(kbId)}`)}
      />
      {createOpen && (
        <CreateKnowledgeBaseModal
          onClose={() => setCreateOpen(false)}
          onCreated={(kb) => {
            setKbs((items) => [kb, ...items])
            setCreateOpen(false)
            navigate(`/database/${encodeURIComponent(kb.id)}`)
          }}
        />
      )}
    </AppShell>
  )
}

function DatabaseListPage({
  error,
  kbs,
  loading,
  onCreate,
  onOpen,
}: {
  error: string | null
  kbs: KnowledgeBase[]
  loading: boolean
  onCreate: () => void
  onOpen: (kbId: string) => void
}) {
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    let alive = true
    if (kbs.length === 0) {
      setFileCounts({})
      return () => { alive = false }
    }
    void Promise.all(
      kbs.map(async (kb) => {
        try {
          const sources = await api.listSources(kb.id)
          return [kb.id, sources.filter((source) => source.root === "raw").length] as const
        } catch {
          return [kb.id, undefined] as const
        }
      }),
    ).then((entries) => {
      if (!alive) return
      const next: Record<string, number> = {}
      for (const [kbId, count] of entries) {
        if (typeof count === "number") next[kbId] = count
      }
      setFileCounts(next)
    })
    return () => { alive = false }
  }, [kbs])

  return (
    <section className="flex h-full flex-col bg-[#f6f7f9] text-neutral-950">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-5">
        <h1 className="text-lg font-semibold">知识库</h1>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-medium text-white shadow-sm hover:bg-cyan-800"
          onClick={onCreate}
        >
          <Plus className="h-4 w-4" />
          新建知识库
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        {loading ? (
          <div className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">正在连接 KN 服务端...</div>
        ) : kbs.length === 0 ? (
          <EmptyState onCreate={onCreate} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {kbs.map((kb) => (
              <KnowledgeBaseCard key={kb.id} fileCount={fileCounts[kb.id]} kb={kb} onOpen={() => onOpen(kb.id)} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function KnowledgeBaseCard({ fileCount, kb, onOpen }: { fileCount?: number; kb: KnowledgeBase; onOpen: () => void }) {
  return (
    <button
      className="group flex h-32 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-cyan-200 hover:bg-cyan-50/40 hover:shadow-md"
      onClick={onOpen}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-700">
          <LibraryBig className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{kb.name}</h2>
          <p className="mt-1 text-xs text-neutral-500">{typeof fileCount === "number" ? `${fileCount} 个文件` : "正在统计文件"}</p>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-5 text-neutral-600">{kb.description || "暂无描述"}</p>
    </button>
  )
}

function CreateKnowledgeBaseModal({ onCreated, onClose }: { onCreated: (kb: KnowledgeBase) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-6" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">新建知识库</h2>
            <p className="mt-1 text-sm text-neutral-500">创建后写入 database/{`{kb_id}`}/raw 和 wiki 目录。</p>
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-neutral-100" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          <CreateKnowledgeBase onCreated={onCreated} />
        </div>
      </div>
    </div>
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

function AppShell({
  auth,
  route,
  children,
  onNavigate,
  onLogout,
}: {
  auth: AuthPayload
  route: AppRoute
  children: ReactNode
  onNavigate: (path: string) => void
  onLogout: () => void
}) {
  const [userOpen, setUserOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const isAdmin = auth.user.isPlatformAdmin || auth.user.role === "platform_admin" || auth.user.role === "org_admin"
  const active = route.page === "database" || route.page === "detail" ? "database" : route.page

  return (
    <main className="flex h-screen overflow-hidden bg-white text-neutral-950">
      <aside className="flex w-[52px] shrink-0 flex-col items-center border-r border-neutral-200 bg-[#fbfbfc]">
        <button
          className="mt-2 flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-white text-cyan-700 shadow-sm"
          title="引导页"
          onClick={() => onNavigate("/")}
        >
          <img className="h-full w-full object-cover" src="/logo.jpg" alt="LLM Wiki" onError={(event) => { event.currentTarget.style.display = "none" }} />
          <Brain className="hidden h-5 w-5" />
        </button>

        <nav className="mt-6 flex flex-col items-center gap-3">
          <SidebarButton
            active={active === "database"}
            icon={<LibraryBig className="h-5 w-5" />}
            label="知识库"
            onClick={() => onNavigate("/database")}
          />
          <SidebarButton
            active={active === "extensions"}
            icon={<Blocks className="h-5 w-5" />}
            label="扩展管理"
            onClick={() => onNavigate("/extensions")}
          />
        </nav>

        <div className="flex-1" />

        <nav className="mb-2 flex flex-col items-center gap-3">
          <SidebarButton
            active={tasksOpen}
            icon={<ClipboardList className="h-5 w-5" />}
            label="任务中心"
            onClick={() => setTasksOpen(true)}
          />
          {isAdmin && (
            <SidebarButton
              active={active === "companySettings"}
              icon={<Settings className="h-5 w-5" />}
              label="公司设置"
              onClick={() => onNavigate("/company-settings")}
            />
          )}
          <div className="relative">
            <button
              className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50"
              title="个人中心"
              onClick={() => setUserOpen((open) => !open)}
            >
              <span className="text-xs font-semibold">{auth.user.displayName?.slice(0, 1) || auth.user.username.slice(0, 1)}</span>
            </button>
            {userOpen && (
              <UserMenu
                auth={auth}
                isAdmin={isAdmin}
                onDocs={() => setUserOpen(false)}
                onCompanySettings={() => { setUserOpen(false); onNavigate("/company-settings") }}
                onLogout={() => { setUserOpen(false); onLogout() }}
              />
            )}
          </div>
        </nav>
      </aside>

      <section className="min-w-0 flex-1 overflow-hidden bg-[#f6f7f9]">{children}</section>

      {tasksOpen && <TaskCenterOverlay onClose={() => setTasksOpen(false)} />}
    </main>
  )
}

function SidebarButton({ active, icon, label, onClick }: { active: boolean; icon: ReactElement; label: string; onClick: () => void }) {
  return (
    <button
      className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${
        active ? "border-cyan-100 bg-cyan-50 text-cyan-700 shadow-sm" : "border-transparent text-neutral-600 hover:bg-white hover:text-cyan-700 hover:shadow-sm"
      }`}
      title={label}
      onClick={onClick}
    >
      {icon}
    </button>
  )
}

function UserMenu({
  auth,
  isAdmin,
  onDocs,
  onCompanySettings,
  onLogout,
}: {
  auth: AuthPayload
  isAdmin: boolean
  onDocs: () => void
  onCompanySettings: () => void
  onLogout: () => void
}) {
  const roleLabel = auth.user.isPlatformAdmin ? "超级管理员" : auth.user.role === "org_admin" ? "公司管理员" : "公司成员"
  return (
    <div className="absolute bottom-0 left-12 z-40 w-60 rounded-lg border border-neutral-200 bg-white py-2 shadow-xl">
      <div className="flex items-start gap-3 px-3 pb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cyan-50 text-sm font-semibold text-cyan-700">
          {auth.user.displayName?.slice(0, 1) || auth.user.username.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{auth.user.displayName || auth.user.username}</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
            <Building2 className="h-3 w-3" />
            <span className="truncate">{auth.company.name}</span>
            <ChevronUp className="ml-auto h-3 w-3" />
          </div>
          <div className="mt-1 text-xs text-neutral-500">{roleLabel}</div>
        </div>
      </div>
      <div className="border-t border-neutral-100 py-1">
        <MenuButton icon={<BookOpen className="h-4 w-4" />} label="文档中心" onClick={onDocs} />
        <MenuButton icon={<Moon className="h-4 w-4" />} label="切换到深色模式 (Beta)" onClick={onDocs} />
      </div>
      {isAdmin && (
        <div className="border-t border-neutral-100 py-1">
          <MenuButton icon={<Settings className="h-4 w-4" />} label="公司设置" onClick={onCompanySettings} />
        </div>
      )}
      <div className="border-t border-neutral-100 py-1">
        <MenuButton icon={<LogOut className="h-4 w-4" />} label="退出登录" onClick={onLogout} />
      </div>
    </div>
  )
}

function MenuButton({ icon, label, onClick }: { icon: ReactElement; label: string; onClick: () => void }) {
  return (
    <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50" onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

function TaskCenterOverlay({ onClose }: { onClose: () => void }) {
  const tasks = [
    ["持久化摄取队列", "上传、文件夹导入、崩溃恢复、取消和重试。"],
    ["图洞察任务", "基于 4-Signal 图谱和 Louvain 社区生成研究线索。"],
    ["异步审核", "lint、LLM review、Deep Research 结果进入人工判断。"],
  ]
  return (
    <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose}>
      <aside className="absolute bottom-4 left-16 w-[420px] rounded-lg border border-neutral-200 bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">任务中心</h2>
          <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-neutral-50" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 divide-y divide-neutral-100 rounded-md border border-neutral-100">
          {tasks.map(([name, description]) => (
            <div key={name} className="flex gap-3 p-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-50 text-cyan-700">
                <Activity className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium">{name}</div>
                <div className="mt-1 text-xs leading-5 text-neutral-500">{description}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
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
  const [visibility, setVisibility] = useState<KnowledgeBase["visibility"]>("company")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      onCreated(await api.createKb(name, description, visibility))
      setName("")
      setDescription("")
      setVisibility("company")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">知识库配置</h2>
      <p className="mt-2 text-sm leading-5 text-neutral-600">
        创建后会初始化 llm_wiki 规则、schema、purpose、wiki/index 和 overview。
      </p>
      <label className="mt-5 block text-xs font-medium text-neutral-600">名称</label>
      <input
        id="new-kb-name"
        className="mt-1 h-10 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="例如：AI 研究知识库"
      />
      <label className="mt-3 block text-xs font-medium text-neutral-600">描述</label>
      <textarea
        className="mt-1 h-24 w-full resize-none rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-cyan-600"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="这个知识库要解决什么问题"
      />
      <label className="mt-3 block text-xs font-medium text-neutral-600">可见性</label>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <button
          className={`h-10 rounded-md border px-3 text-sm ${visibility === "company" ? "border-cyan-600 bg-cyan-50 text-cyan-900" : "border-neutral-200 bg-white"}`}
          onClick={() => setVisibility("company")}
          type="button"
        >
          全公司可见
        </button>
        <button
          className={`h-10 rounded-md border px-3 text-sm ${visibility === "creator_only" ? "border-cyan-600 bg-cyan-50 text-cyan-900" : "border-neutral-200 bg-white"}`}
          onClick={() => setVisibility("creator_only")}
          type="button"
        >
          仅创建者
        </button>
      </div>
      <button
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-medium text-white disabled:opacity-50"
        disabled={busy || !name.trim()}
        onClick={() => void submit()}
      >
        <Plus className="h-4 w-4" />
        {busy ? "创建中" : "创建知识库"}
      </button>
    </section>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full min-h-96 items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-white">
      <div className="max-w-md text-center">
        <Brain className="mx-auto h-10 w-10 text-teal-700" />
        <h2 className="mt-4 text-lg font-semibold">还没有知识库</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          从左侧创建第一个知识库，然后上传文档。后台会按两步式摄取生成可追溯 wiki 页面。
        </p>
        <button className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-medium text-white" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          创建知识库
        </button>
      </div>
    </div>
  )
}

function LandingPage({
  auth,
  capabilities,
  onStart,
  onLogout,
}: {
  auth: AuthPayload
  capabilities: Capabilities | null
  onStart: () => void
  onLogout: () => void
}) {
  return (
    <main className="min-h-screen bg-[#f7f7f4] text-neutral-950">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6">
        <header className="flex items-center justify-between border-b border-neutral-300 pb-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-teal-700">LLM Wiki Knowledge Network</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">企业知识库</h1>
          </div>
          <div className="flex items-center gap-2">
            <UserBadge auth={auth} />
            <button
              className="inline-flex h-10 items-center gap-2 border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-100"
              onClick={onLogout}
            >
              <LogOut className="h-4 w-4" />
              退出
            </button>
          </div>
        </header>

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_420px] gap-8 py-10">
          <section className="flex flex-col justify-center">
            <div className="max-w-3xl">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-teal-700">Raw Sources {"->"} Wiki {"->"} Graph</p>
              <h2 className="mt-4 text-5xl font-semibold leading-tight tracking-normal">
                用 `llm_wiki` 把公司文档变成可追溯知识网络
              </h2>
              <p className="mt-5 text-lg leading-8 text-neutral-700">
                上传文件或文件夹后，系统会保留 raw 目录结构，通过两步式 LLM 摄取生成 wiki 页面，
                再构建 4-Signal 知识图谱、Louvain 社区、混合召回和人工审核队列。
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <button className="inline-flex h-11 items-center gap-2 bg-neutral-950 px-5 text-sm font-medium text-white" onClick={onStart}>
                  <Database className="h-4 w-4" />
                  开始体验
                </button>
                <span className="inline-flex h-11 items-center border border-neutral-300 bg-white px-4 text-sm text-neutral-700">
                  默认进入 /database 管理知识库
                </span>
              </div>
            </div>
          </section>

          <aside className="self-center border border-neutral-300 bg-white p-5">
            <h3 className="text-base font-semibold">当前能力</h3>
            <div className="mt-4 grid gap-3">
              {[
                ["raw/", "用户上传的原始文件和文件夹"],
                ["wiki/", "LLM 生成的 index、overview、schema、source pages"],
                ["Graph", "4-Signal 图谱、社区和图洞察"],
                ["Review", "Lint、异步审核和 Deep Research"],
              ].map(([title, description]) => (
                <div key={title} className="border border-neutral-200 bg-neutral-50 p-3">
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="mt-1 text-sm text-neutral-600">{description}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <CapabilityStrip capabilities={capabilities} />
      </section>
    </main>
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

function ExtensionsPage() {
  return (
    <section className="flex h-full flex-col bg-white">
      <header className="flex h-12 items-center border-b border-neutral-100 px-4">
        <h1 className="text-lg font-semibold">扩展管理</h1>
      </header>
      <div className="grid max-w-5xl grid-cols-3 gap-4 p-4">
        {[
          ["Web Clipper", "网页内容转 Markdown 写入 raw/，进入同一套 llm_wiki 摄取流程。"],
          ["REST API", "开放知识库列表、文件读取、混合搜索、图谱遍历和 raw 重扫接口。"],
          ["MCP Server", "后续企业化能力，基于服务端 API 暴露给 Agent 工具链。"],
        ].map(([name, description]) => (
          <article key={name} className="rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
              <Blocks className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold">{name}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">{description}</p>
            <button className="mt-4 h-8 rounded-md border border-neutral-200 px-3 text-sm text-neutral-600">规划中</button>
          </article>
        ))}
      </div>
    </section>
  )
}

function CompanySettingsPage({ auth, capabilities }: { auth: AuthPayload; capabilities: Capabilities | null }) {
  const isAdmin = auth.user.isPlatformAdmin || auth.user.role === "platform_admin" || auth.user.role === "org_admin"
  const [models, setModels] = useState<CompanyModel[]>([])
  const [modelError, setModelError] = useState<string | null>(null)
  const [modelBusy, setModelBusy] = useState(false)
  const [modelForm, setModelForm] = useState({
    name: "公司默认 LLM",
    provider: "openai" as CompanyModel["provider"],
    model: capabilities?.providers.model || "gpt-4o-mini",
    endpoint: "",
    apiKey: "",
    llm: true,
    embedding: false,
    vision: true,
    defaultLlm: true,
    defaultEmbedding: false,
    defaultVision: true,
  })
  const searchProviders = Object.entries(capabilities?.searchProviders ?? {}).filter(([, enabled]) => enabled).map(([name]) => name)
  useEffect(() => {
    if (!isAdmin) return
    void api.companyModels()
      .then(setModels)
      .catch((err) => setModelError(err instanceof Error ? err.message : String(err)))
  }, [isAdmin])

  const saveModel = async () => {
    setModelBusy(true)
    setModelError(null)
    try {
      const capabilities: CompanyModel["capabilities"] = []
      if (modelForm.llm) capabilities.push("llm")
      if (modelForm.embedding) capabilities.push("embedding")
      if (modelForm.vision) capabilities.push("vision")
      const saved = await api.saveCompanyModel({
        name: modelForm.name,
        provider: modelForm.provider,
        model: modelForm.model,
        endpoint: modelForm.endpoint,
        apiKey: modelForm.apiKey || undefined,
        capabilities,
        isDefaultLlm: modelForm.defaultLlm,
        isDefaultEmbedding: modelForm.defaultEmbedding,
        isDefaultVision: modelForm.defaultVision,
      })
      setModels((items) => [saved, ...items.filter((item) => item.id !== saved.id)])
      setModelForm((form) => ({ ...form, apiKey: "" }))
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelBusy(false)
    }
  }

  const modelRows = [
    {
      type: "LLM",
      model: capabilities?.providers.model || "未配置",
      provider: capabilities?.providers.chatConfigured ? "OpenAI Compatible" : "等待 KN_LLM_ENDPOINT",
      usage: "两步式摄取、问答、图洞察、Deep Research",
      status: capabilities?.providers.chatConfigured ? "可用" : "待配置",
      icon: <Bot className="h-4 w-4" />,
    },
    {
      type: "文本嵌入",
      model: capabilities?.providers.embeddingModel || "未配置",
      provider: capabilities?.providers.embeddingConfigured ? "OpenAI Compatible" : "等待 KN_EMBEDDING_ENDPOINT",
      usage: "pgvector 语义召回、RRF 混合检索",
      status: capabilities?.providers.embeddingConfigured ? "可用" : "待配置",
      icon: <Network className="h-4 w-4" />,
    },
    {
      type: "视觉模型",
      model: capabilities?.providers.model || "公司默认视觉模型",
      provider: "OpenAI Compatible Vision",
      usage: "PDF 嵌入图片说明、图像感知召回",
      status: capabilities?.providers.chatConfigured ? "继承 LLM" : "待配置",
      icon: <Image className="h-4 w-4" />,
    },
    {
      type: "Web Search",
      model: searchProviders.join(", ") || "未配置",
      provider: "Tavily / SerpApi / SearXNG",
      usage: "Deep Research 多查询导入 wiki",
      status: searchProviders.length ? "可用" : "可选",
      icon: <Globe2 className="h-4 w-4" />,
    },
  ]
  const displayedModels = models.length > 0
    ? models.map((model) => ({
      type: model.capabilities.join(" / "),
      model: model.model,
      provider: model.provider,
      usage: `${model.name} · ${model.endpoint || "未配置 endpoint"}`,
      status: [
        model.isDefaultLlm ? "默认 LLM" : "",
        model.isDefaultEmbedding ? "默认 Embedding" : "",
        model.isDefaultVision ? "默认 Vision" : "",
      ].filter(Boolean).join(" / ") || "模型池",
      icon: model.capabilities.includes("embedding")
        ? <Network className="h-4 w-4" />
        : model.capabilities.includes("vision")
          ? <Image className="h-4 w-4" />
          : <Bot className="h-4 w-4" />,
    }))
    : modelRows

  if (!isAdmin) {
    return (
      <section className="flex h-full items-center justify-center bg-[#f6f7f9]">
        <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-9 w-9 text-neutral-400" />
          <h1 className="mt-3 text-base font-semibold">需要公司管理员权限</h1>
          <p className="mt-2 text-sm text-neutral-500">公司设置只对平台管理员和公司管理员开放。</p>
        </div>
      </section>
    )
  }

  return (
    <section className="flex h-full flex-col bg-[#f6f7f9]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-5">
        <div>
          <h1 className="text-lg font-semibold">公司设置</h1>
          <p className="mt-0.5 text-xs text-neutral-500">租户、成员、LDAP 登录、模型池和知识库默认能力。</p>
        </div>
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm text-neutral-600">{auth.company.name}</div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] gap-4 overflow-auto p-4">
        <aside className="flex min-h-0 flex-col gap-4">
          <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">{auth.company.name}</h2>
                <p className="mt-1 text-xs text-neutral-500">tenant: {auth.company.slug}</p>
              </div>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-neutral-500">默认公司</dt>
                <dd className="mt-1 font-medium">{auth.company.slug === "default" ? "是，LDAP 用户默认进入" : "否"}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">当前身份</dt>
                <dd className="mt-1 font-medium">{auth.user.isPlatformAdmin ? "平台管理员" : auth.user.role}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">知识库可见性</dt>
                <dd className="mt-1 font-medium">全公司可见 / 仅创建者可见</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold">管理员入口</h2>
            <div className="mt-3 space-y-2">
              {[
                ["LDAP 登录", "真实 LDAP 优先，xcdebugpwd 仅用于已存在用户调试。"],
                ["成员权限", "公司成员默认可见全公司知识库。"],
                ["租户隔离", "company_id + kb_id + root + relative_path 组合隔离。"],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-md border border-neutral-100 bg-neutral-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4 text-cyan-700" />
                    {title}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">{desc}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <div className="min-w-0 space-y-4">
          <section className="grid grid-cols-3 gap-4">
            <DefaultModelCard title="默认 LLM" value={capabilities?.providers.model || "未配置"} active={Boolean(capabilities?.providers.chatConfigured)} />
            <DefaultModelCard title="默认 Embedding" value={capabilities?.providers.embeddingModel || "未配置"} active={Boolean(capabilities?.providers.embeddingConfigured)} />
            <DefaultModelCard title="默认视觉模型" value={capabilities?.providers.model || "继承 LLM"} active={Boolean(capabilities?.providers.chatConfigured)} />
          </section>

          <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold">模型池</h2>
                <p className="mt-1 text-sm text-neutral-600">公司级统一维护文本嵌入、LLM、视觉模型和搜索提供商，知识库创建时继承默认模型。</p>
              </div>
              <span className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">{models.length} 个模型</span>
            </div>
            <div className="divide-y divide-neutral-100">
              {displayedModels.map((row) => (
                <div key={row.type} className="grid grid-cols-[180px_1fr_180px_140px] items-center gap-3 px-4 py-3 text-sm">
                  <div className="flex items-center gap-3 font-medium">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-cyan-50 text-cyan-700">{row.icon}</span>
                    {row.type}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.model}</div>
                    <div className="mt-1 truncate text-xs text-neutral-500">{row.usage}</div>
                  </div>
                  <div className="truncate text-neutral-600">{row.provider}</div>
                  <div>
                    <span className={`rounded px-2 py-1 text-xs ${row.status === "可用" || row.status === "继承 LLM" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {row.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">添加或更新公司模型</h2>
                <p className="mt-1 text-sm text-neutral-600">兼容 OpenAI 协议端点，可登记千问、DeepSeek、Kimi、Claude Code、Ollama 和自定义模型。</p>
              </div>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-medium text-white disabled:opacity-50"
                disabled={modelBusy || !modelForm.name.trim() || !modelForm.model.trim()}
                onClick={() => void saveModel()}
              >
                <Plus className="h-4 w-4" />
                {modelBusy ? "保存中" : "保存模型"}
              </button>
            </div>
            {modelError && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{modelError}</div>}
            <div className="mt-4 grid grid-cols-4 gap-3">
              <Field label="名称">
                <input className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600" value={modelForm.name} onChange={(event) => setModelForm((form) => ({ ...form, name: event.target.value }))} />
              </Field>
              <Field label="供应商">
                <select className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600" value={modelForm.provider} onChange={(event) => setModelForm((form) => ({ ...form, provider: event.target.value as CompanyModel["provider"] }))}>
                  {["openai", "qwen", "deepseek", "kimi", "claudecode", "ollama", "custom"].map((provider) => (
                    <option key={provider} value={provider}>{provider}</option>
                  ))}
                </select>
              </Field>
              <Field label="模型名">
                <input className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600" value={modelForm.model} onChange={(event) => setModelForm((form) => ({ ...form, model: event.target.value }))} />
              </Field>
              <Field label="API Key">
                <input className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600" value={modelForm.apiKey} onChange={(event) => setModelForm((form) => ({ ...form, apiKey: event.target.value }))} placeholder="留空则保留旧密钥" type="password" />
              </Field>
              <Field label="OpenAI 兼容 Endpoint">
                <input className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600" value={modelForm.endpoint} onChange={(event) => setModelForm((form) => ({ ...form, endpoint: event.target.value }))} placeholder="https://... 或 http://localhost:11434" />
              </Field>
              <Field label="能力">
                <div className="flex h-9 items-center gap-3 text-sm">
                  <CheckBox label="LLM" checked={modelForm.llm} onChange={(checked) => setModelForm((form) => ({ ...form, llm: checked }))} />
                  <CheckBox label="Embedding" checked={modelForm.embedding} onChange={(checked) => setModelForm((form) => ({ ...form, embedding: checked }))} />
                  <CheckBox label="Vision" checked={modelForm.vision} onChange={(checked) => setModelForm((form) => ({ ...form, vision: checked }))} />
                </div>
              </Field>
              <Field label="默认角色">
                <div className="flex h-9 items-center gap-3 text-sm">
                  <CheckBox label="LLM" checked={modelForm.defaultLlm} onChange={(checked) => setModelForm((form) => ({ ...form, defaultLlm: checked }))} />
                  <CheckBox label="Embedding" checked={modelForm.defaultEmbedding} onChange={(checked) => setModelForm((form) => ({ ...form, defaultEmbedding: checked }))} />
                  <CheckBox label="Vision" checked={modelForm.defaultVision} onChange={(checked) => setModelForm((form) => ({ ...form, defaultVision: checked }))} />
                </div>
              </Field>
            </div>
          </section>

          <section className="grid grid-cols-3 gap-4">
            <PolicyCard icon={<HardDrive className="h-4 w-4" />} title="知识库存储" text="database/{真实 kb_id}/raw 与 wiki 分离，界面隐藏真实前缀。" />
            <PolicyCard icon={<Eye className="h-4 w-4" />} title="成员可见范围" text="成员登录后可见公司级知识库，私有库仅创建者可见。" />
            <PolicyCard icon={<Check className="h-4 w-4" />} title="默认策略" text="新知识库只使用 llm_wiki 形态，模型和搜索策略继承公司默认值。" />
          </section>
        </div>
      </div>
    </section>
  )
}

function DefaultModelCard({ title, value, active }: { title: string; value: string; active: boolean }) {
  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className={`rounded px-2 py-1 text-xs ${active ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {active ? "可用" : "待配置"}
        </span>
      </div>
      <p className="mt-3 truncate text-sm text-neutral-600">{value}</p>
    </article>
  )
}

function PolicyCard({ icon, title, text }: { icon: ReactElement; title: string; text: string }) {
  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-neutral-700">{icon}</span>
        {title}
      </div>
      <p className="mt-3 text-sm leading-6 text-neutral-600">{text}</p>
    </article>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  )
}

function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-neutral-700">
      <input className="h-3.5 w-3.5 accent-cyan-700" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function KnowledgeBaseDetail({
  kb,
  onBack,
  capabilities,
}: {
  kb: KnowledgeBase
  onBack: () => void
  capabilities: Capabilities | null
}) {
  const [tab, setTab] = useState<DetailTab>("graph")
  const detailTabs: Array<{ key: DetailTab; label: string; icon: ReactElement }> = [
    { key: "graph", label: "知识图谱", icon: <Network className="h-4 w-4" /> },
    { key: "recall", label: "检索测试", icon: <MessageSquare className="h-4 w-4" /> },
    { key: "reviews", label: "审核研究", icon: <ClipboardList className="h-4 w-4" /> },
  ]

  return (
    <section className="flex h-full flex-col bg-[#f6f7f9] text-neutral-950">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-neutral-100" onClick={onBack} title="返回知识库列表">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{kb.name}</h1>
              <span className="rounded bg-purple-50 px-2 py-1 text-xs text-purple-700">llm_wiki</span>
              <span className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600">v{kb.dataVersion}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-neutral-500">/database/{kb.id} · {kb.visibility === "company" ? "全公司可见" : "仅创建者可见"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>更新于 {new Date(kb.updatedAt).toLocaleString()}</span>
          <button className="inline-flex h-8 items-center gap-2 rounded-md border border-neutral-200 px-3 text-sm text-neutral-600">
            <Settings className="h-4 w-4" />
            检索配置
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[42%_minmax(0,1fr)] gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-3">
          <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">知识库概览</h2>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-600">{kb.description || "浏览器知识库详情"}</p>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                <LibraryBig className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniInfo label="原始文件" value="raw/" />
              <MiniInfo label="Wiki 页面" value="wiki/" />
              <MiniInfo label="向量模型" value={capabilities?.providers.embeddingConfigured ? capabilities.providers.embeddingModel : "待配置"} />
            </div>
          </section>

          <div className="min-h-0 flex-1">
            <SourcesPanel kbId={kb.id} />
          </div>
        </div>

        <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-100 px-4">
            <nav className="flex h-full items-center gap-1">
              {detailTabs.map((item) => (
                <DetailTabButton
                  key={item.key}
                  active={tab === item.key}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => setTab(item.key)}
                />
              ))}
            </nav>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden bg-white">
            {tab === "graph" && <GraphPanel kbId={kb.id} />}
            {tab === "recall" && <RecallPanel kbId={kb.id} />}
            {tab === "structure" && <StructurePanel kbId={kb.id} />}
            {tab === "reviews" && <ReviewsPanel kbId={kb.id} />}
          </div>
        </section>
      </div>
    </section>
  )
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-100 bg-neutral-50 p-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  )
}

function DetailTabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactElement; label: string; onClick: () => void }) {
  return (
    <button
      className={`relative inline-flex h-full items-center gap-2 px-3 text-sm font-medium ${active ? "text-cyan-700" : "text-neutral-700 hover:text-cyan-700"}`}
      onClick={onClick}
    >
      {icon}
      {label}
      {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-700" />}
    </button>
  )
}

function SourcesPanel({ kbId }: { kbId: string }) {
  const [rawTree, setRawTree] = useState<FileTreeNode[]>([])
  const [wikiTree, setWikiTree] = useState<FileTreeNode[]>([])
  const [sources, setSources] = useState<SourceDocument[]>([])
  const [jobs, setJobs] = useState<IngestJob[]>([])
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<FileSelection | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

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
    const uploadItems = Array.from(files).map((file) => ({
      file,
      relativePath: normalizeClientRelativePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name),
    }))
    const existingByPath = new Map(
      sources
        .filter((source) => source.root === "raw")
        .map((source) => [normalizeClientRelativePath(source.relativePath), source]),
    )
    const conflicts = uploadItems.filter((item) => existingByPath.has(item.relativePath))
    let acceptedItems = uploadItems
    if (conflicts.length > 0) {
      const lines = conflicts.slice(0, 12).map((item) => {
        const existing = existingByPath.get(item.relativePath)
        const updatedAt = existing?.updatedAt ? new Date(existing.updatedAt).toLocaleString() : "未知时间"
        return `- ${item.relativePath}（原文件更新时间：${updatedAt}）`
      })
      const more = conflicts.length > lines.length ? `\n... 另有 ${conflicts.length - lines.length} 个冲突文件` : ""
      const overwrite = window.confirm(`以下 raw 路径已经存在同名文件，继续将覆盖旧文件：\n\n${lines.join("\n")}${more}\n\n确定覆盖这些文件吗？`)
      if (!overwrite) {
        const conflictPaths = new Set(conflicts.map((item) => item.relativePath))
        acceptedItems = uploadItems.filter((item) => !conflictPaths.has(item.relativePath))
      }
    }
    if (acceptedItems.length === 0) return
    setUploading(true)
    try {
      await api.uploadFiles(kbId, acceptedItems)
      await load()
    } finally {
      setUploading(false)
    }
  }

  const folderInputProps = {
    webkitdirectory: "",
    directory: "",
  } as InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string; directory: string }

  const openFile = async (root: "raw" | "wiki", node: FileTreeNode) => {
    if (node.isDirectory) return
    const kind = inferFileKind(node.name)
    const nextFile: FileSelection = {
      root,
      path: node.path,
      name: node.name,
      kind,
      imageUrl: kind === "image" ? api.objectUrl(kbId, node.path) : undefined,
    }
    setSelectedFile(nextFile)
    setFileLoading(true)
    setFileError(null)
    try {
      if (kind === "image" || kind === "pdf" || kind === "binary") {
        setSelectedFile(nextFile)
      } else {
        setSelectedFile({ ...nextFile, text: await api.objectText(kbId, node.path) })
      }
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err))
    } finally {
      setFileLoading(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <section className="shrink-0 border-b border-neutral-100 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">文件目录与摄取队列</h2>
            <p className="mt-1 text-sm text-neutral-600">raw 保留用户上传结构，wiki 按 llm_wiki 规则生成可追溯页面。</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-neutral-200 px-3 text-sm hover:bg-neutral-50">
              <Upload className="h-4 w-4" />
              {uploading ? "上传中" : "上传文件"}
              <input className="hidden" type="file" multiple onChange={(event) => void upload(event.target.files)} />
            </label>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-neutral-200 px-3 text-sm hover:bg-neutral-50">
              <Folder className="h-4 w-4" />
              文件夹
              <input className="hidden" type="file" multiple {...folderInputProps} onChange={(event) => void upload(event.target.files)} />
            </label>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-200 px-3 text-sm hover:bg-neutral-50" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </div>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-3">
        <TreePanel title="raw 上传目录" nodes={rawTree} selectedPath={selectedFile?.path} onOpenFile={(node) => void openFile("raw", node)} />
        <TreePanel title="wiki 规则目录" nodes={wikiTree} selectedPath={selectedFile?.path} onOpenFile={(node) => void openFile("wiki", node)} />
      </section>

      <DocumentPreviewModal
        kbId={kbId}
        file={selectedFile}
        loading={fileLoading}
        error={fileError}
        onClose={() => {
          setSelectedFile(null)
          setFileError(null)
        }}
      />

      <section className="max-h-44 shrink-0 overflow-auto border-t border-neutral-100 bg-white">
        <div className="sticky top-0 z-10 border-b border-neutral-100 bg-white px-3 py-2">
          <h3 className="text-sm font-semibold">队列和源文件</h3>
        </div>
        <div className="divide-y divide-neutral-100">
          {jobs.length === 0 && sources.length === 0 && <div className="p-3 text-sm text-neutral-500">暂无上传文件</div>}
          {jobs.map((job) => (
            <div key={job.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase text-neutral-500">{job.status}</span>
                <span className="text-xs text-neutral-500">{job.progress}%</span>
              </div>
              <div className="mt-2 h-1.5 rounded bg-neutral-200">
                <div className="h-full rounded bg-cyan-700" style={{ width: `${job.progress}%` }} />
              </div>
              <p className="mt-2 text-sm">{job.stage}</p>
              {job.error && <p className="mt-1 text-xs text-red-700">{job.error}</p>}
              <div className="mt-2 flex gap-2">
                {job.status === "running" || job.status === "queued" ? (
                  <button className="rounded border border-neutral-200 px-2 py-1 text-xs" onClick={() => void api.cancelJob(job.id).then(load)}>
                    取消
                  </button>
                ) : null}
                {job.status === "failed" || job.status === "cancelled" ? (
                  <button className="rounded border border-neutral-200 px-2 py-1 text-xs" onClick={() => void api.retryJob(job.id).then(load)}>
                    重试
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {sources.map((source) => (
            <div key={source.id} className="p-3 text-sm">
              <div className="font-medium">{source.relativePath}</div>
              <div className="mt-1 text-xs text-neutral-500">
                {source.status} · {source.root}/{source.parentPath || "/"} · {source.uploadBatchId || "no-batch"}
              </div>
              {source.folderContext && (
                <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs leading-5 text-neutral-600">
                  {source.folderContext}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function TreePanel({
  title,
  nodes,
  selectedPath,
  onOpenFile,
}: {
  title: string
  nodes: FileTreeNode[]
  selectedPath?: string
  onOpenFile: (node: FileTreeNode) => void
}) {
  return (
    <div className="min-h-0 overflow-auto rounded-md border border-neutral-200 bg-white">
      <div className="sticky top-0 z-10 border-b border-neutral-100 bg-white px-3 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="p-3">
        {nodes.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无文件</p>
        ) : (
          nodes.map((node) => <TreeNodeView key={node.path} node={node} depth={0} selectedPath={selectedPath} onOpenFile={onOpenFile} />)
        )}
      </div>
    </div>
  )
}

function TreeNodeView({
  node,
  depth,
  selectedPath,
  onOpenFile,
}: {
  node: FileTreeNode
  depth: number
  selectedPath?: string
  onOpenFile: (node: FileTreeNode) => void
}) {
  const [open, setOpen] = useState(true)
  const selected = selectedPath === node.path
  const toggle = () => {
    if (node.isDirectory) setOpen((value) => !value)
    else onOpenFile(node)
  }
  return (
    <div>
      <button
        className={`flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm ${selected ? "bg-cyan-50 text-cyan-800" : "hover:bg-neutral-50"}`}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={toggle}
        type="button"
      >
        {node.isDirectory && <ChevronUp className={`h-3 w-3 text-neutral-400 transition ${open ? "" : "rotate-90"}`} />}
        {node.isDirectory ? <Folder className="h-4 w-4 text-amber-700" /> : <FileSearch className="h-4 w-4 text-neutral-500" />}
        <span className="truncate">{node.name}</span>
      </button>
      {open && node.children?.map((child) => <TreeNodeView key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onOpenFile={onOpenFile} />)}
    </div>
  )
}

function DocumentPreviewModal({
  kbId,
  file,
  loading,
  error,
  onClose,
}: {
  kbId: string
  file: FileSelection | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!file && !error) return
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [file, error, onClose])

  if (!file && !error) return null
  const contentLength = file?.text?.length ?? 0
  const modeLabel = file?.kind === "markdown" ? "Markdown" : file?.kind === "text" ? "原文" : file?.kind === "image" ? "Image" : file?.kind === "pdf" ? "PDF" : "文件"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/55 p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <section className="flex h-[82vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="h-4 w-4 shrink-0 text-neutral-500" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{file?.name ?? "文件预览"}</h3>
              {file && <p className="mt-0.5 truncate text-xs text-neutral-500">{file.root}/{file.path.replace(/^(raw|wiki)\//, "")}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-xs text-neutral-500">{contentLength > 0 ? `${formatCharCount(contentLength)} 字符` : "原文件"}</span>
            <span className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800">{modeLabel}</span>
            {file && (
              <a
                className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-200 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                href={api.objectUrl(kbId, file.path)}
                target="_blank"
                rel="noreferrer"
                download={file.name}
              >
                <Download className="h-4 w-4" />
                下载
              </a>
            )}
            <button className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" onClick={onClose} type="button" aria-label="关闭预览">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-6">
          {loading && <p className="text-sm text-neutral-500">正在读取原文...</p>}
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {!loading && !error && file?.kind === "markdown" && <MarkdownView content={file.text ?? ""} />}
          {!loading && !error && file?.kind === "text" && (
            <pre className="whitespace-pre-wrap rounded-md bg-neutral-50 p-4 text-sm leading-7 text-neutral-800">{file.text}</pre>
          )}
          {!loading && !error && file?.kind === "image" && (
            <div className="flex min-h-full items-start justify-center">
              <img className="max-h-full max-w-full rounded-md border border-neutral-200 object-contain" src={file.imageUrl} alt={file.name} />
            </div>
          )}
          {!loading && !error && file?.kind === "pdf" && (
            <iframe className="h-full min-h-[640px] w-full rounded-md border border-neutral-200" src={api.objectUrl(kbId, file.path)} title={file.name} />
          )}
          {!loading && !error && file?.kind === "binary" && (
            <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">该文件不是可直接渲染的文本、Markdown、图片或 PDF，可通过“下载”查看原文件。</p>
          )}
        </div>
      </section>
    </div>
  )
}

function formatCharCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k`
  return String(count)
}

function MarkdownView({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-neutral-800 prose-headings:font-semibold prose-a:text-cyan-700 prose-pre:bg-neutral-900 prose-pre:text-neutral-50">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => (
            <img className="max-h-64 rounded-md border border-neutral-200 object-contain" src={markdownAssetUrl(src)} alt={alt ?? ""} />
          ),
          a: ({ href, children }) => (
            <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function markdownAssetUrl(src?: string): string | undefined {
  if (!src) return src
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) return src
  if (src.startsWith("/api/")) {
    const token = getAuthToken()
    const glue = src.includes("?") ? "&" : "?"
    return `${API_BASE}${src}${token ? `${glue}access_token=${encodeURIComponent(token)}` : ""}`
  }
  return src
}

function inferFileKind(name: string): FileSelection["kind"] {
  const lower = name.toLowerCase()
  if (/\.(md|markdown|mdx)$/.test(lower)) return "markdown"
  if (/\.(txt|json|csv|tsv|log|yaml|yml|xml|html|css|js|ts|tsx|jsx)$/.test(lower)) return "text"
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(lower)) return "image"
  if (/\.pdf$/.test(lower)) return "pdf"
  return "binary"
}

function StructurePanel({ kbId }: { kbId: string }) {
  const [groups, setGroups] = useState<WikiTreeGroup[]>([])
  const [selectedPage, setSelectedPage] = useState<WikiPage | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  useEffect(() => {
    void api.wikiTree(kbId).then(setGroups)
  }, [kbId])

  const openPage = async (pageId: string) => {
    setPageError(null)
    try {
      setSelectedPage(await api.wikiPage(kbId, pageId))
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] bg-white">
      <aside className="min-h-0 overflow-auto border-r border-neutral-100">
        <div className="sticky top-0 z-10 border-b border-neutral-100 bg-white px-4 py-3">
          <h2 className="text-base font-semibold">Wiki 规则结构</h2>
          <p className="mt-1 text-sm text-neutral-600">按 llm_wiki page type 组织。</p>
        </div>
        <div className="space-y-3 p-3">
          {groups.map((group) => (
            <section key={group.type} className="rounded-md border border-neutral-200">
              <h3 className="border-b border-neutral-100 bg-neutral-50 px-3 py-2 text-sm font-semibold">{group.type}</h3>
              <div className="divide-y divide-neutral-100">
                {group.pages.map((page) => (
                  <button key={page.id} className="block w-full p-3 text-left hover:bg-cyan-50/50" onClick={() => void openPage(page.id)}>
                    <div className="truncate text-sm font-medium">{page.title}</div>
                    <div className="mt-1 truncate text-xs text-neutral-500">{page.path}</div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-neutral-600">
                      <span>{page.sources.length} source</span>
                      <span>{page.images.length} image</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>
      <div className="min-h-0 overflow-auto p-4">
        {pageError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{pageError}</div>}
        {!pageError && !selectedPage && <p className="text-sm text-neutral-500">选择左侧 wiki 页面后查看 Markdown 内容、源追溯和图片。</p>}
        {selectedPage && (
          <article>
            <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <h3 className="text-base font-semibold">{selectedPage.title}</h3>
              <div className="mt-1 text-xs text-neutral-500">{selectedPage.type} · {selectedPage.path}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedPage.sources.map((source) => <span key={source} className="rounded bg-white px-2 py-1 text-xs text-neutral-600">{source}</span>)}
              </div>
            </div>
            <MarkdownView content={selectedPage.content} />
          </article>
        )}
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
    <section className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_280px] gap-3 p-3">
      <div className="min-h-0 overflow-hidden rounded-md border border-neutral-200 bg-white">
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
        <svg className="h-[calc(100%-74px)] min-h-[420px] w-full" viewBox="0 0 840 560" role="img">
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
      <aside className="min-h-0 overflow-auto rounded-md border border-neutral-200 bg-white">
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
    <section className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_360px] gap-3 p-3">
      <div className="min-h-0 overflow-auto rounded-md border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-semibold">召回</h2>
          <p className="mt-1 text-sm text-neutral-600">关键词 + 可选向量语义搜索，图片 caption 参与召回。</p>
        </div>
        <div className="flex gap-2 p-4">
          <input
            className="h-10 flex-1 rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-700"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void runSearch() }}
            placeholder="搜索知识库、图片说明、wiki 页面"
          />
          <button className="h-10 rounded-md bg-cyan-700 px-4 text-sm font-medium text-white" onClick={() => void runSearch()}>搜索</button>
        </div>
        <div className="px-4 pb-2 text-xs text-neutral-500">模式：{mode} · RRF 混合召回会合并关键词和向量语义结果</div>
        <div className="divide-y divide-neutral-200">
          {results.length === 0 && <div className="p-4 text-sm text-neutral-500">输入关键词后测试召回。上传并完成摄取后，这里会展示 wiki 页面、源路径、分数和图片。</div>}
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
                <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                  {result.images.map((image) => (
                    <button key={image.id} className="rounded-md border border-neutral-200 bg-white p-2 text-left text-xs hover:border-cyan-200 hover:bg-cyan-50/40" onClick={() => setLightbox(image)}>
                      <img className="h-20 w-full rounded object-cover" src={api.objectUrl(kbId, image.storageKey)} alt={image.caption} />
                      <span className="mt-1 block truncate">{image.fileName}</span>
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
      <aside className="min-h-0 overflow-auto rounded-md border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-semibold">问答</h2>
          <p className="mt-1 text-sm text-neutral-600">服务端完成搜索、图谱扩展、上下文预算和引用。</p>
        </div>
        <div className="p-4">
          <textarea className="h-32 w-full resize-none rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-cyan-700" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="问一个具体问题" />
          <button className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-medium text-white" onClick={() => void ask()}>
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
    <section className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] gap-3 p-3">
      <aside className="min-h-0 overflow-auto rounded-md border border-neutral-200 bg-white p-4">
        <h2 className="text-base font-semibold">异步审核和深度研究</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          LLM 摄取、lint、图洞察和 deep research 都会进入同一个人工审核队列。
        </p>
        <button className="mt-4 h-10 w-full border border-neutral-300 text-sm" onClick={() => void runLint()}>运行 lint</button>
        <label className="mt-5 block text-xs font-medium text-neutral-600">深度研究主题</label>
        <input className="mt-1 h-10 w-full border border-neutral-300 px-3 text-sm outline-none focus:border-teal-700" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如：RAG 图谱检索" />
        <button className="mt-3 h-10 w-full bg-neutral-950 text-sm font-medium text-white" onClick={() => void runResearch()}>开始深度研究</button>
      </aside>
      <div className="min-h-0 overflow-auto rounded-md border border-neutral-200 bg-white">
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

function readRoute(): AppRoute {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/"
  if (pathname === "/") return { page: "home" }
  if (pathname === "/database") return { page: "database" }
  if (pathname === "/extensions") return { page: "extensions" }
  if (pathname === "/company-settings") return { page: "companySettings" }
  if (pathname.startsWith("/database/")) {
    const kbId = decodeURIComponent(pathname.slice("/database/".length))
    return kbId ? { page: "detail", kbId } : { page: "database" }
  }
  return { page: "home" }
}

function normalizeClientRelativePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
}

export default App
