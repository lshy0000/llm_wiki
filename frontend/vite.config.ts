import path from "path"
import { readFileSync } from "fs"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// TAURI_DEV_HOST：桌面壳开发；VITE_DEV_HOST：Web 开发（默认 0.0.0.0 局域网可访问）
const host = process.env.TAURI_DEV_HOST || process.env.VITE_DEV_HOST || "0.0.0.0"
const frontendRoot = __dirname
const repoRoot = path.resolve(frontendRoot, "..")

const pkgJson = JSON.parse(readFileSync(path.join(frontendRoot, "package.json"), "utf-8"))
const knApiPort = process.env.KN_PORT || "8787"
const knApiTarget = `http://127.0.0.1:${knApiPort}`
const vitePort = Number(process.env.VITE_PORT || "1420")
// 前端代码只允许请求同源 /api；开发和预览时由 Vite 在这里统一转发到后端。
// 这样 DELETE/PATCH 等预检请求不会从桌面壳 Origin 直接打后端，避免再次出现 CORS 方法白名单问题。
const knApiProxy = {
  "/api": {
    target: knApiTarget,
    changeOrigin: true,
  },
} as const

export default defineConfig(async () => ({
  root: frontendRoot,
  envDir: repoRoot,
  publicDir: path.resolve(frontendRoot, "public"),
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: { "@": path.resolve(frontendRoot, "./src") },
  },

  define: {
    __APP_VERSION__: JSON.stringify(pkgJson.version),
  },

  build: {
    outDir: path.resolve(frontendRoot, "dist"),
    emptyOutDir: true,
  },

  clearScreen: false,
  server: {
    port: vitePort,
    strictPort: true,
    host,
    hmr: process.env.TAURI_DEV_HOST
      ? {
          protocol: "ws",
          host: process.env.TAURI_DEV_HOST,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/desktop/**"],
    },
    proxy: knApiProxy,
  },
  preview: {
    proxy: knApiProxy,
  },

  test: {
    environment: "node",
    setupFiles: [path.resolve(frontendRoot, "./src/test-helpers/load-test-env.ts")],
  },
}))
