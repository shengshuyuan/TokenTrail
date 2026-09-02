// ─── 账号额度中心 · Codex Adapter ────────────────────────────
// 授权与额度分开：
// 1) ChatGPT 订阅登录：~/.codex/auth.json（codex login 浏览器 OAuth）
// 2) API Key：OPENAI_API_KEY / auth.json 中的 OPENAI_API_KEY，不得与 ChatGPT 登录混用
// 额度仍只扫描本地 ~/.codex/sessions 的 rate_limits，绝不主动发模型请求。

const fs = require('fs')
const path = require('path')
const { codedError, readJsonIfExists, toEpochMs } = require('../http.js')
const { deriveProviderStatus } = require('../status.js')

// 只扫最近修改的前 N 个会话文件，并只读文件尾部，避免整库扫描
const MAX_SESSION_FILES = 20
const TAIL_BYTES = 256 * 1024

/** 由 window_minutes 生成窗口元数据（label 由 UI 按 kind 本地化）。 */
function windowMetaFromMinutes(minutes) {
  if (minutes === 300) return { kind: '5h' }
  if (minutes === 1440) return { kind: 'day' }
  if (minutes === 10080) return { kind: 'week' }
  if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) {
    return { kind: `${minutes}m` }
  }
  return { kind: null }
}

/**
 * 从会话行中提取携带 rate_limits 的候选事件。
 * 返回 { timestamp, rate_limits }；无有效事件返回 null。
 */
function extractLatestRateLimits(lines) {
  let best = null
  let bestTs = -1
  for (const line of lines) {
    if (!line || !line.trim() || line[0] !== '{') continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue // 容忍被截断的行
    }
    const rateLimits = entry?.payload?.rate_limits ?? entry?.rate_limits
    if (!rateLimits || typeof rateLimits !== 'object') continue
    if (!rateLimits.primary && !rateLimits.secondary) continue
    const ts = toEpochMs(entry.timestamp) ?? 0
    if (ts >= bestTs) {
      bestTs = ts
      best = { timestamp: ts, rate_limits: rateLimits }
    }
  }
  return best
}

/** rate_limits → QuotaWindow 列表（primary=5小时，secondary=每周）。 */
function mapRateLimitsToWindows(rateLimits) {
  const windows = []
  for (const slot of ['primary', 'secondary']) {
    const w = rateLimits?.[slot]
    if (!w || typeof w !== 'object') continue
    const usedPercent = typeof w.used_percent === 'number' ? w.used_percent : undefined
    const minutes = typeof w.window_minutes === 'number' ? w.window_minutes : null
    const meta = windowMetaFromMinutes(minutes)
    windows.push({
      id: slot,
      label: slot === 'primary' ? meta.kind || 'primary' : meta.kind || 'secondary',
      unit: 'request',
      usedPercent,
      windowMinutes: minutes,
      resetsAt: toEpochMs(w.resets_at) ?? undefined,
    })
  }
  return windows
}

/** credits → 钱包（仅当官方给出余额时展示）。 */
function mapCreditsToWallet(credits) {
  if (!credits || typeof credits !== 'object') return null
  const balance = typeof credits.balance === 'number' ? credits.balance : null
  if (balance === null) return null
  return { label: 'credits', balance, currency: 'USD' }
}

function planLabelFromRateLimits(rateLimits) {
  const plan = rateLimits?.plan_type
  return typeof plan === 'string' && plan.trim() ? plan : undefined
}

function jwtExpMs(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parts[1].length + 3) % 4)
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * 读取 Codex CLI 登录态。只返回是否已登录 / 是否过期 / 登录方式，
 * 绝不带回 access_token、refresh_token、account_id。
 */
