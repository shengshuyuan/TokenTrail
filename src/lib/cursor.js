/**
 * TokenTrail — Cursor 用量接入
 *
 * Cursor 不在本地落盘逐次调用的 token 用量，真实账单只存在于官方后台。
 * 本模块复用本机 Cursor 已登录的会话。优先读桌面版 state.vscdb 里的
 * cursorAuth/accessToken；桌面版数据目录不在时，改读命令行登录存在
 * 钥匙串里的 cursor-access-token。
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
const { execFileSync } = require('child_process')
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

/** 把 access token 解析成会话。解析不了返回 null，过期返回 expired。 */
function sessionFromAccessToken(token, now) {
  const payload = decodeJwtPayload(token)
  const sub = payload && typeof payload.sub === 'string' ? payload.sub : ''
  // sub 形如 "google-oauth2|user_01..."，会话 Cookie 需要的是竖线后的用户 ID
  const userId = sub.split('|').pop()
  if (!userId) return null
  const expiresAt = Number.isFinite(payload.exp) ? payload.exp * 1000 : null
  if (expiresAt && expiresAt <= now) return { ok: false, reason: 'expired', expiresAt }
  return { ok: true, accessToken: String(token).trim(), userId, expiresAt }
}

/**
 * Cursor 命令行（cursor-agent）把登录令牌放在 macOS 钥匙串，不写 state.vscdb。
 * 读不到或当前系统不是 macOS 时返回空字符串，绝不抛出。
 */
const KEYCHAIN_TTL_MS = 60_000
let keychainCache = { at: 0, token: '' }

function readKeychainAccessToken() {
  if (process.platform !== 'darwin') return ''
  const now = Date.now()
  if (now - keychainCache.at < KEYCHAIN_TTL_MS) return keychainCache.token
  let token = ''
  try {
    token = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'cursor-access-token', '-a', 'cursor-user', '-w'],
      { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    token = ''
  }
  keychainCache = { at: now, token }
  return token
}

/**
 * 读取本机 Cursor 登录态。
 * 返回 { ok: true, accessToken, userId, expiresAt } 或
 * { ok: false, reason: 'not_installed' | 'unreadable' | 'not_logged_in' | 'expired' }。
 * 显式传入 dbPath 时只看那个库，方便测试；平时库不在就改问钥匙串。
 */
function readCursorSession(options = {}) {
  const now = options.now ?? Date.now()
  const fromDb = readCursorSessionFromDb(options, now)
  if (fromDb.ok || options.dbPath) return fromDb
  const readKeychain = options.readKeychain || readKeychainAccessToken
  const token = readKeychain()
  if (!token) return fromDb
  return sessionFromAccessToken(token, now) || fromDb
}

