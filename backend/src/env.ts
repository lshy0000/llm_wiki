import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(backendRoot, "..")

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith("#")) continue
    const eqIdx = line.indexOf("=")
    if (eqIdx < 0) continue
    const key = line.slice(0, eqIdx).trim()
    const rawValue = line.slice(eqIdx + 1).trim()
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue
    if (!(key in process.env)) process.env[key] = value
  }
}

/** Load repo-root `.env` (override via KN_ENV_FILE). */
export function loadEnv(): void {
  const envPath = process.env.KN_ENV_FILE?.trim() || path.join(repoRoot, ".env")
  loadEnvFile(envPath)
}

export const paths = {
  repoRoot,
  backendRoot,
  get dataDir() {
    return process.env.KN_DATA_DIR?.trim() || path.join(backendRoot, ".kn-data")
  },
  get logFile() {
    return process.env.KN_LOG_FILE?.trim() || path.join(backendRoot, "server.log")
  },
}
