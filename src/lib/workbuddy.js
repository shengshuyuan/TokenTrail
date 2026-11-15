/**
 * WorkBuddy（小八）用量解析
 * ------------------------------------------------------------------
 * WorkBuddy 本地数据分三处，三处各管一件事，绝不互相推算：
 *
 *   1. ~/.workbuddy/traces/<pid>/trace_*.jsonl   → 每次模型调用的真实 usage
 *      generation span 的 toolOutput 就是官方 chat.completion 响应，
 *      带 prompt_tokens / completion_tokens / cached_tokens / reasoning_tokens。
 *      这是 token 用量的唯一来源：读不到 usage 就跳过，绝不用字符数估算。
 *
 *   2. ~/.workbuddy/workbuddy.db · session_usage → 每次用户请求扣的积分
 *      credit_json 形如 {"<conversationRequestId>": credits}，是官方扣费值。
 *      只保留最近若干条（会被滚动清理），所以同步要跑得勤，落库后才是长期账本。
 *
 *   3. ~/.workbuddy/projects/<dir>/<sessionId>.jsonl → 会话的 cwd 与时间范围
 *      会话目录名不是可读项目名，cwd 才是；用它把 trace 归因到项目。
 *
 * 口径：TraeWork / Codex 一样的加法口径（total = input + cached + output + reasoning），
 * 因此 OpenAI 风格的 prompt_tokens 必须先减掉 cached_tokens，completion_tokens 先减掉 reasoning。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

/** WorkBuddy 数据根目录；测试与多账号场景可用环境变量覆盖。 */
function resolveRoot(override) {
  return override || process.env.WORKBUDDY_HOME || path.join(os.homedir(), '.workbuddy')
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function toNumber(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function isoToMs(value) {
  if (typeof value !== 'string') return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

// ─── 会话索引 ────────────────────────────────────────────────

/**
 * 扫描 projects/<projectDir>/<sessionId>.jsonl：
 * 取 cwd 作为项目名，首尾时间戳作为会话窗口。
 * 只读到能判定 cwd + 时间范围为止，不整文件解析（会话文件可能几百 KB）。
 */
function indexSessions(root) {
  const sessions = new Map()
  const projectsDir = path.join(root, 'projects')
  let entries = []
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true })
  } catch {
    return sessions
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(projectsDir, entry.name)
    let files = []
    try {
      files = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const name of files) {
      const sessionId = name.slice(0, -'.jsonl'.length)
      const filePath = path.join(dir, name)
      let cwd = ''
      let start = null
      let last = null
      let model = ''
      let lines
      try {
        lines = fs.readFileSync(filePath, 'utf8').split('\n')
      } catch {
        continue
      }
      for (const line of lines) {
        if (!line || line[0] !== '{') continue
        let item
        try {
          item = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof item.timestamp === 'number') {
          if (start === null || item.timestamp < start) start = item.timestamp
          if (last === null || item.timestamp > last) last = item.timestamp
        }
        if (!cwd && typeof item.cwd === 'string' && item.cwd) cwd = item.cwd
        if (!model && item.providerData && typeof item.providerData.model === 'string') {
          model = item.providerData.model
        }
      }
      if (start === null) start = 0
      if (last === null) last = start
      sessions.set(sessionId, {
        sessionId,
        cwd,
        project: cwd ? path.basename(cwd) : 'workbuddy',
        start,
        end: last,
        model,
      })
    }
  }
  return sessions
}

/** sessions/<pid>.json 是活会话的 pid → sessionId 映射，能精确归因正在跑的会话。 */
function indexLivePids(root) {
  const map = new Map()
  const dir = path.join(root, 'sessions')
  let files = []
  try {
    files = fs.readdirSync(dir).filter(name => name.endsWith('.json'))
  } catch {
    return map
  }
  for (const name of files) {
    const data = readJsonFile(path.join(dir, name))
    if (!data || typeof data.sessionId !== 'string') continue
    const pid = name.slice(0, -'.json'.length)
    map.set(pid, { sessionId: data.sessionId, cwd: typeof data.cwd === 'string' ? data.cwd : '' })
  }
  return map
}

/**
 * trace 文件 → 项目名。
 * 同一个 trace 文件必然对应同一会话，所以一个文件只归一个项目：
 * 活会话优先看 sessions/<pid>.json，历史会话按时间窗匹配。
 */
