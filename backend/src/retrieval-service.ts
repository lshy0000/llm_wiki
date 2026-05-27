import type {
  ImageAsset,
  PageChunk,
  SearchDiagnostics,
  SearchResult,
  SourceDocument,
  WikiLink,
  WikiPage,
} from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import type { GraphIndex, GraphPath, GraphRecallSeed } from "./graph-index-service.js"
import { buildSnippet, tokenize } from "./wiki-utils.js"

export type RetrievalMode = "keyword" | "vector" | "hybrid" | "graph" | "graph-hybrid"

export interface RetrieveOptions {
  topK?: number
  queryEmbedding?: number[]
}

export interface RetrieveResponse {
  mode: RetrievalMode
  results: SearchResult[]
  diagnostics: SearchDiagnostics
}

const DEFAULT_TOP_K = 20
const MAX_TOP_K = 100
const MAX_GRAPH_PATHS = 4
const MAX_GRAPH_SCORE_PER_PAGE = 70

type SignalCategory = "keyword" | "graph" | "vector"

interface Accumulator {
  page: WikiPage
  score: number
  keywordScore: number
  graphScore: number
  vectorScore?: number
  titleMatch: boolean
  signals: Record<string, number>
  reasons: Set<string>
  snippet?: string
  chunkId?: string
  chunkOrdinal?: number
  graphPaths: GraphPath[]
}

