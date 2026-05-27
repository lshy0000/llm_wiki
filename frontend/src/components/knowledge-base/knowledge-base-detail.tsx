import { useEffect, useMemo, useState } from "react"
import type { InputHTMLAttributes, ReactElement } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronUp,
  ClipboardList,
  Download,
  FileSearch,
  FileText,
  Folder,
  LibraryBig,
  Loader2,
  MessageSquare,
  Network,
  RefreshCw,
  RotateCcw,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { API_BASE, api, getAuthToken } from "@/web/api"
import {
  KB_TYPE_LABEL,
  sortFileTreeNodes,
  type Capabilities,
  type CompanyModel,
  type FileTreeNode,
  type GraphResponse,
  type IngestJob,
  type KnowledgeBase,
  type ReviewItem,
  type SearchResult,
  type SourceDocument,
  type WikiPage,
  type WikiTreeGroup,
} from "@/web/types"
import { embeddingModelLabel } from "@/model-provider-presets"

type DetailTab = "sources" | "structure" | "graph" | "recall" | "reviews"
const SOURCES_PANEL_INITIAL_REFRESH_DELAY_MS = 2_000
const SOURCES_PANEL_MAX_REFRESH_DELAY_MS = 30_000

type FileSelection = {
  root: "raw" | "wiki"
  path: string
  name: string
  kind: "markdown" | "text" | "image" | "pdf" | "binary"
  text?: string
  imageUrl?: string
}

