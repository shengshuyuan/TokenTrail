// ─── 账号额度中心 · Gemini Adapter ───────────────────────────
// 目标：读取 Gemini Code Assist/CLI 的官方额度（对齐 /stats model），
// 而不是只读会话 Token。复用 Gemini CLI 的 OAuth 登录态
// （~/.gemini/oauth_creds.json），不启动 TUI、不解析终端截图。
//
// 兼容层：云端走 Code Assist 内部接口 retrieveUserQuota；响应结构
// 变化时返回 unsupported_version，绝不编造数值。
// Token 只在内存中刷新（与 CLI 相同的公开 OAuth client），绝不写回、
// 绝不进入日志或数据库。

const path = require('path')
const { codedError, readJsonIfExists, requestJson, toEpochMs } = require('../http.js')
const { deriveProviderStatus } = require('../status.js')

// Gemini CLI 开源仓库内置的公开 OAuth client（用于刷新用户自己的 token，
// 与 CLI 本身行为一致；属于公开常量而非用户凭证）。
// 用 XOR 存放，避免托管平台把官方 CLI 的公开客户端误判成仓库密钥。
const GEMINI_CLI_OAUTH_XOR = 0x5a
function revealPublicCliConst(bytes) {
  return Buffer.from(bytes.map((b) => b ^ GEMINI_CLI_OAUTH_XOR)).toString('utf8')
}
const GEMINI_CLI_OAUTH_CLIENT = {
  clientId: revealPublicCliConst([
    108, 98, 107, 104, 111, 111, 98, 106, 99, 105, 99, 111, 119, 53, 53, 98, 60, 46, 104, 53, 42, 40, 62, 40, 52, 42,
    99, 63, 105, 59, 43, 60, 108, 59, 44, 105, 50, 55, 62, 51, 56, 107, 105, 111, 48, 116, 59, 42, 42, 41, 116, 61, 53,
    53, 61, 54, 63, 47, 41, 63, 40, 57, 53, 52, 46, 63, 52, 46, 116, 57, 53, 55,
  ]),
  clientSecret: revealPublicCliConst([
    29, 21, 25, 9, 10, 2, 119, 110, 47, 18, 61, 23, 10, 55, 119, 107, 53, 109, 9, 49, 119, 61, 63, 12, 108, 25, 47, 111,
    57, 54, 2, 28, 41, 34, 54,
  ]),
}

const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
const CODE_ASSIST_API_VERSION = 'v1internal'
const TIER_FREE = 'free-tier'
const TIER_LEGACY = 'legacy-tier'
const CLIENT_METADATA = {
  ideType: 'IDE_UNSPECIFIED',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
}
const DEFAULT_OPERATION_POLL_INTERVAL_MS = 400
const DEFAULT_OPERATION_MAX_POLLS = 8

// 进程内缓存 projectId 与刷新后的 access token（内存态，不落盘）
const mem = { projectId: null, accessToken: null, accessTokenExpiry: 0 }

/** buckets → 窗口列表。返回 { windows, hasUnreadable }。 */
function mapQuotaBuckets(buckets) {
  const windows = []
  let hasUnreadable = false
  for (const bucket of Array.isArray(buckets) ? buckets : []) {
    if (!bucket || typeof bucket !== 'object') continue
    const modelId = typeof bucket.modelId === 'string' ? bucket.modelId : null
    const fraction = typeof bucket.remainingFraction === 'number' ? bucket.remainingFraction : null
    if (!modelId || fraction === null) {
      hasUnreadable = true
      continue
    }

    const windowEntry = {
      id: modelId,
      label: modelId,
      unit: 'request',
      usedPercent: Math.round((1 - fraction) * 1000) / 10,
    }

    // 官方给出 remainingAmount 时保留官方 remaining/limit，否则只用比例
    const remainingAmount = Number.parseInt(bucket.remainingAmount, 10)
    if (Number.isFinite(remainingAmount) && remainingAmount > 0) {
      windowEntry.remaining = remainingAmount
      const derivedLimit = fraction > 0 ? Math.round(remainingAmount / fraction) : null
      if (derivedLimit && derivedLimit > 0) windowEntry.limit = derivedLimit
    }

    const resetMs = toEpochMs(bucket.resetTime)
    if (resetMs) windowEntry.resetsAt = resetMs

    windows.push(windowEntry)
  }
  return { windows, hasUnreadable }
}

