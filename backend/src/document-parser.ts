import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { makeEvidenceBlock, makeTextEvidenceBlocks } from "./evidence.js"
import { classifySourceBytes, getSourceExtension } from "./source-formats.js"
import type { EvidenceBlock, ParsedDocument } from "./types.js"
import { extractJpegImagesFromPdf, isImageFile, mediaTypeForFile, normalizeStorageKey } from "./wiki-utils.js"

type ParsedImage = ParsedDocument["images"][number]

const execFileAsync = promisify(execFile)
const MAX_PDF_RENDERED_PAGES = 4
const MAX_ZIP_IMAGES = 32
const MAX_SHEETS = 20
const MAX_SHEET_ROWS = 120
const MAX_SHEET_COLUMNS = 20

export class DocumentParser {
  async parse(fileName: string, bytes: Buffer): Promise<ParsedDocument> {
    const admission = classifySourceBytes(fileName, bytes)
    if (!admission.supported) {
      return this.fromEvidence([
        makeEvidenceBlock({
          kind: "text",
          sourcePath: fileName,
          text: `Unsupported source file: ${fileName}. Reason: ${admission.reason ?? "unsupported source"}.`,
          extractor: "source-admission",
        }),
      ], [])
    }

    if (admission.mode === "store-only") {
      return this.fromEvidence([
        makeEvidenceBlock({
          kind: "video",
          sourcePath: fileName,
          text: `Stored media file for later reference: ${fileName}. No content parsing was attempted.`,
          extractor: "source-admission:store-only",
        }),
      ], [])
    }

    if (admission.kind === "image" || isImageFile(fileName)) {
      return this.fromEvidence([
        makeEvidenceBlock({
          kind: "image",
          sourcePath: fileName,
          text: `Standalone image file accepted for visual extraction: ${fileName}.`,
          extractor: "source-admission:image",
        }),
      ], [
        {
          fileName,
          mediaType: mediaTypeForFile(fileName),
          bytes,
          origin: "standalone-image",
        },
      ])
    }

    const extension = admission.extension || getSourceExtension(fileName)
    if (extension === "pdf") return this.parsePdf(fileName, bytes)
    if (extension === "docx") return this.parseDocx(fileName, bytes, "mammoth:docx")
    if (extension === "doc") return this.parseConvertedDocument(fileName, bytes)
    if (extension === "odt") return this.parseOpenDocumentText(fileName, bytes, "document")
    if (extension === "pptx") return this.parsePptx(fileName, bytes, "pptx-xml")
    if (extension === "ppt") return this.parseConvertedPresentation(fileName, bytes)
    if (extension === "odp") return this.parseOpenDocumentText(fileName, bytes, "presentation")
    if (extension === "xlsx" || extension === "xls" || extension === "ods") return this.parseSpreadsheet(fileName, bytes)

    return this.parsePlainText(fileName, bytes)
  }

  private async parsePdf(fileName: string, bytes: Buffer): Promise<ParsedDocument> {
    try {
      const { PDFParse } = await import("pdf-parse")
      const parser = new PDFParse({ data: bytes })
      try {
        const [textResult, imageResult] = await Promise.all([
          parser.getText({ pageJoiner: "\n\n" }),
          parser.getImage({ imageBuffer: true, imageDataUrl: false, imageThreshold: 100 }).catch(() => undefined),
        ])
        const evidence = textResult.pages.flatMap((page) =>
          makeTextEvidenceBlocks({
            sourcePath: fileName,
            kind: "page",
            text: page.text,
            locator: { page: page.num },
            extractor: "pdf-parse:text",
          }),
        )
        const embeddedImages: ParsedImage[] = (imageResult?.pages ?? []).flatMap((page) =>
          page.images.map((image, index) => ({
            fileName: `pdf-page-${page.pageNumber}-image-${index + 1}.png`,
            mediaType: "image/png",
            bytes: Buffer.from(image.data),
            origin: "pdf-embedded" as const,
            sourcePage: page.pageNumber,
          })),
        )
        const pageRenders = await this.renderPdfPages(parser, textResult.pages)
        return this.fromEvidence(
          evidence.length > 0
            ? evidence
            : [
              makeEvidenceBlock({
                kind: "page",
                sourcePath: fileName,
                text: "PDF parser found no selectable text; rendered page images were queued for visual captioning when available.",
                extractor: "pdf-parse:text",
              }),
            ],
          [...embeddedImages, ...pageRenders],
        )
      } finally {
        await parser.destroy()
      }
    } catch (err) {
      return this.fromEvidence([
        makeEvidenceBlock({
          kind: "page",
          sourcePath: fileName,
          text: [
            "PDF text extraction failed; raw PDF bytes were still accepted for ingest.",
            `Parser error: ${err instanceof Error ? err.message : String(err)}`,
          ].join("\n"),
          extractor: "pdf-parse:error",
        }),
      ], extractJpegImagesFromPdf(bytes))
    }
  }

