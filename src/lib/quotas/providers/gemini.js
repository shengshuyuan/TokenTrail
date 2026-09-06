const path = require('path')
const { execFile } = require('child_process')
const { codedError, readJsonIfExists, toEpochMs } = require('../http.js')
const { deriveProviderStatus } = require('../status.js')
const { resolveCliBinary } = require('../cli-login.js')

const TOKEN_REL = path.join('.gemini', 'antigravity-cli', 'antigravity-oauth-token')
const PRINT_TIMEOUT = '10s'
const AGY_EXEC_TIMEOUT_MS = 15_000

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CLOUDCODE_QUOTA_URLS = [
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
]

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** OAuth client comes from the local token file or injected deps — never hardcoded in source. */
function resolveAgyOAuthClient(creds, env = {}) {
  const token = creds?.token && typeof creds.token === 'object' ? creds.token : {}
  const clientId = firstNonEmptyString(token.client_id, creds?.client_id, env.ANTIGRAVITY_OAUTH_CLIENT_ID)
  const clientSecret = firstNonEmptyString(token.client_secret, creds?.client_secret, env.ANTIGRAVITY_OAUTH_CLIENT_SECRET)
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function tokenPath(home) {
  return path.join(home, TOKEN_REL)
}

function credsLookLoggedIn(creds) {
  const token = creds && typeof creds === 'object' ? creds.token : null
  return Boolean(token && typeof token === 'object' && typeof token.refresh_token === 'string' && token.refresh_token)
}

function readAntigravityAccountEmail(fsMod, home) {
  try {
    const cliLog = path.join(home, '.gemini', 'antigravity-cli', 'cli.log')
    if (fsMod && fsMod.existsSync && fsMod.existsSync(cliLog)) {
      const content = fsMod.readFileSync(cliLog, 'utf8')
      const m = content.match(/authenticated successfully as ([^\s,]+)/) || content.match(/email=([^,\s]+)/)
      if (m && m[1]) return m[1].trim()
    }
  } catch {
    // ignore
  }
  return null
}

function readAntigravityCliSession(fsMod, home) {
  const creds = readJsonIfExists(fsMod, tokenPath(home))
  return { loggedIn: credsLookLoggedIn(creds) }
}

/** 兼容旧调用名：Gemini 额度现在读 Antigravity 登录态。 */
function readGeminiCliSession(fsMod, home) {
  return readAntigravityCliSession(fsMod, home)
}

function slugId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'window'
}

function windowKind(remainingLabel) {
  const text = String(remainingLabel || '').toLowerCase()
  if (text.includes('five hour') || text.includes('5 hour') || /\b5h\b/.test(text)) {
    return { idSuffix: '5h', labelSuffix: '5h', windowMinutes: 300 }
  }
  if (text.includes('week')) {
    return { idSuffix: 'week', labelSuffix: 'week', windowMinutes: 10080 }
  }
  return { idSuffix: slugId(remainingLabel), labelSuffix: remainingLabel || 'limit', windowMinutes: undefined }
}

function parseRemainingPercent(value) {
  const match = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*%$/)
  if (!match) return null
  const remaining = Number(match[1])
  if (!Number.isFinite(remaining)) return null
  return Math.min(100, Math.max(0, remaining))
}

/** 解析官方 CloudCode Quota Summary JSON 响应 */
function parseUserQuotaSummary(data) {
  const windows = []
  if (!data || !Array.isArray(data.groups)) return { windows, hasUnreadable: true }

  for (const group of data.groups) {
    const groupName = group.displayName || 'Models'
    const buckets = Array.isArray(group.buckets) ? group.buckets : []
    for (const bucket of buckets) {
      const remainingFrac = typeof bucket.remainingFraction === 'number' ? bucket.remainingFraction : null
      if (remainingFrac === null || !Number.isFinite(remainingFrac)) continue

      const usedPercent = Math.round(Math.max(0, Math.min(100, (1 - remainingFrac) * 100)) * 10) / 10
      const kind = windowKind(bucket.window || bucket.displayName)
      const windowEntry = {
        id: `${slugId(groupName)}-${kind.idSuffix}`,
        label: `${groupName} · ${kind.labelSuffix}`,
        unit: 'request',
        usedPercent,
      }
      if (kind.windowMinutes) windowEntry.windowMinutes = kind.windowMinutes
      const resetMs = toEpochMs(bucket.resetTime)
      if (resetMs) windowEntry.resetsAt = resetMs
      windows.push(windowEntry)
    }
  }
  return { windows, hasUnreadable: windows.length === 0 }
}

