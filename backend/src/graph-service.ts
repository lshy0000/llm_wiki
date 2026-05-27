import { createRequire } from "node:module"
import { UndirectedGraph } from "graphology"
import type { CommunityInfo, GraphEdge, GraphNode, ReviewItem, WikiPage } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import { id, nowIso } from "./wiki-utils.js"
import { isStructuralWikiPage, WikiLinkResolver, wikiLinksForPage } from "./wiki-link-resolver.js"

const require = createRequire(import.meta.url)
const louvain = require("graphology-communities-louvain") as (
  graph: UndirectedGraph,
  options?: { resolution?: number },
) => Record<string, number>

const WEIGHTS = {
  directLink: 3,
  sourceOverlap: 4,
  commonNeighbor: 1.5,
  typeAffinity: 1,
}

const TYPE_AFFINITY: Record<string, Record<string, number>> = {
  entity: { concept: 1.2, entity: 0.8, source: 1, synthesis: 1, query: 0.8 },
  concept: { entity: 1.2, concept: 0.8, source: 1, synthesis: 1.2, query: 1 },
  source: { entity: 1, concept: 1, source: 0.5, query: 0.8, synthesis: 1 },
  query: { concept: 1, entity: 0.8, synthesis: 1, source: 0.8, query: 0.5 },
  synthesis: { concept: 1.2, entity: 1, source: 1, query: 1, synthesis: 0.8 },
}

interface NodeModel {
  page: WikiPage
  outLinks: Set<string>
  inLinks: Set<string>
}

export class GraphService {
  constructor(private readonly repo: KnowledgeRepository) {}

  async buildGraph(kbId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; communities: CommunityInfo[] }> {
    const pages = (await this.repo.listPages(kbId)).filter((page) => page.type !== "query" && !isStructuralWikiPage(page))
    const resolver = new WikiLinkResolver(pages)
    const links = pages.flatMap((page) => wikiLinksForPage(page, resolver))
    const pageIds = new Set(pages.map((page) => page.id))
    const models = new Map<string, NodeModel>()
    for (const page of pages) models.set(page.id, { page, outLinks: new Set(), inLinks: new Set() })
    for (const link of links) {
      if (!pageIds.has(link.sourcePageId) || !pageIds.has(link.targetPageId)) continue
      models.get(link.sourcePageId)?.outLinks.add(link.targetPageId)
      models.get(link.targetPageId)?.inLinks.add(link.sourcePageId)
    }

    const candidatePairs = new Set<string>()
    for (const model of models.values()) {
      for (const target of model.outLinks) candidatePairs.add(this.edgeKey(model.page.id, target))
      const neighbors = [...new Set([...model.outLinks, ...model.inLinks])]
      for (let i = 0; i < neighbors.length; i += 1) {
        for (let j = i + 1; j < neighbors.length; j += 1) {
          candidatePairs.add(this.edgeKey(neighbors[i], neighbors[j]))
        }
      }
      for (const other of models.values()) {
        if (other.page.id !== model.page.id && this.sourceOverlap(model.page, other.page) > 0) {
          candidatePairs.add(this.edgeKey(model.page.id, other.page.id))
        }
      }
    }

    const edges: GraphEdge[] = [...candidatePairs].map((key) => {
      const [a, b] = key.split(":::")
      return this.scoreEdge(models.get(a)!, models.get(b)!, models)
    }).filter((edge) => edge.weight > 0.5)

    const { assignments, communities } = this.detectCommunities(pages, edges)
    const linkCounts = new Map<string, number>()
    for (const edge of edges) {
      linkCounts.set(edge.source, (linkCounts.get(edge.source) ?? 0) + 1)
      linkCounts.set(edge.target, (linkCounts.get(edge.target) ?? 0) + 1)
    }

    return {
      nodes: pages.map((page) => ({
        id: page.id,
        label: page.title,
        type: page.type,
        path: page.path,
        linkCount: linkCounts.get(page.id) ?? 0,
        community: assignments.get(page.id) ?? 0,
      })),
      edges,
      communities,
    }
  }