  private async renderPdfPages(
    parser: { getScreenshot(params: object): Promise<{ pages: Array<{ data: Uint8Array; pageNumber: number }> }> },
    pages: Array<{ num: number; text: string }>,
  ): Promise<ParsedImage[]> {
    const lowTextPages = pages.filter((page) => page.text.trim().length < 400).map((page) => page.num)
    const firstPages = pages.slice(0, 2).map((page) => page.num)
    const selected = [...new Set([...lowTextPages, ...firstPages])].slice(0, MAX_PDF_RENDERED_PAGES)
    if (selected.length === 0) return []
    try {
      const screenshots = await parser.getScreenshot({
        partial: selected,
        desiredWidth: 1400,
        imageBuffer: true,
        imageDataUrl: false,
      })
      return screenshots.pages.map((page) => ({
        fileName: `pdf-page-${page.pageNumber}-render.png`,
        mediaType: "image/png",
        bytes: Buffer.from(page.data),
        origin: "pdf-page-render" as const,
        sourcePage: page.pageNumber,
      }))
    } catch {
      return []
    }
  }

  private async parseDocx(fileName: string, bytes: Buffer, extractor: string): Promise<ParsedDocument> {
    const text = await this.parseDocxText(bytes)
    const evidence = makeTextEvidenceBlocks({
      sourcePath: fileName,
      text,
      extractor,
    })
    const images = await this.extractZipImages(bytes, {
      prefixes: ["word/media/"],
      filePrefix: "docx-image",
    })
    return this.fromEvidence(
      evidence.length > 0
        ? evidence
        : [
          makeEvidenceBlock({
            kind: "text",
            sourcePath: fileName,
            text: "DOCX parser found no extractable text; embedded images were queued for visual captioning when available.",
            extractor,
          }),
        ],
      images,
    )
  }

  private async parseConvertedDocument(fileName: string, bytes: Buffer): Promise<ParsedDocument> {
    try {
      const converted = await this.convertWithLibreOffice(fileName, bytes, "docx")
      return this.parseDocx(fileName, converted, "libreoffice:doc-to-docx+mammoth")
    } catch (err) {
      return this.fromEvidence([
        makeEvidenceBlock({
          kind: "text",
          sourcePath: fileName,
          text: [
            "Legacy DOC parsing requires LibreOffice/soffice conversion to DOCX.",
            `Parser error: ${err instanceof Error ? err.message : String(err)}`,
          ].join("\n"),
          extractor: "libreoffice:doc-to-docx:error",
        }),
      ], [])
    }
  }

