#!/usr/bin/env node

import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertPortAvailable, PortOccupiedError } from "./check-dev-port.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

try {
  await assertPortAvailable("backend", 8787, "KN_PORT")
  await assertPortAvailable("frontend", 1420, "VITE_PORT")
} catch (error) {
  if (!(error instanceof PortOccupiedError)) {
    console.error(error instanceof Error ? error.message : String(error))
  }
  process.exit(1)
}

console.log("[dev:all] 端口预检通过，开始启动 backend 和 frontend。")

const children = [
  spawnNpm(["run", "server:dev"]),
  spawnNpm(["run", "dev"]),
]

let shuttingDown = false

for (const child of children) {
  child.on("error", (error) => {
    if (shuttingDown) {
      return
    }
    console.error(error instanceof Error ? error.message : String(error))
    shutdown(1)
  })

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return
    }
    const exitCode = typeof code === "number" ? code : signal ? 1 : 0
    shutdown(exitCode)
  })
}

process.on("SIGINT", () => shutdown(130))
process.on("SIGTERM", () => shutdown(143))

function shutdown(exitCode) {
  shuttingDown = true
  process.exitCode = exitCode
  for (const child of children) {
    stopChild(child)
  }
  setTimeout(() => process.exit(exitCode), 800)
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
    return
  }

  child.kill("SIGTERM")
}

function spawnNpm(args) {
  if (process.platform === "win32") {
    const shell = process.env.ComSpec || process.env.COMSPEC || "cmd.exe"
    return spawn(shell, ["/d", "/s", "/c", ["npm", ...args].join(" ")], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    })
  }

  return spawn("npm", args, { cwd: repoRoot, env: process.env, stdio: "inherit" })
}