function readCodexCliSession(fsMod, home, now = Date.now(), env = {}) {
  const envKey = typeof env?.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : ''
  if (envKey) {
    return { loggedIn: true, hasCredentials: true, expired: false, authMode: 'api_key' }
  }

  const auth = readJsonIfExists(fsMod, path.join(home, '.codex', 'auth.json'))
  if (!auth || typeof auth !== 'object') {
    return { loggedIn: false, hasCredentials: false, expired: false, authMode: null }
  }

  const fileKey = typeof auth.OPENAI_API_KEY === 'string' ? auth.OPENAI_API_KEY.trim() : ''
  if (fileKey) {
    return { loggedIn: true, hasCredentials: true, expired: false, authMode: 'api_key' }
  }

  const tokens = auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : null
  const access = typeof tokens?.access_token === 'string' ? tokens.access_token.trim() : ''
  const refresh = typeof tokens?.refresh_token === 'string' ? tokens.refresh_token.trim() : ''
  const mode = typeof auth.auth_mode === 'string' && auth.auth_mode.trim() ? auth.auth_mode.trim() : 'chatgpt'

  if (refresh) {
    return { loggedIn: true, hasCredentials: true, expired: false, authMode: mode }
  }
  if (access) {
    const exp = jwtExpMs(access)
    if (exp !== null && exp <= now) {
      return { loggedIn: false, hasCredentials: true, expired: true, authMode: mode }
    }
    return { loggedIn: true, hasCredentials: true, expired: false, authMode: mode }
  }

  if (mode || auth.tokens) {
    return { loggedIn: false, hasCredentials: true, expired: true, authMode: mode }
  }
  return { loggedIn: false, hasCredentials: false, expired: false, authMode: mode }
}

function loggedInEmptySnapshot(deps, session) {
  const now = deps.now()
  return {
    provider: 'codex',
    product: 'subscription',
    accountLabel: session?.authMode === 'api_key' ? 'API Key' : 'ChatGPT',
    status: 'healthy',
    windows: [],
    wallets: [],
    source: 'local_cli',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
    error: { code: 'no_data', safeMessage: 'no quota records yet' },
  }
}

/**
 * 扫描会话目录，取事件时间最新的一条 rate_limits。
 * 不依赖文件修改时间作为排序唯一依据：候选按事件 timestamp 比较。
 */
function findLatestRateLimitEvent(deps) {
  const fsMod = deps.fs ?? fs
  const sessionsDir = path.join(deps.home, '.codex', 'sessions')
  if (!fsMod.existsSync(sessionsDir)) {
    throw codedError('not_configured', 'Codex CLI not detected')
  }

  const files = []
  const walk = (dir, depth) => {
    if (depth > 6 || files.length > 4000) return
    let entries
    try {
      entries = fsMod.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name.endsWith('.jsonl')) files.push(full)
    }
  }
  walk(sessionsDir, 0)

  files.sort((a, b) => {
    try {
      return fsMod.statSync(b).mtimeMs - fsMod.statSync(a).mtimeMs
    } catch {
      return 0
    }
  })

  let best = null
  for (const file of files.slice(0, MAX_SESSION_FILES)) {
    let lines = []
    try {
      const stat = fsMod.statSync(file)
      const start = stat.size > TAIL_BYTES ? stat.size - TAIL_BYTES : 0
      const text = fsMod.readFileSync(file, 'utf-8').slice(start)
      lines = text.split('\n')
      if (start > 0) lines = lines.slice(1) // 丢弃被截断的首行
    } catch {
      continue
    }
    const candidate = extractLatestRateLimits(lines)
    if (candidate && (!best || candidate.timestamp > best.timestamp)) best = candidate
  }

  if (!best) throw codedError('no_data', 'no quota records yet')
  return best
}

async function fetchQuota(deps) {
  const session = readCodexCliSession(deps.fs, deps.home, deps.now(), deps.env)

  let latest = null
  try {
    latest = findLatestRateLimitEvent(deps)
  } catch (err) {
    if (session.expired) throw codedError('auth', 'Codex login expired')
    if (session.loggedIn) return loggedInEmptySnapshot(deps, session)
    throw err
  }

  const rateLimits = latest.rate_limits
  const windows = mapRateLimitsToWindows(rateLimits)
  const wallet = mapCreditsToWallet(rateLimits.credits)
  const now = deps.now()

  const snapshot = {
    provider: 'codex',
    product: 'subscription',
    planLabel: planLabelFromRateLimits(rateLimits),
    accountLabel: session.authMode === 'api_key' ? 'API Key' : session.loggedIn ? 'ChatGPT' : undefined,
    windows,
    wallets: wallet ? [wallet] : [],
    source: 'local_session',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
  }
  snapshot.status = deriveProviderStatus({ windows, fallback: 'healthy' })
  return snapshot
}

module.exports = {
  MAX_SESSION_FILES,
  TAIL_BYTES,
  extractLatestRateLimits,
  mapRateLimitsToWindows,
  mapCreditsToWallet,
  planLabelFromRateLimits,
  windowMetaFromMinutes,
  jwtExpMs,
  readCodexCliSession,
  fetchQuota,
}
