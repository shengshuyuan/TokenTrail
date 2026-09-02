// ─── 账号额度中心 · Kimi Code Adapter ────────────────────────
// 两条读取路径：
// 1) 官方 Kimi Code Server API（本地 kimi web 服务）：
//    GET /api/v1/oauth/usage → summary / limits / extra_usage
//    （实例文件 ~/.kimi-code/server/instances/*.json 含端口与 bearer token）
// 2) 本地服务不可用时，凭证仍新鲜则直连账号服务端点
//    GET https://api.kimi.com/coding/v1/usages（与 CLI 内部实现一致）
// 严格区分 Kimi Code 订阅与 Moonshot 开放平台：后者仅在用户另行配置
// MOONSHOT_API_KEY 时作为独立次级钱包，绝不替代订阅额度。
// 凭证只在服务端内存出现；userId/region 等账号隐私字段绝不进入快照。

const fs = require('fs')
const path = require('path')
const { codedError, requestJson, toEpochMs, toFiniteNumber } = require('../http.js')
const { deriveProviderStatus } = require('../status.js')

const KIMI_HOME = () => path.join('.kimi-code')
const INSTANCES_DIR = () => path.join('.kimi-code', 'server', 'instances')
const CREDENTIALS_PATH = () => path.join('.kimi-code', 'credentials', 'kimi-code.json')

const LOCAL_USAGE_PATH = '/api/v1/oauth/usage'
const REMOTE_USAGE_URL = 'https://api.kimi.com/coding/v1/usages'
const MOONSHOT_BALANCE_URL = 'https://api.moonshot.cn/v1/users/me/balance'

const TOKEN_TOLERANCE_MS = 30 * 1000

/** instances/*.json → [{ url, bearerToken }]（容错字段名；缺 token 的实例跳过）。 */
function discoverLocalServers(fsMod, home) {
  const dir = path.join(home, INSTANCES_DIR())
  let files
  try {
    files = fsMod.readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }

  const servers = []
  for (const file of files) {
    const data = readJsonSafe(fsMod, path.join(dir, file))
    if (!data || typeof data !== 'object') continue
    const port = Number(data.port ?? data.serverPort)
    if (!Number.isFinite(port) || port <= 0 || port > 65535) continue
    const token = data.bearerToken ?? data.serverToken ?? data.token
    if (typeof token !== 'string' || !token) continue
    const host = typeof data.host === 'string' && data.host ? data.host : '127.0.0.1'
    servers.push({ url: `http://${host}:${port}${LOCAL_USAGE_PATH}`, bearerToken: token })
  }
  return servers
}

