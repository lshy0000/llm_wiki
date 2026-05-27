import fs from "node:fs/promises"
import path from "node:path"
import type { ToolCategory, ToolParametersSchema, ToolScope } from "./tool-service.js"

export interface CustomHttpToolConfig {
  name: string
  displayName: string
  description: string
  category: ToolCategory
  scope: ToolScope
  readOnly: boolean
  enabled: boolean
  agentEnabled: boolean
  triggers?: string[]
  parameters: ToolParametersSchema
  http: {
    url: string
    method?: "GET" | "POST"
    headers?: Record<string, string>
    timeoutMs?: number
  }
}

export interface ToolConfigState {
  customTools: CustomHttpToolConfig[]
}

export class ToolConfigService {
  private state: ToolConfigState = { customTools: [] }

  constructor(private readonly configPath: string) {}

  async init(): Promise<ToolConfigState> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true })
    this.state = await this.read()
    return this.snapshot()
  }

  snapshot(): ToolConfigState {
    return {
      customTools: this.state.customTools.map((tool) => ({ ...tool, http: { ...tool.http, headers: { ...(tool.http.headers ?? {}) } } })),
    }
  }

  async saveCustomTool(input: unknown): Promise<CustomHttpToolConfig> {
    const tool = normalizeCustomTool(input)
    const existingIndex = this.state.customTools.findIndex((item) => item.name === tool.name)
    if (existingIndex >= 0) {
      this.state.customTools = this.state.customTools.map((item, index) => index === existingIndex ? tool : item)
    } else {
      this.state.customTools = [...this.state.customTools, tool]
    }
    await this.write()
    return tool
  }

  async deleteCustomTool(name: string): Promise<boolean> {
    const before = this.state.customTools.length
    this.state.customTools = this.state.customTools.filter((tool) => tool.name !== name)
    if (this.state.customTools.length === before) return false
    await this.write()
    return true
  }

  private async read(): Promise<ToolConfigState> {
    try {
      const raw = await fs.readFile(this.configPath, "utf-8")
      const parsed = JSON.parse(raw) as unknown
      if (!isRecord(parsed)) return { customTools: [] }
      const customTools = Array.isArray(parsed.customTools)
        ? parsed.customTools.map(normalizeCustomTool)
        : []
      return { customTools }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { customTools: [] }
      throw err
    }
  }

  private async write(): Promise<void> {
    await fs.writeFile(this.configPath, `${JSON.stringify(this.state, null, 2)}\n`)
  }
}

function normalizeCustomTool(input: unknown): CustomHttpToolConfig {
  if (!isRecord(input)) throw new Error("tool config must be an object")
  const name = stringValue(input.name, "name")
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/.test(name)) {
    throw new Error("name must start with a letter and contain only letters, numbers, _ or -")
  }
  const displayName = stringValue(input.displayName ?? input.name, "displayName")
  const description = stringValue(input.description, "description")
  const category = normalizeCategory(input.category)
  const scope = normalizeScope(input.scope)
  const http = normalizeHttp(input.http)
  return {
    name,
    displayName,
    description,
    category,
    scope,
    readOnly: input.readOnly !== false,
    enabled: input.enabled !== false,
    agentEnabled: input.agentEnabled === true,
    triggers: normalizeTriggers(input.triggers),
    parameters: normalizeParameters(input.parameters),
    http,
  }
}

function normalizeHttp(value: unknown): CustomHttpToolConfig["http"] {
  if (!isRecord(value)) throw new Error("http config is required")
  const url = stringValue(value.url, "http.url")
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("http.url must use http or https")
  const method = value.method === "GET" ? "GET" : "POST"
  const headers: Record<string, string> = {}
  if (isRecord(value.headers)) {
    for (const [key, headerValue] of Object.entries(value.headers)) {
      if (typeof headerValue === "string") headers[key] = headerValue
    }
  }
  const timeoutMs = typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs)
    ? Math.min(Math.max(Math.trunc(value.timeoutMs), 1000), 30000)
    : 10000
  return { url, method, headers, timeoutMs }
}

function normalizeParameters(value: unknown): ToolParametersSchema {
  if (!isRecord(value)) return { type: "object", properties: {}, additionalProperties: false }
  const properties = isRecord(value.properties) ? value.properties : {}
  const required = Array.isArray(value.required) ? value.required.filter((item): item is string => typeof item === "string") : []
  return {
    type: "object",
    properties: properties as ToolParametersSchema["properties"],
    required,
    additionalProperties: value.additionalProperties === true,
  }
}

function normalizeCategory(value: unknown): ToolCategory {
  return value === "retrieval" || value === "storage" || value === "external" ? value : "knowledge"
}

function normalizeScope(value: unknown): ToolScope {
  return value === "global" ? "global" : "knowledge_base"
}

function normalizeTriggers(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const triggers = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
  return triggers.length > 0 ? triggers : undefined
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