function readCursorSessionFromDb(options, now) {
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
  return sessionFromAccessToken(token, now) || { ok: false, reason: 'not_logged_in' }
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
/** 接口里 Auto 模式的原始模型名；request_id 末段就是它。 */
const CURSOR_AUTO_RAW_MODEL = 'default'
/**
 * grok-bot-*（Cursor 套餐附带的 Grok Bot）单独一个来源。它不是 IDE / 命令行对话，
 * 本机没有任何对话存储或全文，底层模型无从得知；混在 Cursor 里会把真正用的模型淹没。
 */
/** Must match `CURSOR_GROK_BOT_SOURCE` in `src/lib/db.ts` (kept separate to avoid a db↔cursor import cycle). */
const CURSOR_GROK_BOT_SOURCE = 'cursor-grok-bot'

function displayCursorModel(rawModel) {
  return CURSOR_MODEL_ALIASES[rawModel.toLowerCase()] || rawModel
}

function isGrokBotModel(model) {
  return String(model || '').toLowerCase().startsWith('grok-bot')
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
  // grok-bot-* = Cursor 套餐附带的 Grok Bot：单独来源，只记 token，不算美元（账单 totalCents 只是等值）
  const isGrokBot = isGrokBotModel(model)
  const cents = Number(usage.totalCents)
  const record = {
    source: isGrokBot ? CURSOR_GROK_BOT_SOURCE : 'cursor',
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

// ───────────────────────── 本机模型补全（估算） ─────────────────────────
//
// 官方用量接口不一定列出所有调用：实测发现选了 Claude Opus / Sonnet 的对话在接口里常常一条记录都没有，
// 接口里只有 Grok Bot / Auto。真实模型的权威来源是 Cursor 命令行自己的对话存储：
//   ~/.cursor/chats/<工作区>/<conversationId>/store.db
// 每条助手回复的每一段都带 providerOptions.cursor.modelName（如 claude-sonnet-5-5-high），
// 而且 Auto 对话里也会写出底层真正跑的模型。
// （~/.cursor/ai-tracking/ai-code-tracking.db 的 model 字段不可靠：实测会把 Sonnet 对话标成 Opus，
//   所以只借它来分日期，不信它的模型名。）
// 对话全文在 ~/.cursor/projects/<slug>/agent-transcripts/<conversationId>/ 下。
//
// 这里只补「官方接口里完全没出现过的对话」，用对话里助手输出的字符量，按官方账单反推的系数估算 token，
// 记录一律标记 estimated，不进入实测合计，避免和官方数据重复；金额一律记 $0，只保留 token 用量。

/**
 * 估算系数，用本机 23 个「官方接口有完整账单」的对话反推（2026-11-07）：
 * - 输出：对话里助手文字+工具调用的字符数 ÷ 1.6 ≈ 官方输出 token（中位数 1.57，四分位 1.45～2.30；
 *   比常规的 3～4 字符/token 小，因为官方输出还含看不见的思考 token）。
 * - 缓存读取：每一轮都会重新读整个上下文，约为输出的 133 倍（四分位 87～166 倍）。
 * - 常规输入（含缓存写入）：约为输出的 6.4 倍（四分位 3.8～7.8 倍）。
 * 这些系数来自 Auto / Grok Bot 对话，用在 Claude 对话上有额外误差，所以记录始终标记为估算。
 */
const OUTPUT_CHARS_PER_TOKEN = 1.6
const CACHE_READ_PER_OUTPUT = 133
const FRESH_INPUT_PER_OUTPUT = 6.4
function trackingDbPath(home = os.homedir()) {
  return path.join(home, '.cursor', 'ai-tracking', 'ai-code-tracking.db')
}

function localDay(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 读本机追踪库：只取「某对话在哪些本地日期有多少次请求、最后活动时间」，用来把一个对话分摊到各天。
 * 返回 Map(conversationId → [{ day, requests, lastTs }])。库不存在、被锁或结构不符时返回空 Map，绝不抛出。
 */
function readLocalRequestDays(home = os.homedir()) {
  const map = new Map()
  const dbPath = trackingDbPath(home)
  if (!fs.existsSync(dbPath)) return map
  let db
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const rows = db.prepare(`
      SELECT conversationId AS conversationId,
             strftime('%Y-%m-%d', COALESCE(timestamp, createdAt) / 1000, 'unixepoch', 'localtime') AS day,
             COUNT(DISTINCT COALESCE(requestId, hash)) AS requests,
             MAX(COALESCE(timestamp, createdAt)) AS lastTs
      FROM ai_code_hashes
      WHERE conversationId IS NOT NULL AND conversationId != ''
      GROUP BY conversationId, day
    `).all()
    for (const row of rows) {
      if (!map.has(row.conversationId)) map.set(row.conversationId, [])
      map.get(row.conversationId).push({ day: row.day, requests: row.requests, lastTs: row.lastTs })
    }
  } catch {
    return new Map()
  } finally {
    if (db) db.close()
  }
  return map
}

/** 读过的对话存储缓存：文件没变就不再解析（大对话的 store.db 有几十 MB）。 */
const chatModelCache = new Map()

function statSignature(file) {
  let sig = ''
  for (const suffix of ['', '-wal']) {
    try {
      const st = fs.statSync(file + suffix)
      sig += `${st.size}:${Math.trunc(st.mtimeMs)};`
    } catch {
      sig += '-;'
    }
  }
  return sig
}

/**
 * 读一个对话存储，统计每个模型的助手输出量（段内容的字符数，不含 providerOptions）。解析失败返回 null。
 * 存储里 blob 有的是加密二进制（首字节不是 "{"），直接跳过。
 */
function readChatStoreModels(file) {
  const sig = statSignature(file)
  const cached = chatModelCache.get(file)
  if (cached && cached.sig === sig) return cached.models
  let db
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
    const models = new Map()
    for (const row of db.prepare('SELECT data FROM blobs').iterate()) {
      const data = row.data
      if (!Buffer.isBuffer(data) || data[0] !== 0x7b) continue
      let blob
      try {
        blob = JSON.parse(data.toString('utf8'))
      } catch {
        continue
      }
      if (!blob || blob.role !== 'assistant' || !Array.isArray(blob.content)) continue
      for (const part of blob.content) {
        const name = part && part.providerOptions && part.providerOptions.cursor && part.providerOptions.cursor.modelName
        if (typeof name === 'string' && name.trim()) {
          const { providerOptions, ...content } = part
          models.set(name.trim(), (models.get(name.trim()) || 0) + JSON.stringify(content).length)
        }
      }
    }
    chatModelCache.set(file, { sig, models })
    return models
  } catch {
    return null
  } finally {
    if (db) db.close()
  }
}

/** 目录名太泛、单独不能代表项目时，改用上一级目录名（如 .../Boss Think Twice/repo → Boss Think Twice）。 */
const GENERIC_DIR_NAMES = new Set(['repo', 'app', 'src', 'code', 'project', 'web', 'frontend', 'backend', 'main', 'workspace'])

function projectFromCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return undefined
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  let name = parts.pop()
  if (name && GENERIC_DIR_NAMES.has(name.toLowerCase()) && parts.length > 0) name = parts.pop()
  return name || undefined
}

/**
 * 读 ~/.cursor/chats 下全部对话：conversationId → { models: Map(模型名→输出字符数), updatedAtMs, cwd }。
 * 没有任何带模型名的回复段的对话不返回。
 */
function readCursorChatModels(home = os.homedir()) {
  const result = new Map()
  const root = path.join(home, '.cursor', 'chats')
  let workspaces
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return result
  }
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue
    let chats
    try {
      chats = fs.readdirSync(path.join(root, ws.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const chat of chats) {
      if (!chat.isDirectory()) continue
      const dir = path.join(root, ws.name, chat.name)
      const storeFile = path.join(dir, 'store.db')
      if (!fs.existsSync(storeFile)) continue
      const models = readChatStoreModels(storeFile)
      if (!models || models.size === 0) continue
      let updatedAtMs = 0
      let cwd
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
        updatedAtMs = Number(meta.updatedAtMs) || 0
        cwd = meta.cwd
      } catch {
        updatedAtMs = 0
      }
      if (!updatedAtMs) {
        try { updatedAtMs = Math.trunc(fs.statSync(storeFile).mtimeMs) } catch { updatedAtMs = Date.now() }
      }
      result.set(chat.name, { models, updatedAtMs, cwd })
    }
  }
  return result
}

