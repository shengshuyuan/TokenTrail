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
const { codedError, queryString, readJsonIfExists, requestJson, toEpochMs, toFiniteNumber } = require('../http.js')
const { deriveProviderStatus } = require('../status.js')

// 固定白名单外链，禁止用户输入任意 URL
const USAGE_URLS = {
  subscription: 'https://grok.com/settings',
  api: 'https://console.x.ai',
}

const MANAGEMENT_BASE = 'https://management-api.x.ai/v1/billing/teams'
const CLI_BILLING_BASE = 'https://cli-chat-proxy.grok.com/v1/billing'
const OIDC_ISSUER = 'https://auth.x.ai'
const OIDC_TOKEN_URL = 'https://auth.x.ai/oauth2/token'
/** 与 Grok CLI 默认 GROK_AUTH_EARLY_INVALIDATION_SECS=300 对齐：到期前 5 分钟静默续期。 */
const TOKEN_SKEW_MS = 5 * 60 * 1000
const DEFAULT_ACCESS_TTL_MS = 6 * 60 * 60 * 1000

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

function grokAuthPath(home) {
  return path.join(home, '.grok', 'auth.json')
}

function normalizeIssuer(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  return value.trim().replace(/\/+$/, '')
}

function clientIdFromSession(sessionKey, session) {
  if (typeof session?.oidc_client_id === 'string' && session.oidc_client_id.trim()) {
    return session.oidc_client_id.trim()
  }
  if (typeof sessionKey !== 'string') return ''
  const parts = sessionKey.split('::')
  return parts.length >= 2 ? parts[parts.length - 1].trim() : ''
}

/**
 * 读取 Grok CLI 浏览器 OAuth 登录态。
 * 只返回是否已登录、过期时间、是否可静默续期，绝不带回 token / email / team_id。
 */
function readGrokCliSession(fsMod, home) {
  const creds = readGrokCliCredentials(fsMod, home)
  if (!creds) return null
  return {
    loggedIn: true,
    expiresAt: creds.expiresAt,
    hasRefreshToken: Boolean(creds.refreshToken),
  }
}

function readGrokCliCredentials(fsMod, home) {
  if (!fsMod || !home) return null
  const authPath = grokAuthPath(home)
  const auth = readJsonIfExists(fsMod, authPath)
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return null

  for (const [sessionKey, session] of Object.entries(auth)) {
    if (!session || typeof session !== 'object') continue
    const token = typeof session.key === 'string' ? session.key : session.access_token
    const refresh = typeof session.refresh_token === 'string' ? session.refresh_token.trim() : ''
    if (typeof token !== 'string' || !token.trim()) {
      if (!refresh) continue
    }
    const access = typeof token === 'string' ? token.trim() : ''
    if (!access && !refresh) continue
    const userId = session.user_id ?? session.userId ?? session.userid ?? session.id ?? xaiUserIdFromAccessToken(access)
    return {
      loggedIn: true,
      token: access,
      refreshToken: refresh,
      clientId: clientIdFromSession(sessionKey, session),
      issuer: normalizeIssuer(session.oidc_issuer) || OIDC_ISSUER,
      userId: typeof userId === 'string' && userId.trim() ? userId.trim() : undefined,
      expiresAt: parseSessionExpiry(session.expires_at),
      authPath,
      sessionKey,
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
  if (session.hasRefreshToken || session.refreshToken) return true
  if (typeof session.expiresAt !== 'number') return true
  return session.expiresAt > now
}

function accessTokenIsUsable(creds, now) {
  if (!creds || typeof creds.token !== 'string' || !creds.token) return false
  if (typeof creds.expiresAt !== 'number') return true
  return creds.expiresAt > now + TOKEN_SKEW_MS
}

function persistGrokCliTokens(fsMod, creds, patch) {
  if (!fsMod || typeof fsMod.writeFileSync !== 'function' || !creds?.authPath || !creds?.sessionKey) return false
  const auth = readJsonIfExists(fsMod, creds.authPath)
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return false
  const session = auth[creds.sessionKey]
  if (!session || typeof session !== 'object') return false
  Object.assign(session, patch)
  try {
    fsMod.writeFileSync(creds.authPath, `${JSON.stringify(auth, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    if (typeof fsMod.chmodSync === 'function') fsMod.chmodSync(creds.authPath, 0o600)
    return true
  } catch {
    return false
  }
}

async function refreshGrokOAuthCredentials(creds, deps) {
  if (!creds?.refreshToken || !creds.clientId) {
    throw codedError('auth', 'Grok CLI login expired')
  }
  if ((creds.issuer || OIDC_ISSUER) !== OIDC_ISSUER) {
    throw codedError('auth', 'Grok CLI login expired')
  }

  const { json } = await requestJson(OIDC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: queryString({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.clientId,
    }),
    rawBody: true,
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  })

  const access = typeof json?.access_token === 'string' ? json.access_token.trim() : ''
  if (!access) throw codedError('unsupported_version', 'unexpected grok oauth refresh response')

  const expiresInSec = toFiniteNumber(json.expires_in)
  const ttlMs = expiresInSec && expiresInSec > 0 ? Math.round(expiresInSec * 1000) : DEFAULT_ACCESS_TTL_MS
  const expiresAtMs = deps.now() + ttlMs
  const nextRefresh =
    typeof json.refresh_token === 'string' && json.refresh_token.trim()
      ? json.refresh_token.trim()
      : creds.refreshToken

  persistGrokCliTokens(deps.fs, creds, {
    key: access,
    refresh_token: nextRefresh,
    expires_at: new Date(expiresAtMs).toISOString(),
  })

  return {
    ...creds,
    token: access,
    refreshToken: nextRefresh,
    expiresAt: expiresAtMs,
    userId: creds.userId || xaiUserIdFromAccessToken(access),
  }
}

async function ensureFreshGrokCliCredentials(deps) {
  const creds = readGrokCliCredentials(deps.fs, deps.home)
  if (!creds) return null
  if (accessTokenIsUsable(creds, deps.now())) return creds
  if (!creds.refreshToken) return null
  return refreshGrokOAuthCredentials(creds, deps)
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
  let cliCreds = null
  try {
    cliCreds = await ensureFreshGrokCliCredentials(deps)
  } catch (err) {
    if (err && err.code === 'auth' && !config) throw err
    if (err && err.code === 'auth') cliCreds = null
    else throw err
  }
  const cliFresh = grokCliSessionIsFresh(cliCreds, deps.now()) && Boolean(cliCreds?.token)

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
  OIDC_TOKEN_URL,
  TOKEN_SKEW_MS,
  subscriptionNotice,
  resolveManagementConfig,
  parseCents,
  mapPrepaidBalance,
  mapMonthlyWindow,
  xaiUserIdFromAccessToken,
  readGrokCliSession,
  readGrokCliCredentials,
  grokCliSessionIsFresh,
  accessTokenIsUsable,
  mapCliCreditsWindow,
  mapCliMonthlyWindow,
  resolveGrokBinary,
  resetGrokLoginState,
  isGrokLoginRunning,
  startGrokOAuthLogin,
  fetchQuota,
}
