import { useEffect, useState } from "react"
import { AppShell } from "@/components/app-shell"
import { CompanySettingsPage } from "@/components/company-settings/company-settings-page"
import { CreateKnowledgeBaseModal, DatabaseListPage } from "@/components/database/database-list-page"
import { KnowledgeBaseDetail } from "@/components/knowledge-base/knowledge-base-detail"
import { ExtensionsPage } from "@/pages/extensions-page"
import { ApiKeysPage } from "@/pages/api-keys-page"
import { DocsPage } from "@/pages/docs-page"
import { LandingPage } from "@/pages/landing-page"
import { LoginPage } from "@/pages/login-page"
import { api } from "@/web/api"
import type { AuthPayload, Capabilities, KnowledgeBase } from "@/web/types"

type ThemeMode = "light" | "dark"

type AppRoute =
  | { page: "home" }
  | { page: "database" }
  | { page: "detail"; kbId: string }
  | { page: "extensions" }
  | { page: "docs"; docPath?: string }
  | { page: "companySettings" }
  | { page: "apiKeys" }

const THEME_STORAGE_KEY = "llm-wiki.theme"

function App() {
  const [auth, setAuth] = useState<AuthPayload | null>(null)
  const [kbs, setKbs] = useState<KnowledgeBase[]>([])
  const [route, setRoute] = useState<AppRoute>(() => readRoute())
  const [theme, setTheme] = useState<ThemeMode>(() => readThemeMode())
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

  const toggleTheme = () => {
    setTheme((current) => current === "dark" ? "light" : "dark")
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
    document.documentElement.classList.toggle("dark", theme === "dark")
    document.documentElement.style.colorScheme = theme
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Ignore storage failures; the visible theme still changes for this session.
    }
  }, [theme])

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
      <AppShell
        auth={auth}
        activePage={route.page}
        theme={theme}
        onNavigate={navigate}
        onLogout={() => void logout()}
        onToggleTheme={toggleTheme}
      >
        <KnowledgeBaseDetail
          kb={selected}
          isAdmin={auth.user.isPlatformAdmin || auth.user.role === "platform_admin" || auth.user.role === "org_admin"}
          onBack={() => { navigate("/database"); void loadKbs() }}
          onDeleted={() => { navigate("/database"); void loadKbs() }}
          onKbUpdated={(updated) => setKbs((items) => items.map((item) => (item.id === updated.id ? updated : item)))}
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
      <AppShell
        auth={auth}
        activePage={route.page}
        theme={theme}
        onNavigate={navigate}
        onLogout={() => void logout()}
        onToggleTheme={toggleTheme}
      >
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
      <AppShell
        auth={auth}
        activePage={route.page}
        theme={theme}
        onNavigate={navigate}
        onLogout={() => void logout()}
        onToggleTheme={toggleTheme}
      >
        <ExtensionsPage />
      </AppShell>
    )
  }

  if (route.page === "docs") {
    return (
      <AppShell
        auth={auth}
        activePage={route.page}
        theme={theme}
        onNavigate={navigate}
        onLogout={() => void logout()}
        onToggleTheme={toggleTheme}
      >
        <DocsPage docPath={route.docPath} onNavigate={navigate} />
      </AppShell>
    )
  }

  if (route.page === "companySettings") {
    return (
      <AppShell
        auth={auth}
        activePage={route.page}
        theme={theme}
        onNavigate={navigate}
        onLogout={() => void logout()}
        onToggleTheme={toggleTheme}
      >
        <CompanySettingsPage auth={auth} capabilities={capabilities} />
      </AppShell>
    )
  }

  if (route.page === "apiKeys") {
    return (
      <AppShell
        auth={auth}
        activePage={route.page}
        theme={theme}
        onNavigate={navigate}
        onLogout={() => void logout()}
        onToggleTheme={toggleTheme}
      >
        <ApiKeysPage />
      </AppShell>
    )
  }

  return (
    <AppShell
      auth={auth}
      activePage={route.page}
      theme={theme}
      onNavigate={navigate}
      onLogout={() => void logout()}
      onToggleTheme={toggleTheme}
    >
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

function readRoute(): AppRoute {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/"
  if (pathname === "/") return { page: "home" }
  if (pathname === "/database") return { page: "database" }
  if (pathname === "/extensions") return { page: "extensions" }
  if (pathname === "/docs") return { page: "docs" }
  if (pathname.startsWith("/docs/")) {
    const docPath = decodePath(pathname.slice("/docs/".length))
    return docPath ? { page: "docs", docPath } : { page: "docs" }
  }
  if (pathname === "/company-settings") return { page: "companySettings" }
  if (pathname === "/account/api-keys") return { page: "apiKeys" }
  if (pathname.startsWith("/database/")) {
    const kbId = decodeURIComponent(pathname.slice("/database/".length))
    return kbId ? { page: "detail", kbId } : { page: "database" }
  }
  return { page: "home" }
}

function decodePath(value: string): string {
  return value
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
    .join("/")
}

function readThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === "dark" ? "dark" : "light"
  } catch {
    return "light"
  }
}

export default App
