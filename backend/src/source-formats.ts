import { normalizeStorageKey } from "./wiki-utils.js"

export type SourceKind =
  | "text"
  | "markdown"
  | "code"
  | "document"
  | "spreadsheet"
  | "pdf"
  | "presentation"
  | "image"
  | "video"
  | "unsupported"

export type SourceIngestMode =
  | "parse-text"
  | "parse-structured"
  | "caption-image"
  | "store-only"
  | "skip"

export interface SourceFormat {
  kind: Exclude<SourceKind, "unsupported">
  mode: Exclude<SourceIngestMode, "skip">
  extensions: string[]
}

export interface SourceAdmission {
  path: string
  fileName: string
  extension: string
  kind: SourceKind
  mode: SourceIngestMode
  supported: boolean
  autoIngest: boolean
  reason?: string
}

export const SOURCE_FORMATS: SourceFormat[] = [
  { kind: "markdown", mode: "parse-text", extensions: ["md", "mdx"] },
  { kind: "text", mode: "parse-text", extensions: ["txt", "rtf", "log"] },
  { kind: "pdf", mode: "parse-structured", extensions: ["pdf"] },
  { kind: "document", mode: "parse-structured", extensions: ["doc", "docx", "odt"] },
  { kind: "presentation", mode: "parse-structured", extensions: ["ppt", "pptx", "odp"] },
  { kind: "spreadsheet", mode: "parse-structured", extensions: ["xls", "xlsx", "ods"] },
  { kind: "text", mode: "parse-text", extensions: ["html", "htm", "xml", "svg"] },
  { kind: "text", mode: "parse-text", extensions: ["json", "jsonl", "csv", "tsv", "yaml", "yml", "ndjson"] },
  {
    kind: "code",
    mode: "parse-text",
    extensions: [
      "js",
      "jsx",
      "ts",
      "tsx",
      "py",
      "rs",
      "go",
      "java",
      "c",
      "cpp",
      "h",
      "hpp",
      "rb",
      "php",
      "swift",
      "kt",
      "scala",
      "sh",
      "bash",
      "zsh",
      "sql",
      "r",
      "lua",
      "css",
      "scss",
      "less",
      "toml",
      "ini",
      "cfg",
      "conf",
    ],
  },
  { kind: "image", mode: "caption-image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "avif", "heic", "heif"] },
  { kind: "video", mode: "store-only", extensions: ["mp4", "webm", "mov", "avi", "mkv", "flv", "wmv", "m4v"] },
]

const FORMAT_BY_EXTENSION = new Map<string, SourceFormat>()
for (const format of SOURCE_FORMATS) {
  for (const extension of format.extensions) FORMAT_BY_EXTENSION.set(extension, format)
}

const FORMAT_BY_FILE_NAME = new Map<string, SourceFormat>()
const codeFormat = SOURCE_FORMATS.find((format) => format.kind === "code")
if (codeFormat) {
  for (const name of ["dockerfile", "makefile"]) FORMAT_BY_FILE_NAME.set(name, codeFormat)
}

const LEGACY_UNSUPPORTED_EXTENSIONS = new Set(["pages", "numbers", "key", "epub"])

export const SUPPORTED_SOURCE_EXTENSIONS = [...FORMAT_BY_EXTENSION.keys()].sort()

export function classifySourcePath(path: string): SourceAdmission {
  const normalized = normalizeStorageKey(path)
  const fileName = normalized.split("/").pop() ?? ""
  const extension = getSourceExtension(normalized)

  if (!fileName) return unsupported(normalized, fileName, extension, "missing file name")
  if (fileName.startsWith(".")) return unsupported(normalized, fileName, extension, "hidden file")
  if (normalized.split("/").includes(".cache")) return unsupported(normalized, fileName, extension, "preprocess cache")

  const namedFormat = FORMAT_BY_FILE_NAME.get(fileName.toLowerCase())
  if (namedFormat) return supported(normalized, fileName, "", namedFormat)

  if (!extension) return unsupported(normalized, fileName, extension, "missing extension")
  if (LEGACY_UNSUPPORTED_EXTENSIONS.has(extension)) {
    return unsupported(normalized, fileName, extension, "legacy binary format is not supported")
  }

  const format = FORMAT_BY_EXTENSION.get(extension)
  return format ? supported(normalized, fileName, extension, format) : unsupported(normalized, fileName, extension, "unsupported extension")
}

export function classifySourceBytes(path: string, bytes: Buffer): SourceAdmission {
  const admission = classifySourcePath(path)
  if (admission.supported || admission.reason !== "missing extension") return admission
  if (!looksLikeUtf8Text(bytes)) return admission
  return {
    ...admission,
    kind: "text",
    mode: "parse-text",
    supported: true,
    autoIngest: true,
    reason: undefined,
  }
}

export function isAutoIngestAdmission(admission: SourceAdmission): boolean {
  return admission.supported && admission.mode !== "store-only"
}

export function sourceContentType(admission: SourceAdmission, fileName = admission.fileName): string {
  switch (admission.kind) {
    case "markdown":
      return "text/markdown"
    case "text":
    case "code":
      return "text/plain"
    case "pdf":
      return "application/pdf"
    case "document":
      return documentContentType(admission.extension)
    case "presentation":
      return presentationContentType(admission.extension)
    case "spreadsheet":
      return spreadsheetContentType(admission.extension)
    case "image":
      return imageContentType(fileName)
    case "video":
      return videoContentType(admission.extension)
    default:
      return "application/octet-stream"
  }
}

export function getSourceExtension(path: string): string {
  const fileName = normalizeStorageKey(path).split("/").pop() ?? ""
  if (!fileName || !fileName.includes(".")) return ""
  return fileName.split(".").pop()?.toLowerCase() ?? ""
}

function supported(path: string, fileName: string, extension: string, format: SourceFormat): SourceAdmission {
  return {
    path,
    fileName,
    extension,
    kind: format.kind,
    mode: format.mode,
    supported: true,
    autoIngest: format.mode !== "store-only",
  }
}

function unsupported(path: string, fileName: string, extension: string, reason: string): SourceAdmission {
  return {
    path,
    fileName,
    extension,
    kind: "unsupported",
    mode: "skip",
    supported: false,
    autoIngest: false,
    reason,
  }
}

function looksLikeUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return false
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096)).toString("utf-8")
  if (!sample) return true
  const controlChars = sample.match(/[\u0001-\u0008\u000E-\u001F]/g)?.length ?? 0
  return controlChars / sample.length < 0.02
}

