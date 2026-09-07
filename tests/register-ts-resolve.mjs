import { register } from 'node:module'
import path from 'node:path'
import os from 'node:os'

// Safety net: every test process gets its own throwaway DB unless it opts out
// explicitly. Tests that import src/lib/db.ts with a static import cannot set
// TOKENTRAIL_DB_PATH before the module loads, so the default must live here.
// Without this, any db-touching test would run against ./data/token-trail.db.
process.env.TOKENTRAIL_DB_PATH ||= path.join(
  os.tmpdir(),
  `tokentrail-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`
)

register('./ts-resolve-loader.mjs', import.meta.url)
