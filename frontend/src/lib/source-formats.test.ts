import { describe, expect, it } from "vitest"
import {
  classifySourcePath,
  isAutoIngestSourcePath,
  isSupportedSourcePath,
  SOURCE_DIALOG_FILTERS,
  SOURCE_WATCH_FILE_TYPE_GROUPS,
} from "./source-formats"

describe("source format registry", () => {
  it("classifies supported source families from one registry", () => {
    expect(classifySourcePath("raw/sources/notes.md")).toMatchObject({
      kind: "markdown",
      mode: "parse-text",
      supported: true,
      autoIngest: true,
    })
    expect(classifySourcePath("raw/sources/report.pdf")).toMatchObject({
      kind: "pdf",
      mode: "parse-structured",
      supported: true,
      autoIngest: true,
    })
    expect(classifySourcePath("raw/sources/chart.png")).toMatchObject({
      kind: "image",
      mode: "caption-image",
      supported: true,
      autoIngest: true,
    })
    expect(classifySourcePath("raw/sources/demo.mp4")).toMatchObject({
      kind: "video",
      mode: "store-only",
      supported: true,
      autoIngest: false,
    })
    expect(classifySourcePath("raw/sources/Dockerfile")).toMatchObject({
      kind: "code",
      mode: "parse-text",
      supported: true,
      autoIngest: true,
    })
  })

  it("does not admit legacy binary formats without a parser", () => {
    expect(isSupportedSourcePath("raw/sources/old.pages")).toBe(false)
    expect(isSupportedSourcePath("raw/sources/deck.key")).toBe(false)
    expect(isAutoIngestSourcePath("raw/sources/demo.mp4")).toBe(false)
  })

  it("keeps UI and watcher extension groups sourced from the registry", () => {
    const dialogExtensions = SOURCE_DIALOG_FILTERS.flatMap((filter) => filter.extensions)
    expect(dialogExtensions).toContain("pdf")
    expect(dialogExtensions).toContain("doc")
    expect(dialogExtensions).toContain("ppt")
    expect(dialogExtensions).toContain("png")
    expect(dialogExtensions).toContain("mp4")
    expect(dialogExtensions).not.toContain("key")

    const imageWatchGroup = SOURCE_WATCH_FILE_TYPE_GROUPS.find((group) => group.id === "images")
    expect(imageWatchGroup?.extensions).toContain("png")
    expect(imageWatchGroup?.extensions).not.toContain("mp4")
  })
})
