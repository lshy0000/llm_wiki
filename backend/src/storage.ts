import fs from "node:fs/promises"
import path from "node:path"
import type { FileTreeNode } from "./types.js"
import { compareFileTreeEntries, normalizeStorageKey, nowIso } from "./wiki-utils.js"

export interface StorageProvider {
  writeObject(kbId: string, key: string, content: Buffer | string): Promise<void>
  readObject(kbId: string, key: string): Promise<Buffer>
  readText(kbId: string, key: string): Promise<string>
  deleteObject(kbId: string, key: string): Promise<void>
  deleteKnowledgeBase(kbId: string): Promise<void>
  listTree(kbId: string, prefix: string): Promise<FileTreeNode[]>
  publicPath(kbId: string, key: string): string
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly rootDir: string) {}

  async writeObject(kbId: string, key: string, content: Buffer | string): Promise<void> {
    const filePath = this.resolve(kbId, key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content)
  }

  async readObject(kbId: string, key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(kbId, key))
  }

  async readText(kbId: string, key: string): Promise<string> {
    return this.readObject(kbId, key).then((buf) => buf.toString("utf-8"))
  }

  async deleteObject(kbId: string, key: string): Promise<void> {
    await fs.rm(this.resolve(kbId, key), { recursive: true, force: true })
  }

  async deleteKnowledgeBase(kbId: string): Promise<void> {
    const safeKb = kbId.replace(/[^a-zA-Z0-9_-]/g, "")
    if (!safeKb) throw new Error(`Unsafe knowledge base id: ${kbId}`)
    const dir = path.resolve(this.rootDir, safeKb)
    const root = path.resolve(this.rootDir)
    const relative = path.relative(root, dir)
    // 删除知识库目录是递归破坏性操作，不能只靠字符串 startsWith 判断；
    // Windows 下 `C:\data\kb2` 会以 `C:\data\kb` 开头，必须用 path.relative
    // 确认目标确实是存储根目录下面的一个子目录，且不能等于根目录本身。
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Unsafe knowledge base id: ${kbId}`)
    }
    await fs.rm(dir, { recursive: true, force: true })
  }

  async listTree(kbId: string, prefix: string): Promise<FileTreeNode[]> {
    const safePrefix = normalizeStorageKey(prefix)
    const dir = this.resolve(kbId, safePrefix)
    try {
      return await this.readDirRecursive(kbId, dir, safePrefix)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    }
  }

  publicPath(kbId: string, key: string): string {
    return `/api/kbs/${kbId}/objects/${encodeURIComponent(normalizeStorageKey(key))}`
  }

  private resolve(kbId: string, key: string): string {
    const safeKb = kbId.replace(/[^a-zA-Z0-9_-]/g, "")
    if (!safeKb) throw new Error(`Unsafe knowledge base id: ${kbId}`)
    const safeKey = normalizeStorageKey(key)
    const resolved = path.resolve(this.rootDir, safeKb, safeKey)
    const root = path.resolve(this.rootDir, safeKb)
    const relative = path.relative(root, resolved)
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe storage key: ${key}`)
    return resolved
  }

  private async readDirRecursive(kbId: string, absoluteDir: string, prefix: string): Promise<FileTreeNode[]> {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true })
    const nodes: FileTreeNode[] = []
    for (const entry of entries.sort((a, b) =>
      compareFileTreeEntries(
        { name: a.name, isDirectory: a.isDirectory() },
        { name: b.name, isDirectory: b.isDirectory() },
      ),
    )) {
      const key = normalizeStorageKey(`${prefix}/${entry.name}`)
      const absolute = this.resolve(kbId, key)
      const stat = await fs.stat(absolute)
      const node: FileTreeNode = {
        name: entry.name,
        path: key,
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : stat.size,
        updatedAt: stat.mtime.toISOString() || nowIso(),
      }
      if (entry.isDirectory()) node.children = await this.readDirRecursive(kbId, absolute, key)
      nodes.push(node)
    }
    return nodes
  }
}