export function KnowledgeBaseDetail({
  kb,
  isAdmin,
  onBack,
  onDeleted,
  onKbUpdated,
  capabilities,
}: {
  kb: KnowledgeBase
  isAdmin: boolean
  onBack: () => void
  onDeleted: () => void
  onKbUpdated: (kb: KnowledgeBase) => void
  capabilities: Capabilities | null
}) {
  const [tab, setTab] = useState<DetailTab>("graph")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [embeddingModels, setEmbeddingModels] = useState<CompanyModel[]>([])
  const [embeddingBusy, setEmbeddingBusy] = useState(false)
  const [embeddingError, setEmbeddingError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void api.companyModels()
      .then((models) => {
        if (!alive) return
        setEmbeddingModels(models.filter((model) => model.capabilities.includes("embedding")))
      })
      .catch(() => {
        if (!alive) return
        setEmbeddingModels([])
      })
    return () => { alive = false }
  }, [])

  const defaultEmbedding = embeddingModels.find((model) => model.isDefaultEmbedding)
  // 展示层可以把“未显式绑定”显示成当前默认模型，便于管理员理解实际会用哪个模型；
  // 但只有用户在下拉框保存后，kb.embeddingModelId 才会变成显式绑定，后端摄取和检索都以这个字段为准。
  const activeEmbedding = embeddingModels.find((model) => model.id === kb.embeddingModelId) ?? defaultEmbedding
  const embeddingLabel = activeEmbedding
    ? embeddingModelLabel(activeEmbedding)
    : kb.embeddingModelId
      ? "已删除的模型"
      : capabilities?.providers.embeddingConfigured
        ? capabilities.providers.embeddingModel
        : "待配置"
  const selectedEmbeddingId = kb.embeddingModelId ?? defaultEmbedding?.id ?? ""

  const saveEmbeddingModel = async (modelId: string) => {
    if (!modelId) return
    setEmbeddingBusy(true)
    setEmbeddingError(null)
    try {
      onKbUpdated(await api.updateKbEmbeddingModel(kb.id, modelId))
    } catch (err) {
      setEmbeddingError(err instanceof Error ? err.message : String(err))
    } finally {
      setEmbeddingBusy(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      // 知识库删除是破坏性操作，前端只负责二次确认和触发固定 /api DELETE；
      // 权限、数据库级联和磁盘目录边界校验都在后端执行，不能在 UI 里假设一定能删。
      await api.deleteKb(kb.id)
      setDeleteOpen(false)
      onDeleted()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }
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
              <span className="rounded bg-purple-50 px-2 py-1 text-xs text-purple-700">{KB_TYPE_LABEL[kb.type]}</span>
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
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">知识库概览</h2>
                  {isAdmin && (
                    <button
                      type="button"
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-red-200 px-2.5 text-xs text-red-700 hover:bg-red-50"
                      onClick={() => { setDeleteError(null); setDeleteOpen(true) }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-600">{kb.description || "浏览器知识库详情"}</p>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                <LibraryBig className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniInfo label="原始文件" value="raw/" />
              <MiniInfo label="Wiki 页面" value="wiki/" />
              {isAdmin && embeddingModels.length > 0 ? (
                <div className="rounded-md border border-neutral-100 bg-neutral-50 p-2">
                  <div className="text-xs text-neutral-500">向量模型</div>
                  <select
                    className="mt-1 h-8 w-full truncate rounded border border-neutral-200 bg-white px-2 text-sm font-medium outline-none focus:border-cyan-600 disabled:opacity-60"
                    value={selectedEmbeddingId}
                    disabled={embeddingBusy}
                    onChange={(event) => void saveEmbeddingModel(event.target.value)}
                  >
                    {embeddingModels.map((model) => (
                      <option key={model.id} value={model.id}>{embeddingModelLabel(model)}</option>
                    ))}
                  </select>
                  {embeddingError && <p className="mt-1 truncate text-xs text-red-600">{embeddingError}</p>}
                </div>
              ) : (
                <MiniInfo label="向量模型" value={embeddingLabel} />
              )}
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

      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-950">删除知识库</h3>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                onClick={() => !deleting && setDeleteOpen(false)}
                disabled={deleting}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4 text-sm leading-6 text-neutral-600">
              <p>
                确定要删除知识库 <span className="font-semibold text-neutral-950">{kb.name}</span> 吗？
              </p>
              <p>此操作将永久删除该知识库下的全部 raw/wiki 文件、数据库记录与检索索引，且无法恢复。</p>
              {deleteError && <p className="text-red-600">{deleteError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-100 px-4 py-3">
              <button
                type="button"
                className="h-9 rounded-md border border-neutral-200 px-4 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
              >
                取消
              </button>
              <button
                type="button"
                className="h-9 rounded-md bg-red-600 px-4 text-sm text-white hover:bg-red-700 disabled:opacity-60"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
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
    setRawTree(sortFileTreeNodes(raw))
    setWikiTree(sortFileTreeNodes(wiki))
    setSources(sourceList)
    setJobs(jobList)
  }

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    let delay = SOURCES_PANEL_INITIAL_REFRESH_DELAY_MS

    const scheduleNextLoad = () => {
      timer = window.setTimeout(() => {
        void load().finally(() => {
          if (cancelled) return
          delay = Math.min(delay * 2, SOURCES_PANEL_MAX_REFRESH_DELAY_MS)
          scheduleNextLoad()
        })
      }, delay)
    }

    void load()
    scheduleNextLoad()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
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
            <p className="mt-1 text-sm text-neutral-600">raw 保留用户上传结构，wiki 按 KN 规则生成可追溯页面。</p>
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
          <h3 className="text-sm font-semibold">任务队列</h3>
        </div>
        <div className="divide-y divide-neutral-100">
          {jobs.length === 0 && <div className="p-3 text-sm text-neutral-500">暂无任务</div>}
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
        {node.isDirectory ? (
          <ChevronUp className={`h-3 w-3 shrink-0 text-neutral-400 transition ${open ? "" : "rotate-90"}`} />
        ) : (
          <span className="inline-block h-3 w-3 shrink-0" aria-hidden />
        )}
        {node.isDirectory ? <Folder className="h-4 w-4 shrink-0 text-amber-700" /> : <FileSearch className="h-4 w-4 shrink-0 text-neutral-500" />}
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
          <p className="mt-1 text-sm text-neutral-600">按 KN page type 组织。</p>
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
  const [lightbox, setLightbox] = useState<SearchResult["images"][number] | null>(null)

  const runSearch = async () => {
    if (!query.trim()) return
    const response = await api.search(kbId, query)
    setMode(response.mode)
    setResults(response.results)
  }

  return (
    <section className="h-full min-h-0 p-3">
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

type ReviewStatusFilter = ReviewItem["status"] | "all"

const REVIEW_STATUS_FILTERS: Array<{ key: ReviewStatusFilter; label: string }> = [
  { key: "open", label: "待处理" },
  { key: "resolved", label: "已解决" },
  { key: "dismissed", label: "已忽略" },
  { key: "all", label: "全部" },
]

const REVIEW_STATUS_META: Record<ReviewItem["status"], { label: string; className: string }> = {
  open: { label: "待处理", className: "border-amber-200 bg-amber-50 text-amber-800" },
  resolved: { label: "已解决", className: "border-teal-200 bg-teal-50 text-teal-800" },
  dismissed: { label: "已忽略", className: "border-neutral-200 bg-neutral-100 text-neutral-600" },
}

const REVIEW_KIND_LABELS: Record<ReviewItem["kind"], string> = {
  "llm-review": "LLM 审核",
  lint: "Lint",
  "graph-insight": "图谱洞察",
  "deep-research": "深度研究",
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function ReviewsPanel({ kbId }: { kbId: string }) {
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [topic, setTopic] = useState("")
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>("open")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runningLint, setRunningLint] = useState(false)
  const [runningResearch, setRunningResearch] = useState(false)
  const [updatingReviewId, setUpdatingReviewId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void api.reviews(kbId)
      .then((items) => {
        if (cancelled) return
        setReviews(items)
      })
      .catch((err) => {
        if (cancelled) return
        setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [kbId])

  const refreshReviews = async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      setReviews(await api.reviews(kbId))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  const runLint = async () => {
    setRunningLint(true)
    setError(null)
    try {
      await api.lint(kbId)
      await refreshReviews()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRunningLint(false)
    }
  }

  const runResearch = async () => {
    const researchTopic = topic.trim()
    if (!researchTopic) return
    setRunningResearch(true)
    setError(null)
    try {
      await api.research(kbId, researchTopic)
      setTopic("")
      await refreshReviews()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRunningResearch(false)
    }
  }

  const updateReviewStatus = async (reviewId: string, status: ReviewItem["status"]) => {
    setUpdatingReviewId(reviewId)
    setError(null)
    try {
      await api.updateReviewStatus(kbId, reviewId, status)
      await refreshReviews()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setUpdatingReviewId(null)
    }
  }

  const reviewCounts = useMemo(() => {
    const counts: Record<ReviewItem["status"], number> = { open: 0, resolved: 0, dismissed: 0 }
    for (const review of reviews) counts[review.status] += 1
    return counts
  }, [reviews])

  const visibleReviews = useMemo(
    () => statusFilter === "all" ? reviews : reviews.filter((review) => review.status === statusFilter),
    [reviews, statusFilter],
  )
  const currentFilterLabel = REVIEW_STATUS_FILTERS.find((item) => item.key === statusFilter)?.label ?? "审核项"

  return (
    <section className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] gap-3 p-3">
      <aside className="min-h-0 overflow-auto rounded-md border border-neutral-200 bg-white p-4">
        <h2 className="text-base font-semibold">异步审核和深度研究</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          LLM 摄取、lint、图洞察和 deep research 都会进入同一个人工审核队列。
        </p>
        <button
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 border border-neutral-300 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          disabled={runningLint}
          onClick={() => void runLint()}
          type="button"
        >
          {runningLint ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          运行 lint
        </button>
        <label className="mt-5 block text-xs font-medium text-neutral-600">深度研究主题</label>
        <input className="mt-1 h-10 w-full border border-neutral-300 px-3 text-sm outline-none focus:border-teal-700" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如：RAG 图谱检索" />
        <button
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 bg-neutral-950 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!topic.trim() || runningResearch}
          onClick={() => void runResearch()}
          type="button"
        >
          {runningResearch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          开始深度研究
        </button>
      </aside>
      <div className="min-h-0 overflow-auto rounded-md border border-neutral-200 bg-white">
        <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">审核项</h2>
              <p className="mt-1 text-xs text-neutral-500">{reviewCounts.open} 个待处理 · {reviews.length} 个总计</p>
            </div>
            <button
              className="inline-flex h-8 items-center gap-2 border border-neutral-300 px-3 text-xs text-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading}
              onClick={() => void refreshReviews(true)}
              type="button"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {REVIEW_STATUS_FILTERS.map((item) => {
              const count = item.key === "all" ? reviews.length : reviewCounts[item.key]
              const active = statusFilter === item.key
              return (
                <button
                  className={`h-8 border px-3 text-xs ${active ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"}`}
                  key={item.key}
                  onClick={() => setStatusFilter(item.key)}
                  type="button"
                >
                  {item.label} {count}
                </button>
              )
            })}
          </div>
          {error && <div className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        </div>
        <div className="divide-y divide-neutral-200">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载审核项
            </div>
          ) : visibleReviews.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">暂无{currentFilterLabel}审核项</div>
          ) : visibleReviews.map((review) => {
            const status = REVIEW_STATUS_META[review.status]
            const updating = updatingReviewId === review.id
            return (
              <article key={review.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{review.title}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-neutral-500">{REVIEW_KIND_LABELS[review.kind]}</span>
                      <span className={`border px-2 py-1 ${status.className}`}>{status.label}</span>
                    </div>
                  </div>
                  <span className="shrink-0 border border-neutral-300 px-2 py-1 text-xs">{new Date(review.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{review.description}</p>
                {review.action && <p className="mt-2 text-sm text-teal-800">{review.action}</p>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-neutral-500">更新于 {new Date(review.updatedAt).toLocaleString()}</p>
                  <div className="flex flex-wrap gap-2">
                    {review.status === "open" ? (
                      <>
                        <button
                          className="inline-flex h-8 items-center gap-1.5 border border-teal-700 px-3 text-xs font-medium text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={updating}
                          onClick={() => void updateReviewStatus(review.id, "resolved")}
                          type="button"
                        >
                          {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          标记解决
                        </button>
                        <button
                          className="inline-flex h-8 items-center gap-1.5 border border-neutral-300 px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={updating}
                          onClick={() => void updateReviewStatus(review.id, "dismissed")}
                          type="button"
                        >
                          {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                          忽略
                        </button>
                      </>
                    ) : (
                      <button
                        className="inline-flex h-8 items-center gap-1.5 border border-neutral-300 px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={updating}
                        onClick={() => void updateReviewStatus(review.id, "open")}
                        type="button"
                      >
                        {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        重新打开
                      </button>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}


function normalizeClientRelativePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
}
