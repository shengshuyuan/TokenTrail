// ─── 账号额度中心 · Grok Adapter ─────────────────────────────
// 授权优先级与 Grok CLI 一致：
// 1) 浏览器 OAuth（`grok login --oauth` → ~/.grok/auth.json）
// 2) 无法跳转页面时，才手动输入 xAI Management Key + Team ID
//
// 额度读取仍分两类产品：
// - SuperGrok / Grok Build 订阅：复用 Grok CLI OAuth 凭证读取
//   cli-chat-proxy 的 billing 端点；结构不认识时返回 unsupported_version。
// - xAI API：仅当用户已配置 Management Key + Team ID 时读取
//   预付余额 / 月度支出限制 / 后付费预览。

const path = require('path')
const { launchCliLogin, resolveCliBinary } = require('../cli-login.js')
const { codedError, readJsonIfExists, requestJson, toEpochMs, toFiniteNumber } = require('../http.js')
const { deriveProviderStatus } = require('../status.js')

// 固定白名单外链，禁止用户输入任意 URL
const USAGE_URLS = {
  subscription: 'https://grok.com/settings',
  api: 'https://console.x.ai',
}

const MANAGEMENT_BASE = 'https://management-api.x.ai/v1/billing/teams'
const CLI_BILLING_BASE = 'https://cli-chat-proxy.grok.com/v1/billing'

/** 订阅额度的固定“不支持自动读取”说明（始终存在，绝不伪造数据）。 */
function subscriptionNotice() {
  return 'subscription quota comes from Grok CLI OAuth; xAI API billing comes from Management API'
}

function resolveManagementConfig(env) {
  const key = env?.XAI_MANAGEMENT_KEY || env?.XAI_MANAGEMENT_API_KEY
  const teamId = env?.XAI_TEAM_ID
  if (typeof key === 'string' && key.trim() && typeof teamId === 'string' && teamId.trim()) {
    return { key: key.trim(), teamId: teamId.trim() }
  }
  return null
}

function parseSessionExpiry(value) {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  }
  return null
}

/**
 * 读取 Grok CLI 浏览器 OAuth 登录态。
 * 只返回是否已登录与过期时间，绝不带回 token / email / team_id。
 */
function readGrokCliSession(fsMod, home) {
  const creds = readGrokCliCredentials(fsMod, home)
  if (!creds) return null
  return {
    loggedIn: true,
    expiresAt: creds.expiresAt,
  }
}

function readGrokCliCredentials(fsMod, home) {
  if (!fsMod || !home) return null
  const auth = readJsonIfExists(fsMod, path.join(home, '.grok', 'auth.json'))
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return null

  for (const session of Object.values(auth)) {
    if (!session || typeof session !== 'object') continue
    const token = typeof session.key === 'string' ? session.key : session.access_token
    if (typeof token !== 'string' || !token.trim()) continue
    const userId = session.user_id ?? session.userId ?? session.userid ?? session.id ?? xaiUserIdFromAccessToken(token)
    return {
      loggedIn: true,
      token: token.trim(),
      userId: typeof userId === 'string' && userId.trim() ? userId.trim() : undefined,
      expiresAt: parseSessionExpiry(session.expires_at),
    }
  }
  return null
}

function xaiUserIdFromAccessToken(accessToken) {
  const parts = String(accessToken || '').split('.')
  if (parts.length < 2 || !parts[1]) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return typeof payload?.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : undefined
  } catch {
    return undefined
  }
}

function grokCliSessionIsFresh(session, now) {
  if (!session || session.loggedIn !== true) return false
  if (typeof session.expiresAt !== 'number') return true
  return session.expiresAt > now
}

function resolveGrokBinary(deps = {}) {
  return resolveCliBinary('grok', deps)
}

let grokLoginProc = null

function resetGrokLoginState() {
  grokLoginProc = null
}

function isGrokLoginRunning() {
  return Boolean(grokLoginProc && grokLoginProc.exitCode == null && grokLoginProc.killed !== true)
}

/**
 * 启动 `grok login --oauth`：由 CLI 打开 auth.x.ai 浏览器授权页。
 * 进程分离，不阻塞额度接口；同一时刻只允许一个登录进程。
 */
