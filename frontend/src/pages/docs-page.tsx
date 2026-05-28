import { isValidElement, useEffect, useMemo, useState, type HTMLAttributes, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import {
  BookOpen,
  ExternalLink,
  FileText,
  FolderOpen,
  Hash,
  ListTree,
  Search,
} from "lucide-react"
import { MermaidDiagram, unwrapMermaidPre } from "@/components/mermaid-diagram"
import { detectLanguage } from "@/lib/detect-language"
import { parseFrontmatter } from "@/lib/frontmatter"
import { getHtmlLang, getTextDirection } from "@/lib/language-metadata"

type DocItem = {
  path: string
  folder: string
  title: string
  summary: string
  body: string
  content: string
}

type TocItem = {
  id: string
  level: number
  text: string
}

type DocLink = {
  path: string
  href: string
}

const docModules = import.meta.glob<string>("../../../docs/**/*.md", {
  eager: true,
  import: "default",
  query: "?raw",
})

const assetModules = import.meta.glob<string>("../../../docs/**/*.{gif,jpeg,jpg,png,svg,webp}", {
  eager: true,
  import: "default",
  query: "?url",
})

const DOC_ASSET_URLS = new Map(
  Object.entries(assetModules).map(([modulePath, url]) => [toDocsPath(modulePath), url]),
)

const DOCS = Object.entries(docModules)
  .map(([modulePath, content]) => buildDocItem(toDocsPath(modulePath), content))
  .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"))

const DOC_PATHS = new Set(DOCS.map((doc) => doc.path))

export function DocsPage({ docPath, onNavigate }: { docPath?: string; onNavigate: (path: string) => void }) {
  const [selectedPath, setSelectedPath] = useState(() => resolveDocPath(docPath) ?? DOCS[0]?.path ?? "")
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLowerCase()

  useEffect(() => {
    const resolved = resolveDocPath(docPath)
    if (resolved) setSelectedPath(resolved)
  }, [docPath])

  const visibleDocs = useMemo(() => {
    if (!normalizedQuery) return DOCS
    return DOCS.filter((doc) => {
      const haystack = `${doc.title}\n${doc.path}\n${doc.summary}\n${doc.content}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [normalizedQuery])

  const selectedDoc = DOCS.find((doc) => doc.path === selectedPath) ?? DOCS[0] ?? null
  const toc = useMemo(() => (selectedDoc ? extractToc(selectedDoc.body) : []), [selectedDoc])
  const selectDoc = (path: string, href = hrefForDocPath(path)) => {
    setSelectedPath(path)
    onNavigate(href)
  }

  if (!selectedDoc) {
    return (
      <section className="flex h-full items-center justify-center bg-[#f6f7f9] p-6 text-neutral-950">
        <div className="border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <BookOpen className="mx-auto h-8 w-8 text-neutral-400" />
          <h1 className="mt-3 text-base font-semibold">暂无文档</h1>
          <p className="mt-2 text-sm text-neutral-500">没有在 docs 目录中找到 Markdown 文件。</p>
        </div>
      </section>
    )
  }

  return (
    <section className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)_240px] bg-[#f6f7f9] text-neutral-950">
      <aside className="flex min-h-0 flex-col border-r border-neutral-200 bg-white">
        <div className="shrink-0 border-b border-neutral-100 p-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-cyan-700" />
            <h1 className="text-base font-semibold">文档中心</h1>
          </div>
          <p className="mt-1 text-xs text-neutral-500">{DOCS.length} 篇 Markdown 文档</p>
          <label className="mt-4 flex h-9 items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm focus-within:border-cyan-600 focus-within:bg-white">
            <Search className="h-4 w-4 shrink-0 text-neutral-400" />
            <input
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-neutral-400"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文档"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {visibleDocs.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-neutral-500">没有匹配的文档</div>
          ) : (
            <div className="space-y-1">
              {visibleDocs.map((doc) => (
                <button
                  key={doc.path}
                  className={`block w-full rounded-md border px-3 py-2 text-left transition ${
                    doc.path === selectedDoc.path
                      ? "border-cyan-200 bg-cyan-50 text-cyan-950"
                      : "border-transparent text-neutral-700 hover:border-neutral-200 hover:bg-neutral-50"
                  }`}
                  onClick={() => selectDoc(doc.path)}
                  type="button"
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span className="truncate">{doc.folder || "docs"}</span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm font-medium leading-5">{doc.title}</div>
                  {doc.summary && <div className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500">{doc.summary}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="min-h-0 overflow-auto bg-white">
        <article className="mx-auto min-h-full max-w-5xl px-8 py-7">
          <div className="mb-5 border-b border-neutral-200 pb-5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <FileText className="h-3.5 w-3.5" />
              <span>{selectedDoc.path}</span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold leading-tight">{selectedDoc.title}</h2>
            {selectedDoc.summary && <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">{selectedDoc.summary}</p>}
          </div>
          <DocMarkdown doc={selectedDoc} onSelectDoc={selectDoc} />
        </article>
      </main>

      <aside className="min-h-0 overflow-auto border-l border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ListTree className="h-4 w-4 text-cyan-700" />
          目录
        </div>
        {toc.length === 0 ? (
          <p className="text-xs leading-5 text-neutral-500">当前文档没有标题目录。</p>
        ) : (
          <nav className="space-y-1">
            {toc.map((item, index) => (
              <a
                key={`${item.id}-${index}`}
                className="block truncate rounded px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 hover:text-cyan-700"
                href={`#${item.id}`}
                style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
              >
                {item.text}
              </a>
            ))}
          </nav>
        )}
      </aside>
    </section>
  )
}