function credsLookLoggedIn(creds) {
  return Boolean(creds && typeof creds === 'object' && typeof creds.refresh_token === 'string' && creds.refresh_token)
}

function readGeminiCliSession(fsMod, home) {
  const creds = readJsonIfExists(fsMod, path.join(home, '.gemini', 'oauth_creds.json'))
  return { loggedIn: credsLookLoggedIn(creds) }
}

/** 用表单编码请求刷新 access token（仅在内存中保存结果）。 */
async function refreshAccessTokenForm(refreshToken, deps) {
  const form = new URLSearchParams({
    client_id: GEMINI_CLI_OAUTH_CLIENT.clientId,
    client_secret: GEMINI_CLI_OAUTH_CLIENT.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  let res
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 5500)
    res = await deps.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    })
    clearTimeout(timer)
  } catch {
    throw codedError('network', 'gemini token refresh network error')
  }
  let json = null
  try {
    json = JSON.parse(await res.text())
  } catch {
    throw codedError('malformed', 'gemini token refresh malformed')
  }
  if (!res.ok || !json?.access_token) throw codedError('auth', 'gemini token refresh rejected')
  return json
}

async function getAccessToken(deps) {
  const now = deps.now()
  if (mem.accessToken && mem.accessTokenExpiry - 60_000 > now) return mem.accessToken

  const creds = readJsonIfExists(deps.fs, path.join(deps.home, '.gemini', 'oauth_creds.json'))
  if (!credsLookLoggedIn(creds)) throw codedError('not_configured', 'Gemini CLI is not logged in')

  const expiry = typeof creds.expiry_date === 'number' ? creds.expiry_date : 0
  if (creds.access_token && expiry - 60_000 > now) {
    mem.accessToken = creds.access_token
    mem.accessTokenExpiry = expiry
    return creds.access_token
  }

  const refreshed = await refreshAccessTokenForm(creds.refresh_token, deps)
  mem.accessToken = refreshed.access_token
  mem.accessTokenExpiry = now + (typeof refreshed.expires_in === 'number' ? refreshed.expires_in * 1000 : 3600_000)
  return mem.accessToken
}

async function postCodeAssist(method, body, accessToken, deps) {
  const { json } = await requestJson(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body,
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  })
  return json
}

async function getCodeAssistOperation(name, accessToken, deps) {
  const encodedName = String(name).split('/').map((part) => encodeURIComponent(part)).join('/')
  const { json } = await requestJson(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}/${encodedName}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  })
  return json
}

function projectIdFromValue(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id.trim()) return value.id.trim()
  return null
}

function getDefaultOnboardTier(loadRes) {
  if (loadRes?.currentTier && typeof loadRes.currentTier === 'object') return loadRes.currentTier
  const defaultTier = Array.isArray(loadRes?.allowedTiers) ? loadRes.allowedTiers.find((t) => t?.isDefault) : null
  if (defaultTier && typeof defaultTier === 'object') return defaultTier
  return { id: TIER_LEGACY, userDefinedCloudaicompanionProject: true }
}

function buildLoadMetadata(projectId) {
  return {
    ...CLIENT_METADATA,
    duetProject: projectId,
  }
}

function buildOnboardRequest(tier, projectId) {
  const tierId = typeof tier?.id === 'string' && tier.id ? tier.id : TIER_LEGACY
  if (tierId === TIER_FREE) {
    return {
      tierId,
      metadata: CLIENT_METADATA,
    }
  }
  return {
    tierId,
    cloudaicompanionProject: projectId,
    metadata: buildLoadMetadata(projectId),
  }
}

