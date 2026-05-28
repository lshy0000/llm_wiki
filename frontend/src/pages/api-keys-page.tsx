import { useCallback, useEffect, useRef, useState } from "react"
import { CheckCircle2, Copy, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react"
import { api } from "@/web/api"
import type { UserApiKey, UserApiKeyCreated } from "@/web/types"
import { formatShanghaiDateTime } from "@/lib/time"

type CopyState = "idle" | "ok" | "error"

export function ApiKeysPage() {
  const [rows, setRows] = useState<UserApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)
  const [onceKey, setOnceKey] = useState<UserApiKeyCreated | null>(null)
  const [copyState, setCopyState] = useState<CopyState>("idle")
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserApiKey | null>(null)
  const [deleting, setDeleting] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)

  const loadApiKeys = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await api.listApiKeys())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadApiKeys()
  }, [loadApiKeys])

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
  }, [])

  const createApiKey = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setError(null)
    try {
      const created = await api.createApiKey(name)
      setOnceKey(created)
      setCopyState("idle")
      setCreateOpen(false)
      setNewName("")
      await loadApiKeys()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  const saveEdit = async () => {
    if (!editId) return
    const name = editName.trim()
    if (!name) return
    setSavingEdit(true)
    setError(null)
    try {
      const updated = await api.updateApiKey(editId, name)
      setRows((items) => items.map((item) => (item.id === updated.id ? updated : item)))
      setEditId(null)
      setEditName("")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSavingEdit(false)
    }
  }

  const deleteApiKey = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setError(null)
    try {
      await api.deleteApiKey(deleteTarget.id)
      setRows((items) => items.filter((item) => item.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setDeleting(false)
    }
  }

  const copySecret = async (value: string) => {
    const copied = await copyText(value)
    setCopyState(copied ? "ok" : "error")
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), 2600)
  }

  return (
    <section className="flex h-full flex-col bg-[#f6f7f9]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-5">
        <div>
          <h1 className="text-lg font-semibold">API Key</h1>
          <p className="mt-0.5 text-xs text-neutral-500">用于自动化调用，权限与当前登录账号一致。</p>
        </div>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-60"
          onClick={() => setCreateOpen((open) => !open)}
          type="button"
        >
          {createOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {createOpen ? "取消" : "新建 Key"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-5xl space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {createOpen && (
            <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="block">
                  <span className="text-xs font-medium text-neutral-500">Key 名称</span>
                  <input
                    autoFocus
                    className="mt-1 h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600"
                    maxLength={200}
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void createApiKey() }}
                    placeholder="例如：脚本 / CI / 外部系统"
                    value={newName}
                  />
                </label>
                <button
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-60"
                  disabled={creating || !newName.trim()}
                  onClick={() => void createApiKey()}
                  type="button"
                >
                  <KeyRound className="h-4 w-4" />
                  {creating ? "创建中" : "创建"}
                </button>
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-cyan-700" />
                <h2 className="text-base font-semibold">我的 API Key</h2>
              </div>
              <span className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">{rows.length} 个</span>
            </div>

            {loading ? (
              <div className="px-4 py-8 text-sm text-neutral-500">正在加载...</div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-8 text-sm text-neutral-500">暂无 API Key</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-xs text-neutral-500">
                      <th className="px-4 py-3 font-medium">名称</th>
                      <th className="px-4 py-3 font-medium">后缀</th>
                      <th className="px-4 py-3 font-medium">创建时间</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-neutral-100 last:border-b-0">
                        <td className="px-4 py-3">
                          {editId === row.id ? (
                            <input
                              className="h-8 w-full max-w-xs rounded-md border border-neutral-200 px-2 text-sm outline-none focus:border-cyan-600"
                              maxLength={200}
                              onChange={(event) => setEditName(event.target.value)}
                              onKeyDown={(event) => { if (event.key === "Enter") void saveEdit() }}
                              value={editName}
                            />
                          ) : (
                            <span className="font-medium text-neutral-950">{row.name}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-neutral-500">...{row.keyHint}</td>
                        <td className="px-4 py-3 text-neutral-500">{formatShanghaiDateTime(row.createdAt)}</td>
                        <td className="px-4 py-3">
                          {editId === row.id ? (
                            <div className="flex justify-end gap-2">
                              <button
                                className="h-8 rounded-md bg-cyan-700 px-3 text-xs font-medium text-white disabled:opacity-60"
                                disabled={savingEdit || !editName.trim()}
                                onClick={() => void saveEdit()}
                                type="button"
                              >
                                保存
                              </button>
                              <button
                                className="h-8 rounded-md border border-neutral-200 px-3 text-xs text-neutral-700 hover:bg-neutral-50"
                                onClick={() => { setEditId(null); setEditName("") }}
                                type="button"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <button
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                                onClick={() => { setEditId(row.id); setEditName(row.name) }}
                                title="重命名"
                                type="button"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 text-red-700 hover:bg-red-50"
                                onClick={() => setDeleteTarget(row)}
                                title="删除"
                                type="button"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      {onceKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-lg border border-neutral-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-950">Key 已创建</h3>
              <button className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100" onClick={() => setOnceKey(null)} type="button">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                完整密钥只显示一次，请现在复制保存。
              </div>
              <div className="break-all rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs text-neutral-800">
                {onceKey.key}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-h-5 text-xs">
                  {copyState === "ok" && (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      已复制
                    </span>
                  )}
                  {copyState === "error" && <span className="text-red-700">复制失败，请手动选择复制</span>}
                </div>
                <div className="flex gap-2">
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-200 px-3 text-sm text-neutral-700 hover:bg-neutral-50"
                    onClick={() => void copySecret(onceKey.key)}
                    type="button"
                  >
                    <Copy className="h-4 w-4" />
                    复制
                  </button>
                  <button className="h-9 rounded-md bg-cyan-700 px-4 text-sm font-medium text-white" onClick={() => setOnceKey(null)} type="button">
                    关闭
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white shadow-xl">
            <div className="border-b border-neutral-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-950">删除 API Key</h3>
            </div>
            <div className="space-y-2 px-4 py-4 text-sm leading-6 text-neutral-600">
              <p>
                确定删除 <span className="font-semibold text-neutral-950">{deleteTarget.name}</span> 吗？
              </p>
              <p className="font-mono text-xs text-neutral-500">...{deleteTarget.keyHint}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-100 px-4 py-3">
              <button
                className="h-9 rounded-md border border-neutral-200 px-4 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="h-9 rounded-md bg-red-600 px-4 text-sm text-white hover:bg-red-700 disabled:opacity-60"
                disabled={deleting}
                onClick={() => void deleteApiKey()}
                type="button"
              >
                {deleting ? "删除中" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    return fallbackCopy(value)
  }
  return fallbackCopy(value)
}

function fallbackCopy(value: string): boolean {
  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  try {
    const parsed = JSON.parse(raw) as { error?: string }
    return parsed.error || raw
  } catch {
    return raw
  }
}
