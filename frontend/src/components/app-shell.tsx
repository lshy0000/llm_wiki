import { useEffect, useMemo, useState } from "react"
import type { ReactElement, ReactNode } from "react"
import {
  AlertCircle,
  BookOpen,
  Blocks,
  Brain,
  Building2,
  ChevronUp,
  CheckCircle2,
  ClipboardList,
  Clock,
  KeyRound,
  LibraryBig,
  Loader2,
  LogOut,
  Moon,
  RefreshCw,
  RotateCcw,
  Settings,
  Sun,
  UserRound,
  X,
} from "lucide-react"
import { api } from "@/web/api"
import type { AuthPayload, BackgroundTask, KnowledgeBase } from "@/web/types"
import { formatShanghaiDateTime } from "@/lib/time"

type ActivePage = "home" | "database" | "detail" | "extensions" | "docs" | "companySettings" | "apiKeys"

export function AppShell({
  auth,
  activePage,
  theme,
  children,
  onNavigate,
  onLogout,
  onToggleTheme,
}: {
  auth: AuthPayload
  activePage: ActivePage
  theme: "light" | "dark"
  children: ReactNode
  onNavigate: (path: string) => void
  onLogout: () => void
  onToggleTheme: () => void
}) {
  const [userOpen, setUserOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const isAdmin = auth.user.isPlatformAdmin || auth.user.role === "platform_admin" || auth.user.role === "org_admin"
  const active = activePage === "database" || activePage === "detail" ? "database" : activePage

  return (
    <main className="flex h-screen overflow-hidden bg-white text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100">
      <aside className="flex w-[52px] shrink-0 flex-col items-center border-r border-neutral-200 bg-[#fbfbfc] dark:border-neutral-800 dark:bg-neutral-950">
        <button
          className="mt-2 flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-white text-cyan-700 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-cyan-300"
          title="引导页"
          onClick={() => onNavigate("/")}
        >
          <img className="h-full w-full object-cover" src="/logo.png" alt="LLM Wiki" onError={(event) => { event.currentTarget.style.display = "none" }} />
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
              className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
              title="个人中心"
              onClick={() => setUserOpen((open) => !open)}
            >
              <span className="text-xs font-semibold">{auth.user.displayName?.slice(0, 1) || auth.user.username.slice(0, 1)}</span>
            </button>
            {userOpen && (
              <UserMenu
                auth={auth}
                isAdmin={isAdmin}
                theme={theme}
                onDocs={() => { setUserOpen(false); onNavigate("/docs") }}
                onToggleTheme={() => { setUserOpen(false); onToggleTheme() }}
                onApiKeys={() => { setUserOpen(false); onNavigate("/account/api-keys") }}
                onCompanySettings={() => { setUserOpen(false); onNavigate("/company-settings") }}
                onLogout={() => { setUserOpen(false); onLogout() }}
              />
            )}
          </div>
        </nav>
      </aside>

      <section className="min-w-0 flex-1 overflow-hidden bg-[#f6f7f9] dark:bg-neutral-950">{children}</section>

      {tasksOpen && <TaskCenterOverlay onClose={() => setTasksOpen(false)} />}
    </main>
  )
}

function SidebarButton({ active, icon, label, onClick }: { active: boolean; icon: ReactElement; label: string; onClick: () => void }) {
  return (
    <button
      className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${
        active
          ? "border-cyan-100 bg-cyan-50 text-cyan-700 shadow-sm dark:border-cyan-800 dark:bg-cyan-950/70 dark:text-cyan-300"
          : "border-transparent text-neutral-600 hover:bg-white hover:text-cyan-700 hover:shadow-sm dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-cyan-300"
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
  theme,
  onDocs,
  onToggleTheme,
  onApiKeys,
  onCompanySettings,
  onLogout,
}: {
  auth: AuthPayload
  isAdmin: boolean
  theme: "light" | "dark"
  onDocs: () => void
  onToggleTheme: () => void
  onApiKeys: () => void
  onCompanySettings: () => void
  onLogout: () => void
}) {
  const roleLabel = auth.user.isPlatformAdmin ? "超级管理员" : auth.user.role === "org_admin" ? "公司管理员" : "公司成员"
  const ThemeIcon = theme === "dark" ? Sun : Moon
  return (
    <div className="absolute bottom-0 left-12 z-40 w-60 rounded-lg border border-neutral-200 bg-white py-2 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start gap-3 px-3 pb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cyan-50 text-sm font-semibold text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
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
        <MenuButton
          icon={<ThemeIcon className="h-4 w-4" />}
          label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          onClick={onToggleTheme}
        />
      </div>
      <div className="border-t border-neutral-100 py-1">
        <MenuButton icon={<KeyRound className="h-4 w-4" />} label="API Key" onClick={onApiKeys} />
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
    <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:text-neutral-100 dark:hover:bg-neutral-800" onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

type TaskFilter = "all" | "unfinished" | "completed" | "failed"

const TASK_FILTERS: Array<{ key: TaskFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "unfinished", label: "未完成" },
  { key: "completed", label: "已完成" },
  { key: "failed", label: "失败" },
]

function TaskCenterOverlay({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [filter, setFilter] = useState<TaskFilter>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const nextTasks = await api.listTasks()
      setTasks(nextTasks)
      void api.listKbs()
        .then(setKnowledgeBases)
        .catch(() => undefined)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const loadIfAlive = async (showLoading = false) => {
      if (showLoading) setLoading(true)
      try {
        const nextTasks = await api.listTasks()
        if (!cancelled) {
          setTasks(nextTasks)
          void api.listKbs()
            .then((nextKnowledgeBases) => {
              if (!cancelled) setKnowledgeBases(nextKnowledgeBases)
            })
            .catch(() => undefined)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled && showLoading) setLoading(false)
      }
    }
    void loadIfAlive(true)
    const timer = window.setInterval(() => void loadIfAlive(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const counts = useMemo(() => {
    const failed = tasks.filter((task) => task.status === "failed" || task.status === "cancelled").length
    const completed = tasks.filter((task) => task.status === "completed").length
    const unfinished = tasks.filter((task) => task.status === "queued" || task.status === "running").length
    return { all: tasks.length, unfinished, completed, failed }
  }, [tasks])

  const visibleTasks = useMemo(() => {
    if (filter === "unfinished") return tasks.filter((task) => task.status === "queued" || task.status === "running")
    if (filter === "completed") return tasks.filter((task) => task.status === "completed")
    if (filter === "failed") return tasks.filter((task) => task.status === "failed" || task.status === "cancelled")
    return tasks
  }, [filter, tasks])

  const knowledgeBaseNameById = useMemo(() => {
    return new Map(knowledgeBases.map((kb) => [kb.id, kb.name]))
  }, [knowledgeBases])

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/35 p-6" onClick={onClose}>
      <aside
        className="flex h-[82vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
          <div>
            <h2 className="text-lg font-semibold">任务中心</h2>
            <p className="mt-1 text-xs text-neutral-500">查看全部后台任务、失败任务，并重试。</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-neutral-50" onClick={() => void load(true)} title="刷新">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-neutral-50" onClick={onClose} title="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-4 gap-3 border-b border-neutral-100 bg-neutral-50/70 p-4">
          {TASK_FILTERS.map((item) => (
            <button
              className={`min-h-20 rounded-md border bg-white p-3 text-left transition ${
                filter === item.key ? "border-cyan-300 ring-2 ring-cyan-100" : "border-neutral-200 hover:border-cyan-200"
              }`}
              key={item.key}
              onClick={() => setFilter(item.key)}
              type="button"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-700">{item.label}</span>
                <TaskFilterIcon filter={item.key} />
              </div>
              <div className="mt-2 text-2xl font-semibold text-neutral-950">{counts[item.key]}</div>
            </button>
          ))}
        </div>

        {error && <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

        <div className="min-h-0 flex-1 overflow-auto">
          {loading && tasks.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载任务
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="p-4 text-sm text-neutral-500">暂无{TASK_FILTERS.find((item) => item.key === filter)?.label}任务</div>
          ) : (
            <div>
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.4fr)_minmax(150px,0.6fr)_minmax(180px,0.7fr)_120px_160px_96px] gap-3 border-b border-neutral-100 bg-white px-5 py-2 text-xs font-medium text-neutral-500">
                <span>任务</span>
                <span>知识库</span>
                <span>来源</span>
                <span>进度</span>
                <span>创建时间</span>
                <span className="text-right">操作</span>
              </div>
              {visibleTasks.map((task) => (
                <TaskCenterRow
                  key={task.id}
                  task={task}
                  knowledgeBaseName={knowledgeBaseNameById.get(task.kbId) ?? task.kbId}
                  onReload={() => load()}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function TaskFilterIcon({ filter }: { filter: TaskFilter }) {
  if (filter === "unfinished") return <Clock className="h-4 w-4 text-cyan-700" />
  if (filter === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (filter === "failed") return <AlertCircle className="h-4 w-4 text-red-600" />
  return <ClipboardList className="h-4 w-4 text-neutral-500" />
}

function TaskCenterRow({
  task,
  knowledgeBaseName,
  onReload,
}: {
  task: BackgroundTask
  knowledgeBaseName: string
  onReload: () => Promise<void>
}) {
  const busy = task.status === "queued" || task.status === "running"
  const failed = task.status === "failed" || task.status === "cancelled"
  const sourceText = task.sourcePaths.length > 0
    ? task.sourcePaths.slice(0, 4).join(", ") + (task.sourcePaths.length > 4 ? ` 等 ${task.sourcePaths.length} 个文件` : "")
    : `${task.sourceIds.length} 个文件`

  const retry = async () => {
    await api.retryTask(task.id)
    await onReload()
  }

  const cancel = async () => {
    await api.cancelTask(task.id)
    await onReload()
  }

  return (
    <article className="grid grid-cols-[minmax(0,1.4fr)_minmax(150px,0.6fr)_minmax(180px,0.7fr)_120px_160px_96px] items-center gap-3 border-b border-neutral-100 px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <TaskCenterStatusIcon status={task.status} />
          <span className={`rounded border px-2 py-0.5 text-[11px] ${taskStatusClass(task.status)}`}>
            {taskStatusLabel(task.status)}
          </span>
          <h3 className="truncate text-sm font-semibold">{task.title}</h3>
        </div>
        <p className="mt-1 truncate text-xs text-neutral-700">{task.stage}</p>
        {task.error && <p className="mt-1 line-clamp-2 text-xs text-red-700">{task.error}</p>}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-700" title={knowledgeBaseName}>
        <LibraryBig className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        <span className="truncate">{knowledgeBaseName}</span>
      </div>
      <div className="truncate text-xs text-neutral-500" title={sourceText}>{sourceText}</div>
      <div>
        <div className="mb-1 text-xs text-neutral-500">{task.progress}%</div>
        <div className="h-1.5 rounded bg-neutral-200">
          <div className="h-full rounded bg-cyan-700" style={{ width: `${task.progress}%` }} />
        </div>
      </div>
      <div className="text-xs text-neutral-500">{formatShanghaiDateTime(task.createdAt)}</div>
      <div className="flex justify-end">
        {busy ? (
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-xs hover:bg-neutral-50" onClick={() => void cancel()}>
            取消
          </button>
        ) : failed ? (
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-xs hover:bg-neutral-50" onClick={() => void retry()}>
            <RotateCcw className="h-3.5 w-3.5" />
            重试
          </button>
        ) : (
          <span className="text-xs text-neutral-400">-</span>
        )}
      </div>
    </article>
  )
}

function TaskCenterStatusIcon({ status }: { status: BackgroundTask["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-700" />
  if (status === "queued") return <Clock className="h-3.5 w-3.5 text-neutral-500" />
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-red-600" />
  return <X className="h-3.5 w-3.5 text-neutral-500" />
}

function taskStatusLabel(status: BackgroundTask["status"]): string {
  if (status === "queued") return "未完成"
  if (status === "running") return "执行中"
  if (status === "completed") return "已完成"
  if (status === "failed") return "失败"
  return "已取消"
}

function taskStatusClass(status: BackgroundTask["status"]): string {
  if (status === "queued" || status === "running") return "border-cyan-200 bg-cyan-50 text-cyan-800"
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800"
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700"
  return "border-neutral-200 bg-neutral-100 text-neutral-600"
}

export function UserBadge({ auth }: { auth: AuthPayload }) {
  return (
    <div className="flex h-10 items-center gap-3 border border-neutral-300 bg-white px-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
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