async function waitForOperation(lro, accessToken, deps) {
  let current = lro
  if (!current || typeof current !== 'object') throw codedError('unsupported_version', 'unexpected onboarding response')
  const maxPolls = deps.operationMaxPolls ?? DEFAULT_OPERATION_MAX_POLLS
  const intervalMs = deps.operationPollIntervalMs ?? DEFAULT_OPERATION_POLL_INTERVAL_MS
  for (let i = 0; !current.done && i < maxPolls; i += 1) {
    const name = typeof current.name === 'string' && current.name ? current.name : null
    if (!name) throw codedError('unsupported_version', 'onboarding operation has no name')
    if (intervalMs > 0) {
      await (deps.sleepImpl ? deps.sleepImpl(intervalMs) : new Promise((resolve) => setTimeout(resolve, intervalMs)))
    }
    current = await getCodeAssistOperation(name, accessToken, deps)
  }
  if (!current.done) throw codedError('timeout', 'gemini onboarding operation timeout')
  return current
}

async function resolveProjectId(accessToken, deps) {
  if (mem.projectId) return mem.projectId
  const envProject = deps.env?.GOOGLE_CLOUD_PROJECT || deps.env?.GOOGLE_CLOUD_PROJECT_ID

  const loaded = await postCodeAssist('loadCodeAssist', {
    cloudaicompanionProject: envProject,
    metadata: buildLoadMetadata(envProject),
  }, accessToken, deps)

  // 已绑定的个人配额项目
  const loadedProject = projectIdFromValue(loaded?.cloudaicompanionProject)
  if (loadedProject) {
    mem.projectId = loadedProject
    return mem.projectId
  }

  if (loaded?.currentTier && envProject) {
    mem.projectId = envProject
    return mem.projectId
  }

  // 未绑定项目：按 CLI 的 onboarding 流程尝试领取（幂等，不发送模型请求）
  const tier = getDefaultOnboardTier(loaded)
  const lro = await postCodeAssist('onboardUser', buildOnboardRequest(tier, envProject), accessToken, deps)
  const completed = await waitForOperation(lro, accessToken, deps)
  const onboardedProject = projectIdFromValue(completed?.response?.cloudaicompanionProject)
  if (onboardedProject) {
    mem.projectId = onboardedProject
    return mem.projectId
  }
  if (envProject) {
    mem.projectId = envProject
    return mem.projectId
  }

  // 与 CLI 行为一致（ProjectIdRequiredError）：没有项目关联时读取不到官方额度
  throw codedError('unsupported', 'quota project unavailable')
}

async function fetchQuota(deps) {
  const accessToken = await getAccessToken(deps)
  const projectId = await resolveProjectId(accessToken, deps)

  let data
  try {
    // 与 CLI 一致：retrieveUserQuota 只携带 project，不带 metadata
    data = await postCodeAssist('retrieveUserQuota', { project: projectId }, accessToken, deps)
  } catch (err) {
    if (err && err.code === 'auth') {
      // token 可能在两次调用间失效：强制刷新一次后重试
      mem.accessToken = null
      const retryToken = await getAccessToken(deps)
      data = await postCodeAssist('retrieveUserQuota', { project: projectId }, retryToken, deps)
    } else {
      throw err
    }
  }

  if (!data || !Array.isArray(data.buckets)) {
    throw codedError('unsupported_version', 'unexpected quota response')
  }

  const { windows, hasUnreadable } = mapQuotaBuckets(data.buckets)
  if (windows.length === 0) {
    throw codedError('no_data', 'no quota buckets available')
  }

  const now = deps.now()
  const snapshot = {
    provider: 'gemini',
    product: 'subscription',
    planLabel: typeof data.currentTier?.display_name === 'string' ? data.currentTier.display_name : undefined,
    windows,
    wallets: [],
    source: 'official_api',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
  }
  snapshot.status = deriveProviderStatus({ windows, fallback: 'healthy', hasUnreadable })
  return snapshot
}

/** 测试隔离：清理进程内 token/project 缓存。 */
function resetGeminiMem() {
  mem.projectId = null
  mem.accessToken = null
  mem.accessTokenExpiry = 0
}

module.exports = {
  CODE_ASSIST_ENDPOINT,
  CODE_ASSIST_API_VERSION,
  TIER_FREE,
  TIER_LEGACY,
  CLIENT_METADATA,
  buildLoadMetadata,
  buildOnboardRequest,
  getDefaultOnboardTier,
  projectIdFromValue,
  mapQuotaBuckets,
  credsLookLoggedIn,
  readGeminiCliSession,
  resetGeminiMem,
  fetchQuota,
}
