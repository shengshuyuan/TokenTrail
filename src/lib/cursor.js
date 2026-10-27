/**
 * TokenTrail — Cursor 用量接入
 *
 * Cursor 不在本地落盘逐次调用的 token 用量，真实账单只存在于官方后台。
 * 本模块复用本机 Cursor 已登录的会话（state.vscdb 里的 cursorAuth/accessToken），
 * 以只读方式调用 cursor.com 的用量接口：
 * - POST /api/dashboard/get-filtered-usage-events：逐次调用的模型、token、费用
 * - GET  /api/usage-summary：当前计费周期的套餐额度（供额度中心使用）
 *
 * 设计约束:
 * - 只读打开 Cursor 数据库，绝不写入；凭证只在内存里使用，不落盘、不进日志
 * - 口径:Cursor 的 inputTokens 不含缓存，cacheRead/cacheWrite 单独给出，
 *   与 Claude Code 一致：cache write 计入 input，cache read 计入 cached_input
 * - 费用:优先使用 Cursor 账单里的 totalCents（真实金额），没有时才回退到定价表
 * - 幂等:request_id = cursor:<timestamp>:<conversationId>:<model>，重复同步由唯一索引去重
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3')
const { codedError, requestJson } = require('./quotas/http.js')
const { detectZcodeProvider } = require('./zcode.js')

const CURSOR_API_BASE = 'https://cursor.com'
const USAGE_EVENTS_URL = `${CURSOR_API_BASE}/api/dashboard/get-filtered-usage-events`
const USAGE_SUMMARY_URL = `${CURSOR_API_BASE}/api/usage-summary`

/** 首次同步回溯的时长（官方接口会自行截断到账号真实存在的历史）。 */
const FULL_HISTORY_MS = 10 * 365 * 24 * 3600 * 1000
/** 增量同步时向前多拉的时长：容纳晚到的账单事件，重复部分由 request_id 去重。 */
const INCREMENTAL_OVERLAP_MS = 6 * 3600 * 1000
const PAGE_SIZE = 500
const MAX_PAGES = 100
const REQUEST_TIMEOUT_MS = 15000

/** Cursor 全局状态库位置（与 VS Code 系 IDE 一致，按平台区分）。 */
function cursorStateDbCandidates(home = os.homedir(), platform = process.platform, env = process.env) {
  const rel = ['User', 'globalStorage', 'state.vscdb']
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Cursor', ...rel)]
  if (platform === 'win32') {
    return [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', ...rel)]
  }
  return [path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Cursor', ...rel)]
}

function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1]
    if (!part) return null
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf-8'))
  } catch {
    return null
  }
}

/**
 * 读取本机 Cursor 登录态。
 * 返回 { ok: true, accessToken, userId, expiresAt } 或
 * { ok: false, reason: 'not_installed' | 'unreadable' | 'not_logged_in' | 'expired' }。
 */
function readCursorSession(options = {}) {
  const now = options.now ?? Date.now()
  const dbPath = options.dbPath || cursorStateDbCandidates(options.home || os.homedir()).find((p) => fs.existsSync(p))
  if (!dbPath || !fs.existsSync(dbPath)) return { ok: false, reason: 'not_installed' }

  let token = ''
  let db
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'").get()
    token = row && row.value != null ? String(row.value).trim() : ''
  } catch {
    return { ok: false, reason: 'unreadable' }
  } finally {
    if (db) db.close()
  }

  if (!token) return { ok: false, reason: 'not_logged_in' }
  const payload = decodeJwtPayload(token)
  const sub = payload && typeof payload.sub === 'string' ? payload.sub : ''
  // sub 形如 "google-oauth2|user_01..."，会话 Cookie 需要的是竖线后的用户 ID
  const userId = sub.split('|').pop()
  if (!userId) return { ok: false, reason: 'not_logged_in' }
  const expiresAt = Number.isFinite(payload.exp) ? payload.exp * 1000 : null
  if (expiresAt && expiresAt <= now) return { ok: false, reason: 'expired', expiresAt }
  return { ok: true, accessToken: token, userId, expiresAt }
}

