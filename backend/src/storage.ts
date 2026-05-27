import fs from "node:fs/promises"
import path from "node:path"
import type { FileTreeNode } from "./types.js"
import { normalizeStorageKey, nowIso } from "./wiki-utils.js"

export interface StorageProvider {
  writeObject(kbId: string, key: string, content: Buffer | string): Promise<void>
  readObject(kbId: string, key: string): Promise<Buffer>
  readText(kbId: string, key: string): Promise<string>
  deleteObject(kbId: string, key: string): Promise<void>
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
    const safeKey = normalizeStorageKey(key)
    const resolved = path.resolve(this.rootDir, safeKb, safeKey)
    const root = path.resolve(this.rootDir, safeKb)
    if (!resolved.startsWith(root)) throw new Error(`Unsafe storage key: ${key}`)
    return resolved
  }

  private async readDirRecursive(kbId: string, absoluteDir: string, prefix: string): Promise<FileTreeNode[]> {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true })
    const nodes: FileTreeNode[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
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

