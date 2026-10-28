import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { invalidateStatsCache } from './stats-cache'

const DB_PATH = process.env.TOKENTRAIL_DB_PATH || path.join(process.cwd(), 'data', 'token-trail.db')
const DB_DIR = path.dirname(DB_PATH)

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  // Ensure data directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true })
  }

  _db = new Database(DB_PATH)

  // Enable WAL mode for better performance
  _db.pragma('journal_mode = WAL')

  // Create tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT 'unknown',
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      is_internal INTEGER NOT NULL DEFAULT 0,
      is_aggregate INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      credits REAL NOT NULL DEFAULT 0,
      request_id TEXT,
      timestamp INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_usage_source ON usage_records(source);
    CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model);
    CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_request_id ON usage_records(request_id) WHERE request_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS model_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_price_per_1m REAL NOT NULL,
      cached_input_price_per_1m REAL NOT NULL DEFAULT 0,
      output_price_per_1m REAL NOT NULL,
      reasoning_price_per_1m REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_snapshots (
      provider TEXT PRIMARY KEY,
      snapshot_json TEXT NOT NULL,
      fetched_at INTEGER,
      last_success_at INTEGER,
      last_error_code TEXT
    );
  `)

  ensureUsageRecordsProjectColumn(_db)
  ensureUsageRecordsProviderColumn(_db)
  ensureUsageRecordsTimestampValues(_db)
  ensureUsageRecordsInternalColumn(_db)
  ensureUsageRecordsAggregateColumn(_db)
  ensureUsageRecordsEstimatedColumn(_db)
  ensureUsageRecordsCreditsColumn(_db)
  markLegacyInternalCodexUsageRecords(_db)
  _db.exec('CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_records(project);')

  return _db
}

function ensureUsageRecordsProjectColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(usage_records)').all() as { name: string }[]
  if (!columns.some(column => column.name === 'project')) {
    db.exec("ALTER TABLE usage_records ADD COLUMN project TEXT NOT NULL DEFAULT 'unknown';")
  }
}

function ensureUsageRecordsProviderColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(usage_records)').all() as { name: string }[]
  if (!columns.some(column => column.name === 'provider')) {
    db.exec("ALTER TABLE usage_records ADD COLUMN provider TEXT;")
  }
}

function ensureUsageRecordsInternalColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(usage_records)').all() as { name: string }[]
  if (!columns.some(column => column.name === 'is_internal')) {
    db.exec('ALTER TABLE usage_records ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;')
  }
}

function ensureUsageRecordsAggregateColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(usage_records)').all() as { name: string }[]
  if (!columns.some(column => column.name === 'is_aggregate')) {
    db.exec('ALTER TABLE usage_records ADD COLUMN is_aggregate INTEGER NOT NULL DEFAULT 0;')
  }
  db.prepare("UPDATE usage_records SET is_aggregate = 1 WHERE request_id LIKE 'vc:%' AND is_aggregate = 0").run()
}

function ensureUsageRecordsEstimatedColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(usage_records)').all() as { name: string }[]
  if (!columns.some(column => column.name === 'estimated')) {
    db.exec('ALTER TABLE usage_records ADD COLUMN estimated INTEGER NOT NULL DEFAULT 0;')
  }
  // Backfill scanner-derived estimates. Antigravity legacy session rows (antigravity-*)
  // are char-based estimates; modern per-event rows (antigravity:*:*) manage their own
  // estimated flag from native tokens. TraeWork scan rows are char-weighted estimates (provider = 'trae').
  db.prepare(`
    UPDATE usage_records
    SET estimated = 1
    WHERE estimated = 0
      AND (
        (source = 'antigravity' AND (request_id LIKE 'antigravity-%' OR request_id NOT LIKE 'antigravity:%:%') AND is_aggregate = 0)
        OR (source = 'traework' AND provider = 'trae')
      )
  `).run()
}

function markLegacyInternalCodexUsageRecords(db: Database.Database) {
  db.prepare(`
    UPDATE usage_records
    SET is_internal = 1
    WHERE model = 'codex-auto-review'
      AND is_internal = 0
  `).run()
}

/**
 * Kiro CLI bills in credits, not tokens. The credits column stores that
 * per-turn credit usage so Kiro rows carry a meaningful quantity even though
 * their token counts are 0. Defaults to 0 so every existing source is untouched.
 */
function ensureUsageRecordsCreditsColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(usage_records)').all() as { name: string }[]
  if (!columns.some(column => column.name === 'credits')) {
    db.exec('ALTER TABLE usage_records ADD COLUMN credits REAL NOT NULL DEFAULT 0;')
  }
}

function normalizeStoredTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Unix seconds → ms (same rule as sync.normalizeTimestamp)
    return Math.abs(value) < 1e12 ? Math.round(value * 1000) : Math.trunc(value)
  }

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed)
    if (!Number.isFinite(numeric)) return null
    return Math.abs(numeric) < 1e12 ? Math.round(numeric * 1000) : Math.trunc(numeric)
  }

  // Legacy Hermes records can contain microseconds, while JavaScript dates
  // retain milliseconds. Trim only the excess precision before parsing.
  const normalizedIso = trimmed.replace(/(\.\d{3})\d+/, '$1')
  const parsed = Date.parse(normalizedIso)
  return Number.isFinite(parsed) ? parsed : null
}

function ensureUsageRecordsTimestampValues(db: Database.Database) {
  const rows = db
    .prepare("SELECT id, timestamp FROM usage_records WHERE typeof(timestamp) = 'text'")
    .all() as { id: number; timestamp: string }[]

  if (rows.length === 0) return

  const update = db.prepare('UPDATE usage_records SET timestamp = ? WHERE id = ?')
  const migrate = db.transaction(() => {
    for (const row of rows) {
      const timestamp = normalizeStoredTimestamp(row.timestamp)
      if (timestamp !== null) update.run(timestamp, row.id)
    }
  })

  migrate()
}

// ─── WHERE 子句构建 ───────────────────────────────────────────
// 将 WHERE 子句构建抽象为函数，避免事后字符串替换的脆弱做法。

interface FilterParams {
  startDate: number
  endDate: number
  sources?: string[]
  models?: string[]
  /** 'measured' 仅实测，'estimated' 仅估算，省略表示全部 */
  kind?: UsageKind
}

export type UsageKind = 'measured' | 'estimated'

interface UsageQueryOptions {
  limit?: number
  offset?: number
}

/**
 * 构建 WHERE 子句 + 参数。
 * @param alias 表别名（空字符串表示不使用别名，如 'u' 表示 usage_records u）
 */
/**
 * Milliseconds to add to a UTC timestamp so SQLite `date()` lands on the
 * user's local calendar day. Defaults to the host timezone.
 * Override with TOKENTRAIL_TZ_OFFSET_MINUTES (China = 480) or app_config
 * key `timezone_offset_minutes`.
 */
export function localDayOffsetMs(): number {
  const fromEnv = process.env.TOKENTRAIL_TZ_OFFSET_MINUTES
  if (fromEnv != null && fromEnv !== '' && Number.isFinite(Number(fromEnv))) {
    return Math.trunc(Number(fromEnv)) * 60 * 1000
  }
  try {
    const row = getDb().prepare(
      "SELECT value FROM app_config WHERE key = 'timezone_offset_minutes'"
    ).get() as { value: string } | undefined
    if (row?.value != null && row.value !== '' && Number.isFinite(Number(row.value))) {
      return Math.trunc(Number(row.value)) * 60 * 1000
    }
  } catch {
    // DB not ready yet — fall through to the host clock.
  }
  return -new Date().getTimezoneOffset() * 60 * 1000
}

/** SQL expression: local calendar day for a millisecond timestamp column. */
export function localDayExpr(column: string): string {
  const offset = Math.trunc(localDayOffsetMs())
  if (!Number.isFinite(offset)) {
    throw new Error('invalid timezone offset')
  }
  return `date(ROUND((${column} + ${offset}) / 1000), 'unixepoch')`
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Time window for "last N days" in the user's calendar: days=1 means today
 * since local midnight, days=7 means today plus the previous 6 local days.
 * Uses the same offset as localDayExpr so totals and the daily chart agree.
 */
export function localDayWindow(days: number, now = Date.now()): { startDate: number; endDate: number } {
  const offset = localDayOffsetMs()
  const startOfToday = Math.floor((now + offset) / DAY_MS) * DAY_MS - offset
  const span = Math.max(1, Math.trunc(days))
  return { startDate: startOfToday - (span - 1) * DAY_MS, endDate: now }
}

function buildWhere(alias: string, filters: FilterParams, options: { measuredOnly?: boolean } = {}): { sql: string; params: (string | number)[] } {
  const col = (name: string) => alias ? `${alias}.${name}` : name
  const conditions: string[] = []
  const params: (string | number)[] = []

  conditions.push(`${col('timestamp')} >= ?`)
  params.push(filters.startDate)

  conditions.push(`${col('timestamp')} <= ?`)
  params.push(filters.endDate)

  // Codex auto-review and other internal rows stay in the table for audit,
  // but they are not part of usage the user spent.
  conditions.push(`${col('is_internal')} = 0`)

  // Dashboard totals count measured rows only. Character estimates stay in
  // the table and are reported separately (see getAggregatedStats).
  if (options.measuredOnly || filters.kind === 'measured') {
    conditions.push(`${col('estimated')} = 0`)
  } else if (filters.kind === 'estimated') {
    conditions.push(`${col('estimated')} = 1`)
  }

  if (filters.sources && filters.sources.length > 0) {
    const placeholders = filters.sources.map(() => '?').join(',')
    conditions.push(`${col('source')} IN (${placeholders})`)
    params.push(...filters.sources)
  }

  if (filters.models && filters.models.length > 0) {
    const placeholders = filters.models.map(() => '?').join(',')
    conditions.push(`${col('model')} IN (${placeholders})`)
    params.push(...filters.models)
  }

  return { sql: 'WHERE ' + conditions.join(' AND '), params }
}

// ─── 来源别名 ───────────────────────────────────────────────

const SOURCE_ALIASES: Record<string, string> = {
  'codex-review': 'codex',
}

/** Lowercase + alias mapping; request_id synthesis must use the same form. */
export function normalizeSource(source: string): string {
  return SOURCE_ALIASES[source.toLowerCase()] || source
}

// ─── 插入用量记录 ─────────────────────────────────────────────

/**
 * 当来源未提供 request_id 时，基于记录字段合成确定性的 fallback ID。
 * 用于 OpenClaw / Hermes 等 JSONL 不带 request_id 的来源：
 * 同一事件（同 source/timestamp/model/token 数）每次导入/上报都得到同一个 key，
 * 从而能命中 request_id 唯一索引做去重，避免每次 sync 都把历史记录再插一遍。
 *
 * Token counts are sanitized before hashing so callers may pass raw values;
 * note that changing stored values does NOT change this key for a given raw
 * event — compute it from the raw values before normalizing buckets.
 */
export function synthesizeRequestId(source: string, rec: {
  timestamp: number
  model: string
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
}): string {
  const raw = [
    source,
    rec.timestamp,
    rec.model,
    sanitizeTokenCount(rec.input_tokens),
    sanitizeTokenCount(rec.cached_input_tokens),
    sanitizeTokenCount(rec.output_tokens),
    sanitizeTokenCount(rec.reasoning_tokens),
  ].join('|')
  return `${source}:${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}`
}

export function insertUsageRecord(record: {
  source: string
  provider?: string
  project?: string
  model: string
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  is_internal?: boolean
  is_aggregate?: boolean
  estimated?: boolean
  cost_usd: number
  /** Credit-based usage (Kiro CLI). Lets a row carry a quantity with 0 tokens. */
  credits?: number
  request_id?: string
  timestamp: number
}) {
  const db = getDb()
  const source = normalizeSource(record.source)
  const project = normalizeProjectName(record.project)
  const provider = record.provider || null

  // Coerce to non-negative integers so float / string payloads never pollute aggregates
  const input_tokens = sanitizeTokenCount(record.input_tokens)
  const cached_input_tokens = sanitizeTokenCount(record.cached_input_tokens)
  const output_tokens = sanitizeTokenCount(record.output_tokens)
  const reasoning_tokens = sanitizeTokenCount(record.reasoning_tokens)
  const credits = Number.isFinite(record.credits) && (record.credits as number) > 0 ? (record.credits as number) : 0
  const timestamp = Number.isFinite(record.timestamp) ? Math.trunc(record.timestamp) : Date.now()
  const cost_usd = shouldZeroUsageCost(record.model) ? 0 : record.cost_usd

  // 拒绝全部 token 为 0 的记录，避免污染统计数据。
  // 例外：credit 计量来源（如 Kiro CLI）本就无 token，只要带 credits 即视为有效。
  if (input_tokens === 0 && output_tokens === 0 && cached_input_tokens === 0 && reasoning_tokens === 0 && credits === 0) {
    return { success: false, cost_usd: 0, id: 0, duplicate: false, project_backfilled: false }
  }

  // 确定 request_id：显式提供则用之；否则按记录字段合成确定性 fallback，保证幂等去重
  const explicitReqId = record.request_id && String(record.request_id).trim()
  const requestId = explicitReqId || synthesizeRequestId(source, {
    timestamp,
    model: record.model,
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_tokens,
  })

  const existing = db.prepare('SELECT id, project FROM usage_records WHERE request_id = ?').get(requestId) as { id: number; project: string } | undefined
  if (existing) {
    const projectBackfilled = backfillProjectForExistingRecord(db, existing.id, existing.project, project)
    if (projectBackfilled) invalidateStatsCache()
    return { success: true, cost_usd: 0, id: existing.id, duplicate: true, project_backfilled: projectBackfilled }
  }

  const stmt = db.prepare(`
    INSERT INTO usage_records (source, provider, project, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, is_internal, is_aggregate, estimated, cost_usd, credits, request_id, timestamp)
    VALUES (@source, @provider, @project, @model, @input_tokens, @cached_input_tokens, @output_tokens, @reasoning_tokens, @is_internal, @is_aggregate, @estimated, @cost_usd, @credits, @request_id, @timestamp)
    ON CONFLICT(request_id) WHERE request_id IS NOT NULL DO NOTHING
  `)

  const result = stmt.run({
    source,
    provider,
    project,
    model: record.model,
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_tokens,
    is_internal: record.is_internal ? 1 : 0,
    is_aggregate: record.is_aggregate ? 1 : 0,
    estimated: record.estimated ? 1 : 0,
    cost_usd,
    credits,
    request_id: requestId,
    timestamp,
  })

  // changes === 0 表示因唯一约束冲突被忽略（即重复）
  if (result.changes === 0) {
    return { success: true, cost_usd: 0, id: 0, duplicate: true, project_backfilled: false }
  }

  invalidateStatsCache()
  return { success: true, cost_usd, id: result.lastInsertRowid as number, duplicate: false, project_backfilled: false }
}

/** Model already stored for a request_id, or undefined when the row does not exist. */
export function getStoredUsageModel(requestId: string): string | undefined {
  const row = getDb().prepare('SELECT model FROM usage_records WHERE request_id = ?').get(requestId) as { model: string } | undefined
  return row?.model
}

/**
 * Replaces a locally-derived record when its stable source position is read
 * again. Parser upgrades can then correct historical rows without duplicates.
 */
export function replaceUsageRecordByRequestId(record: {
  source: string
  provider?: string
  project?: string
  model: string
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  is_internal?: boolean
  is_aggregate?: boolean
  estimated?: boolean
  cost_usd: number
  /** Credit-based usage (Kiro CLI). Preserved on replace like insertUsageRecord. */
  credits?: number
  request_id: string
  timestamp: number
}) {
  const db = getDb()
  const requestId = String(record.request_id).trim()
  if (!requestId) return insertUsageRecord(record)

  const existing = db.prepare('SELECT id FROM usage_records WHERE request_id = ?').get(requestId) as { id: number } | undefined
  if (!existing) return insertUsageRecord({ ...record, request_id: requestId })

  const input_tokens = sanitizeTokenCount(record.input_tokens)
  const cached_input_tokens = sanitizeTokenCount(record.cached_input_tokens)
  const output_tokens = sanitizeTokenCount(record.output_tokens)
  const reasoning_tokens = sanitizeTokenCount(record.reasoning_tokens)
  const credits = Number.isFinite(record.credits) && (record.credits as number) > 0 ? (record.credits as number) : 0
  const timestamp = Number.isFinite(record.timestamp) ? Math.trunc(record.timestamp) : Date.now()

  db.prepare(`
    UPDATE usage_records
    SET source = @source,
        provider = @provider,
        project = @project,
        model = @model,
        input_tokens = @input_tokens,
        cached_input_tokens = @cached_input_tokens,
        output_tokens = @output_tokens,
        reasoning_tokens = @reasoning_tokens,
        is_internal = @is_internal,
        is_aggregate = @is_aggregate,
        estimated = @estimated,
        cost_usd = @cost_usd,
        credits = @credits,
        timestamp = @timestamp
    WHERE id = @id
  `).run({
    id: existing.id,
    source: normalizeSource(record.source),
    provider: record.provider || null,
    project: normalizeProjectName(record.project),
    model: record.model,
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_tokens,
    is_internal: record.is_internal ? 1 : 0,
    is_aggregate: record.is_aggregate ? 1 : 0,
    estimated: record.estimated ? 1 : 0,
    cost_usd: shouldZeroUsageCost(record.model) ? 0 : record.cost_usd,
    credits,
    timestamp,
  })

  invalidateStatsCache()
  return { success: true, cost_usd: shouldZeroUsageCost(record.model) ? 0 : record.cost_usd, id: existing.id, duplicate: true, project_backfilled: false }
}

/** Remove legacy Codex rows created before a session declared any model. */
export function removeUnknownCodexUsageRecords(): number {
  const db = getDb()
  return db.prepare(`DELETE FROM usage_records WHERE source = 'codex' AND model = 'unknown-codex'`).run().changes
}

/**
 * A VibeCafé row is a daily aggregate. When the same source, model, and local
 * day is already present in a raw local log, retain the raw events only. Keep
 * aggregates for days absent from the local scanner so historical coverage is
 * not lost.
 */
/**
 * True when a non-aggregate row already covers this source, model, and local
 * day. VibeCafé daily buckets should not be inserted in that case.
 */
export function hasRawUsageOnLocalDay(source: string, model: string, timestamp: number): boolean {
  const db = getDb()
  const row = db.prepare(`
    SELECT 1 AS hit
    FROM usage_records
    WHERE is_aggregate = 0
      AND source = ?
      AND model = ?
      AND ${localDayExpr('timestamp')} = ${localDayExpr('?')}
    LIMIT 1
  `).get(source, model, timestamp) as { hit: number } | undefined
  return !!row
}

export function removeOverlappingAggregateUsageRecords(): number {
  const db = getDb()
  return db.prepare(`
    DELETE FROM usage_records AS aggregate_row
    WHERE aggregate_row.is_aggregate = 1
      AND EXISTS (
        SELECT 1
        FROM usage_records AS local_row
        WHERE local_row.is_aggregate = 0
          AND local_row.source = aggregate_row.source
          AND local_row.model = aggregate_row.model
          AND ${localDayExpr('local_row.timestamp')} =
              ${localDayExpr('aggregate_row.timestamp')}
      )
  `).run().changes
}

/**
 * Remove the legacy whole-conversation Antigravity row once its per-event rows
 * have been written, so the same tokens are not counted twice. Conversations
 * whose brain directory no longer exists never reach the scanner and keep
 * their frozen legacy row.
 */
export function deleteAntigravityConversationRow(convId: string): boolean {
  const db = getDb()
  const result = db.prepare(`
    DELETE FROM usage_records
    WHERE request_id = ?
      AND source = 'antigravity'
  `).run(`antigravity-${convId}`)
  return result.changes > 0
}

/** 清理指定会话的旧有整段行与逐事件行，以便重新同步入库 */
export function cleanAntigravityConversationRecords(convId: string): number {
  const db = getDb()
  const result = db.prepare(`
    DELETE FROM usage_records
    WHERE (request_id = ? OR request_id = ? OR request_id LIKE ?)
      AND source = 'antigravity'
  `).run(`antigravity-${convId}`, `antigravity:${convId}`, `antigravity:${convId}:%`)
  return result.changes
}

function normalizeProjectName(project?: string): string {
  const value = project?.trim()
  return value || 'unknown'
}

/** Coerce token counts to non-negative integers (floor floats, treat NaN as 0). */
function sanitizeTokenCount(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

function backfillProjectForExistingRecord(db: Database.Database, id: number, existingProject: string, nextProject: string): boolean {
  if (existingProject !== 'unknown' || nextProject === 'unknown') return false
  const result = db.prepare('UPDATE usage_records SET project = ? WHERE id = ? AND project = ?').run(nextProject, id, 'unknown')
  return result.changes > 0
}

export function backfillProjectByRequestPrefix(requestPrefix: string, project?: string): number {
  const normalizedProject = normalizeProjectName(project)
  if (!requestPrefix || normalizedProject === 'unknown') return 0

  const db = getDb()
  const result = db.prepare(`
    UPDATE usage_records
    SET project = ?
    WHERE request_id LIKE ?
      AND project = 'unknown'
  `).run(normalizedProject, `${requestPrefix}%`)
  return result.changes
}

/** 按 request_id 纠正 project（用于历史误标，如会话 cwd 与真实项目文件夹不一致） */
export function correctProjectByRequestId(requestId: string, project?: string): boolean {
  const normalizedProject = normalizeProjectName(project)
  if (!requestId || normalizedProject === 'unknown') return false

  const db = getDb()
  const result = db.prepare(`
    UPDATE usage_records
    SET project = ?
    WHERE request_id = ?
      AND project != ?
  `).run(normalizedProject, requestId, normalizedProject)
  return result.changes > 0
}

export function normalizeStoredProjectNames(normalize: (project: string) => string): number {
  const db = getDb()
  const projects = db.prepare('SELECT DISTINCT project FROM usage_records').all() as { project: string }[]
  const update = db.prepare('UPDATE usage_records SET project = ? WHERE project = ?')
  let changed = 0

  for (const { project } of projects) {
    const normalizedProject = normalize(project)
    if (normalizedProject && normalizedProject !== project) {
      changed += update.run(normalizedProject, project).changes
    }
  }

  return changed
}

// ─── 查询用量明细 ─────────────────────────────────────────────

export function queryUsageRecords(filters: FilterParams, options: UsageQueryOptions = {}) {
  const db = getDb()
  const { sql, params } = buildWhere('', filters)
  const limit = Math.min(100, Math.max(1, options.limit ?? 10))
  const offset = Math.max(0, options.offset ?? 0)
  return db.prepare(`SELECT * FROM usage_records ${sql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
}