function resolveTraceProject({ pid, timestamp, sessions, livePids }) {
  const live = livePids.get(pid)
  if (live) {
    const session = sessions.get(live.sessionId)
    if (session) return session.project
    if (live.cwd) return path.basename(live.cwd)
  }
  const session = sessionAt(sessions, timestamp)
  return session ? session.project : 'workbuddy'
}

/** 时间窗内最贴近的会话；找不到返回 null（宁可空项目，也不瞎归因）。 */
function sessionAt(sessions, timestamp) {
  let best = null
  for (const session of sessions.values()) {
    if (timestamp < session.start - 60_000 || timestamp > session.end + 10 * 60_000) continue
    if (!best || session.start > best.start) best = session
  }
  return best
}

// ─── trace 解析 ──────────────────────────────────────────────

/**
 * 从 generation span 的 toolOutput 里取官方 usage。
 * toolOutput 是 chat.completion 响应的字符串（可能是一批），读不到就返回 null。
 */
function usageFromToolOutput(toolOutput) {
  if (!toolOutput) return null
  let parsed = toolOutput
  if (typeof toolOutput === 'string') {
    try {
      parsed = JSON.parse(toolOutput)
    } catch {
      return null // 被截断的响应：跳过，不猜
    }
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  for (const item of list) {
    const usage = item && item.usage
    if (!usage || typeof usage !== 'object') continue
    const prompt = toNumber(usage.prompt_tokens)
    if (prompt === null) continue
    const cached = toNumber(usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0
    const completion = toNumber(usage.completion_tokens) || 0
    const reasoning = toNumber(usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) || 0
    return {
      model: typeof item.model === 'string' ? item.model : '',
      response_id: typeof item.id === 'string' ? item.id : '',
      prompt_tokens: prompt,
      cached_tokens: Math.min(cached, prompt),
      completion_tokens: completion,
      reasoning_tokens: Math.min(reasoning, completion),
    }
  }
  return null
}

function generationSpansFromJson(filePath) {
  const data = readJsonFile(filePath)
  const spans = data && Array.isArray(data.spans) ? data.spans : []
  return spans.filter(span => span && span.type === 'generation')
}

function generationSpansFromJsonl(filePath) {
  const spans = []
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return spans
  }
  const lines = raw.split('\n')
  for (const line of lines) {
    if (!line || line.indexOf('"span_end"') === -1) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue // 正在写入的半行：下次同步再读
    }
    const span = event && event.span
    if (span && span.type === 'generation') spans.push(span)
  }
  return spans
}

function listTraceFiles(root) {
  const tracesDir = path.join(root, 'traces')
  const files = []
  let pids = []
  try {
    pids = fs.readdirSync(tracesDir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const pidEntry of pids) {
    if (!pidEntry.isDirectory()) continue
    const dir = path.join(tracesDir, pidEntry.name)
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.startsWith('trace_') && (name.endsWith('.jsonl') || name.endsWith('.json'))) {
        files.push({ file: path.join(dir, name), pid: pidEntry.name })
      }
    }
  }
  return files.sort((a, b) => a.file.localeCompare(b.file))
}

/** trace 文件 → 每次模型调用的 token 记录（真实 usage，缺 usage 的直接丢）。 */
function parseTraceFile(filePath) {
  const spans = filePath.endsWith('.jsonl')
    ? generationSpansFromJsonl(filePath)
    : generationSpansFromJson(filePath)

  const calls = []
  for (const span of spans) {
    const usage = usageFromToolOutput(span.toolOutput)
    if (!usage) continue
    const timestamp = isoToMs(span.startedAt)
    if (timestamp === null) continue
    const reasoning = usage.reasoning_tokens
    calls.push({
      model: usage.model,
      request_id: usage.response_id || `${path.basename(filePath)}:${span.spanId}`,
      timestamp,
      input_tokens: usage.prompt_tokens - usage.cached_tokens,
      cached_input_tokens: usage.cached_tokens,
      output_tokens: usage.completion_tokens - reasoning,
      reasoning_tokens: reasoning,
    })
  }
  return calls
}

// ─── 积分 ────────────────────────────────────────────────────