function DocMarkdown({ doc, onSelectDoc }: { doc: DocItem; onSelectDoc: (path: string, href?: string) => void }) {
  const language = detectLanguage(doc.body)
  const direction = getTextDirection(language)
  const htmlLang = getHtmlLang(language)

  return (
    <div
      className="doc-markdown min-w-0 text-[15px] leading-7 text-neutral-800"
      dir={direction}
      lang={htmlLang}
      style={{ textAlign: "start" }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: ({ children, ...props }) => <Heading level={1} {...props}>{children}</Heading>,
          h2: ({ children, ...props }) => <Heading level={2} {...props}>{children}</Heading>,
          h3: ({ children, ...props }) => <Heading level={3} {...props}>{children}</Heading>,
          h4: ({ children, ...props }) => <Heading level={4} {...props}>{children}</Heading>,
          p: ({ children, ...props }) => <p className="my-4 leading-7" {...props}>{children}</p>,
          ul: ({ children, ...props }) => <ul className="my-4 list-disc space-y-1 pl-6" {...props}>{children}</ul>,
          ol: ({ children, ...props }) => <ol className="my-4 list-decimal space-y-1 pl-6" {...props}>{children}</ol>,
          li: ({ children, ...props }) => <li className="pl-1 leading-7" {...props}>{children}</li>,
          blockquote: ({ children, ...props }) => (
            <blockquote className="my-4 border-l-4 border-cyan-200 bg-cyan-50/60 px-4 py-2 text-neutral-700" {...props}>{children}</blockquote>
          ),
          hr: (props) => <hr className="my-8 border-neutral-200" {...props} />,
          a: ({ href, children, ...props }) => {
            const h = typeof href === "string" ? href : ""
            const linkedDoc = resolveDocHref(doc.path, h)
            const external = isExternalUrl(h)
            return (
              <a
                className="inline-flex items-baseline gap-1 text-cyan-700 underline decoration-cyan-300 underline-offset-2 hover:decoration-cyan-700"
                href={linkedDoc ? linkedDoc.href : h || undefined}
                onClick={(event) => {
                  if (!linkedDoc) return
                  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return
                  event.preventDefault()
                  onSelectDoc(linkedDoc.path, linkedDoc.href)
                }}
                rel={external ? "noreferrer" : undefined}
                target={external ? "_blank" : undefined}
                {...props}
              >
                {children}
                {external && <ExternalLink className="h-3 w-3 shrink-0" />}
              </a>
            )
          },
          img: ({ src, alt, ...props }) => (
            <img
              className="my-5 max-h-[560px] max-w-full rounded-md border border-neutral-200 object-contain"
              src={resolveDocAssetSrc(doc.path, typeof src === "string" ? src : undefined)}
              alt={alt ?? ""}
              loading="lazy"
              {...props}
            />
          ),
          table: ({ children, ...props }) => (
            <div className="my-5 overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full border-collapse text-sm" {...props}>{children}</table>
            </div>
          ),
          thead: ({ children, ...props }) => <thead className="bg-neutral-50" {...props}>{children}</thead>,
          th: ({ children, ...props }) => (
            <th className="border border-neutral-200 px-3 py-2 text-left text-xs font-semibold text-neutral-700" {...props}>{children}</th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-neutral-200 px-3 py-2 align-top text-sm leading-6" {...props}>{children}</td>
          ),
          pre: ({ children, ...props }) => {
            const mermaid = unwrapMermaidPre(children)
            if (mermaid) return <>{mermaid}</>
            return (
              <pre
                className="my-5 overflow-x-auto rounded-md bg-neutral-950 p-4 text-sm leading-6 text-neutral-100"
                dir="ltr"
                style={{ textAlign: "left" }}
                {...props}
              >
                {children}
              </pre>
            )
          },
          code: ({ className, children, ...props }) => {
            const lang = className?.replace("language-", "")
            const codeText = String(children).replace(/\n$/, "")
            if (lang === "mermaid") return <MermaidDiagram code={codeText} />
            return (
              <code
                className={
                  className
                    ? `${className} font-mono text-sm`
                    : "rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[0.92em] text-neutral-900"
                }
                dir="ltr"
                {...props}
              >
                {children}
              </code>
            )
          },
        }}
      >
        {doc.body}
      </ReactMarkdown>
    </div>
  )
}

