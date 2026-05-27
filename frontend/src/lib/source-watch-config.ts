import type { SourceWatchConfig } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import sourceWatchDefaults from "@/lib/source-watch-defaults.json"
import {
  classifySourcePath,
  getSourceExtension,
  SOURCE_WATCH_FILE_TYPE_GROUPS,
} from "@/lib/source-formats"

export const DEFAULT_SOURCE_WATCH_CONFIG: SourceWatchConfig = sourceWatchDefaults
export { SOURCE_WATCH_FILE_TYPE_GROUPS }

function normalizeExtensions(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? [])
    .map((value) => value.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean))]
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

export function normalizeSourceWatchConfig(config?: Partial<SourceWatchConfig> | null): SourceWatchConfig {
  return {
    enabled: config?.enabled ?? DEFAULT_SOURCE_WATCH_CONFIG.enabled,
    autoIngest: config?.autoIngest ?? DEFAULT_SOURCE_WATCH_CONFIG.autoIngest,
    includeExtensions: normalizeExtensions(config?.includeExtensions ?? DEFAULT_SOURCE_WATCH_CONFIG.includeExtensions),
    excludeExtensions: normalizeExtensions(config?.excludeExtensions ?? DEFAULT_SOURCE_WATCH_CONFIG.excludeExtensions),
    excludeDirs: normalizeList(config?.excludeDirs ?? DEFAULT_SOURCE_WATCH_CONFIG.excludeDirs),
    excludeGlobs: normalizeList(config?.excludeGlobs ?? DEFAULT_SOURCE_WATCH_CONFIG.excludeGlobs),
    maxFileSizeMb: Math.max(1, Math.min(4096, config?.maxFileSizeMb ?? DEFAULT_SOURCE_WATCH_CONFIG.maxFileSizeMb)),
  }
}

export function getSourceWatchExtension(path: string): string {
  return getSourceExtension(path)
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`, "i")
}

function matchesGlob(path: string, pattern: string): boolean {
  const normalized = normalizePath(path)
  const name = normalized.split("/").pop() ?? normalized
  const re = wildcardToRegExp(pattern)
  return re.test(name) || re.test(normalized)
}

function pathMatchesExcludedDir(path: string, excludedDir: string): boolean {
  const normalized = normalizePath(path).toLowerCase()
  const dir = normalizePath(excludedDir).toLowerCase()
  if (!dir) return false
  if (dir.includes("/")) {
    return normalized === dir || normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`)
  }
  return normalized.split("/").some((part) => part === dir)
}

export function isPathAllowedBySourceWatch(path: string, config: SourceWatchConfig): boolean {
  const cfg = normalizeSourceWatchConfig(config)
  const normalized = normalizePath(path)
  const parts = normalized.split("/").filter(Boolean)
  if (cfg.excludeDirs.some((dir) => pathMatchesExcludedDir(normalized, dir))) return false
  if (cfg.excludeGlobs.some((pattern) => matchesGlob(normalized, pattern))) return false
  const name = parts[parts.length - 1] ?? ""
  if (!name || name.startsWith(".")) return false
  const admission = classifySourcePath(normalized)
  if (!admission.autoIngest) return false
  const ext = getSourceWatchExtension(normalized)
  if (ext && cfg.excludeExtensions.includes(ext)) return false
  if (cfg.includeExtensions.length > 0 && (!ext || !cfg.includeExtensions.includes(ext))) {
    return false
  }
  return true
}
