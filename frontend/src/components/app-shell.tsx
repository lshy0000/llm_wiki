import { useState } from "react"
import type { ReactElement, ReactNode } from "react"
import {
  Activity,
  BookOpen,
  Blocks,
  Brain,
  Building2,
  ChevronUp,
  ClipboardList,
  KeyRound,
  LibraryBig,
  LogOut,
  Moon,
  Settings,
  UserRound,
  X,
} from "lucide-react"
import type { AuthPayload } from "@/web/types"

type ActivePage = "home" | "database" | "detail" | "extensions" | "companySettings" | "apiKeys"

export function AppShell({
  auth,
  activePage,
  children,
  onNavigate,
  onLogout,
}: {
  auth: AuthPayload
  activePage: ActivePage
  children: ReactNode
  onNavigate: (path: string) => void
  onLogout: () => void
}) {
  const [userOpen, setUserOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const isAdmin = auth.user.isPlatformAdmin || auth.user.role === "platform_admin" || auth.user.role === "org_admin"
  const active = activePage === "database" || activePage === "detail" ? "database" : activePage

  return (
    <main className="flex h-screen overflow-hidden bg-white text-neutral-950">
      <aside className="flex w-[52px] shrink-0 flex-col items-center border-r border-neutral-200 bg-[#fbfbfc]">
        <button
          className="mt-2 flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-white text-cyan-700 shadow-sm"
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
                onApiKeys={() => { setUserOpen(false); onNavigate("/account/api-keys") }}
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
  onApiKeys,
  onCompanySettings,
  onLogout,
}: {
  auth: AuthPayload
  isAdmin: boolean
  onDocs: () => void
  onApiKeys: () => void
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

export function UserBadge({ auth }: { auth: AuthPayload }) {
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
