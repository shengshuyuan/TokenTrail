import { getDb, getConfig, setConfig } from './db'
import { calculateCost } from './pricing'

/**
 * One-time data migrations, run from ensureInit() after schema creation and
 * pricing seed. Each migration is guarded by an app_config marker and, where
 * it rewrites rows, executes inside a single transaction so a crash can only
 * leave the pre-migration state (marker absent → safe to re-run).
 */

const NORMALIZE_INCLUSIVE_MARKER = 'migration.normalize_inclusive_v1'

interface InclusiveRow {
  id: number
  model: string
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
}

/**
 * Normalize hermes/grok rows that were recorded with OpenAI's inclusive wire
 * semantics (cached ⊆ prompt_tokens, reasoning ⊆ completion_tokens) into the
 * mutually exclusive buckets the aggregator and pricing expect, then recompute
 * cost. Rows whose subsets exceed their totals (~2% anomalies) are skipped —
 * undercounting beats inventing negative tokens. Sources whose writers already
 * report exclusive buckets (openclaw, cursor, dsh, …) are never touched.
 */
function normalizeInclusiveUsageRows(): void {
  if (getConfig(NORMALIZE_INCLUSIVE_MARKER)) return

  const db = getDb()
  const rows = db.prepare(`
    SELECT id, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens
    FROM usage_records
    WHERE source IN ('hermes', 'grok')
      AND is_aggregate = 0
      AND cached_input_tokens <= input_tokens
      AND reasoning_tokens <= output_tokens
      AND (cached_input_tokens > 0 OR reasoning_tokens > 0)
  `).all() as InclusiveRow[]

  if (rows.length === 0) {
    setConfig(NORMALIZE_INCLUSIVE_MARKER, `nothing-to-do@${new Date().toISOString()}`)
    return
  }

  const update = db.prepare(`
    UPDATE usage_records
    SET input_tokens = @input_tokens,
        output_tokens = @output_tokens,
        cost_usd = @cost_usd
    WHERE id = @id
  `)

  const migrate = db.transaction(() => {
    for (const row of rows) {
      const cost = calculateCost({
        model: row.model,
        input_tokens: row.input_tokens - row.cached_input_tokens,
        cached_input_tokens: row.cached_input_tokens,
        output_tokens: row.output_tokens - row.reasoning_tokens,
        reasoning_tokens: row.reasoning_tokens,
      })
      update.run({
        id: row.id,
        input_tokens: row.input_tokens - row.cached_input_tokens,
        output_tokens: row.output_tokens - row.reasoning_tokens,
        cost_usd: cost,
      })
    }
    // Marker inside the transaction: data and marker commit atomically.
    setConfig(NORMALIZE_INCLUSIVE_MARKER, `${rows.length} rows@${new Date().toISOString()}`)
  })

  migrate()
  console.log(`[TokenTrail] migration ${NORMALIZE_INCLUSIVE_MARKER}: normalized ${rows.length} rows`)
}

export function runMigrations(): void {
  normalizeInclusiveUsageRows()
}