  private async parsePptx(fileName: string, bytes: Buffer, extractor: string): Promise<ParsedDocument> {
    try {
      const zip = await this.loadZip(bytes)
      const slideEntries = Object.keys(zip.files)
        .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry))
        .sort((a, b) => slideNumber(a) - slideNumber(b))
      const evidence: EvidenceBlock[] = []
      for (const entry of slideEntries) {
        const slide = slideNumber(entry)
        const xml = await zip.file(entry)?.async("string")
        const text = extractXmlText(xml ?? "")
        if (!text) continue
        evidence.push(...makeTextEvidenceBlocks({
          sourcePath: fileName,
          kind: "slide",
          text,
          locator: { slide },
          extractor,
        }))
      }
      const slideByMediaPath = await this.pptxMediaSlideMap(zip)
      const images = await this.extractZipImages(bytes, {
        prefixes: ["ppt/media/"],
        filePrefix: "pptx-image",
        sourcePageByPath: slideByMediaPath,
      })
      const renderedSlides = await this.renderPresentationWithLibreOffice(fileName, bytes)
      return this.fromEvidence(
        evidence.length > 0
          ? evidence
          : [
            makeEvidenceBlock({
              kind: "slide",
              sourcePath: fileName,
              text: "PPTX parser found no extractable slide text; slide render images or embedded media were queued for visual captioning when available.",
              extractor,
            }),
          ],
        [...images, ...renderedSlides],
      )
    } catch (err) {
      return this.fromEvidence([
        makeEvidenceBlock({
          kind: "slide",
          sourcePath: fileName,
          text: [
            "PPTX parsing failed.",
            `Parser error: ${err instanceof Error ? err.message : String(err)}`,
          ].join("\n"),
          extractor: `${extractor}:error`,
        }),
      ], [])
    }
  }

  private async parseConvertedPresentation(fileName: string, bytes: Buffer): Promise<ParsedDocument> {
    try {
      const converted = await this.convertWithLibreOffice(fileName, bytes, "pptx")
      return this.parsePptx(fileName, converted, "libreoffice:ppt-to-pptx+pptx-xml")
    } catch (err) {
      return this.fromEvidence([
        makeEvidenceBlock({
          kind: "slide",
          sourcePath: fileName,
          text: [
            "Legacy PPT parsing requires LibreOffice/soffice conversion to PPTX.",
            `Parser error: ${err instanceof Error ? err.message : String(err)}`,
          ].join("\n"),
          extractor: "libreoffice:ppt-to-pptx:error",
        }),
      ], [])
    }
  }

  private async renderPresentationWithLibreOffice(fileName: string, bytes: Buffer): Promise<ParsedImage[]> {
    try {
      const pdfBytes = await this.convertWithLibreOffice(fileName, bytes, "pdf")
      const parsedPdf = await this.parsePdf(`${fileName}.pdf`, pdfBytes)
      return parsedPdf.images
        .filter((image) => image.origin === "pdf-page-render")
        .map((image) => ({
          ...image,
          fileName: `slide-${image.sourcePage ?? 0}-render.png`,
          sourceSlide: image.sourcePage,
        }))
    } catch {
      return []
    }
  }

  private async parseOpenDocumentText(fileName: string, bytes: Buffer, kind: "document" | "presentation"): Promise<ParsedDocument> {
    try {
      const zip = await this.loadZip(bytes)
      const contentXml = await zip.file("content.xml")?.async("string")
      const text = extractXmlText(contentXml ?? "")
      const evidence = makeTextEvidenceBlocks({
        sourcePath: fileName,
        kind: kind === "presentation" ? "slide" : "text",
        text,
        extractor: `opendocument:${kind}`,
      })
      const images = await this.extractZipImages(bytes, {
        prefixes: ["Pictures/"],
        filePrefix: `${kind}-image`,
      })
      if (evidence.length > 0 || images.length > 0) return this.fromEvidence(evidence, images)
      if (kind === "document") {
        const converted = await this.convertWithLibreOffice(fileName, bytes, "docx")
        return this.parseDocx(fileName, converted, "libreoffice:odt-to-docx+mammoth")
      }
      const converted = await this.convertWithLibreOffice(fileName, bytes, "pptx")
      return this.parsePptx(fileName, converted, "libreoffice:odp-to-pptx+pptx-xml")
    } catch (err) {
      return this.fromEvidence([
        makeEvidenceBlock({
          kind: kind === "presentation" ? "slide" : "text",
          sourcePath: fileName,
          text: [
            `${kind.toUpperCase()} parsing failed.`,
            `Parser error: ${err instanceof Error ? err.message : String(err)}`,
          ].join("\n"),
          extractor: `opendocument:${kind}:error`,
        }),
      ], [])
    }
  }

  private async parseSpreadsheet(fileName: string, bytes: Buffer): Promise<ParsedDocument> {
    try {
      const xlsx = await import("xlsx")
      const workbook = xlsx.read(bytes, { type: "buffer", cellDates: true, raw: false })
      const evidence: EvidenceBlock[] = []
      for (const sheetName of workbook.SheetNames.slice(0, MAX_SHEETS)) {
        const sheet = workbook.Sheets[sheetName]
        if (!sheet) continue
        const rows = xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "" })
          .map((row) => row.map((cell) => String(cell ?? "").trim()))
          .filter((row) => row.some((cell) => cell.length > 0))
        const markdown = sheetRowsToMarkdown(sheetName, rows)
        evidence.push(makeEvidenceBlock({
          kind: "table",
          sourcePath: fileName,
          locator: { sheet: sheetName },
          text: markdown,
          extractor: "xlsx:sheet",
        }))
      }
      const images = await this.extractZipImages(bytes, {
        prefixes: ["xl/media/", "Pictures/"],
        filePrefix: "sheet-image",
      })
      return this.fromEvidence(
        evidence.length > 0
          ? evidence
          : [
            makeEvidenceBlock({
              kind: "table",
              sourcePath: fileName,
              text: "Spreadsheet parser found no non-empty sheets.",
              extractor: "xlsx:sheet",
            }),
          ],
        images,
      )
    } catch (err) {
      return this.fromEvidence([
        makeEvidenceBlock({
          kind: "table",
          sourcePath: fileName,
          text: [
            "Spreadsheet parsing failed.",
            `Parser error: ${err instanceof Error ? err.message : String(err)}`,
          ].join("\n"),
          extractor: "xlsx:error",
        }),
      ], [])
    }
  }

  private parsePlainText(fileName: string, bytes: Buffer): ParsedDocument {
    const text = bytes.toString("utf-8").trim()
    return this.fromEvidence(
      makeTextEvidenceBlocks({
        sourcePath: fileName,
        text,
        extractor: "utf8:text",
      }),
      [],
    )
  }

  private async parseDocxText(bytes: Buffer): Promise<string> {
    try {
      const mammoth = await import("mammoth")
      const parsed = await mammoth.extractRawText({ buffer: bytes })
      return parsed.value.trim()
    } catch (err) {
      return [
        "DOCX text extraction failed; source metadata was still accepted for ingest.",
        `Parser error: ${err instanceof Error ? err.message : String(err)}`,
      ].join("\n")
    }
  }

  private async extractZipImages(
    bytes: Buffer,
    options: {
      prefixes: string[]
      filePrefix: string
      sourcePageByPath?: Map<string, number>
    },
  ): Promise<ParsedImage[]> {
    try {
      const zip = await this.loadZip(bytes)
      const images: ParsedImage[] = []
      const normalizedPrefixes = options.prefixes.map((prefix) => prefix.toLowerCase())
      for (const [entryName, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue
        const lower = entryName.toLowerCase()
        if (!normalizedPrefixes.some((prefix) => lower.startsWith(prefix))) continue
        if (!isImageFile(entryName)) continue
        const imageBytes = await entry.async("nodebuffer")
        if (imageBytes.length < 256) continue
        const extension = getSourceExtension(entryName)
        const safeName = `${options.filePrefix}-${images.length + 1}.${extension || "bin"}`
        const sourcePage = options.sourcePageByPath?.get(normalizeStorageKey(entryName).toLowerCase())
        images.push({
          fileName: safeName,
          mediaType: mediaTypeForFile(entryName),
          bytes: imageBytes,
          origin: "office-embedded",
          sourcePage,
          sourceSlide: sourcePage,
        })
        if (images.length >= MAX_ZIP_IMAGES) break
      }
      return images
    } catch {
      return []
    }
  }

  private async pptxMediaSlideMap(zip: Awaited<ReturnType<DocumentParser["loadZip"]>>): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    const relEntries = Object.keys(zip.files).filter((entry) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(entry))
    for (const relEntry of relEntries) {
      const slide = slideNumber(relEntry)
      const xml = await zip.file(relEntry)?.async("string")
      if (!xml) continue
      for (const match of xml.matchAll(/Target="([^"]+)"/g)) {
        const target = decodeXml(match[1] ?? "")
        if (!/\.(png|jpe?g|gif|webp|bmp|tiff?|avif|heic|heif)$/i.test(target)) continue
        const resolved = resolveZipRelative("ppt/slides", target)
        result.set(resolved.toLowerCase(), slide)
      }
    }
    return result
  }

  private async loadZip(bytes: Buffer) {
    const { default: JSZip } = await import("jszip")
    return JSZip.loadAsync(bytes)
  }

  private async convertWithLibreOffice(fileName: string, bytes: Buffer, targetExt: "docx" | "pptx" | "pdf"): Promise<Buffer> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-office-"))
    const inputPath = path.join(tmpDir, path.basename(fileName))
    await writeFile(inputPath, bytes)
    try {
      const command = process.env.SOFFICE_PATH?.trim() || "soffice"
      await execFileAsync(command, ["--headless", "--convert-to", targetExt, "--outdir", tmpDir, inputPath], {
        timeout: 90_000,
        windowsHide: true,
      })
      const outputPath = path.join(tmpDir, `${path.basename(fileName, path.extname(fileName))}.${targetExt}`)
      return await readFile(outputPath)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  }

  private fromEvidence(evidence: EvidenceBlock[], images: ParsedImage[]): ParsedDocument {
    return {
      text: evidence.map((block) => block.text).join("\n\n").trim(),
      images,
      evidence,
    }
  }
}

