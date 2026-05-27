# Source Evidence Ingest Architecture

## 目标

导入资源的目标不是“把文件转成一段文本”，而是尽可能理解资源里的知识：正文、表格、版式、图表、截图、扫描页、幻灯片视觉结构、文件夹上下文，以及后续可以引用的媒体资产。

最佳实践是 **multimodal-first evidence extraction**：

```text
Raw Source
  -> Source Admission
  -> Normalized Views (text, page images, slide images, tables, media assets)
  -> Multimodal / Structured Extractors
  -> Evidence Cache
  -> Evidence Markdown
  -> Wiki Analysis + Generation
  -> Search / Chat / Graph
```

多模态模型要更多参与，但参与位置是 Evidence 生成，而不是绕过 Evidence 直接写 Wiki。

## 输入边界

支持矩阵：

| 输入 | 行为 | 多模态参与 |
|---|---|---|
| `.txt` / `.log` / 无后缀文本 | parse-text | 通常不需要 |
| `.md` / `.mdx` | parse-text | 通常不需要 |
| 代码 / 脚本 / 配置文本 | parse-text | 通常不需要 |
| `.json` / `.jsonl` / `.csv` / `.tsv` / `.yaml` / `.xml` / `.html` | parse-text / table evidence | 复杂页面或图表可选 VLM |
| `.pdf` | parse-structured + visual evidence | 扫描页、图表页、图片、复杂版式交给 VLM |
| `.docx` / `.odt` / `.doc` | parse-structured + optional visual evidence | `.doc` 先通过 LibreOffice/soffice 转 `.docx`；复杂版式可渲染给 VLM |
| `.pptx` / `.odp` / `.ppt` | slide evidence | 强 VLM：每页 slide 应可渲染成图片并由 VLM 抽取视觉结构 |
| `.xlsx` / `.xls` / `.ods` | table evidence | 表格用 parser；图表或复杂 sheet 后续渲染给 VLM |
| 图片 | image evidence | 必须 VLM caption / OCR / diagram extraction |
| 视频 | store-only | 第一版只保存并生成可引用资产；后续可选关键帧 VLM |
| 其它格式 | skip | 不复制进 source；导入报告记录跳过原因 |

`pages` / `numbers` / `key` / `epub` 暂不支持。只有在有明确 parser、转换器或稳定的渲染路径后才进入支持矩阵。

## 文件夹导入

文件夹导入先生成 `ImportPlan`，再复制文件：

```ts
type ImportPlan = {
  acceptedFiles: SourceCandidate[]
  skippedFiles: SkippedSource[]
  folderManifest: string
}
```

导入结果：

1. 支持的文件按相对路径复制到 `raw/sources/<folder>/...`。
2. 生成 `raw/sources/<folder>/__folder_structure.md`，记录 accepted/skipped 列表和目录树。

这个 manifest 本身进入摄入流程，用于告诉 LLM：这些文件属于同一批资料，目录层级和文件名本身也是上下文。

## Evidence 层

统一中间对象：

```ts
type EvidenceBlock = {
  id: string
  sourcePath: string
  kind: "text" | "image" | "page" | "slide" | "table" | "folder" | "video"
  locator?: {
    page?: number
    slide?: number
    sheet?: string
    startSec?: number
    endSec?: number
  }
  mediaPath?: string
  text: string
  hash: string
  extractor: string
}
```

Evidence 的职责：

- 保存多模态模型看到的输入视图，例如页面截图、slide 图片、原始图片。
- 保存模型抽取出来的事实性描述、OCR 文本、图表结构、流程图节点、表格摘要。
- 记录来源定位，例如 page、slide、sheet、timestamp。
- 作为缓存和重跑边界。

## 多模态最佳实践

不同资源使用不同策略：

| 资源 | 策略 |
|---|---|
| 纯文本 | 直接文本 evidence；不浪费 VLM 调用 |
| PDF | 同时提取文本和渲染/抽取视觉元素；扫描页必须 VLM |
| PPT/PPTX | 优先 slide-as-image + VLM，因为幻灯片知识经常在布局和图表里 |
| DOC/DOCX | 文本结构为主；复杂版式、图片、截图走 VLM |
| XLS/XLSX | 单元格结构为主；图表/仪表盘/截图型 sheet 走 VLM |
| 图片 | VLM 生成事实 caption，包含可见文字、图表轴、图例、流程箭头 |
| 视频 | 第一版 store-only；后续按关键帧 + 音频转写生成 evidence |

这不是 parser-first，也不是 VLM-only。正确策略是：

- parser 保留确定性结构：文本、sheet、表格、标题、页码。
- VLM 理解非文本知识：图像、图表、视觉布局、截图、扫描页。
- Evidence 把两者合并成稳定、可追溯、可索引的中间层。

## 为什么不直接把所有文件丢给多模态大模型

多模态模型很重要，但不能替代 Evidence 层：

1. 很多 OpenAI-compatible 接口不接受任意 `.doc/.ppt/.xls` 原始二进制。
2. 不同 provider 的 file upload、生命周期、引用语义都不一致。
3. Wiki 需要来源定位：第几页、第几张 slide、第几个 sheet、第几张图。
4. Wiki 需要增量更新：某页、某图、某 sheet 没变就不应重跑整份文件。
5. Wiki 需要可审计：用户能看到模型基于哪些 evidence 写了页面。
6. 搜索和 embedding 需要文本信号：caption、OCR、表格 Markdown、转写文本都能进入现有检索管线。
7. 成本需要可控：Evidence 层可以过滤小图标、限制 VLM 调用、并发 caption、按 hash 去重。

所以多模态模型应该是强 extractor，而不是唯一 ingest runtime。

## Wiki 合成

Wiki 生成阶段只吃规范化 Evidence Markdown：

```md
## Evidence: slide-003
Type: slide
Source: decks/product-roadmap.pptx
Location: slide 3
Media: wiki/media/product-roadmap/slide-003.png

VLM extraction:
The slide compares three roadmap phases. The left column is labeled "Now", the center "Next", and the right "Later"...

![caption](wiki/media/product-roadmap/slide-003.png)
```

两步摄入保持稳定：

1. Analysis：基于 Evidence 分析实体、概念、冲突、结构建议。
2. Generation：生成或合并 Wiki 页面，并保留 source trace。

## 当前落地顺序

1. 统一 Source Admission 和文件夹 ImportPlan。
2. 独立图片进入 `wiki/media/<source>/`，由 VLM caption 后作为 visual evidence 进入摄入。
3. PDF/DOCX/PPTX 内嵌图片继续 caption，并注入 source summary。
4. 增加页面/slide 渲染型 evidence，让 PPT/PDF 的整页视觉结构也由 VLM 理解。
5. 增加 sheet/chart visual evidence，让 XLS/XLSX 不只停留在单元格文本。
6. 视频保持 store-only，后续再加关键帧和转写。
