import { useEffect, useState } from "react"
import { Brain, LibraryBig, Loader2, Play, Plus, X } from "lucide-react"
import { embeddingModelLabel } from "@/model-provider-presets"
import { api } from "@/web/api"
import type { CompanyModel, KnowledgeBase, SourceIngestSummary } from "@/web/types"

export function DatabaseListPage({
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
  const [ingestSummaries, setIngestSummaries] = useState<Record<string, SourceIngestSummary>>({})
  const [startingIngest, setStartingIngest] = useState<Record<string, boolean>>({})
  const [ingestErrors, setIngestErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    if (kbs.length === 0) {
      setIngestSummaries({})
      return () => { alive = false }
    }
    void Promise.all(
      kbs.map(async (kb) => {
        try {
          return [kb.id, await api.sourceIngestSummary(kb.id)] as const
        } catch {
          return [kb.id, undefined] as const
        }
      }),
    ).then((entries) => {
      if (!alive) return
      const next: Record<string, SourceIngestSummary> = {}
      for (const [kbId, summary] of entries) {
        if (summary) next[kbId] = summary
      }
      setIngestSummaries(next)
    })
    return () => { alive = false }
  }, [kbs])

  const ingestMissing = async (kbId: string) => {
    if (startingIngest[kbId]) return
    setStartingIngest((items) => ({ ...items, [kbId]: true }))
    setIngestErrors((items) => ({ ...items, [kbId]: "" }))
    try {
      const result = await api.ingestMissingSources(kbId)
      setIngestSummaries((items) => ({ ...items, [kbId]: result.summary }))
    } catch (err) {
      setIngestErrors((items) => ({ ...items, [kbId]: err instanceof Error ? err.message : String(err) }))
    } finally {
      setStartingIngest((items) => ({ ...items, [kbId]: false }))
    }
  }

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
              <KnowledgeBaseCard
                key={kb.id}
                ingestStarting={Boolean(startingIngest[kb.id])}
                ingestSummary={ingestSummaries[kb.id]}
                ingestError={ingestErrors[kb.id]}
                kb={kb}
                onIngestMissing={() => void ingestMissing(kb.id)}
                onOpen={() => onOpen(kb.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function KnowledgeBaseCard({
  ingestStarting,
  ingestSummary,
  ingestError,
  kb,
  onIngestMissing,
  onOpen,
}: {
  ingestStarting: boolean
  ingestSummary?: SourceIngestSummary
  ingestError?: string
  kb: KnowledgeBase
  onIngestMissing: () => void
  onOpen: () => void
}) {
  const ready = ingestSummary?.ready ?? 0
  const active = ingestSummary?.active ?? 0
  const missing = ingestSummary?.missing ?? 0
  return (
    <article className="group flex min-h-44 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-cyan-200 hover:bg-cyan-50/40 hover:shadow-md">
      <button className="min-w-0 flex-1 text-left" onClick={onOpen} type="button">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-700">
            <LibraryBig className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{kb.name}</h2>
            <p className="mt-1 text-xs text-neutral-500">
              {ingestSummary ? `${ingestSummary.ingested}/${ingestSummary.totalRequired} 个文档已入库` : "正在统计文档"}
            </p>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 text-sm leading-5 text-neutral-600">{kb.description || "暂无描述"}</p>
      </button>
      {ingestSummary && missing > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="min-w-0 text-xs text-amber-900">
            <div className="font-medium">{missing} 个文档未入库</div>
            <div className="mt-0.5 truncate text-amber-800">
              {active > 0 ? `${active} 个正在处理中` : "可启动新的入库任务"}
            </div>
          </div>
          <button
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-cyan-700 px-3 text-xs font-medium text-white disabled:bg-neutral-300"
            disabled={ready === 0 || ingestStarting}
            onClick={onIngestMissing}
            type="button"
          >
            {ingestStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            入库 {ready}
          </button>
        </div>
      )}
      {ingestError && <p className="mt-2 line-clamp-2 text-xs text-red-700">{ingestError}</p>}
    </article>
  )
}

export function CreateKnowledgeBaseModal({ onCreated, onClose }: { onCreated: (kb: KnowledgeBase) => void; onClose: () => void }) {
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


function CreateKnowledgeBase({ onCreated }: { onCreated: (kb: KnowledgeBase) => void }) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [visibility, setVisibility] = useState<KnowledgeBase["visibility"]>("company")
  const [embeddingModels, setEmbeddingModels] = useState<CompanyModel[]>([])
  const [embeddingModelId, setEmbeddingModelId] = useState("")
  const [modelsLoading, setModelsLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void api.companyModels()
      .then((models) => {
        if (!alive) return
        const items = models.filter((model) => model.capabilities.includes("embedding"))
        setEmbeddingModels(items)
        // 新知识库会固定使用创建时选中的 embedding 模型，避免后续默认模型变化后，
        // 旧 chunk 向量和新查询向量进入不同语义空间。没有 embedding 模型时保持空值，搜索自然退回关键词召回。
        const defaultModel = items.find((model) => model.isDefaultEmbedding)
        setEmbeddingModelId(defaultModel?.id ?? "")
      })
      .catch(() => {
        if (!alive) return
        setEmbeddingModels([])
        setEmbeddingModelId("")
      })
      .finally(() => {
        if (alive) setModelsLoading(false)
      })
    return () => { alive = false }
  }, [])

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      onCreated(await api.createKb(name, description, visibility, embeddingModelId || undefined))
      setName("")
      setDescription("")
      setVisibility("company")
      const defaultModel = embeddingModels.find((model) => model.isDefaultEmbedding)
      setEmbeddingModelId(defaultModel?.id ?? "")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">知识库配置</h2>
      <p className="mt-2 text-sm leading-5 text-neutral-600">
        创建后会初始化 KN 规则、schema、purpose、wiki/index 和 overview。
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
      <label className="mt-3 block text-xs font-medium text-neutral-600">向量模型</label>
      {modelsLoading ? (
        <p className="mt-1 text-sm text-neutral-500">正在加载模型...</p>
      ) : embeddingModels.length === 0 ? (
        <p className="mt-1 text-sm text-neutral-500">请先在「公司设置」添加 Embedding 模型</p>
      ) : (
        <select
          className="mt-1 h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-cyan-600 disabled:opacity-60"
          value={embeddingModelId}
          disabled={busy}
          onChange={(event) => setEmbeddingModelId(event.target.value)}
        >
          <option value="">请选择向量模型</option>
          {embeddingModels.map((model) => (
            <option key={model.id} value={model.id}>{embeddingModelLabel(model)}</option>
          ))}
        </select>
      )}
      <button
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-medium text-white disabled:opacity-50"
        disabled={busy || !name.trim() || modelsLoading || (embeddingModels.length > 0 && !embeddingModelId)}
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