/** `agy -p "/usage"` 官方 TSV：group \t remaining-label \t 97% \t ISO reset */
function parseAgyUsageTsv(stdout) {
  const windows = []
  let hasUnreadable = false
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (const line of lines) {
    const cols = line.split('\t').map((part) => part.trim())
    if (cols.length < 3) {
      hasUnreadable = true
      continue
    }
    const remaining = parseRemainingPercent(cols[2])
    if (remaining === null) {
      hasUnreadable = true
      continue
    }
    const kind = windowKind(cols[1])
    const group = cols[0] || 'Models'
    const windowEntry = {
      id: `${slugId(group)}-${kind.idSuffix}`,
      label: `${group} · ${kind.labelSuffix}`,
      unit: 'request',
      usedPercent: Math.round((100 - remaining) * 10) / 10,
    }
    if (kind.windowMinutes) windowEntry.windowMinutes = kind.windowMinutes
    const resetMs = toEpochMs(cols[3])
    if (resetMs) windowEntry.resetsAt = resetMs
    windows.push(windowEntry)
  }
  return { windows, hasUnreadable }
}

/** `agy -p "/credits"`：Remaining credits \t 0 */
function parseAgyCreditsTsv(stdout) {
  const wallets = []
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (const line of lines) {
    const cols = line.split('\t').map((part) => part.trim())
    if (cols.length < 2) continue
    if (!/^remaining credits$/i.test(cols[0])) continue
    const balance = Number(cols[1])
    if (!Number.isFinite(balance)) continue
    wallets.push({ label: 'G1 credits', balance, currency: 'credit' })
  }
  return wallets
}

/**
 * 主动检查并使用 refresh_token 向 Google OAuth 换取新 access_token，
 * 并写回 ~/.gemini/antigravity-cli/antigravity-oauth-token，避免过期。
 */
async function refreshAntigravityToken(deps, options = {}) {
  const fsMod = deps.fs
  const filePath = tokenPath(deps.home)
  const creds = readJsonIfExists(fsMod, filePath)
  if (!credsLookLoggedIn(creds)) {
    return { ok: false, reason: 'not_logged_in' }
  }

  const token = creds.token
  const nowMs = deps.now ? deps.now() : Date.now()
  const expiryMs = toEpochMs(token.expiry)

  // 如果 Token 仍在有效期内（剩余 > 5 分钟）且未强制刷新，直接返回
  if (!options.force && token.access_token && expiryMs && expiryMs - nowMs > 5 * 60 * 1000) {
    return { ok: true, access_token: token.access_token, fresh: true }
  }

  const oauthClient = resolveAgyOAuthClient(creds, deps.env)
  if (!oauthClient) {
    return token.access_token
      ? { ok: true, access_token: token.access_token, reason: 'no_oauth_client' }
      : { ok: false, reason: 'no_oauth_client' }
  }

  const fetchImpl = deps.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return token.access_token ? { ok: true, access_token: token.access_token } : { ok: false, reason: 'no_fetch' }
  }

  try {
    const postBody = new URLSearchParams({
      client_id: oauthClient.clientId,
      client_secret: oauthClient.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }).toString()

    const resp = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postBody,
    })

    if (!resp.ok) {
      if (resp.status === 400 || resp.status === 401) {
        return { ok: false, status: resp.status, reason: 'invalid_grant' }
      }
      return { ok: false, status: resp.status, reason: 'http_error' }
    }

    const data = await resp.json()
    if (!data || !data.access_token) {
      return { ok: false, reason: 'invalid_token_response' }
    }

    const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600
    const newExpiry = new Date(nowMs + expiresInSec * 1000).toISOString()

    token.access_token = data.access_token
    token.expiry = newExpiry
    if (data.token_type) token.token_type = data.token_type

    // 写回本地文件，保持权限与格式
    try {
      if (fsMod && typeof fsMod.writeFileSync === 'function') {
        fsMod.writeFileSync(filePath, JSON.stringify(creds, null, 2), { encoding: 'utf8', mode: 0o600 })
      }
    } catch {
      // 忽略文件写回失败（如只读/mock 文件系统）
    }

    return { ok: true, access_token: data.access_token, refreshed: true }
  } catch (err) {
    return { ok: false, reason: 'network_error', error: err }
  }
}

/** 通过官方 CloudCode API 直接获取结构化额度摘要 */
async function fetchCloudCodeQuota(accessToken, deps) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function' || !accessToken) return null

  for (const url of CLOUDCODE_QUOTA_URLS) {
    try {
      const resp = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Antigravity-CLI',
        },
        body: '{}',
      })
      if (resp.status === 200) {
        const json = await resp.json()
        const parsed = parseUserQuotaSummary(json)
        if (parsed.windows && parsed.windows.length > 0) {
          return parsed
        }
      }
    } catch {
      // 尝试下一个备用地址
    }
  }
  return null
}

