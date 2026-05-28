import { CheckCircle2, Database, LogOut } from "lucide-react"
import { UserBadge } from "@/components/app-shell"
import type { AuthPayload, Capabilities } from "@/web/types"

export function LandingPage({
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
