import { loadEnv, paths } from "./env.js"
import { buildApp } from "./app.js"

loadEnv()

const port = Number(process.env.KN_PORT ?? 8787)
const host = process.env.KN_HOST ?? "0.0.0.0"

const { app } = await buildApp(paths.dataDir)
app.log.info({ dataDir: paths.dataDir, logFile: paths.logFile }, "kn-backend starting")
await app.listen({ port, host })
