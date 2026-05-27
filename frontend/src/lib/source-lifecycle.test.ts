import { describe, expect, it } from "vitest"
import {
  folderContextForSourcePath,
  isIngestableSourcePath,
} from "./source-lifecycle"

describe("source-lifecycle path helpers", () => {
  it("does not treat preprocessed cache files as ingestable sources", () => {
    expect(isIngestableSourcePath("raw/sources/.cache/report.pdf.txt")).toBe(false)
    expect(isIngestableSourcePath("/project/raw/sources/.cache/report.pdf.txt")).toBe(false)
  })

  it("uses the source registry for ingestable source decisions", () => {
    expect(isIngestableSourcePath("raw/sources/chart.png")).toBe(true)
    expect(isIngestableSourcePath("raw/sources/demo.mp4")).toBe(false)
    expect(isIngestableSourcePath("raw/sources/legacy.doc")).toBe(true)
    expect(isIngestableSourcePath("raw/sources/legacy.ppt")).toBe(true)
  })

  it("derives folder context from absolute raw/sources paths without leaking the project prefix", () => {
    expect(
      folderContextForSourcePath("/tmp/project/raw/sources/reports/2026/report.pdf"),
    ).toBe("reports > 2026")
  })
})
