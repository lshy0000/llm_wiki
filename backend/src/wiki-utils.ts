import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import type { ImageAsset, ParsedDocument } from "./types.js"

export function nowIso(): string {
  return new Date().toISOString()
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`
}

export function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex")
}

export function normalizeStorageKey(key: string): string {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "")
  const parts = normalized.split("/").filter(Boolean)
  if (parts.some((part) => part === "..")) {
    throw new Error(`Unsafe storage key: ${key}`)
  }
  return parts.join("/")
}

export function fileNameOf(key: string): string {
  return normalizeStorageKey(key).split("/").pop() ?? key
}

export function parentPathOf(relativePath: string): string {
  const normalized = normalizeStorageKey(relativePath)
  const parts = normalized.split("/")
  parts.pop()
  return parts.join(" > ")
}

export function parentStoragePathOf(relativePath: string): string {
  const normalized = normalizeStorageKey(relativePath)
  const parts = normalized.split("/")
  parts.pop()
  return parts.join("/")
}

export function folderContextFor(relativePath: string, input?: { uploadBatchId?: string; root?: string }): string {
  const normalized = normalizeStorageKey(relativePath)
  const parentPath = parentStoragePathOf(normalized)
  const fileName = fileNameOf(normalized)
  return [
    `Root: ${input?.root ?? "raw"}`,
    `Relative path: ${normalized}`,
    parentPath ? `Parent folder: ${parentPath}` : "Parent folder: /",
    parentPath ? `Folder chain: ${parentPath.split("/").join(" > ")}` : "Folder chain: /",
    `File name: ${fileName}`,
    input?.uploadBatchId ? `Upload batch: ${input.uploadBatchId}` : "",
  ].filter(Boolean).join("\n")
}

export function slugify(input: string): string {
  const clean = input
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return clean || `page-${Date.now()}`
}

export function pageIdFromPath(pagePath: string): string {
  return normalizeStorageKey(pagePath)
    .replace(/^wiki\//, "")
    .replace(/\.md$/, "")
    .split("/")
    .pop() ?? pagePath
}

export function parseFrontmatter(content: string): {
  title: string
  type: string
  sources: string[]
} {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  const fm = fmMatch?.[1] ?? ""
  const title =
    fm.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ??
    content.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
    "Untitled"
  const type = fm.match(/^type:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim().toLowerCase() ?? "concept"
  const sources: string[] = []
  const block = fm.match(/^sources:\s*\n((?:\s+-\s+.+\n?)*)/m)
  if (block) {
    for (const line of block[1].split("\n")) {
      const item = line.match(/^\s+-\s+["']?(.+?)["']?\s*$/)?.[1]?.trim()
      if (item) sources.push(item)
    }
  }
  const inline = fm.match(/^sources:\s*\[([^\]]*)\]/m)
  if (inline) {
    for (const item of inline[1].split(",")) {
      const clean = item.trim().replace(/^["']|["']$/g, "")
      if (clean) sources.push(clean)
    }
  }
  return { title, type, sources }
}

export function extractWikiLinks(content: string): string[] {
  const links: string[] = []
  const regex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) links.push(match[1].trim())
  return links
}

const STOP_WORDS = new Set([
  "the",
  "is",
  "a",
  "an",
  "what",
  "how",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "it",
  "its",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "this",
  "that",
  "these",
  "those",
  "什么",
  "一个",
  "这个",
  "那个",
  "以及",
])

export function tokenize(text: string): string[] {
  const rawTokens = text
    .toLowerCase()
    .split(/[\s,，。！？、；；?"'()（）\-_/\\·~]+/)
    .filter((token) => token.length > 1)
    .filter((token) => !STOP_WORDS.has(token))

  const tokens: string[] = []
  for (const token of rawTokens) {
    const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(token)
    if (hasCjk && token.length > 2) {
      const chars = [...token]
      for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1])
      for (const ch of chars) {
        if (!STOP_WORDS.has(ch)) tokens.push(ch)
      }
    }
    tokens.push(token)
  }
  return [...new Set(tokens)]
}

export function buildSnippet(content: string, query: string, max = 240): string {
  const tokens = tokenize(query)
  const lower = content.toLowerCase()
  let pos = 0
  for (const token of tokens) {
    const idx = lower.indexOf(token.toLowerCase())
    if (idx >= 0) {
      pos = Math.max(0, idx - Math.floor(max / 3))
      break
    }
  }
  const snippet = content.slice(pos, pos + max).replace(/\s+/g, " ").trim()
  return `${pos > 0 ? "..." : ""}${snippet}${pos + max < content.length ? "..." : ""}`
}

export function chunkText(text: string, maxChars = 1600): string[] {
  const paragraphs = text.split(/\n{2,}/)
  const chunks: string[] = []
  let current = ""
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 > maxChars && current.trim()) {
      chunks.push(current.trim())
      current = ""
    }
    current += `${paragraph}\n\n`
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.length > 0 ? chunks : [text.slice(0, maxChars)]
}

export interface FileBlock {
  kind: "file" | "review"
  path?: string
  content: string
}

export function parseFileBlocks(text: string): FileBlock[] {
  const blocks: FileBlock[] = []
  const regex = /```(?:FILE|file)\s+([^\n]+)\n([\s\S]*?)```|```(?:REVIEW|review)\s*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      blocks.push({ kind: "file", path: normalizeStorageKey(match[1].trim()), content: match[2].trim() })
    } else {
      blocks.push({ kind: "review", content: (match[3] ?? "").trim() })
    }
  }
  return blocks
}