function looksLikeAuthFailure(stderr, stdout) {
  // 如果 stdout 包含标准制表符与百分比，说明 CLI 已成功输出额度，不按错误处理
  if (typeof stdout === 'string' && stdout.includes('\t') && stdout.includes('%')) {
    return false
  }
  const text = `${stderr || ''}\n${stdout || ''}`
  // 过滤掉启动阶段正常的尝试静默登录日志："Print mode: not authenticated, trying silent auth"
  if (/not authenticated,\s*trying silent auth/i.test(text) && !/silent auth failed/i.test(text)) {
    return false
  }
  return /silent auth failed|error getting token source:\s*you are not logged into antigravity|please sign in|login required|unauthorized/i.test(text)
}

function runAgyPrint(slash, deps) {
  const bin = resolveCliBinary('agy', deps)
  if (!bin) throw codedError('not_configured', 'Antigravity CLI is not installed')
  const timeoutMs = Math.max(AGY_EXEC_TIMEOUT_MS, deps.timeoutMs ?? 0)
  const args = ['--print-timeout', deps.printTimeout || PRINT_TIMEOUT, '-p', slash]
  const execImpl = deps.execFileImpl
  if (execImpl) {
    return Promise.resolve(execImpl(bin, args, { timeout: timeoutMs, encoding: 'utf8' })).then((result) => {
      if (result && typeof result.stdout === 'string') return result
      return { stdout: String(result || ''), stderr: '' }
    })
  }
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        env: { ...process.env, ...(deps.env || {}) },
        // agy 会从 stdin 等输入；管道 stdin 会让 print 模式一直挂起
        stdio: ['ignore', 'pipe', 'pipe'],
      },
      (err, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : ''
        const errOut = typeof stderr === 'string' ? stderr : ''
        if (out.trim()) {
          resolve({ stdout: out, stderr: errOut })
          return
        }
        if (err) {
          if (err.killed || err.code === 'ETIMEDOUT') {
            reject(codedError('timeout', 'agy print timeout'))
            return
          }
          reject(codedError('network', 'agy print failed'))
          return
        }
        resolve({ stdout: out, stderr: errOut })
      },
    )
  })
}

async function fetchQuota(deps) {
  if (!readAntigravityCliSession(deps.fs, deps.home).loggedIn) {
    throw codedError('not_configured', 'Antigravity CLI is not logged in')
  }

  let windows = null
  let hasUnreadable = false

  // 1. 如果没有强制注入 execFileImpl（生产环境或常规刷新），优先主动刷新 OAuth Token 并直连官方 Quota Summary API
  if (!deps.execFileImpl) {
    try {
      const refreshed = await refreshAntigravityToken(deps)
      if (refreshed.ok && refreshed.access_token) {
        const quotaData = await fetchCloudCodeQuota(refreshed.access_token, deps)
        if (quotaData && quotaData.windows && quotaData.windows.length > 0) {
          windows = quotaData.windows
          hasUnreadable = quotaData.hasUnreadable
        }
      } else if (refreshed.reason === 'invalid_grant') {
        throw codedError('auth', 'Antigravity OAuth refresh token expired')
      }
    } catch (e) {
      if (e && e.code === 'auth') throw e
      // 降级使用 agy CLI
    }
  }

  // 2. 如果直连 API 未获取到数据（或处于 execFileImpl 单测环境），回退到 agy CLI print 模式
  if (!windows || windows.length === 0) {
    if (!resolveCliBinary('agy', deps)) {
      throw codedError('not_configured', 'Antigravity CLI is not installed')
    }

    const usage = await runAgyPrint('/usage', deps)

    if (looksLikeAuthFailure(usage.stderr, usage.stdout)) {
      throw codedError('auth', 'Antigravity CLI login expired')
    }

    const parsed = parseAgyUsageTsv(usage.stdout)
    windows = parsed.windows
    hasUnreadable = parsed.hasUnreadable

    if (windows.length === 0) {
      if (hasUnreadable || String(usage.stdout || '').trim()) {
        throw codedError('unsupported_version', 'unexpected agy usage output')
      }
      throw codedError('no_data', 'no quota windows from agy')
    }
  }

  const now = deps.now()
  const snapshot = {
    provider: 'gemini',
    product: 'subscription',
    planLabel: 'Antigravity',
    windows,
    wallets: [],
    source: 'local_cli',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
  }
  snapshot.status = deriveProviderStatus({ windows, fallback: 'healthy', hasUnreadable })
  return snapshot
}

fetchQuota.timeoutMs = AGY_EXEC_TIMEOUT_MS

module.exports = {
  TOKEN_REL,
  credsLookLoggedIn,
  readAntigravityAccountEmail,
  readAntigravityCliSession,
  readGeminiCliSession,
  parseAgyUsageTsv,
  parseAgyCreditsTsv,
  parseUserQuotaSummary,
  refreshAntigravityToken,
  fetchCloudCodeQuota,
  looksLikeAuthFailure,
  fetchQuota,
}
