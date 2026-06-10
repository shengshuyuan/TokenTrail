/**
 * Preload script: strips CodePilot-injected env vars before Next.js starts.
 * Usage: node -r ./preload.js node_modules/next/dist/bin/next dev
 */
delete process.env.__NEXT_PRIVATE_STANDALONE_CONFIG
delete process.env.TURBOPACK
if (process.argv.includes('dev')) {
  process.env.NODE_ENV = 'development'
}
