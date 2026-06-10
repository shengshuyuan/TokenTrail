#!/usr/bin/env node

const http = require('http')
const next = require('next')

delete process.env.__NEXT_PRIVATE_STANDALONE_CONFIG
delete process.env.TURBOPACK

const port = Number(process.env.PORT || 3820)
const hostname = process.env.HOST || '127.0.0.1'
const dev = process.argv.includes('--dev') || process.env.NODE_ENV !== 'production'

process.env.NODE_ENV = dev ? 'development' : 'production'

async function main() {
  console.log(`[TokenTrail] preparing Next.js app (${dev ? 'dev' : 'production'})...`)

  const app = next({ dev, dir: process.cwd(), hostname, port })
  const handle = app.getRequestHandler()

  await app.prepare()

  const server = http.createServer((req, res) => {
    handle(req, res)
  })

  server.listen(port, hostname, () => {
    console.log(`[TokenTrail] ready on http://${hostname}:${port}`)
  })
}

main().catch(error => {
  console.error('[TokenTrail] server failed to start')
  console.error(error)
  process.exit(1)
})