function imageContentType(fileName: string): string {
  const extension = getSourceExtension(fileName)
  if (extension === "png") return "image/png"
  if (extension === "webp") return "image/webp"
  if (extension === "gif") return "image/gif"
  if (extension === "bmp") return "image/bmp"
  if (extension === "tif" || extension === "tiff") return "image/tiff"
  if (extension === "avif") return "image/avif"
  if (extension === "heic") return "image/heic"
  if (extension === "heif") return "image/heif"
  return "image/jpeg"
}

function videoContentType(extension: string): string {
  if (extension === "webm") return "video/webm"
  if (extension === "mov") return "video/quicktime"
  if (extension === "avi") return "video/x-msvideo"
  if (extension === "mkv") return "video/x-matroska"
  if (extension === "m4v") return "video/x-m4v"
  if (extension === "wmv") return "video/x-ms-wmv"
  if (extension === "flv") return "video/x-flv"
  return "video/mp4"
}

function documentContentType(extension: string): string {
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if (extension === "odt") return "application/vnd.oasis.opendocument.text"
  if (extension === "doc") return "application/msword"
  return "application/octet-stream"
}

function presentationContentType(extension: string): string {
  if (extension === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  if (extension === "odp") return "application/vnd.oasis.opendocument.presentation"
  if (extension === "ppt") return "application/vnd.ms-powerpoint"
  return "application/octet-stream"
}

function spreadsheetContentType(extension: string): string {
  if (extension === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  if (extension === "ods") return "application/vnd.oasis.opendocument.spreadsheet"
  if (extension === "xls") return "application/vnd.ms-excel"
  return "application/octet-stream"
}
