import { useEffect, useMemo, useState } from "react"
import type { InputHTMLAttributes, ReactElement } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  ArrowLeft,
  AlertCircle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronUp,
  ClipboardList,
  Clock,
  Download,
  FileSearch,
  FileText,
  Folder,
  LibraryBig,
  Loader2,
  MessageSquare,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Trash2,
  Upload,
  UserRound,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react"
import { API_BASE, api, getAuthToken } from "@/web/api"
import {
  KB_TYPE_LABEL,
  sortFileTreeNodes,
  type AgentConversation,
  type AgentTraceStep,
  type BackgroundTask,
  type Capabilities,
  type ChatCitation,
  type CompanyModel,
  type CustomHttpToolConfig,
  type FileTreeNode,
  type GraphResponse,
  type KnowledgeBase,
  type ReviewItem,
  type SearchResult,
  type SourceDocument,
  type ToolDefinition,
  type WikiPage,
  type WikiTreeGroup,
} from "@/web/types"
import { embeddingModelLabel } from "@/model-provider-presets"

type DetailTab = "sources" | "structure" | "chat" | "graph" | "recall" | "tools" | "reviews"
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
  const [tab, setTab] = useState<DetailTab>("chat")
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
    { key: "chat", label: "聊天", icon: <Bot className="h-4 w-4" /> },
    { key: "graph", label: "知识图谱", icon: <Network className="h-4 w-4" /> },
    { key: "recall", label: "检索测试", icon: <MessageSquare className="h-4 w-4" /> },
    { key: "tools", label: "工具", icon: <Wrench className="h-4 w-4" /> },
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
          <section className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
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
                <p className="mt-1 line-clamp-1 text-sm leading-5 text-neutral-600">{kb.description || "浏览器知识库详情"}</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
                <LibraryBig className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <MiniInfo label="原始文件" value="raw/" />
              <MiniInfo label="Wiki 页面" value="wiki/" />
              {isAdmin && embeddingModels.length > 0 ? (
                <div className="rounded-md border border-neutral-100 bg-neutral-50 px-2 py-1.5">
                  <div className="text-xs text-neutral-500">向量模型</div>
                  <select
                    className="mt-1 h-7 w-full truncate rounded border border-neutral-200 bg-white px-2 text-sm font-medium outline-none focus:border-cyan-600 disabled:opacity-60"
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
            {tab === "chat" && <AgentChatPanel kbId={kb.id} />}
            {tab === "graph" && <GraphPanel kbId={kb.id} />}
            {tab === "recall" && <RecallPanel kbId={kb.id} />}
            {tab === "tools" && <ToolsPanel kbId={kb.id} isAdmin={isAdmin} />}
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
    <div className="rounded-md border border-neutral-100 bg-neutral-50 px-2 py-1.5">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
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
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [taskLoadError, setTaskLoadError] = useState<string | null>(null)
  const [uploadTargetPath, setUploadTargetPath] = useState("")
  const [selectedFile, setSelectedFile] = useState<FileSelection | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const load = async () => {
    const [raw, wiki, sourceList] = await Promise.all([
      api.fileTree(kbId, "raw"),
      api.fileTree(kbId, "wiki"),
      api.listSources(kbId),
    ])
    setRawTree(sortFileTreeNodes(raw))
    setWikiTree(sortFileTreeNodes(wiki))
    setSources(sourceList)
    try {
      setTasks(await api.listTasks(kbId))
      setTaskLoadError(null)
    } catch (err) {
      setTaskLoadError(err instanceof Error ? err.message : String(err))
      setTasks([])
    }
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
    if (uploading) return
    if (!files || files.length === 0) return
    const targetPrefix = uploadTargetPath ? `${uploadTargetPath}/` : ""
    const uploadItems = Array.from(files).map((file) => ({
      file,
      relativePath: normalizeClientRelativePath(`${targetPrefix}${(file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name}`),
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
    setUploadProgress(0)
    setUploadError(null)
    let uploadAccepted = false
    try {
      await api.uploadFilesWithProgress(kbId, acceptedItems, setUploadProgress)
      uploadAccepted = true
      setUploading(false)
      await load()
    } catch (err) {
      if (uploadAccepted) setTaskLoadError(err instanceof Error ? err.message : String(err))
      else setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  const selectedTargetLabel = uploadTargetPath ? `raw/${uploadTargetPath}` : "raw/"
  const sourceByStoragePath = useMemo(() => {
    return new Map(sources.map((source) => [source.storageKey, source]))
  }, [sources])

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
      <section className="shrink-0 border-b border-neutral-100 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="shrink-0 text-base font-semibold">文件目录与摄取队列</h2>
              <p className="min-w-0 flex-1 truncate text-sm text-neutral-600">raw 保留上传结构，wiki 生成可追溯页面。</p>
              <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-600">
                <span>上传到</span>
                <span className="max-w-40 truncate rounded border border-cyan-100 bg-cyan-50 px-2 py-1 font-mono text-cyan-800">{selectedTargetLabel}</span>
                {uploadTargetPath && (
                  <button
                    className="rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50"
                    disabled={uploading}
                    onClick={() => setUploadTargetPath("")}
                    type="button"
                  >
                    使用 raw 根目录
                  </button>
                )}
              </div>
            </div>
            {uploadError && <p className="mt-2 text-xs text-red-700">{uploadError}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <label className={`inline-flex h-8 items-center gap-2 rounded-md border border-neutral-200 px-2.5 text-sm hover:bg-neutral-50 ${uploading ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
              <Upload className="h-4 w-4" />
              {uploading ? "上传中" : "上传文件"}
              <input
                className="hidden"
                disabled={uploading}
                type="file"
                multiple
                onChange={(event) => {
                  const input = event.currentTarget
                  void upload(input.files).finally(() => { input.value = "" })
                }}
              />
            </label>
            <label className={`inline-flex h-8 items-center gap-2 rounded-md border border-neutral-200 px-2.5 text-sm hover:bg-neutral-50 ${uploading ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
              <Folder className="h-4 w-4" />
              文件夹
              <input
                className="hidden"
                disabled={uploading}
                type="file"
                multiple
                {...folderInputProps}
                onChange={(event) => {
                  const input = event.currentTarget
                  void upload(input.files).finally(() => { input.value = "" })
                }}
              />
            </label>
            <button className="inline-flex h-8 items-center gap-2 rounded-md border border-neutral-200 px-2.5 text-sm hover:bg-neutral-50 disabled:opacity-60" disabled={uploading} onClick={() => void load()}>
              <RefreshCw className={`h-4 w-4 ${uploading ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden p-3">
        <TreePanel
          title="raw 上传目录"
          nodes={rawTree}
          selectedFolderPath={uploadTargetPath}
          selectedPath={selectedFile?.path}
          sourceByPath={sourceByStoragePath}
          onOpenFile={(node) => void openFile("raw", node)}
          onSelectFolder={(node) => setUploadTargetPath(storageFolderToClientPath(node.path, "raw"))}
        />
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

      <UploadProgressModal
        progress={uploadProgress}
        targetLabel={selectedTargetLabel}
        visible={uploading}
      />

      <section className="max-h-36 shrink-0 overflow-auto border-t border-neutral-100 bg-white">
        <div className="sticky top-0 z-10 border-b border-neutral-100 bg-white px-3 py-2">
          <h3 className="text-sm font-semibold">后台任务</h3>
        </div>
        {taskLoadError && <div className="m-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{taskLoadError}</div>}
        <div className="divide-y divide-neutral-100">
          {tasks.length === 0 && <div className="p-3 text-sm text-neutral-500">暂无任务</div>}
          {tasks.slice(0, 6).map((task) => (
            <TaskSummaryRow key={task.id} task={task} onReload={load} />
          ))}
        </div>
      </section>
    </div>
  )
}

function TreePanel({
  title,
  nodes,
  selectedFolderPath,
  selectedPath,
  sourceByPath,
  onOpenFile,
  onSelectFolder,
}: {
  title: string
  nodes: FileTreeNode[]
  selectedFolderPath?: string
  selectedPath?: string
  sourceByPath?: Map<string, SourceDocument>
  onOpenFile: (node: FileTreeNode) => void
  onSelectFolder?: (node: FileTreeNode) => void
}) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white">
      <div className="shrink-0 border-b border-neutral-100 bg-white px-3 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {nodes.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无文件</p>
        ) : (
          nodes.map((node) => (
            <TreeNodeView
              key={node.path}
              node={node}
              depth={0}
              selectedFolderPath={selectedFolderPath}
              selectedPath={selectedPath}
              sourceByPath={sourceByPath}
              onOpenFile={onOpenFile}
              onSelectFolder={onSelectFolder}
            />
          ))
        )}
      </div>
    </div>
  )
}

function TreeNodeView({
  node,
  depth,
  selectedFolderPath,
  selectedPath,
  sourceByPath,
  onOpenFile,
  onSelectFolder,
}: {
  node: FileTreeNode
  depth: number
  selectedFolderPath?: string
  selectedPath?: string
  sourceByPath?: Map<string, SourceDocument>
  onOpenFile: (node: FileTreeNode) => void
  onSelectFolder?: (node: FileTreeNode) => void
}) {
  // 默认折叠；子节点仅在展开时挂载，避免上万文件时一次性渲染整棵树
  const [open, setOpen] = useState(false)
  const selectedFolder = node.isDirectory && selectedFolderPath !== undefined && selectedFolderPath === storageFolderToClientPath(node.path, "raw")
  const selected = selectedPath === node.path || selectedFolder
  const source = node.isDirectory ? undefined : sourceByPath?.get(node.path)
  const toggle = () => {
    if (node.isDirectory) {
      onSelectFolder?.(node)
      setOpen((value) => !value)
    }
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
        {source && <SourceStatusBadge source={source} />}
      </button>
      {open && node.children?.map((child) => (
        <TreeNodeView
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedFolderPath={selectedFolderPath}
          selectedPath={selectedPath}
          sourceByPath={sourceByPath}
          onOpenFile={onOpenFile}
          onSelectFolder={onSelectFolder}
        />
      ))}
    </div>
  )
}

function SourceStatusBadge({ source }: { source: SourceDocument }) {
  return (
    <span className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${sourceStatusClass(source)}`}>
      {sourceStatusLabel(source)}
    </span>
  )
}

function sourceStatusLabel(source: SourceDocument): string {
  if (!source.ingestRequired) return "仅保存"
  if (source.status === "ingested") return "已入库"
  if (source.status === "queued") return "排队"
  if (source.status === "parsing") return "入库中"
  if (source.status === "failed") return "失败"
  if (source.status === "cancelled") return "已取消"
  return "未入库"
}

function sourceStatusClass(source: SourceDocument): string {
  if (!source.ingestRequired) return "border-neutral-200 bg-neutral-100 text-neutral-600"
  if (source.status === "ingested") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (source.status === "queued" || source.status === "parsing") return "border-cyan-200 bg-cyan-50 text-cyan-700"
  if (source.status === "failed") return "border-red-200 bg-red-50 text-red-700"
  if (source.status === "cancelled") return "border-neutral-200 bg-neutral-100 text-neutral-600"
  return "border-amber-200 bg-amber-50 text-amber-800"
}

function UploadProgressModal({
  progress,
  targetLabel,
  visible,
}: {
  progress: number
  targetLabel: string
  visible: boolean
}) {
  if (!visible) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45 p-4" role="dialog" aria-modal="true">
      <section className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cyan-50 text-cyan-700">
            <Upload className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">正在上传</h3>
            <p className="mt-1 truncate text-xs text-neutral-500">{targetLabel}</p>
          </div>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
            <span>文件接收中，完成前不能继续上传</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
            <div className="h-full rounded-full bg-cyan-700 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </section>
    </div>
  )
}

function TaskSummaryRow({ task, onReload }: { task: BackgroundTask; onReload: () => Promise<void> }) {
  const busy = task.status === "queued" || task.status === "running"
  const failed = task.status === "failed" || task.status === "cancelled"
  const sourceLabel = task.sourcePaths.length > 0
    ? task.sourcePaths.slice(0, 3).join(", ") + (task.sourcePaths.length > 3 ? ` 等 ${task.sourcePaths.length} 个文件` : "")
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
    <div className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <TaskStatusIcon status={task.status} />
            <span className={`rounded border px-2 py-0.5 text-[11px] ${taskStatusClass(task.status)}`}>
              {taskStatusLabel(task.status)}
            </span>
            <span className="truncate text-sm font-medium">{task.title}</span>
          </div>
          <p className="mt-1 truncate text-xs text-neutral-500">{sourceLabel}</p>
          <p className="mt-1 truncate text-xs text-neutral-600">{task.stage}</p>
          {task.error && <p className="mt-1 truncate text-xs text-red-700">{task.error}</p>}
        </div>
        <span className="shrink-0 text-xs text-neutral-500">{task.progress}%</span>
      </div>
      <div className="mt-2 h-1.5 rounded bg-neutral-200">
        <div className="h-full rounded bg-cyan-700" style={{ width: `${task.progress}%` }} />
      </div>
      <div className="mt-2 flex gap-2">
        {busy && (
          <button className="rounded border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50" onClick={() => void cancel()}>
            取消
          </button>
        )}
        {failed && (
          <button className="inline-flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50" onClick={() => void retry()}>
            <RotateCcw className="h-3 w-3" />
            重试
          </button>
        )}
      </div>
    </div>
  )
}

function TaskStatusIcon({ status }: { status: BackgroundTask["status"] }) {
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

function storageFolderToClientPath(path: string, root: "raw" | "wiki"): string {
  return normalizeClientRelativePath(path.replace(new RegExp(`^${root}/?`), ""))
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

type AgentUiMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: ChatCitation[]
  trace?: AgentTraceStep[]
  status?: "streaming" | "complete" | "failed"
}

function AgentChatPanel({ kbId }: { kbId: string }) {
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [messages, setMessages] = useState<AgentUiMessage[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadConversation = async (id: string) => {
    setHistoryLoading(true)
    setError(null)
    try {
      const detail = await api.conversationDetail(kbId, id)
      setConversationId(detail.conversation.id)
      setMessages(detail.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        citations: message.citations,
        trace: message.trace,
      })))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setConversationId(undefined)
    setMessages([])
    setConversations([])
    setHistoryLoading(true)
    setError(null)
    void api.listConversations(kbId)
      .then(async (items) => {
        if (cancelled) return
        setConversations(items)
        const first = items[0]
        if (!first) return
        const detail = await api.conversationDetail(kbId, first.id)
        if (cancelled) return
        setConversationId(detail.conversation.id)
        setMessages(detail.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          citations: message.citations,
          trace: message.trace,
        })))
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => { cancelled = true }
  }, [kbId])

  const refreshConversations = async () => {
    try {
      setConversations(await api.listConversations(kbId))
    } catch {
      // Chat answer already succeeded; history refresh can wait for the next panel load.
    }
  }

  const startNewConversation = () => {
    setConversationId(undefined)
    setMessages([])
    setError(null)
  }

  const send = async () => {
    const question = input.trim()
    if (!question || busy) return
    const userMessage: AgentUiMessage = { id: clientId("user"), role: "user", content: question }
    const assistantId = clientId("assistant")
    const assistantMessage: AgentUiMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      citations: [],
      trace: [],
      status: "streaming",
    }
    const updateAssistantMessage = (update: (message: AgentUiMessage) => AgentUiMessage) => {
      setMessages((items) => items.map((item) => item.id === assistantId ? update(item) : item))
    }
    setMessages((items) => [...items, userMessage, assistantMessage])
    setInput("")
    setBusy(true)
    setError(null)
    let completed = false
    let streamError: string | null = null
    try {
      await api.chatStream(kbId, question, conversationId, (event) => {
        if (event.type === "conversation") {
          setConversationId(event.conversationId)
          return
        }
        if (event.type === "step") {
          updateAssistantMessage((message) => ({
            ...message,
            trace: [...(message.trace ?? []), event.step],
          }))
          return
        }
        if (event.type === "final") {
          completed = true
          setConversationId(event.response.conversationId)
          updateAssistantMessage((message) => ({
            ...message,
            content: event.response.answer,
            citations: event.response.citations,
            trace: event.response.trace.length > 0 ? event.response.trace : message.trace,
            status: "complete",
          }))
          return
        }
        streamError = event.message
        updateAssistantMessage((message) => ({
          ...message,
          status: "failed",
        }))
      })
      if (completed) void refreshConversations()
    } catch (err) {
      const message = streamError ?? errorMessage(err)
      setError(message)
      updateAssistantMessage((item) => ({
        ...item,
        content: item.content || `请求失败：${message}`,
        status: "failed",
      }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] bg-white">
      <aside className="min-h-0 border-r border-neutral-100 bg-neutral-50/60">
        <div className="flex items-center justify-between gap-2 border-b border-neutral-100 p-3">
          <span className="text-xs font-semibold text-neutral-700">会话历史</span>
          <button
            className="rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
            onClick={startNewConversation}
            type="button"
          >
            新会话
          </button>
        </div>
        <div className="min-h-0 space-y-1 overflow-auto p-2">
          {historyLoading && conversations.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在加载
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-3 text-xs leading-5 text-neutral-500">暂无已保存会话</div>
          ) : conversations.map((item) => (
            <button
              className={`block w-full rounded-md px-2 py-2 text-left text-xs ${conversationId === item.id ? "bg-white text-cyan-800 shadow-sm" : "text-neutral-600 hover:bg-white"}`}
              disabled={historyLoading || busy}
              key={item.id}
              onClick={() => void loadConversation(item.id)}
              type="button"
            >
              <div className="truncate font-medium">{item.title || "未命名会话"}</div>
              <div className="mt-1 truncate text-[11px] text-neutral-400">{new Date(item.updatedAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </aside>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="min-h-0 overflow-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-md">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
                <Bot className="h-5 w-5" />
              </div>
              <h2 className="mt-3 text-base font-semibold text-neutral-950">知识库 Agent</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-600">直接提问。Agent 会自主选择快速召回、图谱概览或读取页面证据。</p>
            </div>
          </div>
        )}
        <div className="space-y-4">
          {messages.map((message) => (
            <article key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              {message.role === "assistant" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-cyan-50 text-cyan-700">
                  <Bot className="h-4 w-4" />
                </div>
              )}
              <div className={`max-w-[86%] rounded-lg border px-4 py-3 ${message.role === "user" ? "border-cyan-200 bg-cyan-50" : "border-neutral-200 bg-white"}`}>
                {message.role === "assistant" ? <AgentAssistantMessage message={message} /> : <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-900">{message.content}</p>}
              </div>
              {message.role === "user" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-700">
                  <UserRound className="h-4 w-4" />
                </div>
              )}
            </article>
          ))}
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>
      </div>
      <div className="border-t border-neutral-100 p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-36 min-h-11 flex-1 resize-none rounded-md border border-neutral-200 px-3 py-2 text-sm leading-6 outline-none focus:border-cyan-700"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder="问知识库一个问题"
            disabled={busy}
          />
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-cyan-700 text-white hover:bg-cyan-800 disabled:opacity-60"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            title="发送"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
      </div>
    </section>
  )
}

function AgentAssistantMessage({ message }: { message: AgentUiMessage }) {
  const trace = message.trace ?? []
  const isRunning = message.status === "streaming"
  return (
    <div className="space-y-3">
      {trace.length > 0 && <AgentTimeline trace={trace} active={isRunning && !message.content} />}
      {isRunning && !message.content && (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-cyan-200 bg-cyan-50/60 px-3 py-2 text-xs text-cyan-800">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Agent 正在执行
        </div>
      )}
      {message.content && (
        <div className={`border-l-2 pl-3 ${message.status === "failed" ? "border-red-500" : "border-cyan-700"}`}>
          <div className={`mb-2 flex items-center gap-1.5 text-xs font-semibold ${message.status === "failed" ? "text-red-700" : "text-cyan-800"}`}>
            {message.status === "failed" ? <AlertCircle className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
            回答
          </div>
          <MarkdownView content={message.content} />
        </div>
      )}
      {message.citations && message.citations.length > 0 && <CitationList citations={message.citations} />}
    </div>
  )
}

function CitationList({ citations }: { citations: ChatCitation[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {citations.map((citation) => (
        <span key={`${citation.pageId}-${citation.path}`} className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700">
          {citation.title} · {citation.path}
        </span>
      ))}
    </div>
  )
}

function AgentTimeline({ trace, active }: { trace: AgentTraceStep[]; active: boolean }) {
  return (
    <div className="space-y-2">
      {trace.map((step, index) => (
        <AgentTimelineStep
          key={step.id}
          step={step}
          isLast={index === trace.length - 1}
        />
      ))}
      {active && (
        <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-2">
          <div className="flex justify-center">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </div>
          </div>
          <div className="min-w-0 rounded-md border border-dashed border-cyan-200 bg-cyan-50/50 px-3 py-2 text-xs text-cyan-800">
            等待下一步
          </div>
        </div>
      )}
    </div>
  )
}

function AgentTimelineStep({ step, isLast }: { step: AgentTraceStep; isLast: boolean }) {
  const meta = traceStepMeta(step)
  const Icon = meta.icon
  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-2">
      <div className="flex flex-col items-center">
        <div className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border ${meta.dotClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        {!isLast && <div className="mt-1 h-full min-h-4 w-px bg-neutral-200" />}
      </div>
      <div className={`min-w-0 rounded-md border px-3 py-2 ${meta.cardClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={`shrink-0 text-[11px] font-semibold ${meta.labelClass}`}>{meta.label}</span>
            <span className="min-w-0 truncate text-xs font-semibold text-neutral-950">{step.title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[11px] text-neutral-500">
            {step.toolName && <span className="font-mono">{step.toolName}</span>}
            {step.latencyMs !== undefined && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {step.latencyMs}ms
              </span>
            )}
          </div>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-neutral-700">{step.detail}</p>
        <div className="mt-2 grid gap-2">
          {step.input !== undefined && <JsonBlock label="输入" value={step.input} />}
          {step.outputSummary !== undefined && <JsonBlock label={step.type === "error" ? "错误" : "结果"} value={step.outputSummary} />}
        </div>
      </div>
    </div>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 rounded border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-500">{label}</div>
      <pre className="max-h-44 overflow-auto p-2 text-[11px] leading-4 text-neutral-800">{formatJson(value)}</pre>
    </div>
  )
}

function traceStepMeta(step: AgentTraceStep): {
  label: string
  icon: LucideIcon
  dotClass: string
  cardClass: string
  labelClass: string
} {
  if (step.type === "tool") {
    return {
      label: "工具",
      icon: Wrench,
      dotClass: "border-blue-200 bg-blue-50 text-blue-700",
      cardClass: "border-blue-100 bg-blue-50/30",
      labelClass: "text-blue-700",
    }
  }
  if (step.type === "observation") {
    return {
      label: "观察",
      icon: FileSearch,
      dotClass: "border-amber-200 bg-amber-50 text-amber-700",
      cardClass: "border-amber-100 bg-amber-50/30",
      labelClass: "text-amber-700",
    }
  }
  if (step.type === "answer") {
    return {
      label: "回答",
      icon: CheckCircle2,
      dotClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      cardClass: "border-emerald-100 bg-emerald-50/30",
      labelClass: "text-emerald-700",
    }
  }
  if (step.type === "error") {
    return {
      label: "失败",
      icon: AlertCircle,
      dotClass: "border-red-200 bg-red-50 text-red-700",
      cardClass: "border-red-100 bg-red-50/40",
      labelClass: "text-red-700",
    }
  }
  return {
    label: "思考",
    icon: Brain,
    dotClass: "border-cyan-200 bg-cyan-50 text-cyan-700",
    cardClass: "border-cyan-100 bg-cyan-50/30",
    labelClass: "text-cyan-700",
  }
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function clientId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
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
  const [submittedQuery, setSubmittedQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [mode, setMode] = useState<string>("keyword")
  const [lightbox, setLightbox] = useState<SearchResult["images"][number] | null>(null)
  const hasSearched = submittedQuery.length > 0

  const runSearch = async () => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) return
    setSubmittedQuery(trimmedQuery)
    const response = await api.search(kbId, trimmedQuery)
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
          {results.length === 0 && (
            <div className="p-4 text-sm text-neutral-500">
              {hasSearched
                ? `没有检索到与“${submittedQuery}”相关的结果。可以换个关键词，或确认文档已经完成摄取。`
                : "输入关键词后测试召回。上传并完成摄取后，这里会展示 wiki 页面、源路径、分数和图片。"}
            </div>
          )}
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

function ToolsPanel({ kbId, isAdmin }: { kbId: string; isAdmin: boolean }) {
  const [tools, setTools] = useState<ToolDefinition[]>([])
  const [selectedName, setSelectedName] = useState("")
  const [argsText, setArgsText] = useState("{}")
  const [resultText, setResultText] = useState("")
  const [customToolText, setCustomToolText] = useState(defaultCustomToolJson())
  const [customTools, setCustomTools] = useState<CustomHttpToolConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [savingCustom, setSavingCustom] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)

  const loadTools = async (cancelled?: () => boolean) => {
    const [items, config] = await Promise.all([
      api.listKbTools(kbId),
      isAdmin ? api.toolConfig() : Promise.resolve(undefined),
    ])
    if (cancelled?.()) return
    if (config) setCustomTools(config.customTools)
    setTools(items)
    const first = items.find((item) => item.scope === "knowledge_base" && item.enabled) ?? items.find((item) => item.enabled) ?? items[0]
    setSelectedName(first?.name ?? "")
    setArgsText(defaultToolArgs(first))
    setResultText("")
    const selectedCustom = config?.customTools[0]
    setCustomToolText(selectedCustom ? JSON.stringify(selectedCustom, null, 2) : defaultCustomToolJson())
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void loadTools(() => cancelled)
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [kbId, isAdmin])

  const selected = tools.find((tool) => tool.name === selectedName)

  const selectTool = (name: string) => {
    const tool = tools.find((item) => item.name === name)
    setSelectedName(name)
    setArgsText(defaultToolArgs(tool))
    setResultText("")
    if (tool?.source === "custom") {
      setCustomToolText(JSON.stringify(customTools.find((item) => item.name === tool.name) ?? customToolFromDefinition(tool), null, 2))
    }
    setError(null)
  }

  const saveCustomTool = async () => {
    setSavingCustom(true)
    setCustomError(null)
    try {
      const parsed = JSON.parse(customToolText) as CustomHttpToolConfig
      await api.saveCustomTool(parsed)
      await loadTools()
    } catch (err) {
      setCustomError(errorMessage(err))
    } finally {
      setSavingCustom(false)
    }
  }

  const deleteSelectedCustomTool = async () => {
    if (!selected || selected.source !== "custom") return
    setSavingCustom(true)
    setCustomError(null)
    try {
      await api.deleteCustomTool(selected.name)
      await loadTools()
    } catch (err) {
      setCustomError(errorMessage(err))
    } finally {
      setSavingCustom(false)
    }
  }

  const runSelectedTool = async () => {
    if (!selected) return
    let args: Record<string, unknown>
    try {
      const parsed = JSON.parse(argsText || "{}") as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("工具参数必须是 JSON object")
      args = parsed as Record<string, unknown>
    } catch (err) {
      setError(errorMessage(err))
      return
    }
    setRunning(true)
    setError(null)
    try {
      const response = await api.runKbTool(kbId, selected.name, args)
      setResultText(JSON.stringify(response.result, null, 2))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  const required = new Set(selected?.parameters.required ?? [])

  return (
    <section className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] bg-white">
      <aside className="min-h-0 overflow-auto border-r border-neutral-100">
        <div className="sticky top-0 z-10 border-b border-neutral-100 bg-white px-4 py-3">
          <h2 className="text-base font-semibold">工具</h2>
          <p className="mt-1 text-sm text-neutral-600">只读工具目录和运行结果。</p>
        </div>
        <div className="space-y-2 p-3">
          {loading && <div className="flex items-center gap-2 px-2 py-3 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" />加载工具</div>}
          {!loading && tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              className={`block w-full rounded-md border p-3 text-left text-sm transition ${selectedName === tool.name ? "border-cyan-300 bg-cyan-50" : "border-neutral-200 hover:border-cyan-200 hover:bg-cyan-50/40"}`}
              onClick={() => selectTool(tool.name)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-neutral-950">{tool.displayName}</span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">{tool.source === "custom" ? "custom" : tool.category}</span>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-neutral-500">{tool.name}{tool.enabled ? "" : " · disabled"}</div>
            </button>
          ))}
        </div>
        {isAdmin && (
          <details className="border-t border-neutral-100 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-neutral-800">自定义 HTTP 工具</summary>
            <p className="mt-2 text-xs leading-5 text-neutral-600">保存后会出现在工具列表；`agentEnabled` 为 true 且 triggers 命中时，Agent 可自动调用。</p>
            <textarea
              className="mt-3 h-72 w-full resize-none rounded-md border border-neutral-200 bg-white p-2 font-mono text-[11px] leading-4 outline-none focus:border-cyan-700"
              value={customToolText}
              onChange={(event) => setCustomToolText(event.target.value)}
              spellCheck={false}
            />
            {customError && <p className="mt-2 text-xs text-red-600">{customError}</p>}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="h-8 rounded-md bg-cyan-700 px-3 text-xs font-medium text-white hover:bg-cyan-800 disabled:opacity-60"
                onClick={() => void saveCustomTool()}
                disabled={savingCustom}
              >
                保存工具
              </button>
              {selected?.source === "custom" && (
                <button
                  type="button"
                  className="h-8 rounded-md border border-red-200 px-3 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                  onClick={() => void deleteSelectedCustomTool()}
                  disabled={savingCustom}
                >
                  删除选中
                </button>
              )}
            </div>
          </details>
        )}
      </aside>

      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="border-b border-neutral-100 px-4 py-3">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{selected.displayName}</h3>
                  <p className="mt-1 text-sm text-neutral-600">{selected.description}</p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-60"
                  onClick={() => void runSelectedTool()}
                  disabled={running}
                >
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  运行
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-600">
                <MiniInfo label="scope" value={selected.scope} />
                <MiniInfo label="readOnly" value={selected.readOnly ? "true" : "false"} />
              </div>
            </>
          ) : (
            <p className="text-sm text-neutral-500">暂无可用工具。</p>
          )}
        </div>

        <div className="grid min-h-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 overflow-hidden p-3">
          <section className="flex min-h-0 flex-col rounded-md border border-neutral-200">
            <div className="border-b border-neutral-100 px-3 py-2">
              <h4 className="text-sm font-semibold">参数</h4>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
              {selected && Object.entries(selected.parameters.properties).map(([name, property]) => (
                <div key={name} className="rounded-md border border-neutral-100 bg-neutral-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-neutral-800">{name}</span>
                    <span className="text-[11px] text-neutral-500">{property.type}{required.has(name) ? " required" : ""}</span>
                  </div>
                  {property.description && <p className="mt-1 text-xs leading-5 text-neutral-600">{property.description}</p>}
                </div>
              ))}
              <textarea
                className="h-52 w-full resize-none rounded-md border border-neutral-200 bg-white p-3 font-mono text-xs leading-5 outline-none focus:border-cyan-700"
                value={argsText}
                onChange={(event) => setArgsText(event.target.value)}
                spellCheck={false}
              />
            </div>
          </section>

          <section className="flex min-h-0 flex-col rounded-md border border-neutral-200">
            <div className="border-b border-neutral-100 px-3 py-2">
              <h4 className="text-sm font-semibold">结果</h4>
            </div>
            {error && <div className="m-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs leading-5 text-neutral-800">{resultText || "运行工具后显示 JSON 结果。"}</pre>
          </section>
        </div>
      </div>
    </section>
  )
}

function defaultToolArgs(tool?: ToolDefinition): string {
  const args: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(tool?.parameters.properties ?? {})) {
    if (property.default !== undefined) args[name] = property.default
  }
  if (tool?.name === "retrieve_kb") args.query = ""
  if (tool?.name === "read_kb_file") args.key = "wiki/index.md"
  if (tool?.name === "raw_list_files") args.parent = "raw"
  if (tool?.name === "read_raw_source") args.path = "raw/example.txt"
  return JSON.stringify(args, null, 2)
}

function defaultCustomToolJson(): string {
  const tool: CustomHttpToolConfig = {
    name: "external_search",
    displayName: "External search",
    description: "Call an external HTTP service when the question needs this tool.",
    category: "external",
    scope: "knowledge_base",
    readOnly: true,
    enabled: true,
    agentEnabled: false,
    triggers: ["external_search"],
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Question or search phrase." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    http: {
      url: "https://example.com/tool",
      method: "POST",
      headers: {},
      timeoutMs: 10000,
    },
  }
  return JSON.stringify(tool, null, 2)
}

function customToolFromDefinition(tool: ToolDefinition): CustomHttpToolConfig {
  return {
    name: tool.name,
    displayName: tool.displayName,
    description: tool.description,
    category: tool.category,
    scope: tool.scope,
    readOnly: tool.readOnly,
    enabled: tool.enabled,
    agentEnabled: tool.agentEnabled,
    triggers: tool.triggers,
    parameters: tool.parameters,
    http: {
      url: "https://example.com/tool",
      method: "POST",
      headers: {},
      timeoutMs: 10000,
    },
  }
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