/** conversationId → { file, project }：对话全文所在的 jsonl 与项目名。 */
function locateCursorTranscripts(home = os.homedir()) {
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
    const base = path.join(root, dir.name, 'agent-transcripts')
    let entries
    try {
      entries = fs.readdirSync(base)
    } catch {
      continue
    }
    for (const entry of entries) {
      const id = entry.replace(/\.jsonl$/, '')
      const file = entry.endsWith('.jsonl') ? path.join(base, entry) : path.join(base, entry, `${id}.jsonl`)
      if (fs.existsSync(file)) map.set(id, { file, project })
    }
  }
  return map
}

/** 数一个对话里助手输出的字符量（文字 + 工具调用；transcript 不含工具返回，也没有思考内容）。 */
function countTranscriptOutputChars(file) {
  let outputChars = 0
  let raw
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return outputChars
  }
  for (const line of raw.split('\n')) {
    if (!line) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const content = entry && entry.message && entry.message.content
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue
      const size = block.type === 'text' ? String(block.text || '').length : JSON.stringify(block).length
      if (entry.role !== 'user') outputChars += size
    }
  }
  return outputChars
}

/**
 * 生成「本机补全」的估算记录。
 * - coveredConversationIds：官方接口已有记录的对话 id，这些对话一律跳过
 * - 模型取自对话存储里每段回复的 modelName；一个对话用过几个模型就拆成几条，按各模型的输出字数占比分摊
 * - 日期取自本机追踪库的请求分布（没有则整个对话记在最后更新那天）
 * - request_id = cursor-local:<对话>:<模型>:<日期>，对话继续聊时重新同步会原地更新
 */
