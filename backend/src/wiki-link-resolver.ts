import type { WikiLink, WikiPage } from "./types.js"
import { extractWikiLinks, fileNameOf, normalizeStorageKey, slugify } from "./wiki-utils.js"

const FUZZY_COMPACT_MIN = 6
export const STRUCTURAL_WIKI_TYPES = new Set(["index", "log", "overview", "purpose", "schema"])

export function isStructuralWikiPage(page: Pick<WikiPage, "path" | "type">): boolean {
  return page.path === "wiki/index.md" || STRUCTURAL_WIKI_TYPES.has(page.type)
}

export class WikiLinkResolver {
  private readonly exact = new Map<string, Set<string>>()
  private readonly compact = new Map<string, Set<string>>()
  private readonly titleCompact = new Map<string, string>()

  constructor(pages: readonly WikiPage[]) {
    for (const page of pages) {
      this.indexPage(page)
    }
  }

  resolve(raw: string): string | undefined {
    for (const key of refKeys(raw)) {
      const id = only(this.exact.get(key))
      if (id) return id
    }

    const rawCompact = compactKey(raw)
    const compactId = only(this.compact.get(rawCompact))
    if (compactId) return compactId

    if (rawCompact.length < FUZZY_COMPACT_MIN) return undefined
    const candidates = new Set<string>()
    for (const [titleKey, pageId] of this.titleCompact) {
      if (titleKey.startsWith(rawCompact)) candidates.add(pageId)
    }
    return only(candidates)
  }

  private indexPage(page: WikiPage): void {
    for (const alias of pageAliases(page)) {
      this.add(this.exact, refKeys(alias), page.id)
      this.add(this.compact, [compactKey(alias)], page.id)
    }

    for (const title of titleAliases(page.title)) {
      const key = compactKey(title)
      if (key.length > 0 && !this.titleCompact.has(key)) {
        this.titleCompact.set(key, page.id)
      } else if (this.titleCompact.get(key) !== page.id) {
        this.titleCompact.delete(key)
      }
    }
  }

  private add(index: Map<string, Set<string>>, keys: Iterable<string>, pageId: string): void {
    for (const key of keys) {
      if (!key) continue
      const ids = index.get(key) ?? new Set<string>()
      ids.add(pageId)
      index.set(key, ids)
    }
  }
}

export function wikiLinksForPage(page: WikiPage, resolver: WikiLinkResolver): WikiLink[] {
  const seen = new Set<string>()
  const links: WikiLink[] = []
  for (const raw of extractWikiLinks(page.content)) {
    const targetPageId = resolver.resolve(raw) ?? fallbackTargetId(raw)
    if (targetPageId === page.id) continue
    const key = `${page.id}:::${targetPageId}:::${raw}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({
      companyId: page.companyId,
      kbId: page.kbId,
      sourcePageId: page.id,
      targetPageId,
      targetRaw: raw,
    })
  }
  return links
}

export function fallbackTargetId(raw: string): string {
  return slugify(cleanRef(raw))
}

function pageAliases(page: WikiPage): string[] {
  const aliases = [
    page.id,
    page.path,
    fileNameOf(page.path),
    fileNameOf(page.path).replace(/\.md$/i, ""),
    ...titleAliases(page.title),
  ]

  if (page.type === "source") aliases.push(...page.sources)
  return aliases.filter(Boolean)
}

function titleAliases(title: string): string[] {
  const aliases = new Set<string>()
  const clean = title.trim()
  if (!clean) return []
  aliases.add(clean)

  const withoutTrailingParen = clean.replace(/\s*[\(（][^()（）]+[\)）]\s*$/u, "").trim()
  if (withoutTrailingParen) aliases.add(withoutTrailingParen)

  for (const match of clean.matchAll(/[\(（]([^()（）]+)[\)）]/gu)) {
    const inner = match[1]?.trim()
    if (inner) aliases.add(inner)
  }
  return [...aliases]
}

function refKeys(raw: string): string[] {
  const clean = cleanRef(raw)
  const normalized = normalizeRef(clean)
  const keys = new Set<string>([normalized])
  const storage = normalizeStorageKey(clean)
  keys.add(normalizeRef(storage))
  keys.add(normalizeRef(fileNameOf(storage)))
  keys.add(normalizeRef(fileNameOf(storage).replace(/\.md$/i, "")))
  return [...keys].filter(Boolean)
}

function cleanRef(raw: string): string {
  let value = raw.trim()
  const wikilink = value.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/)
  if (wikilink) value = wikilink[1]
  if (value.includes("|")) value = value.split("|")[0] ?? value
  return value.trim().replace(/^wiki\//i, "").replace(/\.md$/i, "")
}

function normalizeRef(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/^wiki\//, "")
    .replace(/\.md$/i, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function compactKey(value: string): string {
  return cleanRef(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function only(values: Iterable<string> | undefined): string | undefined {
  if (!values) return undefined
  let found: string | undefined
  for (const value of values) {
    if (found && found !== value) return undefined
    found = value
  }
  return found
}
