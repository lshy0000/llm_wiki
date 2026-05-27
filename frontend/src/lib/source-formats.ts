import { normalizePath } from "@/lib/path-utils"

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
  dialogGroup: "documents" | "data" | "code" | "images" | "media"
  watchGroup?: "documents" | "presentations" | "spreadsheets" | "web" | "data" | "code" | "images"
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
  {
    kind: "markdown",
    mode: "parse-text",
    extensions: ["md", "mdx"],
    dialogGroup: "documents",
    watchGroup: "documents",
  },
  {
    kind: "text",
    mode: "parse-text",
    extensions: ["txt", "rtf", "log"],
    dialogGroup: "documents",
    watchGroup: "documents",
  },
  {
    kind: "pdf",
    mode: "parse-structured",
    extensions: ["pdf"],
    dialogGroup: "documents",
    watchGroup: "documents",
  },
  {
    kind: "document",
    mode: "parse-structured",
    extensions: ["doc", "docx", "odt"],
    dialogGroup: "documents",
    watchGroup: "documents",
  },
  {
    kind: "presentation",
    mode: "parse-structured",
    extensions: ["ppt", "pptx", "odp"],
    dialogGroup: "documents",
    watchGroup: "presentations",
  },
  {
    kind: "spreadsheet",
    mode: "parse-structured",
    extensions: ["xls", "xlsx", "ods"],
    dialogGroup: "documents",
    watchGroup: "spreadsheets",
  },
  {
    kind: "text",
    mode: "parse-text",
    extensions: ["html", "htm", "xml"],
    dialogGroup: "documents",
    watchGroup: "web",
  },
  {
    kind: "text",
    mode: "parse-text",
    extensions: ["json", "jsonl", "csv", "tsv", "yaml", "yml", "ndjson"],
    dialogGroup: "data",
    watchGroup: "data",
  },
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
    dialogGroup: "code",
    watchGroup: "code",
  },
  {
    kind: "image",
    mode: "caption-image",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "avif", "heic", "heif"],
    dialogGroup: "images",
    watchGroup: "images",
  },
  {
    kind: "text",
    mode: "parse-text",
    extensions: ["svg"],
    dialogGroup: "images",
    watchGroup: "images",
  },
  {
    kind: "video",
    mode: "store-only",
    extensions: ["mp4", "webm", "mov", "avi", "mkv", "flv", "wmv", "m4v"],
    dialogGroup: "media",
  },
]

const FORMAT_BY_EXTENSION = new Map<string, SourceFormat>()
for (const format of SOURCE_FORMATS) {
  for (const ext of format.extensions) {
    FORMAT_BY_EXTENSION.set(ext, format)
  }
}

const FORMAT_BY_FILE_NAME = new Map<string, SourceFormat>()
for (const name of ["dockerfile", "makefile"]) {
  const format = SOURCE_FORMATS.find((candidate) => candidate.kind === "code")
  if (format) FORMAT_BY_FILE_NAME.set(name, format)
}

const LEGACY_UNSUPPORTED_EXTENSIONS = new Set([
  "pages",
  "numbers",
  "key",
  "epub",
])

export const SUPPORTED_SOURCE_EXTENSIONS = [...FORMAT_BY_EXTENSION.keys()].sort()

export const AUTO_INGEST_SOURCE_EXTENSIONS = SOURCE_FORMATS
  .filter((format) => format.mode !== "store-only")
  .flatMap((format) => format.extensions)
  .sort()

export const STORE_ONLY_SOURCE_EXTENSIONS = SOURCE_FORMATS
  .filter((format) => format.mode === "store-only")
  .flatMap((format) => format.extensions)
  .sort()

export const SOURCE_DIALOG_FILTERS = [
  {
    name: "Documents",
    extensions: extensionsForDialogGroup("documents"),
  },
  {
    name: "Data",
    extensions: extensionsForDialogGroup("data"),
  },
  {
    name: "Code",
    extensions: extensionsForDialogGroup("code"),
  },
  {
    name: "Images",
    extensions: extensionsForDialogGroup("images"),
  },
  {
    name: "Media",
    extensions: extensionsForDialogGroup("media"),
  },
  { name: "All Files", extensions: ["*"] },
]

export const SOURCE_WATCH_FILE_TYPE_GROUPS = [
  watchGroup("documents"),
  watchGroup("presentations"),
  watchGroup("spreadsheets"),
  watchGroup("web"),
  watchGroup("data"),
  watchGroup("code"),
  watchGroup("images"),
]

export function getSourceExtension(path: string): string {
  const name = normalizePath(path).split("/").pop() ?? ""
  if (!name || !name.includes(".")) return ""
  return name.split(".").pop()?.toLowerCase() ?? ""
}

export function classifySourcePath(path: string): SourceAdmission {
  const normalized = normalizePath(path)
  const fileName = normalized.split("/").pop() ?? ""
  const extension = getSourceExtension(normalized)

  if (!fileName) {
    return unsupported(normalized, fileName, extension, "missing file name")
  }
  if (fileName.startsWith(".")) {
    return unsupported(normalized, fileName, extension, "hidden file")
  }
  if (normalized.split("/").includes(".cache")) {
    return unsupported(normalized, fileName, extension, "preprocess cache")
  }
  const namedFormat = FORMAT_BY_FILE_NAME.get(fileName.toLowerCase())
  if (namedFormat) {
    return {
      path: normalized,
      fileName,
      extension: "",
      kind: namedFormat.kind,
      mode: namedFormat.mode,
      supported: true,
      autoIngest: namedFormat.mode !== "store-only",
    }
  }
  if (!extension) {
    return unsupported(normalized, fileName, extension, "missing extension")
  }
  if (LEGACY_UNSUPPORTED_EXTENSIONS.has(extension)) {
    return unsupported(normalized, fileName, extension, "legacy binary format is not supported")
  }

  const format = FORMAT_BY_EXTENSION.get(extension)
  if (!format) {
    return unsupported(normalized, fileName, extension, "unsupported extension")
  }

  return {
    path: normalized,
    fileName,
    extension,
    kind: format.kind,
    mode: format.mode,
    supported: true,
    autoIngest: format.mode !== "store-only",
  }
}

export function classifyExtensionlessTextSource(path: string): SourceAdmission {
  const normalized = normalizePath(path)
  const fileName = normalized.split("/").pop() ?? ""
  return {
    path: normalized,
    fileName,
    extension: "",
    kind: "text",
    mode: "parse-text",
    supported: true,
    autoIngest: true,
  }
}

export function isSupportedSourcePath(path: string): boolean {
  return classifySourcePath(path).supported
}

export function isAutoIngestSourcePath(path: string): boolean {
  return classifySourcePath(path).autoIngest
}

export function shouldPreprocessSourcePath(path: string): boolean {
  const admission = classifySourcePath(path)
  return admission.mode === "parse-structured"
}

function unsupported(
  path: string,
  fileName: string,
  extension: string,
  reason: string,
): SourceAdmission {
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

function extensionsForDialogGroup(group: SourceFormat["dialogGroup"]): string[] {
  return SOURCE_FORMATS
    .filter((format) => format.dialogGroup === group)
    .flatMap((format) => format.extensions)
    .sort()
}

function watchGroup(id: NonNullable<SourceFormat["watchGroup"]>): { id: string; extensions: string[] } {
  return {
    id,
    extensions: SOURCE_FORMATS
      .filter((format) => format.watchGroup === id && format.mode !== "store-only")
      .flatMap((format) => format.extensions)
      .sort(),
  }
}