function collectCursorLocalModelRecords(options = {}) {
  const home = options.home || os.homedir()
  const covered = options.coveredConversationIds || new Set()
  // 允许调用方传入已读好的 chats，避免同一次同步里再扫一遍 ~/.cursor/chats
  const chats = options.chats || readCursorChatModels(home)
  if (chats.size === 0) return []

  const requestDays = readLocalRequestDays(home)
  const transcripts = locateCursorTranscripts(home)
  const records = []
  for (const [conversationId, chat] of chats) {
    if (covered.has(conversationId)) continue
    const located = transcripts.get(conversationId)
    if (!located) continue // 没有对话全文就没有估算依据，宁可不记也不写 0
    const outputChars = countTranscriptOutputChars(located.file)
    if (outputChars === 0) continue

    let days = requestDays.get(conversationId)
    if (!days || days.length === 0) days = [{ day: localDay(chat.updatedAtMs), requests: 1, lastTs: chat.updatedAtMs }]
    const totalRequests = days.reduce((sum, d) => sum + d.requests, 0) || 1
    const totalWeight = Array.from(chat.models.values()).reduce((sum, n) => sum + n, 0)

    for (const [model, weight] of chat.models) {
      for (const day of days) {
        const share = (weight / totalWeight) * (day.requests / totalRequests)
        const output_tokens = Math.round((outputChars * share) / OUTPUT_CHARS_PER_TOKEN)
        if (output_tokens === 0) continue
        const record = {
          source: 'cursor',
          provider: detectCursorProvider(model),
          model,
          input_tokens: Math.round(output_tokens * FRESH_INPUT_PER_OUTPUT),
          cached_input_tokens: Math.round(output_tokens * CACHE_READ_PER_OUTPUT),
          output_tokens,
          reasoning_tokens: 0,
          // 金额不估算：token 是按字数反推的，缓存读取的倍数尤其不可靠，没把握的金额一律记 $0，只保留用量
          cost_usd: 0,
          estimated: true,
          request_id: `cursor-local:${conversationId}:${model}:${day.day}`,
          timestamp: Math.trunc(day.lastTs),
        }
        const project = projectFromCwd(chat.cwd) || located.project
        if (project) record.project = project
        records.push(record)
      }
    }
  }
  return records
}

/** 从已入库的官方 request_id（cursor:<ts>:<对话>:<模型>）里取出对话 id。 */
function conversationIdFromOfficialRequestId(requestId) {
  const parts = String(requestId || '').split(':')
  return parts[0] === 'cursor' && parts.length >= 4 ? parts[2] : ''
}