export class RetrievalService {
  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly graphIndex?: GraphIndex,
  ) {}

  async retrieve(kbId: string, query: string, options: RetrieveOptions = {}): Promise<RetrieveResponse> {
    const trimmed = query.trim()
    if (!trimmed) {
      return this.empty()
    }

    const topK = Math.min(Math.max(options.topK ?? DEFAULT_TOP_K, 1), MAX_TOP_K)
    const tokens = tokenize(trimmed)
    const phrase = normalizeForMatch(trimmed)
    const compactPhrase = compactForMatch(trimmed)

    const [pages, chunks, links, pageSources, images, sources] = await Promise.all([
      this.repo.listPages(kbId),
      this.repo.listChunks(kbId),
      this.repo.listLinks(kbId),
      this.repo.listPageSources(kbId),
      this.repo.listImages(kbId),
      this.repo.listSources(kbId),
    ])

    const pageById = new Map(pages.map((page) => [page.id, page]))
    const chunksByPage = groupBy(chunks, (chunk) => chunk.pageId)
    const imagesByPage = groupBy(images, (image) => image.pageId ?? "")
    const pageSourceIds = buildPageSourceIds(pages, pageSources)
    const pageIdsBySource = invertPageSources(pageSourceIds)
    const accumulators = new Map<string, Accumulator>()
    const seedPageIds = new Set<string>()
    const lexicalPageIds = new Set<string>()
    const graphPageIds = new Set<string>()

    const getAcc = (page: WikiPage): Accumulator => {
      let acc = accumulators.get(page.id)
      if (!acc) {
        acc = {
          page,
          score: 0,
          keywordScore: 0,
          graphScore: 0,
          titleMatch: false,
          signals: {},
          reasons: new Set(),
          graphPaths: [],
        }
        accumulators.set(page.id, acc)
      }
      return acc
    }

    const add = (
      page: WikiPage,
      amount: number,
      signal: string,
      reason: string,
      category: SignalCategory,
      input?: { snippet?: string; titleMatch?: boolean; chunk?: PageChunk; graphPath?: GraphPath; seed?: boolean },
    ) => {
      if (amount <= 0 || !Number.isFinite(amount)) return
      const acc = getAcc(page)
      const appliedAmount = category === "graph"
        ? Math.min(amount, Math.max(0, MAX_GRAPH_SCORE_PER_PAGE - acc.graphScore))
        : amount
      if (appliedAmount <= 0) return
      acc.score += appliedAmount
      acc.signals[signal] = (acc.signals[signal] ?? 0) + appliedAmount
      acc.reasons.add(reason)
      if (category === "keyword") {
        acc.keywordScore += appliedAmount
        lexicalPageIds.add(page.id)
      } else if (category === "graph") {
        acc.graphScore += appliedAmount
        graphPageIds.add(page.id)
      } else {
        acc.vectorScore = Math.max(acc.vectorScore ?? 0, appliedAmount)
      }
      if (input?.titleMatch) acc.titleMatch = true
      if (input?.snippet && (!acc.snippet || appliedAmount > (acc.signals.bestSnippetScore ?? 0))) {
        acc.snippet = input.snippet
        acc.signals.bestSnippetScore = appliedAmount
      }
      if (input?.chunk && (!acc.chunkId || appliedAmount > (acc.signals.bestChunkScore ?? 0))) {
        acc.chunkId = input.chunk.id
        acc.chunkOrdinal = input.chunk.ordinal
        acc.signals.bestChunkScore = appliedAmount
      }
      if (input?.graphPath && acc.graphPaths.length < MAX_GRAPH_PATHS) {
        acc.graphPaths.push(input.graphPath)
      }
      if (input?.seed) seedPageIds.add(page.id)
    }

    this.recallExactPages(pages, tokens, phrase, compactPhrase, add)
    this.recallSourceSeeds(sources, pageIdsBySource, pageById, tokens, phrase, compactPhrase, add)
    this.recallWikilinkAliases(links, pageById, tokens, phrase, compactPhrase, add)
    this.recallLexicalChunks(chunks, pageById, tokens, phrase, add)
    this.recallImageCaptions(imagesByPage, pageById, tokens, phrase, add)

    const graphSeeds = this.graphSeeds(seedPageIds, accumulators)
    const graphIndexHits = await this.recallGraphIndex(kbId, this.graphSeedInputs(graphSeeds, accumulators), pageById, add)
    if (graphIndexHits === 0) {
      this.expandGraphLinks(graphSeeds, links, pageById, add)
      this.expandGraphSources(graphSeeds, pageSourceIds, pageIdsBySource, pageById, add)
      this.expandCommonNeighbors(graphSeeds, links, pageById, add)
    }

    const vectorHits = await this.recallVector(kbId, options.queryEmbedding, pageById, add)

    const results = [...accumulators.values()]
      .sort((a, b) => b.score - a.score || a.page.path.localeCompare(b.page.path))
      .slice(0, topK)
      .map((acc): SearchResult => ({
        pageId: acc.page.id,
        chunkId: acc.chunkId,
        chunkOrdinal: acc.chunkOrdinal,
        path: acc.page.path,
        title: acc.page.title,
        snippet: acc.snippet ?? bestPageSnippet(acc.page, chunksByPage.get(acc.page.id) ?? [], trimmed),
        score: round(acc.score),
        keywordScore: round(acc.keywordScore),
        graphScore: round(acc.graphScore),
        vectorScore: acc.vectorScore === undefined ? undefined : round(acc.vectorScore),
        titleMatch: acc.titleMatch,
        sources: [...(pageSourceIds.get(acc.page.id) ?? new Set(acc.page.sources))],
        images: [...(acc.page.images ?? []), ...(imagesByPage.get(acc.page.id) ?? [])].filter(uniqueImage),
        signals: cleanSignals(acc.signals),
        reasons: [...acc.reasons],
        graphPaths: acc.graphPaths,
      }))

    return {
      mode: modeFor({
        graphHits: graphPageIds.size,
        lexicalHits: lexicalPageIds.size,
        vectorHits,
      }),
      results,
      diagnostics: {
        seeds: graphSeeds.length,
        graphHits: graphPageIds.size,
        lexicalHits: lexicalPageIds.size,
        vectorHits,
        graphBackend: graphIndexHits > 0 ? "neo4j" : graphPageIds.size > 0 ? "postgres" : "none",
        llmUsed: false,
      },
    }
  }

  private empty(): RetrieveResponse {
    return {
      mode: "keyword",
      results: [],
      diagnostics: { seeds: 0, graphHits: 0, lexicalHits: 0, vectorHits: 0, graphBackend: "none", llmUsed: false },
    }
  }

  private recallExactPages(
    pages: WikiPage[],
    tokens: string[],
    phrase: string,
    compactPhrase: string,
    add: AddFn,
  ): void {
    for (const page of pages) {
      const title = normalizeForMatch(page.title)
      const path = normalizeForMatch(page.path)
      const idText = normalizeForMatch(page.id)
      const compactTitle = compactForMatch(page.title)
      const compactPath = compactForMatch(`${page.path} ${page.id}`)
      if (phrase && (title === phrase || idText === phrase)) {
        add(page, 90, "exactPage", "exact page title/id match", "keyword", {
          titleMatch: true,
          snippet: buildSnippet(page.content, page.title),
          seed: true,
        })
      }
      if (compactPhrase && compactTitle === compactPhrase) {
        add(page, 85, "exactPageCompact", "exact normalized title match", "keyword", {
          titleMatch: true,
          snippet: buildSnippet(page.content, page.title),
          seed: true,
        })
      }
      if (phrase && title.includes(phrase)) {
        add(page, 65, "titlePhrase", "page title contains query", "keyword", {
          titleMatch: true,
          snippet: buildSnippet(page.content, page.title),
          seed: true,
        })
      }
      if (phrase && (path.includes(phrase) || idText.includes(phrase))) {
        add(page, 48, "pathPhrase", "page path/id contains query", "keyword", {
          titleMatch: true,
          snippet: buildSnippet(page.content, page.id),
          seed: true,
        })
      }
      if (compactPhrase && compactPath.includes(compactPhrase)) {
        add(page, 42, "pathCompact", "normalized page path/id contains query", "keyword", {
          titleMatch: true,
          snippet: buildSnippet(page.content, page.id),
          seed: true,
        })
      }
      const titleTokenHits = tokenHits(`${page.title} ${page.id}`, tokens)
      if (titleTokenHits > 0) {
        add(page, Math.min(36, titleTokenHits * 12), "titleTokens", "page title/id token match", "keyword", {
          titleMatch: true,
          snippet: buildSnippet(page.content, tokens[0] ?? page.title),
          seed: titleTokenHits >= 2,
        })
      }
    }
  }

  private recallSourceSeeds(
    sources: SourceDocument[],
    pageIdsBySource: Map<string, Set<string>>,
    pageById: Map<string, WikiPage>,
    tokens: string[],
    phrase: string,
    compactPhrase: string,
    add: AddFn,
  ): void {
    for (const source of sources) {
      const sourceText = `${source.fileName} ${source.relativePath} ${source.folderContext}`
      const normalized = normalizeForMatch(sourceText)
      const compact = compactForMatch(sourceText)
      const phraseHit = Boolean(phrase && normalized.includes(phrase))
      const compactHit = Boolean(compactPhrase && compact.includes(compactPhrase))
      const hits = tokenHits(sourceText, tokens)
      if (!phraseHit && !compactHit && hits === 0) continue
      const pageIds = pageIdsBySource.get(source.id) ?? new Set<string>()
      const score = (phraseHit ? 36 : 0) + (compactHit ? 28 : 0) + Math.min(18, hits * 6)
      for (const pageId of pageIds) {
        const page = pageById.get(pageId)
        if (!page) continue
        add(page, score, "sourceMatch", "source filename/path matched query", "keyword", {
          snippet: buildSnippet(page.content, source.fileName),
          graphPath: {
            nodes: [
              { id: source.id, kind: "source", label: source.relativePath },
              { id: page.id, kind: "page", label: page.title },
            ],
            rels: [{ type: "DERIVED_FROM", weight: score }],
          },
        })
      }
    }
  }

  private recallWikilinkAliases(
    links: WikiLink[],
    pageById: Map<string, WikiPage>,
    tokens: string[],
    phrase: string,
    compactPhrase: string,
    add: AddFn,
  ): void {
    for (const link of links) {
      const target = pageById.get(link.targetPageId)
      if (!target) continue
      const raw = normalizeForMatch(link.targetRaw)
      const compact = compactForMatch(link.targetRaw)
      const phraseHit = Boolean(phrase && raw.includes(phrase))
      const compactHit = Boolean(compactPhrase && compact.includes(compactPhrase))
      const hits = tokenHits(link.targetRaw, tokens)
      if (!phraseHit && !compactHit && hits === 0) continue
      const source = pageById.get(link.sourcePageId)
      const score = (phraseHit ? 42 : 0) + (compactHit ? 34 : 0) + Math.min(20, hits * 7)
      add(target, score, "wikilinkAlias", "wikilink alias/target matched query", "keyword", {
        titleMatch: true,
        snippet: buildSnippet(target.content, link.targetRaw),
        seed: true,
        graphPath: source
          ? {
              nodes: [
                { id: source.id, kind: "page", label: source.title },
                { id: target.id, kind: "page", label: target.title },
              ],
              rels: [{ type: "LINKS_TO", weight: score }],
            }
          : undefined,
      })
    }
  }

  private recallLexicalChunks(
    chunks: PageChunk[],
    pageById: Map<string, WikiPage>,
    tokens: string[],
    phrase: string,
    add: AddFn,
  ): void {
    for (const chunk of chunks) {
      const page = pageById.get(chunk.pageId)
      if (!page) continue
      const text = normalizeForMatch(chunk.text)
      const phraseCount = phrase ? countOccurrences(text, phrase) : 0
      const hits = tokenHits(chunk.text, tokens)
      if (phraseCount === 0 && hits === 0) continue
      const score = Math.min(80, phraseCount * 24 + hits * 5)
      add(page, score, "chunkLexical", "chunk text matched query", "keyword", {
        snippet: buildSnippet(chunk.text, phrase || tokens[0] || page.title),
        chunk,
      })
    }
  }

  private recallImageCaptions(
    imagesByPage: Map<string, ImageAsset[]>,
    pageById: Map<string, WikiPage>,
    tokens: string[],
    phrase: string,
    add: AddFn,
  ): void {
    for (const [pageId, images] of imagesByPage) {
      const page = pageById.get(pageId)
      if (!page) continue
      for (const image of images) {
        const caption = `${image.caption} ${image.fileName}`
        const phraseHit = Boolean(phrase && normalizeForMatch(caption).includes(phrase))
        const hits = tokenHits(caption, tokens)
        if (!phraseHit && hits === 0) continue
        add(page, (phraseHit ? 22 : 0) + Math.min(15, hits * 5), "imageCaption", "image caption matched query", "keyword", {
          snippet: image.caption,
        })
      }
    }
  }

  private graphSeeds(seedPageIds: Set<string>, accumulators: Map<string, Accumulator>): string[] {
    if (seedPageIds.size > 0) return [...seedPageIds].slice(0, 12)
    return [...accumulators.values()]
      .filter((acc) => acc.keywordScore >= 24)
      .sort((a, b) => b.keywordScore - a.keywordScore)
      .slice(0, 8)
      .map((acc) => acc.page.id)
  }

  private graphSeedInputs(seedIds: string[], accumulators: Map<string, Accumulator>): GraphRecallSeed[] {
    return seedIds.map((pageId) => ({
      pageId,
      score: Math.max(1, accumulators.get(pageId)?.keywordScore ?? 1),
    }))
  }

  private async recallGraphIndex(
    kbId: string,
    seeds: GraphRecallSeed[],
    pageById: Map<string, WikiPage>,
    add: AddFn,
  ): Promise<number> {
    if (!this.graphIndex?.enabled || seeds.length === 0) return 0
    const seedSet = new Set(seeds.map((seed) => seed.pageId))
    const hits = await this.graphIndex.recallPageNeighborhood(kbId, seeds, 40)
    let accepted = 0
    for (const hit of hits) {
      if (seedSet.has(hit.pageId)) continue
      const page = pageById.get(hit.pageId)
      if (!page) continue
      add(page, hit.score, "neo4jGraph", hit.reason, "graph", {
        graphPath: hit.graphPath,
      })
      accepted += 1
    }
    return accepted
  }

  private expandGraphLinks(seedIds: string[], links: WikiLink[], pageById: Map<string, WikiPage>, add: AddFn): void {
    if (seedIds.length === 0) return
    const seedSet = new Set(seedIds)
    for (const link of links) {
      const fromSeed = seedSet.has(link.sourcePageId)
      const toSeed = seedSet.has(link.targetPageId)
      if (!fromSeed && !toSeed) continue
      const seed = pageById.get(fromSeed ? link.sourcePageId : link.targetPageId)
      const related = pageById.get(fromSeed ? link.targetPageId : link.sourcePageId)
      if (!seed || !related || seed.id === related.id) continue
      if (seedSet.has(related.id)) continue
      add(related, 34, "directLink", "direct wikilink from matched page", "graph", {
        graphPath: {
          nodes: [
            { id: seed.id, kind: "page", label: seed.title },
            { id: related.id, kind: "page", label: related.title },
          ],
          rels: [{ type: fromSeed ? "LINKS_TO" : "LINKED_BY", weight: 34 }],
        },
      })
    }
  }

  private expandGraphSources(
    seedIds: string[],
    pageSourceIds: Map<string, Set<string>>,
    pageIdsBySource: Map<string, Set<string>>,
    pageById: Map<string, WikiPage>,
    add: AddFn,
  ): void {
    if (seedIds.length === 0) return
    const seedSet = new Set(seedIds)
    for (const seedId of seedIds) {
      const seed = pageById.get(seedId)
      if (!seed) continue
      for (const sourceId of pageSourceIds.get(seedId) ?? []) {
        const siblingIds = pageIdsBySource.get(sourceId) ?? new Set<string>()
        const degree = siblingIds.size
        if (degree <= 1) continue
        const score = Math.max(3, 24 / Math.log2(degree + 2))
        for (const pageId of siblingIds) {
          if (pageId === seedId) continue
          if (seedSet.has(pageId)) continue
          const page = pageById.get(pageId)
          if (!page) continue
          add(page, score, "sourceOverlap", "shares source with matched page", "graph", {
            graphPath: {
              nodes: [
                { id: seed.id, kind: "page", label: seed.title },
                { id: sourceId, kind: "source", label: sourceId },
                { id: page.id, kind: "page", label: page.title },
              ],
              rels: [
                { type: "DERIVED_FROM", weight: score },
                { type: "SOURCE_OF", weight: score },
              ],
            },
          })
        }
      }
    }
  }

  private expandCommonNeighbors(seedIds: string[], links: WikiLink[], pageById: Map<string, WikiPage>, add: AddFn): void {
    if (seedIds.length === 0) return
    const neighbors = new Map<string, Set<string>>()
    const addNeighbor = (a: string, b: string) => {
      neighbors.set(a, (neighbors.get(a) ?? new Set()).add(b))
    }
    for (const link of links) {
      addNeighbor(link.sourcePageId, link.targetPageId)
      addNeighbor(link.targetPageId, link.sourcePageId)
    }
    const seedSet = new Set(seedIds)
    const candidates = new Map<string, number>()
    for (const seedId of seedIds) {
      const firstHop = neighbors.get(seedId) ?? new Set<string>()
      for (const neighbor of firstHop) {
        for (const secondHop of neighbors.get(neighbor) ?? []) {
          if (seedSet.has(secondHop) || secondHop === seedId) continue
          candidates.set(secondHop, (candidates.get(secondHop) ?? 0) + 1)
        }
      }
    }
    for (const [pageId, count] of candidates) {
      const page = pageById.get(pageId)
      if (!page) continue
      add(page, Math.min(18, count * 5), "commonNeighbor", "shares wikilink neighbors with matched page", "graph")
    }
  }

  private async recallVector(
    kbId: string,
    queryEmbedding: number[] | undefined,
    pageById: Map<string, WikiPage>,
    add: AddFn,
  ): Promise<number> {
    if (!queryEmbedding || queryEmbedding.length === 0 || queryEmbedding.some((value) => !Number.isFinite(value))) {
      return 0
    }
    const vectorResults = await this.repo.searchPagesByVector(kbId, queryEmbedding, 30)
    for (const result of vectorResults) {
      const page = pageById.get(result.pageId)
      if (!page) continue
      add(page, Math.max(0, result.score * 40), "vector", "caller-provided query embedding matched page chunks", "vector", {
        snippet: buildSnippet(page.content, page.title),
      })
    }
    return vectorResults.length
  }
}

