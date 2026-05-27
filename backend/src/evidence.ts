import type { EvidenceBlock } from "./types.js"
import { sha256 } from "./wiki-utils.js"

export function makeEvidenceBlock(input: Omit<EvidenceBlock, "id" | "hash"> & { id?: string; hash?: string }): EvidenceBlock {
  const hash = input.hash ?? sha256([
    input.kind,
    input.sourcePath,
    JSON.stringify(input.locator ?? {}),
    input.mediaKey ?? "",
    input.text,
    input.extractor,
  ].join("\n"))
  return {
    ...input,
    id: input.id ?? `ev_${hash.slice(0, 16)}`,
    hash,
  }
}

export function makeTextEvidenceBlocks(input: {
  sourcePath: string
  kind?: Extract<EvidenceBlock["kind"], "text" | "page" | "slide" | "table" | "folder">
  text: string
  extractor: string
  locator?: EvidenceBlock["locator"]
  maxChars?: number
}): EvidenceBlock[] {
  const text = input.text.trim()
  if (!text) return []
  const maxChars = input.maxChars ?? 6000
  const blocks: EvidenceBlock[] = []
  for (const [index, chunk] of chunkText(text, maxChars).entries()) {
    blocks.push(makeEvidenceBlock({
      kind: input.kind ?? "text",
      sourcePath: input.sourcePath,
      locator: chunk.locatorOrdinal === 0 ? input.locator : { ...input.locator, chunk: chunk.locatorOrdinal + 1 },
      text: chunk.text,
      extractor: index === 0 ? input.extractor : `${input.extractor}:chunk`,
    }))
  }
  return blocks
}

export function renderEvidenceMarkdown(blocks: EvidenceBlock[]): string {
  if (blocks.length === 0) return "## Source Evidence\n\nNo extractable evidence was produced for this source."
  return [
    "## Source Evidence",
    ...blocks.map((block) => [
      `### Evidence ${block.id}`,
      `- Type: ${block.kind}`,
      `- Source: ${block.sourcePath}`,
      locatorText(block.locator) ? `- Location: ${locatorText(block.locator)}` : "",
      block.mediaKey ? `- Media: ${block.mediaKey}` : "",
      `- Extractor: ${block.extractor}`,
      `- Hash: ${block.hash}`,
      "",
      block.text.trim() || "(empty evidence)",
    ].filter(Boolean).join("\n")),
  ].join("\n\n")
}

function locatorText(locator: EvidenceBlock["locator"] | undefined): string {
  if (!locator) return ""
  const parts = [
    locator.page !== undefined ? `page ${locator.page}` : "",
    locator.slide !== undefined ? `slide ${locator.slide}` : "",
    locator.sheet ? `sheet ${locator.sheet}` : "",
    locator.startSec !== undefined ? `start ${locator.startSec}s` : "",
    locator.endSec !== undefined ? `end ${locator.endSec}s` : "",
    locator.chunk !== undefined ? `chunk ${locator.chunk}` : "",
  ].filter(Boolean)
  return parts.join(", ")
}

function chunkText(text: string, maxChars: number): Array<{ text: string; locatorOrdinal: number }> {
  const paragraphs = text.split(/\n{2,}/)
  const chunks: Array<{ text: string; locatorOrdinal: number }> = []
  let current = ""
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 > maxChars && current.trim()) {
      chunks.push({ text: current.trim(), locatorOrdinal: chunks.length })
      current = ""
    }
    if (paragraph.length > maxChars) {
      if (current.trim()) {
        chunks.push({ text: current.trim(), locatorOrdinal: chunks.length })
        current = ""
      }
      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        chunks.push({ text: paragraph.slice(offset, offset + maxChars).trim(), locatorOrdinal: chunks.length })
      }
    } else {
      current += `${paragraph}\n\n`
    }
  }
  if (current.trim()) chunks.push({ text: current.trim(), locatorOrdinal: chunks.length })
  return chunks.length > 0 ? chunks : [{ text: text.slice(0, maxChars).trim(), locatorOrdinal: 0 }]
}