function readJsonSafe(fsMod, filePath) {
  try {
    return JSON.parse(fsMod.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function readKimiCliSession(fsMod, home, now = Date.now()) {
  const creds = readJsonSafe(fsMod, path.join(home, CREDENTIALS_PATH()))
  const hasCredentials = Boolean(creds?.access_token)
  const expiresAtMs = toEpochMs(creds?.expires_at) ?? 0
  const loggedIn = Boolean(hasCredentials && expiresAtMs > now + TOKEN_TOLERANCE_MS)
  return { loggedIn, hasCredentials, expired: hasCredentials && !loggedIn }
}

/**
 * 直连 Kimi Code 订阅端点。
 * 优先使用用户单独配置的 Kimi Code Key；否则复用 CLI OAuth access token。
 * Moonshot 开放平台 Key 不可用于此端点，二者必须严格分开。
 */
async function fetchRemoteWithStoredCredentials(deps) {
  const configuredKey = deps.env?.KIMI_CODE_API_KEY
  if (typeof configuredKey === 'string' && configuredKey.trim()) {
    return requestJson(REMOTE_USAGE_URL, {
      headers: { Authorization: `Bearer ${configuredKey.trim()}` },
      timeoutMs: deps.timeoutMs,
      fetchImpl: deps.fetchImpl,
    }).then((r) => r.json)
  }

  const creds = readJsonSafe(deps.fs, path.join(deps.home, CREDENTIALS_PATH()))
  if (!creds || typeof creds.access_token !== 'string' || !creds.access_token) {
    throw codedError('not_configured', 'Kimi Code is not logged in or local service unavailable')
  }
  const expiresAtMs = toEpochMs(creds.expires_at) ?? 0
  if (expiresAtMs <= deps.now() + TOKEN_TOLERANCE_MS) {
    throw codedError('auth', 'Kimi Code login expired')
  }
  return requestJson(REMOTE_USAGE_URL, {
    headers: { Authorization: `Bearer ${creds.access_token}` },
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  }).then((r) => r.json)
}

/** {duration, unit|timeUnit} → 窗口分钟数（兼容两种 wire 格式）。 */
function windowMinutesFromKimi(windowInfo) {
  const duration = toFiniteNumber(windowInfo?.duration)
  const unit = windowInfo?.unit ?? windowInfo?.timeUnit
  if (duration === null || duration <= 0) return null
  const normalized = typeof unit === 'string' ? unit.replace(/^TIME_UNIT_/, '').toLowerCase() : unit
  if (normalized === 'minute') return duration
  if (normalized === 'hour') return duration * 60
  if (normalized === 'day') return duration * 1440
  if (normalized === 'week') return duration * 10080
  return null
}

/** 数值或数字字符串 → number（官方接口两种都会出现）。 */
function num(value) {
  return toFiniteNumber(value) ?? undefined
}

function buildWindow({ id, label, minutes, used, limit, remaining, resetAt }) {
  const windowEntry = {
    id,
    label,
    unit: 'request',
    used: num(used),
    limit: num(limit),
    windowMinutes: minutes ?? undefined,
  }
  const usedNum = num(used)
  const limitNum = num(limit)
  if (usedNum === undefined && num(remaining) !== undefined && limitNum) {
    windowEntry.used = limitNum - num(remaining)
  }
  if (windowEntry.used !== undefined && limitNum) {
    windowEntry.usedPercent = Math.round((windowEntry.used / limitNum) * 1000) / 10
  }
  const resetMs = toEpochMs(resetAt)
  if (resetMs) windowEntry.resetsAt = resetMs
  return windowEntry
}

/**
 * 本地 Server API wire 格式：{ kind:'ok', summary, limits[], extra_usage }。
 * summary 本身是主窗口；limits[] 为其余窗口。
 */
function mapLocalUsagePayload(payload) {
  const windows = []
  const rows = []
  if (payload?.summary && typeof payload.summary === 'object') rows.push({ ...payload.summary, name: 'summary' })
  for (const row of Array.isArray(payload?.limits) ? payload.limits : []) {
    if (row && typeof row === 'object') rows.push(row)
  }
  for (const row of rows) {
    const minutes = windowMinutesFromKimi(row.window)
    const used = num(row.used)
    const limit = num(row.limit)
    if (used === undefined && limit === undefined) continue
    windows.push(
      buildWindow({
        id: `kimi-${minutes ?? row.name ?? windows.length}`,
        label: typeof row.name === 'string' && row.name && row.name !== 'summary' ? row.name : minutes === 300 ? '5h' : minutes === 10080 ? 'week' : 'window',
        minutes,
        used,
        limit,
        resetAt: row.reset_at,
      })
    )
  }
  return { windows, wallet: mapExtraUsage(payload?.extra_usage) }
}

/**
 * 直连 /usages 响应格式：
 * { usage: {used,limit,remaining,resetTime}, limits: [{window:{duration,timeUnit}, detail}], membership... }
 */
function mapDirectUsage(json) {
  if (!json || typeof json !== 'object' || typeof json.usage !== 'object') {
    throw codedError('unsupported_version', 'unexpected kimi usage response')
  }
  const windows = []

  const usage = json.usage
  const usageLimit = num(usage.limit)
  const usageUsed = num(usage.used)
  if (usageUsed !== undefined || usageLimit !== undefined) {
    // 主窗口为每周额度（resetTime 为周窗口重置时间）
    windows.push(
      buildWindow({
        id: 'kimi-week',
        label: 'week',
        minutes: 10080,
        used: usageUsed,
        limit: usageLimit,
        resetAt: usage.resetTime,
      })
    )
  }

  for (const row of Array.isArray(json.limits) ? json.limits : []) {
    if (!row || typeof row !== 'object' || typeof row.detail !== 'object') continue
    const minutes = windowMinutesFromKimi(row.window)
    windows.push(
      buildWindow({
        id: `kimi-${minutes ?? windows.length}`,
        label: minutes === 300 ? '5h' : minutes === 10080 ? 'week' : 'window',
        minutes,
        limit: row.detail.limit,
        remaining: row.detail.remaining,
        resetAt: row.detail.resetTime,
      })
    )
  }

  return { windows, wallet: null }
}

/** extra_usage → 加油包钱包（仅本地 Server API 提供）。 */
function mapExtraUsage(extraUsage) {
  if (!extraUsage || typeof extraUsage !== 'object') return null
  const balanceCents = typeof extraUsage.balance_cents === 'number' ? extraUsage.balance_cents : null
  if (balanceCents === null) return null
  const wallet = {
    label: 'extra',
    balance: balanceCents / 100,
    currency: typeof extraUsage.currency === 'string' && extraUsage.currency ? extraUsage.currency : 'USD',
  }
  if (extraUsage.monthly_charge_limit_enabled === true && typeof extraUsage.monthly_charge_limit_cents === 'number') {
    wallet.monthlyLimit = extraUsage.monthly_charge_limit_cents / 100
    if (typeof extraUsage.monthly_used_cents === 'number') {
      wallet.monthlyUsed = extraUsage.monthly_used_cents / 100
    }
  }
  return wallet
}

/** 本地 Server envelope：{code,msg,data:{kind,...}} 或根对象；kind:'error' 按上游状态映射。 */
function unwrapLocalUsageEnvelope(json) {
  const payload = json && typeof json === 'object' && json.data && typeof json.data === 'object' ? json.data : json
  if (!payload || typeof payload !== 'object') {
    throw codedError('unsupported_version', 'unexpected usage response')
  }
  if (payload.kind === 'error') {
    const status = Number(payload.status)
    if (status === 401 || status === 403) throw codedError('auth', 'kimi usage unauthorized')
    if (status === 429) throw codedError('rate_limited', 'kimi usage rate limited')
    throw codedError('network', 'kimi usage upstream error')
  }
  return payload
}

/** Moonshot 开放平台余额：独立次级钱包，失败静默忽略。 */
async function fetchMoonshotWallet(deps) {
  const key = deps.env?.MOONSHOT_API_KEY
  if (typeof key !== 'string' || !key.trim()) return null
  try {
    const { json } = await requestJson(MOONSHOT_BALANCE_URL, {
      headers: { Authorization: `Bearer ${key.trim()}` },
      timeoutMs: deps.timeoutMs,
      fetchImpl: deps.fetchImpl,
    })
    const data = json?.data
    const available = Number(data?.available_balance)
    if (!Number.isFinite(available)) return null
    return { label: 'moonshot-platform', balance: available, currency: 'CNY' }
  } catch {
    return null
  }
}

async function fetchQuota(deps) {
  let windows = []
  let wallet = null
  let viaLocalServer = false
  let directJson = null

  for (const server of discoverLocalServers(deps.fs, deps.home)) {
    try {
      const res = await requestJson(server.url, {
        headers: { Authorization: `Bearer ${server.bearerToken}` },
        timeoutMs: deps.timeoutMs,
        fetchImpl: deps.fetchImpl,
      })
      const payload = unwrapLocalUsageEnvelope(res.json)
      const mapped = mapLocalUsagePayload(payload)
      windows = mapped.windows
      wallet = mapped.wallet
      viaLocalServer = true
      break
    } catch {
      continue // 单个本地实例失败不阻塞其他发现路径
    }
  }

  if (!viaLocalServer) {
    try {
      directJson = await fetchRemoteWithStoredCredentials(deps)
      const mapped = mapDirectUsage(directJson)
      windows = mapped.windows
      wallet = mapped.wallet
    } catch (err) {
      // An Open Platform API key can expose a wallet without being a Kimi Code
      // subscription login. Preserve real auth/network failures for fresh OAuth
      // credentials, but allow the independent wallet-only path when no login exists.
      if (!err || err.code !== 'not_configured') throw err
    }
  }

  const moonshotWallet = await fetchMoonshotWallet(deps)
  const wallets = [wallet, moonshotWallet].filter(Boolean)

  if (windows.length === 0 && wallets.length === 0) {
    throw codedError('no_data', 'no kimi usage data available')
  }

  const now = deps.now()
  const snapshot = {
    provider: 'kimi',
    product: windows.length > 0 && moonshotWallet ? 'mixed' : windows.length > 0 ? 'subscription' : 'api',
    windows,
    wallets,
    source: viaLocalServer ? 'local_cli' : 'official_api',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
  }
  snapshot.status = deriveProviderStatus({ windows, fallback: wallets.length > 0 ? 'healthy' : 'partial' })
  return snapshot
}

module.exports = {
  LOCAL_USAGE_PATH,
  REMOTE_USAGE_URL,
  MOONSHOT_BALANCE_URL,
  TOKEN_TOLERANCE_MS,
  discoverLocalServers,
  readKimiCliSession,
  windowMinutesFromKimi,
  mapLocalUsagePayload,
  mapDirectUsage,
  mapExtraUsage,
  unwrapLocalUsageEnvelope,
  fetchMoonshotWallet,
  fetchQuota,
}