// ───────────────────────── Auto 模式底层模型识别 ─────────────────────────
//
// 官方接口把 Auto 模式记成 "default"，不说底层跑的是哪个模型。但同一对话在本机对话存储里
// 每段回复都带真实模型名（实测 119 条 Auto 记录里 112 条能对上），所以可以把官方 Auto 记录改成真实模型：
// - 对话只用过一个底层模型：原地改名，request_id 不变，去重不受影响
// - 对话里 Auto 切换过多个模型：官方记录按请求汇总、本机存储又没有时间戳，对不上哪次请求用了哪个模型，
//   于是把原记录隐藏（is_internal=1，仍留作去重锚点），按各模型的输出占比拆成几条派生记录
//   （request_id = 原 id + "/" + 模型名）。token 总量不变，只是归到不同模型名下
// - 用户在同一对话里明确选过的模型（官方有具名记录）不会被当成 Auto 的候选
// - 对不上本机对话（比如桌面版 Cursor 的对话、grok-bot）的记录保持 "auto"

/** 官方 Auto 记录的 request_id：cursor:<ts>:<对话>:default */
function isCursorAutoRequestId(requestId) {
  const parts = String(requestId || '').split(':')
  return parts[0] === 'cursor' && parts.length === 4 && parts[3] === CURSOR_AUTO_RAW_MODEL
}

/** 拆分出来的派生记录 request_id：cursor:<ts>:<对话>:default/<模型> */
function isCursorAutoDerivedRequestId(requestId) {
  const s = String(requestId || '')
  return s.startsWith('cursor:') && s.includes(`:${CURSOR_AUTO_RAW_MODEL}/`)
}

/** 显示用：这条记录是不是 Auto 模式跑出来的（原记录或派生记录）。 */
function isCursorAutoRouted(requestId) {
  return isCursorAutoRequestId(requestId) || isCursorAutoDerivedRequestId(requestId)
}

/** 多模型对话里，输出占比低于这个值的模型视为噪音（Auto 偶尔切出去的一两段），不单独拆行。 */
const AUTO_MIN_MODEL_SHARE = 0.02

/**
 * 推断一个对话里 Auto 背后的模型。
 * @param localModels Map(模型名 → 输出字符数)，来自对话存储；没有就返回 []
 * @param explicitModels 该对话里官方有具名记录的模型（小写），优先排除
 * @returns [{ model, share }]，按占比降序，share 之和为 1
 */
function inferAutoModels(localModels, explicitModels = new Set()) {
  if (!localModels || localModels.size === 0) return []
  let candidates = Array.from(localModels, ([model, weight]) => ({ model: String(model).trim(), weight: Number(weight) || 0 }))
    .filter((c) => c.model && c.weight > 0)
  const implicit = candidates.filter((c) => !explicitModels.has(c.model.toLowerCase()))
  if (implicit.length > 0) candidates = implicit
  let total = candidates.reduce((sum, c) => sum + c.weight, 0)
  if (total <= 0) return []
  const kept = candidates.filter((c) => c.weight / total >= AUTO_MIN_MODEL_SHARE)
  if (kept.length > 0) candidates = kept
  total = candidates.reduce((sum, c) => sum + c.weight, 0)
  return candidates
    .sort((a, b) => b.weight - a.weight || a.model.localeCompare(b.model))
    .map((c) => ({ model: c.model, share: c.weight / total }))
}

const TOKEN_FIELDS = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens']

/** 把一条官方 Auto 记录按占比拆成多条派生记录；最后一条拿余数，保证各列总和与原记录完全一致。 */
function splitAutoRow(row, resolved) {
  const remaining = {}
  for (const field of TOKEN_FIELDS) remaining[field] = Math.max(0, Math.trunc(Number(row[field]) || 0))
  const totalCost = Number(row.cost_usd) || 0
  let remainingCost = totalCost
  return resolved.map((r, index) => {
    const last = index === resolved.length - 1
    const record = {
      source: 'cursor',
      provider: detectCursorProvider(r.model),
      model: r.model,
      reasoning_tokens: 0,
      cost_usd: 0,
      estimated: false,
      request_id: `${row.request_id}/${r.model}`,
      timestamp: Math.trunc(Number(row.timestamp)),
    }
    if (row.project) record.project = row.project
    for (const field of TOKEN_FIELDS) {
      const value = last ? remaining[field] : Math.min(remaining[field], Math.round((Number(row[field]) || 0) * r.share))
      record[field] = value
      remaining[field] -= value
    }
    const cost = last ? remainingCost : Math.round(totalCost * r.share * 1e6) / 1e6
    record.cost_usd = Math.max(0, cost)
    remainingCost -= record.cost_usd
    return record
  })
}

