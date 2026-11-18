import { getDb, getConfig, setConfig, deleteJunkTestPricing, zeroCursorGrokBotCosts, CURSOR_GROK_BOT_SOURCE } from './db'
import { calculateCost } from './pricing'
import { invalidateStatsCache } from './stats-cache'

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

const JUNK_TEST_PRICING_MARKER = 'migration.delete_junk_test_pricing_v1'

function deleteJunkTestPricingRows(): void {
  if (getConfig(JUNK_TEST_PRICING_MARKER)) return
  const result = deleteJunkTestPricing()
  setConfig(JUNK_TEST_PRICING_MARKER, `${result.pricing} pricing/${result.usage} usage@${new Date().toISOString()}`)
  if (result.pricing > 0 || result.usage > 0) {
    console.log(
      `[TokenTrail] migration ${JUNK_TEST_PRICING_MARKER}: removed ${result.pricing} pricing rows, ${result.usage} test usage rows`,
    )
  }
}

const CURSOR_AUTO_MODEL_MARKER = 'migration.cursor_default_to_auto_v1'

/**
 * Cursor's usage API reports Auto mode as model "default". Rename stored rows
 * to "auto" (request_id keeps the raw name so re-syncs still dedupe) and drop
 * the price=0 placeholder that ensureModelPricing registered for "default".
 */
function renameCursorDefaultModel(): void {
  if (getConfig(CURSOR_AUTO_MODEL_MARKER)) return
  const db = getDb()
  const migrate = db.transaction(() => {
    const usage = db.prepare("UPDATE usage_records SET model = 'auto' WHERE source = 'cursor' AND model = 'default'").run()
    const pricing = db.prepare(`
      DELETE FROM model_pricing
      WHERE model_id = 'default'
        AND input_price_per_1m = 0 AND cached_input_price_per_1m = 0
        AND output_price_per_1m = 0 AND reasoning_price_per_1m = 0
    `).run()
    setConfig(CURSOR_AUTO_MODEL_MARKER, `${usage.changes} usage/${pricing.changes} pricing@${new Date().toISOString()}`)
    return usage.changes
  })
  const renamed = migrate()
  if (renamed > 0) console.log(`[TokenTrail] migration ${CURSOR_AUTO_MODEL_MARKER}: renamed ${renamed} cursor rows default → auto`)
}

const CURSOR_GROK_BOT_ZERO_COST_MARKER = 'migration.cursor_grok_bot_zero_cost_v1'

/**
 * Cursor Grok Bot (grok-bot-*) is an included subscription pool. Historical
 * rows stored Cursor's list-price totalCents as cost_usd; zero those out so
 * dashboards only count real billed spend. New writes already force $0.
 */
function zeroCursorGrokBotUsageCosts(): void {
  if (getConfig(CURSOR_GROK_BOT_ZERO_COST_MARKER)) return
  const result = zeroCursorGrokBotCosts()
  setConfig(
    CURSOR_GROK_BOT_ZERO_COST_MARKER,
    `${result.usage} usage/${result.pricing} pricing@${new Date().toISOString()}`,
  )
  if (result.usage > 0 || result.pricing > 0) {
    console.log(
      `[TokenTrail] migration ${CURSOR_GROK_BOT_ZERO_COST_MARKER}: zeroed ${result.usage} usage rows, ${result.pricing} pricing rows`,
    )
  }
}

const CURSOR_GROK_BOT_SOURCE_MARKER = 'migration.cursor_grok_bot_source_v1'

/**
 * grok-bot-* 记录（含 VibeCafé 的按天汇总）从 cursor 来源挪到 cursor-grok-bot：
 * Grok Bot 不是 IDE / 命令行对话，底层模型看不到，单独成一个来源才不会把
 * Cursor 里真正用的模型淹没。request_id 不变，重新同步仍按原 id 去重。
 */
function moveCursorGrokBotToOwnSource(): void {
  if (getConfig(CURSOR_GROK_BOT_SOURCE_MARKER)) return
  const db = getDb()
  const moved = db.transaction(() => {
    const result = db.prepare(`
      UPDATE usage_records
      SET source = ?
      WHERE source = 'cursor' AND lower(model) LIKE 'grok-bot%'
    `).run(CURSOR_GROK_BOT_SOURCE)
    setConfig(CURSOR_GROK_BOT_SOURCE_MARKER, `${result.changes} usage@${new Date().toISOString()}`)
    return result.changes
  })()
  if (moved > 0) {
    invalidateStatsCache()
    console.log(`[TokenTrail] migration ${CURSOR_GROK_BOT_SOURCE_MARKER}: moved ${moved} grok-bot rows to ${CURSOR_GROK_BOT_SOURCE}`)
  }
}

/** Remove context-window estimates from scanner rows without changing billed credits. */
function correctKiroContextTokens(): void {
  const marker = 'migration.kiro_credit_only_v1'
  if (getConfig(marker)) return
  const db = getDb()
  db.transaction(() => {
    db.prepare(`
      UPDATE usage_records SET input_tokens = 0
      WHERE source = 'kiro' AND provider = 'kiro' AND request_id LIKE 'kiro:%'
        AND credits > 0 AND input_tokens > 0
        AND cached_input_tokens = 0 AND output_tokens = 0 AND reasoning_tokens = 0
    `).run()
    setConfig(marker, new Date().toISOString())
  })()
  invalidateStatsCache()
}

export function runMigrations(): void {
  normalizeInclusiveUsageRows()
  deleteJunkTestPricingRows()
  renameCursorDefaultModel()
  zeroCursorGrokBotUsageCosts()
  moveCursorGrokBotToOwnSource()
  correctKiroContextTokens()
}