/** cursor.com 网页后台使用的会话 Cookie 形式。 */
function cursorRequestHeaders(session) {
  return {
    Cookie: `WorkosCursorSessionToken=${session.userId}%3A%3A${session.accessToken}`,
    Origin: CURSOR_API_BASE,
    Referer: `${CURSOR_API_BASE}/dashboard`,
    'Content-Type': 'application/json',
  }
}

/** 分页拉取 [startMs, endMs] 内的全部用量事件（接口按时间倒序返回）。 */
async function fetchCursorUsageEvents(session, options = {}) {
  const {
    startMs,
    endMs = Date.now(),
    fetchImpl = (...args) => fetch(...args),
    timeoutMs = REQUEST_TIMEOUT_MS,
    pageSize = PAGE_SIZE,
    maxPages = MAX_PAGES,
    deadline,
  } = options
  const headers = cursorRequestHeaders(session)
  const events = []
  let total = null
  let truncated = false
  for (let page = 1; page <= maxPages; page++) {
    if (typeof deadline === 'number' && Date.now() > deadline) {
      truncated = true
      break
    }
    const { json } = await requestJson(USAGE_EVENTS_URL, {
      method: 'POST',
      headers,
      body: { startDate: String(startMs), endDate: String(endMs), page, pageSize },
      timeoutMs,
      fetchImpl,
    })
    const list = json && Array.isArray(json.usageEventsDisplay) ? json.usageEventsDisplay : null
    if (!list) throw codedError('unsupported_version', 'unexpected cursor usage events response')
    events.push(...list)
    total = Number(json.totalUsageEventsCount)
    const reported = Number.isFinite(total) ? total : null
    if (list.length < pageSize || (reported != null && events.length >= reported)) break
    if (page === maxPages) truncated = true
  }
  return { events, total: Number.isFinite(total) ? total : null, truncated }
}

function tokenCount(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function detectCursorProvider(model) {
  return detectZcodeProvider(model) || 'cursor'
}

/** Cursor 用量接口对 Auto 模式返回字面量 "default"，官网后台显示为 Auto。 */
const CURSOR_MODEL_ALIASES = { default: 'auto' }

function displayCursorModel(rawModel) {
  return CURSOR_MODEL_ALIASES[rawModel.toLowerCase()] || rawModel
}

/**
 * ~/.cursor/projects/<工作区路径 slug>/agent-transcripts/<conversationId>
 * → conversationId 到项目名的映射。slug 由工作区绝对路径把分隔符换成 "-" 得到，
 * 取最后一段作为项目名；被截断成哈希、临时目录或纯数字的 slug 无法还原，跳过。
 */
function projectFromCursorSlug(slug) {
  if (!slug || slug === 'empty-window' || /^\d+$/.test(slug) || slug.startsWith('var-folders-')) return undefined
  const last = slug.split('-').pop().trim()
  if (!last || /^[0-9a-f]{7}$/.test(last)) return undefined
  return last
}

function loadCursorConversationProjects(home = os.homedir()) {
  const map = new Map()
  const root = path.join(home, '.cursor', 'projects')
  let dirs
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return map
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const project = projectFromCursorSlug(dir.name)
    if (!project) continue
    let entries
    try {
      entries = fs.readdirSync(path.join(root, dir.name, 'agent-transcripts'))
    } catch {
      continue
    }
    for (const entry of entries) map.set(entry.replace(/\.jsonl$/, ''), project)
  }
  return map
}

/**
 * 单条 Cursor 用量事件 → TokenTrail 用量记录。
 * 没有 tokenUsage（按次计费的旧事件）或 token 全为 0 时返回 null，绝不写 0。
 */