/**
 * 为库里的官方 Auto 记录生成「改成真实模型」的计划。纯函数，不碰数据库。
 * @param rows 官方 Cursor 记录（含已隐藏的和已拆出的派生记录），字段同 usage_records
 * @param chats Map(对话 id → { models: Map(模型名 → 输出字符数) })，来自 readCursorChatModels
 * @returns { updates, derived }
 *   - updates：需要改动的原记录 [{ id, model, provider, is_internal }]（已经正确的不出现）
 *   - derived：本次能对上本机对话的派生记录；调用方按 request_id 增改。
 *     本机读不到的对话不会出现在 updates/derived 里——调用方必须 sticky 保留那些对话的旧派生行，
 *     不能把「不在 derived 里」一律当成「该删」。
 */
function planCursorAutoResolution(rows, chats) {
  const explicitByConv = new Map()
  const autoRows = []
  for (const row of rows) {
    const conv = conversationIdFromOfficialRequestId(row.request_id)
    if (!conv) continue
    if (isCursorAutoRequestId(row.request_id)) {
      autoRows.push({ row, conv })
      continue
    }
    if (isCursorAutoDerivedRequestId(row.request_id)) continue
    if (!explicitByConv.has(conv)) explicitByConv.set(conv, new Set())
    explicitByConv.get(conv).add(String(row.model).toLowerCase())
  }

  const updates = []
  const derived = []
  const resolvedByConv = new Map()
  const autoLabel = displayCursorModel(CURSOR_AUTO_RAW_MODEL)
  for (const { row, conv } of autoRows) {
    if (!resolvedByConv.has(conv)) {
      const chat = chats && chats.get(conv)
      // 本机没有这段对话：保持库里现状（已还原的不回退成 auto，已拆分的由调用方 sticky 保留派生行）
      // 绝不能在 chats 读失败 / 对话被清时把归因推回 "auto" 再删掉派生行
      if (!chat) {
        resolvedByConv.set(conv, null)
      } else {
        resolvedByConv.set(conv, inferAutoModels(chat.models, explicitByConv.get(conv)))
      }
    }
    const resolved = resolvedByConv.get(conv)
    if (resolved == null) continue
    let model = autoLabel
    let hidden = false
    if (resolved.length === 1) {
      model = resolved[0].model
    } else if (resolved.length > 1) {
      hidden = true
      derived.push(...splitAutoRow(row, resolved))
    }
    const provider = model === autoLabel ? 'cursor' : detectCursorProvider(model)
    if (row.model !== model || Boolean(row.is_internal) !== hidden || (row.provider || 'cursor') !== provider) {
      updates.push({ id: row.id, model, provider, is_internal: hidden })
    }
  }
  return { updates, derived }
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
  CURSOR_GROK_BOT_SOURCE,
  isGrokBotModel,
  isCursorAutoRequestId,
  isCursorAutoDerivedRequestId,
  isCursorAutoRouted,
  inferAutoModels,
  planCursorAutoResolution,
  readCursorChatModels,
  cursorStateDbCandidates,
  readCursorSession,
  cursorRequestHeaders,
  fetchCursorUsageEvents,
  mapCursorUsageEvent,
  displayCursorModel,
  projectFromCursorSlug,
  loadCursorConversationProjects,
  collectCursorUsageRecords,
  collectCursorLocalModelRecords,
  conversationIdFromOfficialRequestId,
  projectFromCwd,
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