export function countUsageRecords(filters: FilterParams) {
  const db = getDb()
  const { sql, params } = buildWhere('', filters)
  const row = db.prepare(`SELECT COUNT(*) as total FROM usage_records ${sql}`).get(...params) as { total: number }
  return row.total
}

// ─── 聚合统计 ─────────────────────────────────────────────────

export function getAggregatedStats(allFilters: FilterParams) {
  const db = getDb()
  // Measured/estimated split is fixed below; a caller's kind filter would
  // otherwise zero out one side.
  const filters: FilterParams = { ...allFilters, kind: undefined }

  // Measured rows only. Estimated rows (Antigravity chars/3.5, TraeWork scans)
  // are returned separately and must not inflate the headline numbers.
  const base = buildWhere('', filters, { measuredOnly: true })
  const joined = buildWhere('u', filters, { measuredOnly: true })
  const estimateBase = buildWhere('', filters)

  // 总体统计（仅 estimated = 0）
  const overall = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens + cached_input_tokens + output_tokens + reasoning_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as total_cost_usd,
      COUNT(*) as total_requests
    FROM usage_records ${base.sql}
  `).get(...base.params) as { total_tokens: number; total_cost_usd: number; total_requests: number }

  // 按来源分组
  const bySource = db.prepare(`
    SELECT
      source,
      COALESCE(SUM(input_tokens + cached_input_tokens + output_tokens + reasoning_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      COUNT(*) as count
    FROM usage_records ${base.sql}
    GROUP BY source
    ORDER BY total_tokens DESC
  `).all(...base.params) as { source: string; total_tokens: number; cost_usd: number; count: number }[]

  // 按模型分组（JOIN pricing 表获取显示名称）
  const byModel = db.prepare(`
    SELECT
      u.model,
      COALESCE(mp.display_name, u.model) as display_name,
      COALESCE(SUM(u.input_tokens + u.cached_input_tokens + u.output_tokens + u.reasoning_tokens), 0) as total_tokens,
      COALESCE(SUM(u.cost_usd), 0) as cost_usd,
      COUNT(*) as count
    FROM usage_records u
    LEFT JOIN model_pricing mp ON u.model = mp.model_id
    ${joined.sql} AND u.is_internal = 0
    GROUP BY u.model
    ORDER BY total_tokens DESC
  `).all(...joined.params) as { model: string; display_name: string; total_tokens: number; cost_usd: number; count: number }[]

  const byProject = db.prepare(`
    SELECT
      project,
      COALESCE(SUM(input_tokens + cached_input_tokens + output_tokens + reasoning_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      COUNT(*) as count
    FROM usage_records ${base.sql}
    GROUP BY project
    ORDER BY total_tokens DESC
  `).all(...base.params) as { project: string; total_tokens: number; cost_usd: number; count: number }[]

  // 按日分组。SQLite date() 是 UTC；偏移量跟随本机时区（可配置）。
  // ROUND() 避免整数除法把午夜边界归入前一天。
  const daily = db.prepare(`
    SELECT
      ${localDayExpr('timestamp')} as date,
      COALESCE(SUM(input_tokens + cached_input_tokens + output_tokens + reasoning_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      COUNT(*) as count
    FROM usage_records ${base.sql}
    GROUP BY date
    ORDER BY date ASC
  `).all(...base.params) as { date: string; total_tokens: number; cost_usd: number; count: number }[]

  // 估算汇总（不进入主数字）
  const estimateOnly = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens + cached_input_tokens + output_tokens + reasoning_tokens), 0) as estimated_tokens,
      COALESCE(SUM(cost_usd), 0) as estimated_cost_usd,
      COUNT(*) as estimated_requests
    FROM usage_records ${estimateBase.sql} AND estimated = 1
  `).get(...estimateBase.params) as { estimated_tokens: number; estimated_cost_usd: number; estimated_requests: number }

  const estimatedBySource = db.prepare(`
    SELECT
      source,
      COALESCE(SUM(input_tokens + cached_input_tokens + output_tokens + reasoning_tokens), 0) as total_tokens
    FROM usage_records ${estimateBase.sql} AND estimated = 1
    GROUP BY source
    ORDER BY total_tokens DESC
  `).all(...estimateBase.params) as { source: string; total_tokens: number }[]

  // Cursor model families, still measured rows only (estimated = 0).
  const cursorModels = db.prepare(`
    SELECT
      model,
      COALESCE(SUM(input_tokens + cached_input_tokens + output_tokens + reasoning_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      COUNT(*) as count
    FROM usage_records ${base.sql} AND source = 'cursor'
    GROUP BY model
  `).all(...base.params) as { model: string; total_tokens: number; cost_usd: number; count: number }[]

  const cursorGroups = { named: emptyGroup(), own: emptyGroup(), grok: emptyGroup() }
  for (const row of cursorModels) {
    const bucket = cursorModelGroup(row.model)
    const target = cursorGroups[bucket]
    target.total_tokens += row.total_tokens
    target.cost_usd += row.cost_usd
    target.count += row.count
  }

  // 日均计算：用实际有数据的天数，避免新用户第一天看到被稀释的值
  const activeDays = daily.length || 1

  return {
    total_tokens: overall.total_tokens,
    total_cost_usd: overall.total_cost_usd,
    total_requests: overall.total_requests,
    estimated_tokens: estimateOnly.estimated_tokens,
    estimated_cost_usd: estimateOnly.estimated_cost_usd,
    estimated_requests: estimateOnly.estimated_requests,
    estimated_by_source: estimatedBySource,
    cursor_groups: cursorGroups,
    avg_daily_tokens: Math.round(overall.total_tokens / activeDays),
    avg_daily_cost_usd: Math.round((overall.total_cost_usd / activeDays) * 100) / 100,
    by_source: bySource,
    by_model: byModel,
    by_project: byProject,
    daily,
  }
}

function emptyGroup(): { total_tokens: number; cost_usd: number; count: number } {
  return { total_tokens: 0, cost_usd: 0, count: 0 }
}

/** auto / composer-* bill against Cursor's own pool; grok-bot-* is the included Grok subscription. */
export function cursorModelGroup(model: string): 'own' | 'grok' | 'named' {
  const id = model.toLowerCase()
  if (id === 'auto' || id.startsWith('composer')) return 'own'
  if (id.startsWith('grok-bot') || id.startsWith('cursor-grok')) return 'grok'
  return 'named'
}

// ─── 价格查询 ─────────────────────────────────────────────────

export function getModelPricing(modelId: string) {
  const db = getDb()
  return db.prepare('SELECT * FROM model_pricing WHERE model_id = ?').get(modelId) as {
    input_price_per_1m: number
    cached_input_price_per_1m: number
    output_price_per_1m: number
    reasoning_price_per_1m: number
  } | undefined
}

export function getAllPricing() {
  const db = getDb()
  return db.prepare('SELECT * FROM model_pricing ORDER BY provider, model_id').all()
}

/** Placeholder / fixture model ids that should not appear in the pricing table. */
const JUNK_AUTO_PRICING_MODELS = new Set([
  'auto',
  'seed_m8',
  'stealth/ox-alpha',
  'test',
  'test-jsonl-model',
  'test-model',
  'verify-model',
  'unknown-codex',
])

export function isJunkAutoPricingModel(model: string): boolean {
  const id = String(model || '').trim().toLowerCase()
  if (!id) return true
  if (JUNK_AUTO_PRICING_MODELS.has(id)) return true
  return id === 'test' || id.startsWith('test-') || id.startsWith('test_') || id.startsWith('verify-') || id.startsWith('verify_')
}

/**
 * Cursor 账单里的 grok-bot-*：套餐附带的 Grok Bot，只记用量、不算美元金额。
 * （OpenRouter 也没有这些模型；账单 totalCents 只是等值参考，不是实付。）
 */
export function isCursorGrokBotModel(model: string): boolean {
  return String(model || '').trim().toLowerCase().startsWith('grok-bot')
}

/** Models that must never contribute to cost_usd (junk fixtures + Cursor Grok Bot). */
export function shouldZeroUsageCost(model: string): boolean {
  return isJunkAutoPricingModel(model) || isCursorGrokBotModel(model)
}

/** Zero historical Cursor Grok Bot rows and wipe their list-price placeholders. */
export function zeroCursorGrokBotCosts(): { usage: number; pricing: number } {
  const db = getDb()
  const usage = db.prepare(`
    UPDATE usage_records
    SET cost_usd = 0
    WHERE lower(model) LIKE 'grok-bot%'
      AND cost_usd != 0
  `).run().changes
  const pricing = db.prepare(`
    UPDATE model_pricing
    SET input_price_per_1m = 0,
        cached_input_price_per_1m = 0,
        output_price_per_1m = 0,
        reasoning_price_per_1m = 0,
        updated_at = ?
    WHERE lower(model_id) LIKE 'grok-bot%'
      AND (input_price_per_1m != 0 OR cached_input_price_per_1m != 0
           OR output_price_per_1m != 0 OR reasoning_price_per_1m != 0)
  `).run(Date.now()).changes
  if (usage > 0 || pricing > 0) invalidateStatsCache()
  return { usage, pricing }
}

/** Ensure placeholder / fixture / invalid model names never accrue billed costs. */
export function zeroJunkModelUsageCosts(): number {
  const db = getDb()
  const ids = [...JUNK_AUTO_PRICING_MODELS]
  const placeholders = ids.map(() => '?').join(', ')
  return db.prepare(`
    UPDATE usage_records
    SET cost_usd = 0
    WHERE (model IN (${placeholders}) OR model LIKE 'test-%' OR model LIKE 'test_%' OR model LIKE 'verify-%' OR model LIKE 'verify_%')
      AND cost_usd != 0
  `).run(...ids).changes
}

/** Remove fixture pricing rows and synthetic hermes test usage. */
export function deleteJunkTestPricing(): { pricing: number; usage: number } {
  const db = getDb()
  const ids = [...JUNK_AUTO_PRICING_MODELS]
  const placeholders = ids.map(() => '?').join(', ')
  const pricing = db.prepare(`DELETE FROM model_pricing WHERE model_id IN (${placeholders})`).run(...ids)
  const usage = db.prepare(
    `DELETE FROM usage_records
     WHERE model IN (${placeholders})
       AND source = 'hermes'
       AND project = 'unknown'`,
  ).run(...ids)
  return { pricing: pricing.changes, usage: usage.changes }
}

export function upsertModelPricing(pricing: {
  model_id: string
  display_name: string
  provider: string
  input_price_per_1m: number
  cached_input_price_per_1m?: number
  output_price_per_1m: number
  reasoning_price_per_1m?: number
}) {
  const db = getDb()
  return db.prepare(`
    INSERT INTO model_pricing (model_id, display_name, provider, input_price_per_1m, cached_input_price_per_1m, output_price_per_1m, reasoning_price_per_1m)
    VALUES (@model_id, @display_name, @provider, @input_price_per_1m, @cached_input_price_per_1m, @output_price_per_1m, @reasoning_price_per_1m)
    ON CONFLICT(model_id) DO UPDATE SET
      display_name = @display_name,
      provider = @provider,
      input_price_per_1m = @input_price_per_1m,
      cached_input_price_per_1m = @cached_input_price_per_1m,
      output_price_per_1m = @output_price_per_1m,
      reasoning_price_per_1m = @reasoning_price_per_1m,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    cached_input_price_per_1m: 0,
    reasoning_price_per_1m: 0,
    ...pricing,
  })
}

// ─── 配置读写 ─────────────────────────────────────────────────

export function getConfig(key: string): string | undefined {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function setConfig(key: string, value: string): void {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(key, value)
}

export function deleteConfig(key: string): void {
  const db = getDb()
  db.prepare('DELETE FROM app_config WHERE key = ?').run(key)
}

// ─── 账号额度快照 ─────────────────────────────────────────────
// 只保存规范化后的额度快照（无凭证、无邮箱、无完整账号/团队 ID）。

export interface QuotaSnapshotRow {
  provider: string
  snapshot_json: string
  fetched_at: number | null
  last_success_at: number | null
  last_error_code: string | null
}

export function loadQuotaSnapshotRows(): QuotaSnapshotRow[] {
  const db = getDb()
  return db
    .prepare('SELECT provider, snapshot_json, fetched_at, last_success_at, last_error_code FROM quota_snapshots')
    .all() as QuotaSnapshotRow[]
}

export function saveQuotaSnapshotRows(rows: QuotaSnapshotRow[]): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO quota_snapshots (provider, snapshot_json, fetched_at, last_success_at, last_error_code)
    VALUES (@provider, @snapshot_json, @fetched_at, @last_success_at, @last_error_code)
    ON CONFLICT(provider) DO UPDATE SET
      snapshot_json = @snapshot_json,
      fetched_at = @fetched_at,
      last_success_at = @last_success_at,
      last_error_code = @last_error_code
  `)
  const write = db.transaction(() => {
    for (const row of rows) stmt.run(row)
  })
  write()
}