function startGrokOAuthLogin(deps = {}) {
  if (isGrokLoginRunning()) return { ok: true, alreadyRunning: true }

  const bin = resolveGrokBinary(deps)
  if (!bin) return { ok: false, reason: 'grok_cli_missing' }

  const result = launchCliLogin('grok', ['login', '--oauth'], deps)
  if (!result.ok) return result
  // Terminal owns the real CLI process, so this flag only debounces rapid clicks.
  grokLoginProc = { exitCode: null, killed: false }
  setTimeout(() => { grokLoginProc = null }, 3000).unref?.()
  return { ok: true }
}

/** xAI 金额统一是 USD 分的 { val: "20000" } 形状。 */
function parseCents(value) {
  if (!value || typeof value !== 'object') return null
  const num = toFiniteNumber(value.val)
  return num === null ? null : num / 100
}

/** 预付余额 → 钱包；响应结构不认识时返回 null（不编造）。 */
function mapPrepaidBalance(json) {
  const total = parseCents(json?.total)
  if (total === null) return null
  return { label: 'prepaid', balance: total, currency: 'USD' }
}

/** 月度支出限制 + 后付费预览 → 月度窗口（有硬上限时才有百分比）。 */
function mapMonthlyWindow(spendingLimits, invoicePreview) {
  const limit = toFiniteNumber(
    spendingLimits?.hardLimit ??
      spendingLimits?.hard_limit ??
      spendingLimits?.monthlyHardLimit ??
      spendingLimits?.monthly_hard_limit
  )
  const used = toFiniteNumber(
    invoicePreview?.expectedAmount ??
      invoicePreview?.expected_amount ??
      invoicePreview?.amountDue ??
      invoicePreview?.amount_due
  )
  if (limit === null && used === null) return null

  const windowEntry = {
    id: 'monthly-postpaid',
    label: 'month',
    unit: 'credit',
  }
  if (limit !== null) windowEntry.limit = limit
  if (used !== null) windowEntry.used = used
  if (limit !== null && limit > 0 && used !== null) {
    windowEntry.usedPercent = Math.round((used / limit) * 1000) / 10
  }
  return windowEntry
}

async function fetchManagementJson(config, resourcePath, deps, opts = {}) {
  const { json } = await requestJson(`${MANAGEMENT_BASE}/${config.teamId}${resourcePath}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${config.key}` },
    body: opts.body,
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  })
  return json
}

async function fetchCliBillingJson(creds, pathSuffix, deps) {
  const headers = {
    Authorization: `Bearer ${creds.token}`,
    'X-XAI-Token-Auth': 'xai-grok-cli',
  }
  if (creds.userId) headers['x-userid'] = creds.userId
  const { json } = await requestJson(`${CLI_BILLING_BASE}${pathSuffix}`, {
    method: 'GET',
    headers,
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  })
  return json
}

function normalizePercent(value) {
  const percent = toFiniteNumber(value)
  if (percent === null || percent < 0 || percent > 100) return null
  return Math.round(percent * 10) / 10
}

function mapCliCreditsWindow(json) {
  const config = json?.config && typeof json.config === 'object' ? json.config : json
  const period = config?.currentPeriod && typeof config.currentPeriod === 'object' ? config.currentPeriod : null
  if (period && period.type && period.type !== 'USAGE_PERIOD_TYPE_WEEKLY') return null
  const rawPercent = config?.creditUsagePercent ?? config?.usagePercent ?? config?.usedPercent
  const usedPercent = rawPercent === undefined && period ? 0 : normalizePercent(rawPercent)
  const resetsAt = toEpochMs(period?.end ?? config?.resetAt ?? config?.resetsAt ?? config?.nextResetTime)
  if (usedPercent === null && !resetsAt) return null
  const windowEntry = {
    id: 'credits',
    label: 'week',
    unit: 'credit',
    windowMinutes: 10080,
  }
  if (usedPercent !== null) windowEntry.usedPercent = usedPercent
  if (resetsAt) windowEntry.resetsAt = resetsAt
  return windowEntry
}