type AddFn = (
  page: WikiPage,
  amount: number,
  signal: string,
  reason: string,
  category: SignalCategory,
  input?: { snippet?: string; titleMatch?: boolean; chunk?: PageChunk; graphPath?: GraphPath; seed?: boolean },
) => void

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim()
}

function compactForMatch(value: string): string {
  return normalizeForMatch(value).replace(/\s+/g, "")
}

function tokenHits(value: string, tokens: string[]): number {
  if (tokens.length === 0) return 0
  const lower = normalizeForMatch(value)
  return tokens.filter((token) => lower.includes(normalizeForMatch(token))).length
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = value.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = value.indexOf(needle, index + needle.length)
  }
  return count
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (!k) continue
    out.set(k, [...(out.get(k) ?? []), item])
  }
  return out
}

function buildPageSourceIds(pages: WikiPage[], pageSources: Array<{ pageId: string; sourceId: string }>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const page of pages) out.set(page.id, new Set(page.sources))
  for (const source of pageSources) {
    out.set(source.pageId, (out.get(source.pageId) ?? new Set()).add(source.sourceId))
  }
  return out
}

function invertPageSources(pageSourceIds: Map<string, Set<string>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [pageId, sourceIds] of pageSourceIds) {
    for (const sourceId of sourceIds) {
      out.set(sourceId, (out.get(sourceId) ?? new Set()).add(pageId))
    }
  }
  return out
}

function bestPageSnippet(page: WikiPage, chunks: PageChunk[], query: string): string {
  const chunk = chunks.find((item) => normalizeForMatch(item.text).includes(normalizeForMatch(query)))
  return chunk ? buildSnippet(chunk.text, query) : buildSnippet(page.content, query)
}

function uniqueImage(image: ImageAsset, index: number, images: ImageAsset[]): boolean {
  return images.findIndex((item) => item.id === image.id || item.storageKey === image.storageKey) === index
}

function cleanSignals(signals: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(signals)) {
    if (key === "bestSnippetScore" || key === "bestChunkScore") continue
    out[key] = round(value)
  }
  return out
}

function modeFor(input: { graphHits: number; lexicalHits: number; vectorHits: number }): RetrievalMode {
  if (input.graphHits > 0 && input.vectorHits > 0) return "graph-hybrid"
  if (input.graphHits > 0) return "graph"
  if (input.vectorHits > 0 && input.lexicalHits > 0) return "hybrid"
  if (input.vectorHits > 0) return "vector"
  return "keyword"
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