function sheetRowsToMarkdown(sheetName: string, rows: string[][]): string {
  if (rows.length === 0) return `Sheet ${sheetName} has no non-empty cells.`
  const totalRows = rows.length
  const totalColumns = Math.max(...rows.map((row) => row.length), 0)
  const width = Math.min(totalColumns, MAX_SHEET_COLUMNS)
  const clippedRows = rows.slice(0, MAX_SHEET_ROWS).map((row) => row.slice(0, width))
  const header = clippedRows[0].map((cell, index) => escapeMarkdownCell(cell || `Column ${index + 1}`))
  const body = clippedRows.slice(1).map((row) => row.map((cell) => escapeMarkdownCell(cell)))
  const table = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${padRow(row, width).join(" | ")} |`),
  ].join("\n")
  const clippedNote = totalRows > clippedRows.length || totalColumns > width
    ? `\n\nNote: preview clipped from ${totalRows} rows x ${totalColumns} columns to ${clippedRows.length} rows x ${width} columns.`
    : ""
  return `Sheet: ${sheetName}\nRows: ${totalRows}\nColumns: ${totalColumns}\n\n${table}${clippedNote}`
}

function padRow(row: string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => escapeMarkdownCell(row[index] ?? ""))
}

function escapeMarkdownCell(input: string): string {
  return input.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()
}

function slideNumber(pathName: string): number {
  return Number(pathName.match(/slide(\d+)\.xml/i)?.[1] ?? 0)
}

function extractXmlText(xml: string): string {
  const parts: string[] = []
  for (const match of xml.matchAll(/<(?:a:t|text:p|text:h|text:span)[^>]*>([\s\S]*?)<\/(?:a:t|text:p|text:h|text:span)>/g)) {
    const text = decodeXml((match[1] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
    if (text) parts.push(text)
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function decodeXml(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function resolveZipRelative(baseDir: string, target: string): string {
  return normalizeStorageKey(path.posix.normalize(path.posix.join(baseDir, target)))
}