function mapCliMonthlyWindow(json) {
  const config = json?.config && typeof json.config === 'object' ? json.config : json
  const used = toFiniteNumber(config?.used ?? config?.monthlyUsed ?? config?.monthly_used ?? config?.currentUsage)
  const limit = toFiniteNumber(config?.monthlyLimit ?? config?.monthly_limit ?? config?.limit)
  if (used === null && limit === null) return null
  const windowEntry = {
    id: 'monthly',
    label: 'month',
    unit: 'credit',
    windowMinutes: 43200,
  }
  if (used !== null) windowEntry.used = used
  if (limit !== null) windowEntry.limit = limit
  if (used !== null && limit !== null && limit > 0) {
    windowEntry.usedPercent = Math.round((used / limit) * 1000) / 10
  }
  return windowEntry
}

async function fetchCliSubscriptionQuota(creds, deps) {
  const [credits, billing] = await Promise.all([
    fetchCliBillingJson(creds, '?format=credits', deps),
    fetchCliBillingJson(creds, '', deps),
  ])
  const windows = [mapCliCreditsWindow(credits), mapCliMonthlyWindow(billing)].filter(Boolean)
  if (windows.length === 0) {
    throw codedError('unsupported_version', 'unexpected grok cli billing response')
  }
  const now = deps.now()
  const snapshot = {
    provider: 'grok',
    product: 'subscription',
    accountLabel: 'Grok CLI',
    windows,
    wallets: [],
    source: 'local_cli',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
    action: { label: 'usage', url: USAGE_URLS.subscription, kind: 'open_url' },
  }
  snapshot.status = deriveProviderStatus({ windows, fallback: 'healthy' })
  return snapshot
}

function subscriptionSnapshot(deps, extra) {
  const now = deps.now()
  return {
    provider: 'grok',
    product: 'subscription',
    windows: [],
    wallets: [],
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
    action: { label: 'usage', url: USAGE_URLS.subscription, kind: 'open_url' },
    ...extra,
  }
}

async function fetchQuota(deps) {
  const config = resolveManagementConfig(deps.env)
  const cliCreds = readGrokCliCredentials(deps.fs, deps.home)
  const cliFresh = grokCliSessionIsFresh(cliCreds, deps.now())

  if (cliFresh) {
    return fetchCliSubscriptionQuota(cliCreds, deps)
  }

  if (!config) {
    return subscriptionSnapshot(deps, {
      status: 'not_configured',
      source: 'unavailable',
      error: { code: 'not_configured', safeMessage: 'Grok CLI is not logged in' },
    })
  }

  // xAI API：并发读三张表，任一失败按对应错误码抛出
  const [balance, limits, invoice] = await Promise.all([
    fetchManagementJson(config, '/prepaid/balance', deps),
    fetchManagementJson(config, '/postpaid/spending-limits', deps),
    fetchManagementJson(config, '/postpaid/invoice/preview', deps).catch((err) => {
      if (err && (err.code === 'unsupported_version' || err.code === 'malformed')) return null
      throw err
    }),
  ])

  const wallet = mapPrepaidBalance(balance)
  const monthlyWindow = mapMonthlyWindow(limits, invoice)
  const windows = monthlyWindow ? [monthlyWindow] : []

  if (!wallet && windows.length === 0) {
    throw codedError('unsupported_version', 'unexpected billing response')
  }

  const now = deps.now()
  const snapshot = {
    provider: 'grok',
    product: 'mixed',
    windows,
    wallets: wallet ? [wallet] : [],
    source: 'official_api',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
    notices: [subscriptionNotice()],
    action: { label: 'usage', url: USAGE_URLS.subscription, kind: 'open_url' },
  }
  snapshot.status = deriveProviderStatus({ windows, fallback: wallet ? 'healthy' : 'unsupported' })
  return snapshot
}

module.exports = {
  USAGE_URLS,
  MANAGEMENT_BASE,
  CLI_BILLING_BASE,
  subscriptionNotice,
  resolveManagementConfig,
  parseCents,
  mapPrepaidBalance,
  mapMonthlyWindow,
  xaiUserIdFromAccessToken,
  readGrokCliSession,
  readGrokCliCredentials,
  grokCliSessionIsFresh,
  mapCliCreditsWindow,
  mapCliMonthlyWindow,
  resolveGrokBinary,
  resetGrokLoginState,
  isGrokLoginRunning,
  startGrokOAuthLogin,
  fetchQuota,
}