export function safeWikiPath(pagePath: string): string {
  const normalized = normalizeStorageKey(pagePath)
  if (!normalized.startsWith("wiki/") || !normalized.endsWith(".md")) {
    throw new Error(`Generated file must be a markdown page under wiki/: ${pagePath}`)
  }
  return normalized
}

export function defaultWikiFiles(name: string): Array<{ key: string; content: string }> {
  const today = new Date().toISOString().slice(0, 10)
  return [
    {
      key: "wiki/schema.md",
      content: `---
type: schema
title: ${name} Schema
sources: []
created: ${today}
updated: ${today}
---

# Wiki Schema

## Page Types

- entity: named things
- concept: ideas, mechanisms, patterns
- source: uploaded documents and web findings
- query: open questions
- comparison: side-by-side analysis
- synthesis: cross-cutting conclusions

## Rules

- Every generated page must use YAML frontmatter.
- Every page should cite its source through the sources field.
- Use [[wikilink]] syntax for internal relations.
- Prefer incremental updates over rewriting unrelated pages.
`,
    },
    {
      key: "wiki/purpose.md",
      content: `---
type: purpose
title: ${name} Purpose
sources: []
created: ${today}
updated: ${today}
---

# Project Purpose

${name} is a browser knowledge base built with the llm_wiki pattern.
`,
    },
    {
      key: "wiki/log.md",
      content: `---
type: log
title: ${name} Log
sources: []
created: ${today}
updated: ${today}
---

# Operation Log

- ${today}: Knowledge base initialized.
`,
    },
    {
      key: "wiki/index.md",
      content: `---
type: index
title: ${name} Index
sources: []
created: ${today}
updated: ${today}
---

# Wiki Index

## Entities

## Concepts

## Sources

## Queries

## Comparisons

## Synthesis
`,
    },
    {
      key: "wiki/overview.md",
      content: `---
type: overview
title: ${name} Overview
sources: []
created: ${today}
updated: ${today}
---

# ${name} Overview

This page is maintained by the ingest pipeline.
`,
    },
  ]
}

export function buildFallbackWikiPage(sourceName: string, sourceText: string, sourceId: string, folderContext = ""): {
  path: string
  content: string
} {
  const title = sourceName.replace(/\.[^.]+$/, "")
  const slug = slugify(title)
  const today = new Date().toISOString().slice(0, 10)
  const summary = sourceText.slice(0, 1600).trim() || "No text could be extracted from this source."
  return {
    path: `wiki/sources/${slug}.md`,
    content: `---
type: source
title: ${title}
sources:
  - ${sourceId}
source_path: ${sourceName}
folder_context: ${JSON.stringify(folderContext)}
created: ${today}
updated: ${today}
---

# ${title}

## Source Summary

${summary}

## Extracted Concepts

- [[${slug}]]
`,
  }
}

export function extractMarkdownImages(content: string): Array<{ alt: string; src: string }> {
  const images: Array<{ alt: string; src: string }> = []
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    images.push({ alt: match[1], src: match[2] })
  }
  return images
}

export function extractJpegImagesFromPdf(buffer: Buffer): ParsedDocument["images"] {
  const text = buffer.toString("latin1")
  const images: ParsedDocument["images"] = []
  const objectRegex = /<<(?:.|\r|\n)*?\/Subtype\s*\/Image(?:.|\r|\n)*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g
  let match: RegExpExecArray | null
  let index = 1
  while ((match = objectRegex.exec(text)) !== null) {
    const objectHeader = match[0].slice(0, Math.max(0, match[0].indexOf("stream")))
    if (!/\/DCTDecode/.test(objectHeader)) continue
    const imageBytes = Buffer.from(match[1], "latin1")
    if (imageBytes.length < 256) continue
    images.push({
      fileName: `pdf-image-${index}.jpg`,
      mediaType: "image/jpeg",
      bytes: imageBytes,
      origin: "pdf-embedded",
    })
    index += 1
  }
  return images
}

export function relativeWikiDirForType(type: string): string {
  switch (type) {
    case "entity":
      return "wiki/entities"
    case "source":
      return "wiki/sources"
    case "query":
      return "wiki/queries"
    case "comparison":
      return "wiki/comparisons"
    case "synthesis":
      return "wiki/synthesis"
    default:
      return "wiki/concepts"
  }
}

export function pathJoinKey(...parts: string[]): string {
  return normalizeStorageKey(path.posix.join(...parts))
}

export function isImageFile(fileName: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(fileName)
}

export function mediaTypeForFile(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  return "image/jpeg"
}

export function imageMarkdown(asset: ImageAsset): string {
  return `![${asset.caption}](/api/kbs/${asset.kbId}/objects/${encodeURIComponent(asset.storageKey)})`
}