function openReadonly(dbPath) {
  try {
    const Database = require('better-sqlite3')
    return new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
}

/**
 * session_usage.credit_json → 每条用户请求的官方扣费积分。
 * 时间 / 模型来自该会话的对话记录（conversationRequestId 对齐），读不到就用会话兜底。
 */
function collectCredits(root, sessions = new Map()) {
  const dbPath = path.join(root, 'workbuddy.db')
  if (!fs.existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  if (!db) return []

  let rows = []
  try {
    rows = db.prepare('SELECT session_id, credit_json, updated_at FROM session_usage').all()
  } catch {
    rows = []
  } finally {
    db.close()
  }

  const credits = []
  for (const row of rows) {
    if (!row || !row.credit_json) continue
    let map
    try {
      map = JSON.parse(row.credit_json)
    } catch {
      continue
    }
    if (!map || typeof map !== 'object') continue
    const session = sessions.get(row.session_id) || null
    const turnMeta = readTurnMeta(root, row.session_id)
    for (const [requestId, value] of Object.entries(map)) {
      const amount = toNumber(value)
      if (amount === null || amount <= 0) continue
      const meta = turnMeta.get(requestId)
      const timestamp = (meta && meta.timestamp) || toNumber(row.updated_at) || (session && session.end) || 0
      // 没有真实时间就丢掉。用 Date.now() 会把旧扣费算进「今天」，并且第一次同步后这个假时间会留在账本里。
      if (!timestamp) continue
      credits.push({
        request_id: `workbuddy-credit:${requestId}`,
        credits: Math.round(amount * 10000) / 10000,
        timestamp,
        model: (meta && meta.model) || (session && session.model) || '',
        project: session ? session.project : 'workbuddy',
      })
    }
  }
  return credits
}

/**
 * 会话对话记录里 conversationRequestId → { timestamp, model }。
 * 额度卡片会轮询，缓存 30 秒；超时重读，避免把新请求的扣费时间钉死在旧快照上。
 */
const TURN_META_TTL_MS = 30_000
const turnMetaCache = new Map()
function readTurnMeta(root, sessionId) {
  const cacheKey = `${root}::${sessionId}`
  const cached = turnMetaCache.get(cacheKey)
  if (cached && Date.now() - cached.at < TURN_META_TTL_MS) return cached.meta
  const meta = new Map()
  const projectsDir = path.join(root, 'projects')
  let projectDirs = []
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(e => e.isDirectory())
  } catch {
    turnMetaCache.set(cacheKey, { at: Date.now(), meta })
    return meta
  }
  for (const dirEntry of projectDirs) {
    const filePath = path.join(projectsDir, dirEntry.name, `${sessionId}.jsonl`)
    if (!fs.existsSync(filePath)) continue
    let lines
    try {
      lines = fs.readFileSync(filePath, 'utf8').split('\n')
    } catch {
      continue
    }
    for (const line of lines) {
      if (!line || line.indexOf('conversationRequestId') === -1) continue
      let item
      try {
        item = JSON.parse(line)
      } catch {
        continue
      }
      const provider = item.providerData
      if (!provider || typeof provider.conversationRequestId !== 'string') continue
      const current = meta.get(provider.conversationRequestId) || {}
      meta.set(provider.conversationRequestId, {
        timestamp: current.timestamp || (typeof item.timestamp === 'number' ? item.timestamp : undefined),
        model: current.model || (typeof provider.model === 'string' ? provider.model : undefined),
      })
    }
    break
  }
  turnMetaCache.set(cacheKey, { at: Date.now(), meta })
  return meta
}

// ─── 对外入口 ────────────────────────────────────────────────

/**
 * 采集 WorkBuddy 的用量记录。
 * 返回 { calls, credits }：calls 带真实 token，credits 带官方积分（无 token）。
 * 两边都为空是合法结果（本机没用过 WorkBuddy），由调用方决定是否跳过。
 */
function collectWorkbuddyUsage(options = {}) {
  const root = resolveRoot(options.root)
  if (!fs.existsSync(root)) return { calls: [], credits: [] }

  const sessions = indexSessions(root)
  const livePids = indexLivePids(root)

  const calls = []
  for (const { file, pid } of listTraceFiles(root)) {
    const parsed = parseTraceFile(file)
    if (parsed.length === 0) continue
    const project = resolveTraceProject({ pid, timestamp: parsed[0].timestamp, sessions, livePids })
    for (const call of parsed) {
      calls.push({ ...call, project })
    }
  }

  return { calls, credits: collectCredits(root, sessions) }
}

module.exports = {
  resolveRoot,
  indexSessions,
  indexLivePids,
  sessionAt,
  resolveTraceProject,
  usageFromToolOutput,
  parseTraceFile,
  listTraceFiles,
  collectCredits,
  readTurnMeta,
  collectWorkbuddyUsage,
}
