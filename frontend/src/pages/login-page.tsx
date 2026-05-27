import { useState } from "react"
import { KeyRound, UserRound } from "lucide-react"
import { api } from "@/web/api"
import type { AuthPayload } from "@/web/types"

export function LoginPage({ onLoggedIn }: { onLoggedIn: (auth: AuthPayload) => void }) {
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
