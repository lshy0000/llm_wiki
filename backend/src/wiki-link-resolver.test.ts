import assert from "node:assert/strict"
import test from "node:test"
import type { WikiPage } from "./types.js"
import { WikiLinkResolver, wikiLinksForPage } from "./wiki-link-resolver.js"

const basePage: Omit<WikiPage, "id" | "path" | "title" | "type" | "content" | "sources"> = {
  companyId: "cmp",
  kbId: "kb",
  sha256: "hash",
  images: [],
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
}

function page(input: Partial<WikiPage> & Pick<WikiPage, "id" | "path" | "title">): WikiPage {
  return {
    ...basePage,
    type: "concept",
    content: "",
    sources: [],
    ...input,
  }
}

test("resolves bilingual titles, page ids, paths, and source ids", () => {
  const pages = [
    page({
      id: "software_center_modular_architecture",
      path: "wiki/concepts/software_center_modular_architecture.md",
      title: "软件中心模块化架构 (Software Center Modular Architecture)",
    }),
    page({
      id: "task_and_skill_recording_system",
      path: "wiki/entities/task_and_skill_recording_system.md",
      title: "任务与 Skill 记录系统 (Task and Skill Recording System)",
      type: "entity",
    }),
    page({
      id: "ominicore_api_and_mdm",
      path: "wiki/entities/ominicore_api_and_mdm.md",
      title: "OminiCore API & MDM 接口 (OminiCore API & MDM Interface)",
      type: "entity",
    }),
    page({
      id: "software_center_modular_architecture_v2_2",
      path: "wiki/sources/software_center_modular_architecture_v2_2.md",
      title: "软件中心_模块化架构_v2.2.xlsx",
      type: "source",
      sources: ["src_fc85aa0348bd47a4"],
    }),
  ]
  const resolver = new WikiLinkResolver(pages)

  assert.equal(resolver.resolve("软件中心模块化架构"), "software_center_modular_architecture")
  assert.equal(resolver.resolve("任务与 Skill 记录系统"), "task_and_skill_recording_system")
  assert.equal(resolver.resolve("OminiCore API & MDM"), "ominicore_api_and_mdm")
  assert.equal(resolver.resolve("wiki/concepts/software_center_modular_architecture.md"), "software_center_modular_architecture")
  assert.equal(resolver.resolve("src_fc85aa0348bd47a4"), "software_center_modular_architecture_v2_2")
})

test("does not fuzzy-link very short broad CJK terms", () => {
  const resolver = new WikiLinkResolver([
    page({
      id: "xiangcheng_build_toolchain",
      path: "wiki/entities/xiangcheng_build_toolchain.md",
      title: "祥承构建指令集 (Xiangcheng Build Toolchain)",
      type: "entity",
    }),
  ])

  assert.equal(resolver.resolve("祥承"), undefined)
})

test("builds deduplicated wiki link rows and keeps unresolved links explicit", () => {
  const target = page({
    id: "task_and_skill_recording_system",
    path: "wiki/entities/task_and_skill_recording_system.md",
    title: "任务与 Skill 记录系统 (Task and Skill Recording System)",
    type: "entity",
  })
  const source = page({
    id: "manual",
    path: "wiki/sources/manual.md",
    title: "Manual",
    type: "source",
    content: "See [[任务与 Skill 记录系统]] and [[任务与 Skill 记录系统]] plus [[TB系统]].",
  })

  const rows = wikiLinksForPage(source, new WikiLinkResolver([source, target]))

  assert.deepEqual(rows.map((row) => [row.targetRaw, row.targetPageId]), [
    ["任务与 Skill 记录系统", "task_and_skill_recording_system"],
    ["TB系统", "tb系统"],
  ])
})
