import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

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
      cost_usd REAL NOT NULL DEFAULT 0,
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
  `)

  ensureUsageRecordsProjectColumn(_db)
  ensureUsageRecordsProviderColumn(_db)
  ensureUsageRecordsTimestampValues(_db)
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

function normalizeStoredTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed)
    return Number.isFinite(numeric) ? Math.trunc(numeric) : null
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
}

interface UsageQueryOptions {
  limit?: number
  offset?: number
}

/**
 * 构建 WHERE 子句 + 参数。
 * @param alias 表别名（空字符串表示不使用别名，如 'u' 表示 usage_records u）
 */
function buildWhere(alias: string, filters: FilterParams): { sql: string; params: (string | number)[] } {
  const col = (name: string) => alias ? `${alias}.${name}` : name
  const conditions: string[] = []
  const params: (string | number)[] = []

  conditions.push(`${col('timestamp')} >= ?`)
  params.push(filters.startDate)

  conditions.push(`${col('timestamp')} <= ?`)
  params.push(filters.endDate)

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

function normalizeSource(source: string): string {
  return SOURCE_ALIASES[source.toLowerCase()] || source
}

// ─── 插入用量记录 ─────────────────────────────────────────────

export function insertUsageRecord(record: {
  source: string
  provider?: string
  project?: string
  model: string
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cost_usd: number
  request_id?: string
  timestamp: number
}) {
  const db = getDb()
  const source = normalizeSource(record.source)
  const project = normalizeProjectName(record.project)
  const provider = record.provider || null

  // 拒绝全部 token 为 0 的记录，避免污染统计数据
  if (record.input_tokens === 0 && record.output_tokens === 0 && record.cached_input_tokens === 0 && record.reasoning_tokens === 0) {
    return { success: false, cost_usd: 0, id: 0, duplicate: false, project_backfilled: false }
  }

  if (record.request_id) {
    const existing = db.prepare('SELECT id, project FROM usage_records WHERE request_id = ?').get(record.request_id) as { id: number; project: string } | undefined
    if (existing) {
      const projectBackfilled = backfillProjectForExistingRecord(db, existing.id, existing.project, project)
      return { success: true, cost_usd: 0, id: existing.id, duplicate: true, project_backfilled: projectBackfilled }
    }
  }

  const stmt = db.prepare(`
    INSERT INTO usage_records (source, provider, project, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, cost_usd, request_id, timestamp)
    VALUES (@source, @provider, @project, @model, @input_tokens, @cached_input_tokens, @output_tokens, @reasoning_tokens, @cost_usd, @request_id, @timestamp)
    ON CONFLICT(request_id) WHERE request_id IS NOT NULL DO NOTHING
  `)

  const result = stmt.run({ ...record, source, provider, project })

  // changes === 0 表示因唯一约束冲突被忽略（即重复）
  if (result.changes === 0 && record.request_id) {
    return { success: true, cost_usd: 0, id: 0, duplicate: true, project_backfilled: false }
  }

  return { success: true, cost_usd: record.cost_usd, id: result.lastInsertRowid as number, duplicate: false, project_backfilled: false }
}

function normalizeProjectName(project?: string): string {
  const value = project?.trim()
  return value || 'unknown'
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

export function getAggregatedStats(filters: FilterParams) {
  const db = getDb()

  const base = buildWhere('', filters)
  const joined = buildWhere('u', filters)

  // 总体统计
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
    ${joined.sql}
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

  // 按日分组
  // 注意：SQLite date() 使用 UTC 时区。对于中国时区(UTC+8)，需要加上 8 小时偏移。
  // 使用 ROUND() 避免整数除法截断导致午夜边界记录归入前一天
  const daily = db.prepare(`
    SELECT
      date(ROUND((timestamp + 28800000) / 1000), 'unixepoch') as date,
      COALESCE(SUM(input_tokens + cached_input_tokens + output_tokens + reasoning_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      COUNT(*) as count
    FROM usage_records ${base.sql}
    GROUP BY date
    ORDER BY date ASC
  `).all(...base.params) as { date: string; total_tokens: number; cost_usd: number; count: number }[]

  // 日均计算：用实际有数据的天数，避免新用户第一天看到被稀释的值
  const activeDays = daily.length || 1

  return {
    total_tokens: overall.total_tokens,
    total_cost_usd: overall.total_cost_usd,
    total_requests: overall.total_requests,
    avg_daily_tokens: Math.round(overall.total_tokens / activeDays),
    avg_daily_cost_usd: Math.round((overall.total_cost_usd / activeDays) * 100) / 100,
    by_source: bySource,
    by_model: byModel,
    by_project: byProject,
    daily,
  }
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