  async insights(kbId: string): Promise<ReviewItem[]> {
    const kb = await this.repo.getKnowledgeBase(kbId)
    if (!kb) throw new Error("Knowledge base not found")
    const graph = await this.buildGraph(kbId)
    const direct = new Set(graph.edges.filter((edge) => edge.signals.directLink > 0).map((edge) => this.edgeKey(edge.source, edge.target)))
    const surprising = graph.edges
      .filter((edge) => edge.weight >= 4 && !direct.has(this.edgeKey(edge.source, edge.target)))
      .slice(0, 5)
    const isolated = graph.nodes.filter((node) => node.linkCount === 0).slice(0, 5)
    const reviews: ReviewItem[] = []

    for (const edge of surprising) {
      reviews.push(await this.repo.addReview({
        id: id("rev"),
        companyId: kb.companyId,
        kbId,
        kind: "graph-insight",
        title: "Surprising graph connection",
        description: `Pages ${edge.source} and ${edge.target} have high 4-signal relevance (${edge.weight.toFixed(2)}) without an explicit wikilink.`,
        action: "Consider adding a synthesis or explicit wikilink if this relationship is meaningful.",
        status: "open",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }))
    }

    for (const node of isolated) {
      reviews.push(await this.repo.addReview({
        id: id("rev"),
        companyId: kb.companyId,
        kbId,
        pageId: node.id,
        kind: "graph-insight",
        title: "Knowledge gap",
        description: `${node.label} is isolated in the graph and may need links, sources, or consolidation.`,
        action: "Review this page and connect it to related concepts or entities.",
        status: "open",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }))
    }
    return reviews
  }

  private scoreEdge(a: NodeModel, b: NodeModel, graph: Map<string, NodeModel>): GraphEdge {
    const directCount = (a.outLinks.has(b.page.id) ? 1 : 0) + (b.outLinks.has(a.page.id) ? 1 : 0)
    const directLink = directCount * WEIGHTS.directLink
    const sourceOverlap = this.sourceOverlap(a.page, b.page) * WEIGHTS.sourceOverlap
    const commonNeighbor = this.adamicAdar(a, b, graph) * WEIGHTS.commonNeighbor
    const typeAffinity = (TYPE_AFFINITY[a.page.type]?.[b.page.type] ?? 0.5) * WEIGHTS.typeAffinity
    return {
      source: a.page.id,
      target: b.page.id,
      weight: directLink + sourceOverlap + commonNeighbor + typeAffinity,
      signals: { directLink, sourceOverlap, commonNeighbor, typeAffinity },
    }
  }

  private sourceOverlap(a: WikiPage, b: WikiPage): number {
    const sources = new Set(a.sources)
    return b.sources.filter((source) => sources.has(source)).length
  }

  private adamicAdar(a: NodeModel, b: NodeModel, graph: Map<string, NodeModel>): number {
    const aNeighbors = new Set([...a.outLinks, ...a.inLinks])
    const bNeighbors = new Set([...b.outLinks, ...b.inLinks])
    let score = 0
    for (const neighborId of aNeighbors) {
      if (!bNeighbors.has(neighborId)) continue
      const neighbor = graph.get(neighborId)
      if (!neighbor) continue
      const degree = neighbor.outLinks.size + neighbor.inLinks.size
      score += 1 / Math.log(Math.max(degree, 2))
    }
    return score
  }

  private detectCommunities(pages: WikiPage[], edges: GraphEdge[]): {
    assignments: Map<string, number>
    communities: CommunityInfo[]
  } {
    const graph = new UndirectedGraph()
    for (const page of pages) graph.addNode(page.id)
    for (const edge of edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target) && !graph.hasEdge(edge.source, edge.target)) {
        graph.addEdge(edge.source, edge.target, { weight: edge.weight })
      }
    }
    const raw = louvain(graph, { resolution: 1 }) as Record<string, number>
    const assignments = new Map(Object.entries(raw))
    const groups = new Map<number, string[]>()
    for (const [nodeId, communityId] of assignments) {
      groups.set(communityId, [...(groups.get(communityId) ?? []), nodeId])
    }
    const edgeSet = new Set(edges.flatMap((edge) => [this.edgeKey(edge.source, edge.target), this.edgeKey(edge.target, edge.source)]))
    const pageMap = new Map(pages.map((page) => [page.id, page]))
    const degree = new Map<string, number>()
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
    }
    const communities: CommunityInfo[] = [...groups.entries()].map(([communityId, ids]) => {
      let intra = 0
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (edgeSet.has(this.edgeKey(ids[i], ids[j]))) intra += 1
        }
      }
      const possible = ids.length > 1 ? (ids.length * (ids.length - 1)) / 2 : 1
      return {
        id: communityId,
        nodeCount: ids.length,
        cohesion: intra / possible,
        topNodes: [...ids]
          .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
          .slice(0, 5)
          .map((pageId) => pageMap.get(pageId)?.title ?? pageId),
      }
    }).sort((a, b) => b.nodeCount - a.nodeCount)
    const idRemap = new Map<number, number>()
    communities.forEach((community, index) => {
      idRemap.set(community.id, index)
      community.id = index
    })
    for (const [nodeId, communityId] of assignments) {
      assignments.set(nodeId, idRemap.get(communityId) ?? 0)
    }
    return { assignments, communities }
  }

  private edgeKey(a: string, b: string): string {
    return a < b ? `${a}:::${b}` : `${b}:::${a}`
  }
}
