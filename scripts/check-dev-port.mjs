#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import net from "node:net"
import { pathToFileURL } from "node:url"

export class PortOccupiedError extends Error {
  constructor(serviceName, port, owners) {
    super(`${serviceName} port ${port} is occupied`)
    this.name = "PortOccupiedError"
    this.serviceName = serviceName
    this.port = port
    this.owners = owners
  }
}

export function resolvePort(defaultPort, envName) {
  const rawPort = envName && process.env[envName] ? process.env[envName] : String(defaultPort)
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${envName || "port"}=${rawPort} 不是有效端口号`)
  }
  return port
}

export async function assertPortAvailable(serviceName, defaultPort, envName) {
  const port = resolvePort(defaultPort, envName)
  const owners = findPortOwners(port)
  if (owners.length > 0) {
    printOccupied(serviceName, port, owners)
    throw new PortOccupiedError(serviceName, port, owners)
  }

  const available = await canListen(port)
  if (!available) {
    printOccupied(serviceName, port, [])
    throw new PortOccupiedError(serviceName, port, [])
  }

  return port
}

export function findPortOwners(port) {
  if (process.platform === "win32") {
    return findWindowsPortOwners(port)
  }
  return findUnixPortOwners(port)
}

function findWindowsPortOwners(port) {
  const owners = new Map()
  let output = ""
  try {
    output = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" })
  } catch {
    return []
  }

  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5 || parts[0].toUpperCase() !== "TCP") {
      continue
    }

    const localAddress = parts[1]
    const state = parts[3]
    const pid = parts[4]
    if (!/^LISTENING$/i.test(state) || localPort(localAddress) !== port || !/^\d+$/.test(pid)) {
      continue
    }

    if (!owners.has(pid)) {
      owners.set(pid, { pid, name: findWindowsProcessName(pid) })
    }
  }

  return [...owners.values()]
}

function findWindowsProcessName(pid) {
  try {
    const output = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
    }).trim()
    const firstLine = output.split(/\r?\n/)[0] || ""
    const match = firstLine.match(/^"([^"]+)","(\d+)"/)
    return match?.[1]
  } catch {
    return undefined
  }
}

function findUnixPortOwners(port) {
  const owners = findWithLsof(port)
  if (owners.length > 0) {
    return owners
  }
  return findWithSs(port)
}

function findWithLsof(port) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    })
    return output
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 2 && /^\d+$/.test(parts[1]))
      .map((parts) => ({ pid: parts[1], name: parts[0] }))
  } catch {
    return []
  }
}

function findWithSs(port) {
  try {
    const output = execFileSync("ss", ["-ltnp"], { encoding: "utf8" })
    const owners = new Map()
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes(`:${port}`) || !line.includes("pid=")) {
        continue
      }
      const pidMatch = line.match(/pid=(\d+)/)
      const nameMatch = line.match(/users:\(\("([^"]+)"/)
      if (pidMatch) {
        owners.set(pidMatch[1], { pid: pidMatch[1], name: nameMatch?.[1] })
      }
    }
    return [...owners.values()]
  } catch {
    return []
  }
}

function localPort(localAddress) {
  const match = localAddress.match(/:(\d+)$/)
  return match ? Number(match[1]) : undefined
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen({ host: "0.0.0.0", port, exclusive: true })
  })
}

function printOccupied(serviceName, port, owners) {
  const pids = owners.map((owner) => owner.pid)
  console.error("")
  console.error(`[启动失败] ${serviceName} 端口 ${port} 已被占用。`)

  if (owners.length > 0) {
    console.error(`占用进程 PID: ${owners.map(formatOwner).join(", ")}`)
    console.error("")
    console.error("查看进程：")
    console.error(`  ${inspectCommand(pids)}`)
    console.error("停止进程：")
    console.error(`  ${stopCommand(pids)}`)
    if (process.platform === "win32") {
      console.error("强制停止：")
      console.error(`  ${taskkillCommand(pids)}`)
    }
  } else {
    console.error("未能自动解析 PID，请手动查看占用：")
    console.error(`  ${manualInspectCommand(port)}`)
  }

  console.error("")
}

function formatOwner(owner) {
  return owner.name ? `${owner.pid} (${owner.name})` : owner.pid
}

function inspectCommand(pids) {
  if (process.platform === "win32") {
    return `Get-Process -Id ${pids.join(",")}`
  }
  return `ps -p ${pids.join(",")} -o pid,comm,args`
}

function stopCommand(pids) {
  if (process.platform === "win32") {
    return `Stop-Process -Id ${pids.join(",")}`
  }
  return `kill ${pids.join(" ")}`
}

function taskkillCommand(pids) {
  return `taskkill ${pids.map((pid) => `/PID ${pid}`).join(" ")} /F`
}

function manualInspectCommand(port) {
  if (process.platform === "win32") {
    return `netstat -ano -p tcp | findstr :${port}`
  }
  return `lsof -nP -iTCP:${port} -sTCP:LISTEN`
}

async function main() {
  const [serviceName, defaultPort, envName] = process.argv.slice(2)
  if (!serviceName || !defaultPort) {
    console.error("Usage: node scripts/check-dev-port.mjs <service-name> <default-port> [env-name]")
    process.exit(2)
  }

  try {
    await assertPortAvailable(serviceName, defaultPort, envName)
  } catch (error) {
    if (!(error instanceof PortOccupiedError)) {
      console.error(error instanceof Error ? error.message : String(error))
    }
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
