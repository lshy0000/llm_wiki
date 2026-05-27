import { describe, expect, it } from "vitest"
import {
  DEFAULT_SOURCE_WATCH_CONFIG,
  isPathAllowedBySourceWatch,
  normalizeSourceWatchConfig,
} from "@/lib/source-watch-config"
import sourceWatchDefaults from "@/lib/source-watch-defaults.json"

describe("source watch config", () => {
  it("uses the shared default fixture", () => {
    expect(DEFAULT_SOURCE_WATCH_CONFIG).toEqual(sourceWatchDefaults)
  })

  it("allows document types by default and rejects config/media/binaries", () => {
    expect(isPathAllowedBySourceWatch("raw/sources/report.pdf", DEFAULT_SOURCE_WATCH_CONFIG)).toBe(true)
    expect(isPathAllowedBySourceWatch("raw/sources/notes.md", DEFAULT_SOURCE_WATCH_CONFIG)).toBe(true)
    expect(isPathAllowedBySourceWatch("raw/sources/report.doc", DEFAULT_SOURCE_WATCH_CONFIG)).toBe(true)
    expect(isPathAllowedBySourceWatch("raw/sources/deck.ppt", DEFAULT_SOURCE_WATCH_CONFIG)).toBe(true)
    expect(isPathAllowedBySourceWatch("raw/sources/secrets.json", DEFAULT_SOURCE_WATCH_CONFIG)).toBe(false)
    expect(isPathAllowedBySourceWatch("raw/sources/video.mp4", DEFAULT_SOURCE_WATCH_CONFIG)).toBe(false)
    expect(isPathAllowedBySourceWatch("raw/sources/tool.exe", DEFAULT_SOURCE_WATCH_CONFIG)).toBe(false)
  })

  it("applies directory and glob exclusions", () => {
    const config = normalizeSourceWatchConfig({
      includeExtensions: ["md"],
      excludeDirs: [".obsidian", "drafts"],
      excludeGlobs: ["*.private.*", "~$*"],
    })

    expect(isPathAllowedBySourceWatch("raw/sources/ready.md", config)).toBe(true)
    expect(isPathAllowedBySourceWatch("raw/sources/drafts/ready.md", config)).toBe(false)
    expect(isPathAllowedBySourceWatch("raw/sources/subdir/drafts/ready.md", config)).toBe(false)
    expect(isPathAllowedBySourceWatch("raw/sources/.obsidian/index.md", config)).toBe(false)
    expect(isPathAllowedBySourceWatch("raw/sources/plan.private.md", config)).toBe(false)
    expect(isPathAllowedBySourceWatch("raw/sources/~$Document.docx", config)).toBe(false)
  })

  it("never allows configured extensions that are not auto-ingestable source formats", () => {
    const config = normalizeSourceWatchConfig({
      includeExtensions: ["png", "mp4", "key"],
      excludeExtensions: [],
    })

    expect(isPathAllowedBySourceWatch("raw/sources/chart.png", config)).toBe(true)
    expect(isPathAllowedBySourceWatch("raw/sources/demo.mp4", config)).toBe(false)
    expect(isPathAllowedBySourceWatch("raw/sources/deck.key", config)).toBe(false)
  })
})
