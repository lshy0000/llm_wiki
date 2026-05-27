import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import {
  Building2,
  CheckCircle2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { api } from "@/web/api"
import type { AuthPayload, Capabilities, CompanyModel, ModelCapability, ModelProviderTestResult } from "@/web/types"
import { MODEL_PROVIDER_PRESETS, modelProviderPreset } from "@/model-provider-presets"

export function CompanySettingsPage({ auth, capabilities: _capabilities }: { auth: AuthPayload; capabilities: Capabilities | null }) {
  const isAdmin = auth.user.isPlatformAdmin || auth.user.role === "platform_admin" || auth.user.role === "org_admin"
  const [models, setModels] = useState<CompanyModel[]>([])
  const [modelError, setModelError] = useState<string | null>(null)
  const [modelBusy, setModelBusy] = useState(false)
  const [modelTestBusy, setModelTestBusy] = useState(false)
  const [modelTestResult, setModelTestResult] = useState<ModelProviderTestResult | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CompanyModel | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [modelForm, setModelForm] = useState({
    name: "",
    provider: "openai" as CompanyModel["provider"],
    protocol: "openai_compatible" as CompanyModel["protocol"],
    model: modelProviderPreset("openai").suggestedModel,
    endpoint: modelProviderPreset("openai").endpoint,
    apiKey: "",
    llm: true,
    embedding: false,
    vision: true,
  })
  const selectedProviderPreset = modelProviderPreset(modelForm.provider)
  const selectedProtocol = modelForm.provider === "custom" ? modelForm.protocol : selectedProviderPreset.protocol
  const selectedEndpoint = modelForm.provider === "custom" ? modelForm.endpoint.trim() : selectedProviderPreset.endpoint
  const selectedNeedsApiKey = modelForm.provider !== "custom" && modelForm.provider !== "ollama"
  const selectedCapabilityCount = Number(modelForm.llm) + Number(modelForm.embedding) + Number(modelForm.vision)
  const capabilityLimitReached = selectedCapabilityCount >= 2
  // 用户看到和选择的是“名称”，但真正会打到同一远端模型的是 endpoint + model ID；
  // 这里前端先拦一层重复保存，后端仍会做同样校验，避免多会话并发时绕过 UI。
  const duplicateModel = models.find((model) =>
    model.model.trim() === modelForm.model.trim() &&
    endpointKey(model.endpoint) === endpointKey(selectedEndpoint),
  )
  const canSaveModel = Boolean(
    !modelBusy &&
    !duplicateModel &&
    modelForm.name.trim() &&
    modelForm.model.trim() &&
    selectedEndpoint &&
    selectedCapabilityCount >= 1 &&
    selectedCapabilityCount <= 2,
  )
  const canTestModel = Boolean(!modelTestBusy && selectedEndpoint && (!selectedNeedsApiKey || modelForm.apiKey.trim()))
  useEffect(() => {
    if (!isAdmin) return
    void api.companyModels()
      .then(setModels)
      .catch((err) => setModelError(err instanceof Error ? err.message : String(err)))
  }, [isAdmin])

  const saveModel = async () => {
    if (duplicateModel) {
      setModelError(`同一 Endpoint 和模型 ID 已存在：${duplicateModel.name}`)
      return
    }
    setModelBusy(true)
    setModelError(null)
    setModelTestResult(null)
    try {
      const capabilities: CompanyModel["capabilities"] = []
      if (modelForm.llm) capabilities.push("llm")
      if (modelForm.embedding) capabilities.push("embedding")
      if (modelForm.vision) capabilities.push("vision")
      const saved = await api.saveCompanyModel({
        name: modelForm.name,
        provider: modelForm.provider,
        protocol: selectedProtocol,
        model: modelForm.model,
        endpoint: selectedEndpoint,
        apiKey: modelForm.apiKey || undefined,
        capabilities,
      })
      setModels((items) => [saved, ...items.filter((item) => item.id !== saved.id)])
      setModelForm((form) => ({ ...form, apiKey: "" }))
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelBusy(false)
    }
  }

  const testModel = async () => {
    setModelTestBusy(true)
    setModelError(null)
    setModelTestResult(null)
    try {
      const result = await api.testCompanyModel({
        provider: modelForm.provider,
        protocol: selectedProtocol,
        model: modelForm.model,
        endpoint: selectedEndpoint,
        apiKey: modelForm.apiKey || undefined,
      })
      setModelTestResult(result)
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelTestBusy(false)
    }
  }

  const saveDefaultModel = async (capability: ModelCapability, modelId: string) => {
    const target = models.find((model) => model.id === modelId)
    if (!target) return
    setModelBusy(true)
    setModelError(null)
    try {
      const saved = await api.saveCompanyModel({
        id: target.id,
        name: target.name,
        provider: target.provider,
        protocol: target.protocol,
        model: target.model,
        endpoint: target.endpoint,
        capabilities: target.capabilities,
        isDefaultLlm: capability === "llm" ? true : target.isDefaultLlm,
        isDefaultEmbedding: capability === "embedding" ? true : target.isDefaultEmbedding,
        isDefaultVision: capability === "vision" ? true : target.isDefaultVision,
      })
      setModels((items) => items.map((item) => {
        if (item.id === saved.id) return saved
        if (capability === "llm") return { ...item, isDefaultLlm: false }
        if (capability === "embedding") return { ...item, isDefaultEmbedding: false }
        return { ...item, isDefaultVision: false }
      }))
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelBusy(false)
    }
  }

  const deleteModel = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setModelError(null)
    setDeleteError(null)
    try {
      await api.deleteCompanyModel(deleteTarget.id)
      setModels((items) => items.filter((item) => item.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleteBusy(false)
    }
  }
  const llmModels = models.filter((model) => model.capabilities.includes("llm"))
  const embeddingModels = models.filter((model) => model.capabilities.includes("embedding"))
  const visionModels = models.filter((model) => model.capabilities.includes("vision"))
  const defaultLlm = models.find((model) => model.isDefaultLlm)
  const defaultEmbedding = models.find((model) => model.isDefaultEmbedding)
  const defaultVision = models.find((model) => model.isDefaultVision)

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
                <dd className="mt-1 font-medium">{auth.company.isDefault ? "是，LDAP 用户默认进入" : "否"}</dd>
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
            <DefaultModelCard
              title="默认 LLM"
              models={llmModels}
              selectedId={defaultLlm?.id ?? ""}
              placeholder="选择 LLM 模型"
              busy={modelBusy}
              onChange={(modelId) => void saveDefaultModel("llm", modelId)}
            />
            <DefaultModelCard
              title="默认 Embedding"
              models={embeddingModels}
              selectedId={defaultEmbedding?.id ?? ""}
              placeholder="选择 Embedding 模型"
              busy={modelBusy}
              onChange={(modelId) => void saveDefaultModel("embedding", modelId)}
            />
            <DefaultModelCard
              title="默认视觉模型"
              models={visionModels}
              selectedId={defaultVision?.id ?? ""}
              placeholder="选择视觉模型"
              busy={modelBusy}
              onChange={(modelId) => void saveDefaultModel("vision", modelId)}
            />
          </section>

          <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold">模型池</h2>
              </div>
              <span className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">{models.length} 个模型</span>
            </div>
            <div className="divide-y divide-neutral-100">
              {models.length === 0 && (
                <div className="px-4 py-6 text-sm text-neutral-500">暂无模型</div>
              )}
              {models.map((model) => (
                <div key={model.id} className="grid grid-cols-[160px_minmax(0,1fr)_220px_80px] items-center gap-3 px-4 py-3 text-sm">
                  <div className="flex items-center gap-3 font-medium">
                    <span className="rounded-md bg-cyan-50 px-2 py-1 text-xs text-cyan-800">{capabilityLabel(model.capabilities)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{model.name}</div>
                    <div className="mt-1 truncate text-xs text-neutral-500">{model.model} · {model.endpoint || "端点未配置"}</div>
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {defaultBadges(model).map((badge) => (
                      <span key={badge} className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{badge}</span>
                    ))}
                    {defaultBadges(model).length === 0 && <span className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600">模型池</span>}
                  </div>
                  <div className="flex justify-end">
                    <button
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60"
                      disabled={modelBusy || deleteBusy}
                      onClick={() => { setDeleteError(null); setDeleteTarget(model) }}
                      type="button"
                      title="删除模型"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">添加或更新公司模型</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-700 disabled:opacity-50"
                  disabled={!canTestModel}
                  onClick={() => void testModel()}
                >
                  <RefreshCw className={`h-4 w-4 ${modelTestBusy ? "animate-spin" : ""}`} />
                  {modelTestBusy ? "测试中" : "测试连接"}
                </button>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-medium text-white disabled:opacity-50"
                  disabled={!canSaveModel}
                  onClick={() => void saveModel()}
                >
                  <Plus className="h-4 w-4" />
                  {modelBusy ? "保存中" : "保存模型"}
                </button>
              </div>
            </div>
            {modelError && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{modelError}</div>}
            {duplicateModel && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                同一 Endpoint 和模型 ID 已存在：{duplicateModel.name}
              </div>
            )}
            {modelTestResult && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  {modelTestResult.message}
                </div>
                {modelTestResult.models.length > 0 && (
                  <p className="mt-1 text-xs leading-5 text-emerald-700">
                    示例模型：{modelTestResult.models.slice(0, 6).join(" / ")}
                  </p>
                )}
              </div>
            )}
            <div className="mt-4 grid grid-cols-4 gap-3">
              <Field label="名称">
                <input className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600" value={modelForm.name} onChange={(event) => setModelForm((form) => ({ ...form, name: event.target.value }))} />
              </Field>
              <Field label="供应商">
                <select
                  className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600"
                  value={modelForm.provider}
                  onChange={(event) => {
                    const provider = event.target.value as CompanyModel["provider"]
                    const preset = modelProviderPreset(provider)
                    setModelTestResult(null)
                    setModelForm((form) => ({
                      ...form,
                      provider,
                      protocol: preset.protocol,
                      endpoint: provider === "custom" ? "" : preset.endpoint,
                      model: !form.model.trim() || MODEL_PROVIDER_PRESETS.some((item) => item.suggestedModel === form.model) ? preset.suggestedModel : form.model,
                      llm: preset.defaultCapabilities.includes("llm"),
                      embedding: preset.defaultCapabilities.includes("embedding"),
                      vision: preset.defaultCapabilities.includes("vision"),
                    }))
                  }}
                >
                  {MODEL_PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.provider} value={preset.provider}>{preset.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="模型 ID">
                <input className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600" value={modelForm.model} onChange={(event) => { setModelTestResult(null); setModelForm((form) => ({ ...form, model: event.target.value })) }} />
              </Field>
              <Field label="API Key">
                <input className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600" value={modelForm.apiKey} onChange={(event) => { setModelTestResult(null); setModelForm((form) => ({ ...form, apiKey: event.target.value })) }} placeholder={selectedNeedsApiKey ? "填写后可测试连接" : "可选"} type="password" />
              </Field>
              {modelForm.provider === "custom" ? (
                <>
                  <Field label="Base URL">
                    <input className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600" value={modelForm.endpoint} onChange={(event) => { setModelTestResult(null); setModelForm((form) => ({ ...form, endpoint: event.target.value })) }} placeholder="https://.../v1 或 http://localhost:11434/v1" />
                  </Field>
                  <Field label="API 模式">
                    <select
                      className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-cyan-600"
                      value={modelForm.protocol}
                      onChange={(event) => { setModelTestResult(null); setModelForm((form) => ({ ...form, protocol: event.target.value as CompanyModel["protocol"] })) }}
                    >
                      <option value="openai_compatible">Chat Completions</option>
                      <option value="anthropic_messages">Messages</option>
                    </select>
                  </Field>
                </>
              ) : (
                <Field label="官方端点">
                  <div className="flex h-9 items-center rounded-md border border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-600">
                    <span className="truncate">{selectedProviderPreset.endpoint}</span>
                  </div>
                </Field>
              )}
              <Field label="能力">
                <div className="flex min-h-9 items-center gap-3 text-sm">
                  <CheckBox label="LLM" checked={modelForm.llm} disabled={!modelForm.llm && capabilityLimitReached} onChange={(checked) => setModelForm((form) => ({ ...form, llm: checked }))} />
                  <CheckBox label="Embedding" checked={modelForm.embedding} disabled={!modelForm.embedding && capabilityLimitReached} onChange={(checked) => setModelForm((form) => ({ ...form, embedding: checked }))} />
                  <CheckBox label="Vision" checked={modelForm.vision} disabled={!modelForm.vision && capabilityLimitReached} onChange={(checked) => setModelForm((form) => ({ ...form, vision: checked }))} />
                </div>
                {selectedCapabilityCount === 0 && <p className="mt-1 text-xs text-amber-700">至少选择一种能力</p>}
              </Field>
            </div>
          </section>
        </div>
      </div>
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white shadow-xl">
            <div className="border-b border-neutral-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-950">删除模型</h3>
            </div>
            <div className="space-y-2 px-4 py-4 text-sm leading-6 text-neutral-600">
              <p>
                确定删除 <span className="font-semibold text-neutral-950">{deleteTarget.name}</span> 吗？
              </p>
              <p>{deleteTarget.model} · {deleteTarget.endpoint}</p>
              {deleteError && <p className="text-red-600">{deleteError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-100 px-4 py-3">
              <button
                className="h-9 rounded-md border border-neutral-200 px-4 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="h-9 rounded-md bg-red-600 px-4 text-sm text-white hover:bg-red-700 disabled:opacity-60"
                disabled={deleteBusy}
                onClick={() => void deleteModel()}
                type="button"
              >
                {deleteBusy ? "删除中" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function DefaultModelCard({
  title,
  models,
  selectedId,
  placeholder,
  busy,
  onChange,
}: {
  title: string
  models: CompanyModel[]
  selectedId: string
  placeholder: string
  busy: boolean
  onChange: (modelId: string) => void
}) {
  const selected = models.find((model) => model.id === selectedId)
  const ready = Boolean(selected?.endpoint && (selected.apiKeySet || selected.provider === "ollama" || selected.provider === "custom"))
  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className={`rounded px-2 py-1 text-xs ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {ready ? "已配置" : "待配置"}
        </span>
      </div>
      <select
        className="mt-3 h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-cyan-600 disabled:opacity-60"
        value={selectedId}
        disabled={busy || models.length === 0}
        onChange={(event) => event.target.value && onChange(event.target.value)}
      >
        <option value="">{models.length === 0 ? "暂无可选模型" : placeholder}</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>{model.name} · {model.model}</option>
        ))}
      </select>
      <p className="mt-2 truncate text-xs text-neutral-500">
        {selected ? `${selected.name} · ${selected.model}` : "先在模型池添加支持该能力的模型"}
      </p>
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

function endpointKey(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "").toLowerCase()
}

function capabilityLabel(capabilities: CompanyModel["capabilities"]): string {
  return capabilities.map((capability) => {
    if (capability === "llm") return "LLM"
    if (capability === "embedding") return "Embedding"
    return "Vision"
  }).join(" / ")
}

function defaultBadges(model: CompanyModel): string[] {
  return [
    model.isDefaultLlm ? "默认 LLM" : "",
    model.isDefaultEmbedding ? "默认 Embedding" : "",
    model.isDefaultVision ? "默认 Vision" : "",
  ].filter(Boolean)
}

function CheckBox({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`inline-flex items-center gap-1.5 text-xs text-neutral-700 ${disabled ? "opacity-50" : ""}`}>
      <input className="h-3.5 w-3.5 accent-cyan-700" type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}