function Heading({
  level,
  children,
  ...props
}: { level: 1 | 2 | 3 | 4; children: ReactNode } & HTMLAttributes<HTMLHeadingElement>) {
  const text = textFromNode(children)
  const id = slugHeading(text)
  if (level === 1) {
    return (
      <h1 id={id} className="group mt-0 mb-5 border-b border-neutral-200 pb-3 text-3xl font-semibold leading-tight" {...props}>
        <HeadingAnchor id={id} />
        {children}
      </h1>
    )
  }
  if (level === 2) {
    return (
      <h2 id={id} className="group mt-9 mb-4 border-b border-neutral-100 pb-2 text-2xl font-semibold leading-tight" {...props}>
        <HeadingAnchor id={id} />
        {children}
      </h2>
    )
  }
  if (level === 3) {
    return (
      <h3 id={id} className="group mt-7 mb-3 text-xl font-semibold leading-tight" {...props}>
        <HeadingAnchor id={id} />
        {children}
      </h3>
    )
  }
  return (
    <h4 id={id} className="group mt-6 mb-2 text-base font-semibold leading-tight" {...props}>
      <HeadingAnchor id={id} />
      {children}
    </h4>
  )
}

function HeadingAnchor({ id }: { id: string }) {
  return (
    <a
      className="mr-2 inline-flex translate-y-0.5 text-neutral-300 opacity-0 transition group-hover:opacity-100 hover:text-cyan-700"
      href={`#${id}`}
      aria-label="定位到此标题"
    >
      <Hash className="h-4 w-4" />
    </a>
  )
}

function buildDocItem(path: string, content: string): DocItem {
  const { body } = parseFrontmatter(content)
  return {
    path,
    folder: folderFromPath(path),
    title: titleFromMarkdown(body, path),
    summary: summaryFromMarkdown(body),
    body,
    content,
  }
}

function titleFromMarkdown(body: string, path: string): string {
  const match = body.match(/^#\s+(.+?)\s*#*\s*$/m)
  const title = match?.[1] ? stripMarkdownInline(match[1]) : ""
  return title || fileStem(path)
}

function summaryFromMarkdown(body: string): string {
  const lines = body.split(/\r?\n/)
  let inFence = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence
      continue
    }
    if (inFence || !line) continue
    if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/.test(line)) continue
    const clean = stripMarkdownInline(line)
    if (clean) return clean.length > 110 ? `${clean.slice(0, 110)}...` : clean
  }
  return ""
}