function mapCursorUsageEvent(event, projectByConversation) {
  const usage = event && event.tokenUsage
  if (!usage || typeof usage !== 'object') return null
  const timestamp = Number(event.timestamp)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null

  const input_tokens = tokenCount(usage.inputTokens) + tokenCount(usage.cacheWriteTokens)
  const cached_input_tokens = tokenCount(usage.cacheReadTokens)
  const output_tokens = tokenCount(usage.outputTokens)
  if (input_tokens === 0 && cached_input_tokens === 0 && output_tokens === 0) return null

  const rawModel = typeof event.model === 'string' && event.model.trim() ? event.model.trim() : 'cursor-unknown'
  const model = displayCursorModel(rawModel)
  const conversationId = typeof event.conversationId === 'string' ? event.conversationId : ''
  // grok-bot-* = Cursor 套餐附带的 Grok Bot：只记 token，不算美元（账单 totalCents 只是等值）
  const isGrokBot = model.toLowerCase().startsWith('grok-bot')
  const cents = Number(usage.totalCents)
  const record = {
    source: 'cursor',
    provider: detectCursorProvider(model),
    model,
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_tokens: 0,
    cost_usd: isGrokBot ? 0 : (Number.isFinite(cents) && cents >= 0 ? cents / 100 : null),
    // request_id 必须沿用接口原始模型名，否则已入库的记录会在增量重叠窗口里重复写入
    request_id: `cursor:${Math.trunc(timestamp)}:${conversationId || '-'}:${rawModel}`,
    timestamp: Math.trunc(timestamp),
  }
  const project = conversationId && projectByConversation ? projectByConversation.get(conversationId) : undefined
  if (project) record.project = project
  return record
}

const FAILURE_MESSAGES = {
  unreadable: '无法读取 Cursor 本地登录信息',
  expired: 'Cursor 登录已过期，请打开 Cursor 重新登录后再同步',
  auth: 'Cursor 拒绝了本机登录凭证，请在 Cursor 中重新登录后再同步',
  rate_limited: 'Cursor 用量接口限流，稍后会自动重试',
  unsupported_version: 'Cursor 用量接口格式发生变化，当前版本无法解析',
}

/**
 * 拉取 Cursor 用量记录。
 * - latestSyncedAt：库里已有 Cursor 记录的最新时间戳；有则增量，无则全量
 * 返回 { ok: true, records, events } 或
 * { ok: false, reason, message }（reason 为 not_installed / not_logged_in 时表示用户没在用 Cursor）。
 */
async function collectCursorUsageRecords(options = {}) {
  const now = options.now ?? Date.now()
  const home = options.home || os.homedir()
  const session = options.session || readCursorSession({ home, dbPath: options.dbPath, now })
  if (!session.ok) {
    return { ok: false, reason: session.reason, message: FAILURE_MESSAGES[session.reason] }
  }

  const startMs = Number.isFinite(options.latestSyncedAt) && options.latestSyncedAt > 0
    ? options.latestSyncedAt - INCREMENTAL_OVERLAP_MS
    : now - FULL_HISTORY_MS

  let fetched
  try {
    fetched = await fetchCursorUsageEvents(session, {
      startMs,
      endMs: now,
      fetchImpl: options.fetchImpl,
      pageSize: options.pageSize,
      deadline: options.deadline,
    })
  } catch (err) {
    const code = err && typeof err.code === 'string' ? err.code : 'network'
    return { ok: false, reason: code, message: FAILURE_MESSAGES[code] || `连接 Cursor 用量接口失败（${code}）` }
  }

  const projects = loadCursorConversationProjects(home)
  const seen = new Set()
  const records = []
  const events = fetched.events
  for (const event of events) {
    const record = mapCursorUsageEvent(event, projects)
    if (!record || seen.has(record.request_id)) continue
    seen.add(record.request_id)
    records.push(record)
  }
  return {
    ok: true,
    records,
    events: events.length,
    total: fetched.total,
    truncated: fetched.truncated,
  }
}

module.exports = {
  CURSOR_API_BASE,
  USAGE_EVENTS_URL,
  USAGE_SUMMARY_URL,
  INCREMENTAL_OVERLAP_MS,
  cursorStateDbCandidates,
  readCursorSession,
  cursorRequestHeaders,
  fetchCursorUsageEvents,
  mapCursorUsageEvent,
  displayCursorModel,
  projectFromCursorSlug,
  loadCursorConversationProjects,
  collectCursorUsageRecords,
}

if (require.main === module) {
  collectCursorUsageRecords().then((result) => {
    if (!result.ok) {
      console.log(`  ✗ Cursor 用量读取跳过: ${result.message || result.reason}`)
      return
    }
    console.log(`  ✓ Cursor 用量接口返回 ${result.events} 条事件，其中 ${result.records.length} 条带 token 用量`)
  })
}
