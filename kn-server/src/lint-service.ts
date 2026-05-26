import type { ReviewItem } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"
import { id, nowIso } from "./wiki-utils.js"

export class LintService {
  constructor(private readonly repo: KnowledgeRepository) {}

  async run(kbId: string): Promise<ReviewItem[]> {
    const pages = await this.repo.listPages(kbId)
    const links = await this.repo.listLinks(kbId)
    const pageIds = new Set(pages.map((page) => page.id))
    const out = new Map<string, number>()
    const incoming = new Map<string, number>()
    const reviews: ReviewItem[] = []

    for (const page of pages) {
      out.set(page.id, 0)
      incoming.set(page.id, 0)
    }

    for (const link of links) {
      out.set(link.sourcePageId, (out.get(link.sourcePageId) ?? 0) + 1)
      if (pageIds.has(link.targetPageId)) {
        incoming.set(link.targetPageId, (incoming.get(link.targetPageId) ?? 0) + 1)
      } else {
        reviews.push(await this.add(kbId, link.sourcePageId, "Broken wikilink", `Missing target [[${link.targetRaw}]].`))
      }
    }

    for (const page of pages.filter((page) => page.path !== "wiki/index.md")) {
      if ((incoming.get(page.id) ?? 0) === 0 && page.type !== "overview") {
        reviews.push(await this.add(kbId, page.id, "Orphan wiki page", `${page.title} has no inbound wiki links.`))
      }
      if ((out.get(page.id) ?? 0) === 0 && page.type !== "source") {
        reviews.push(await this.add(kbId, page.id, "No outgoing links", `${page.title} does not connect to other wiki pages.`))
      }
    }

    return reviews
  }

  private async add(kbId: string, pageId: string, title: string, description: string): Promise<ReviewItem> {
    return this.repo.addReview({
      id: id("rev"),
      kbId,
      pageId,
      kind: "lint",
      title,
      description,
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
  }
}