function extractToc(body: string): TocItem[] {
  const items: TocItem[] = []
  let inFence = false
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = rawLine.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/)
    if (!match) continue
    const text = stripMarkdownInline(match[2])
    if (!text) continue
    items.push({
      id: slugHeading(text),
      level: match[1].length,
      text,
    })
  }
  return items
}

function resolveDocHref(currentPath: string, href: string): DocLink | null {
  if (!href || href.startsWith("#") || isExternalUrl(href)) return null
  const { pathPart, suffix } = splitLinkTarget(href)
  const resolved = resolveDocLinkPath(currentPath, pathPart)
  return resolved ? { path: resolved, href: `${hrefForDocPath(resolved)}${suffix}` } : null
}

function resolveDocAssetSrc(currentPath: string, src?: string): string | undefined {
  if (!src || isExternalUrl(src) || src.startsWith("data:") || src.startsWith("blob:")) return src
  const [pathPart, suffix = ""] = splitUrlSuffix(src)
  const currentDir = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : ""
  const resolved = normalizeDocsRelativePath(pathPart.startsWith("/") ? pathPart : `${currentDir}/${pathPart}`)
  return DOC_ASSET_URLS.get(resolved) ? `${DOC_ASSET_URLS.get(resolved)}${suffix}` : src
}

function splitUrlSuffix(value: string): [string, string?] {
  const index = value.search(/[?#]/)
  return index === -1 ? [value] : [value.slice(0, index), value.slice(index)]
}

function splitLinkTarget(value: string): { pathPart: string; suffix: string } {
  const index = value.search(/[?#]/)
  if (index === -1) return { pathPart: value, suffix: "" }
  return { pathPart: value.slice(0, index), suffix: value.slice(index) }
}

function resolveDocLinkPath(currentPath: string, hrefPath: string): string | null {
  if (!hrefPath) return null
  const normalizedHref = hrefPath.replace(/\\/g, "/")
  if (normalizedHref.startsWith("/docs/")) {
    return resolveDocPath(normalizedHref.slice("/docs/".length))
  }
  if (!/\.(md|markdown)$/i.test(normalizedHref)) return null
  const currentDir = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : ""
  const resolved = normalizeDocsRelativePath(normalizedHref.startsWith("/") ? normalizedHref : `${currentDir}/${normalizedHref}`)
  return DOC_PATHS.has(resolved) ? resolved : null
}

function resolveDocPath(path?: string): string | null {
  if (!path) return null
  const decoded = decodeDocsPath(path)
  const normalized = normalizeDocsRelativePath(decoded)
  const candidates = [normalized]
  if (!/\.(md|markdown)$/i.test(normalized)) {
    candidates.push(`${normalized}.md`, `${normalized}.markdown`)
  }
  for (const candidate of candidates) {
    if (DOC_PATHS.has(candidate)) return candidate
  }
  return null
}

function hrefForDocPath(path: string): string {
  return `/docs/${path.split("/").map(encodeURIComponent).join("/")}`
}

function decodeDocsPath(path: string): string {
  return path.split("/").map(decodePathSegment).join("/")
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeDocsRelativePath(path: string): string {
  const clean = path.replace(/\\/g, "/").replace(/^\/?docs\//, "").replace(/^\/+/, "")
  const parts: string[] = []
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("/")
}

function toDocsPath(modulePath: string): string {
  return normalizeDocsRelativePath(modulePath.replace(/\\/g, "/").replace(/^.*?docs\//, ""))
}

function folderFromPath(path: string): string {
  if (!path.includes("/")) return "docs"
  return `docs/${path.slice(0, path.lastIndexOf("/"))}`
}

function fileStem(path: string): string {
  const name = path.split("/").pop() ?? path
  return name.replace(/\.(md|markdown)$/i, "")
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~#]/g, "")
    .trim()
}

function slugHeading(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[`*_~[\]().,，。:：;；!?！？'"“”‘’]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, 80)
  return slug || "section"
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textFromNode).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children)
  return ""
}

function isExternalUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")
}
