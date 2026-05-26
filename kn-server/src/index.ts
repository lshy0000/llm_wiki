import { buildApp } from "./app.js"

const port = Number(process.env.KN_PORT ?? 8787)
const host = process.env.KN_HOST ?? "127.0.0.1"

const { app } = await buildApp()
await app.listen({ port, host })

