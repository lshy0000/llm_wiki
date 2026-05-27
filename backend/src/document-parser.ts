import type { ParsedDocument } from "./types.js"
import { extractJpegImagesFromPdf, isImageFile, mediaTypeForFile } from "./wiki-utils.js"

export class DocumentParser {
  async parse(fileName: string, bytes: Buffer): Promise<ParsedDocument> {
    const lower = fileName.toLowerCase()

    if (isImageFile(fileName)) {
      return {
        text: `Standalone image file: ${fileName}`,
        images: [
          {
            fileName,
            mediaType: mediaTypeForFile(fileName),
            bytes,
            origin: "standalone-image",
          },
        ],
      }
    }

    if (lower.endsWith(".pdf")) {
      return this.parsePdf(bytes)
    }

    if (lower.endsWith(".docx")) {
      return { text: await this.parseDocxText(bytes), images: [] }
    }

    return { text: bytes.toString("utf-8"), images: [] }
  }

  private async parsePdf(bytes: Buffer): Promise<ParsedDocument> {
    try {
      const { PDFParse } = await import("pdf-parse")
      const parser = new PDFParse({ data: bytes })
      try {
        const [textResult, imageResult] = await Promise.all([
          parser.getText(),
          parser.getImage({ imageBuffer: true, imageDataUrl: false, imageThreshold: 100 }),
        ])
        return {
          text: textResult.text.trim(),
          images: imageResult.pages.flatMap((page) =>
            page.images.map((image, index) => ({
              fileName: `pdf-page-${page.pageNumber}-image-${index + 1}.png`,
              mediaType: "image/png",
              bytes: Buffer.from(image.data),
              origin: "pdf-embedded" as const,
              sourcePage: page.pageNumber,
            })),
          ),
        }
      } finally {
        await parser.destroy()
      }
    } catch (err) {
      return {
        text: [
          "PDF text extraction failed; raw PDF bytes were still accepted for ingest.",
          `Parser error: ${err instanceof Error ? err.message : String(err)}`,
        ].join("\n"),
        images: extractJpegImagesFromPdf(bytes),
      }
    }
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
}
