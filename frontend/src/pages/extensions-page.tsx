import { Blocks } from "lucide-react"

export function ExtensionsPage() {
  return (
    <section className="flex h-full flex-col bg-white">
      <header className="flex h-12 items-center border-b border-neutral-100 px-4">
        <h1 className="text-lg font-semibold">扩展管理</h1>
      </header>
      <div className="grid max-w-5xl grid-cols-3 gap-4 p-4">
        {[
          ["Web Clipper", "网页内容转 Markdown 写入 raw/，进入同一套 llm_wiki 摄取流程。"],
          ["REST API", "开放知识库列表、文件读取、混合搜索、图谱遍历和 raw 重扫接口。"],
          ["MCP Server", "后续企业化能力，基于服务端 API 暴露给 Agent 工具链。"],
        ].map(([name, description]) => (
          <article key={name} className="rounded-md border border-neutral-100 bg-white p-4 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
              <Blocks className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold">{name}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">{description}</p>
            <button className="mt-4 h-8 rounded-md border border-neutral-200 px-3 text-sm text-neutral-600">规划中</button>
          </article>
        ))}
      </div>
    </section>
  )
}
