// ─── 账号额度中心 · Kiro CLI Adapter ─────────────────────────
// 与 Kiro CLI 的 /usage 命令同源：复用本机 Kiro CLI 登录态，只读调用官方
//   GET https://management.<region>.kiro.dev/Get-Usage-Limits?origin=KIRO_CLI&profileArn=…
// 返回套餐名、本期 credits 已用 / 上限、重置时间、赠送额度（bonus / 免费试用）。
// 另附「今日消耗」窗口，来自本地会话 usage_summary 的真实 credits。
//
// 凭证获取顺序：
//   1. 只读打开 Kiro CLI 凭证库（data.sqlite3 · auth_kv），未过期的 access token 直接用
//   2. 已过期 → 调用 `kiro-cli chat _ get-kas-token`，由 Kiro 自己完成续期并写回凭证库
// 凭证只在内存里使用，绝不落盘、不进日志、不进快照；邮箱 / userId 一律丢弃。

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { codedError, queryString, requestJson, toEpochMs, toFiniteNumber } = require('../http.js')
const { deriveProviderStatus } = require('../status.js')
const { kiroSessionsDir, findKiroTranscripts, parseKiroTranscript } = require('../../kiro.js')

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_REGION = 'us-east-1'
/** Kiro 的「无上限」哨兵值（与 Kiro CLI 一致：limit ≥ 999999 视为不限）。 */
const UNLIMITED_SENTINEL = 999999
const TOKEN_SKEW_MS = 60 * 1000
const CLI_TIMEOUT_MS = 10000

function round2(value) {
  return Math.round(value * 100) / 100
}

/** 本地日界：按运行环境本地时区取当天 0 点。 */
function startOfLocalDay(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ─── 凭证 ────────────────────────────────────────────────────

function kiroDataDbCandidates(home = os.homedir(), platform = process.platform, env = process.env) {
  if (env.KIRO_CLI_DATA_DB) return [env.KIRO_CLI_DATA_DB]
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3')]
  return [path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'kiro-cli', 'data.sqlite3')]
}

function kiroCliCandidates(home = os.homedir(), env = process.env) {
  return [
    env.KIRO_CLI_BIN,
    path.join(home, '.local', 'bin', 'kiro-cli'),
    '/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli',
  ].filter(Boolean)
}

/** 只读读取凭证库里未过期的 token；读不到 / 已过期返回 null。 */
function readStoredKiroToken({ home, now, fsMod = fs, env = process.env } = {}) {
  const dbPath = kiroDataDbCandidates(home, process.platform, env).find((p) => fsMod.existsSync(p))
  if (!dbPath) return null
  let db
  try {
    const Database = require('better-sqlite3')
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const rows = db.prepare("SELECT value FROM auth_kv WHERE key LIKE 'kirocli:%token'").all()
    let profileArn
    try {
      const state = db.prepare("SELECT value FROM state WHERE key = 'api.codewhisperer.profile'").get()
      profileArn = state ? JSON.parse(state.value)?.arn : undefined
    } catch {
      profileArn = undefined
    }
    for (const row of rows) {
      let token
      try {
        token = JSON.parse(row.value)
      } catch {
        continue
      }
      const accessToken = typeof token?.access_token === 'string' ? token.access_token : ''
      const expiresAt = toEpochMs(token?.expires_at)
      if (!accessToken || !expiresAt || expiresAt - now <= TOKEN_SKEW_MS) continue
      return { accessToken, profileArn: token.profile_arn || profileArn }
    }
    return null
  } catch {
    return null
  } finally {
    if (db) db.close()
  }
}

/**
 * 让 Kiro CLI 自己续期并返回 token（与 Kiro TUI 取 token 的方式一致）。
 * 返回 null = 本机没有 Kiro CLI；失败时带 failure 区分超时 / 未登录 / 输出异常。
 */
function tokenFromKiroCli({ home, fsMod = fs, env = process.env, execFileImpl = execFile } = {}) {
  const bin = kiroCliCandidates(home, env).find((p) => fsMod.existsSync(p))
  if (!bin) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFileImpl(bin, ['chat', '_', 'get-kas-token'], { timeout: CLI_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        if (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') return resolve({ failure: 'timeout' })
        if (err.code === 'ENOENT' || err.code === 'EACCES') return resolve({ failure: 'not_configured' })
        // Non-zero exit: the CLI could not produce a token (signed out / refresh rejected).
        return resolve({ failure: 'auth' })
      }
      try {
        const parsed = JSON.parse(String(stdout).trim())
        const data = parsed?.data
        if (parsed?.kind === 'getKasToken' && typeof data?.accessToken === 'string' && data.accessToken) {
          return resolve({ accessToken: data.accessToken, profileArn: data.profileArn })
        }
      } catch {
        // fall through
      }
      resolve({ failure: 'malformed' })
    })
  })
}

const CLI_FAILURE_MESSAGES = {
  timeout: 'Kiro CLI token helper timed out',
  not_configured: 'Kiro CLI could not be started',
  auth: 'Kiro CLI login expired',
  malformed: 'unexpected Kiro CLI token output',
}

/** Token via the Kiro CLI; throws a coded error describing why it failed. */
async function cliTokenOrThrow(deps) {
  const fromCli = await (deps.kiroCliToken || tokenFromKiroCli)({ home: deps.home })
  if (!fromCli) throw codedError('not_configured', 'Kiro CLI is not installed or not logged in')
  if (fromCli.failure) throw codedError(fromCli.failure, CLI_FAILURE_MESSAGES[fromCli.failure])
  return fromCli
}

/** 优先用凭证库里未过期的 token；没有则让 Kiro CLI 续期。stored 标记来源，便于 401 时重试。 */
async function resolveKiroAuth(deps) {
  const stored = (deps.kiroStoredToken || readStoredKiroToken)({ home: deps.home, now: deps.now() })
  if (stored) return { ...stored, stored: true }
  return cliTokenOrThrow(deps)
}

function regionFromProfileArn(arn) {
  const match = typeof arn === 'string' ? arn.match(/^arn:aws:codewhisperer:([a-z0-9-]+):/) : null
  return match ? match[1] : DEFAULT_REGION
}

// ─── 响应映射 ────────────────────────────────────────────────

function creditWindow({ id, label, used, limit, resetsAt }) {
  const win = { id, label, unit: 'credit', used: round2(used) }
  if (limit > 0 && limit < UNLIMITED_SENTINEL) {
    win.limit = round2(limit)
    win.remaining = round2(Math.max(0, limit - used))
    win.usedPercent = Math.round((used / limit) * 1000) / 10
  }
  if (resetsAt) win.resetsAt = resetsAt
  return win
}

/**
 * GetUsageLimits → 额度窗口。字段口径与 Kiro CLI /usage 一致：
 * currentUsageWithPrecision / usageLimitWithPrecision，limit ≥ 999999 视为不限。
 */
function mapUsageLimits(json, now) {
  const list = json && Array.isArray(json.usageBreakdownList) ? json.usageBreakdownList : null
  if (!list) throw codedError('unsupported_version', 'unexpected Kiro usage limits response')

  const windows = []
  const wallets = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const resource = String(item.resourceType || 'credit').toLowerCase()
    const used = toFiniteNumber(item.currentUsageWithPrecision) ?? toFiniteNumber(item.currentUsage) ?? 0
    const limit = toFiniteNumber(item.usageLimitWithPrecision) ?? toFiniteNumber(item.usageLimit) ?? 0
    const resetsAt = toEpochMs(item.nextDateReset ?? json.nextDateReset) ?? undefined
    const main = creditWindow({ id: `kiro-${resource}`, label: 'month', used, limit, resetsAt })
    windows.push(main)
    if (typeof main.remaining === 'number' && wallets.length === 0) {
      wallets.push({ label: 'kiro-remaining', balance: main.remaining, currency: 'credits' })
    }

    const trial = item.freeTrialInfo
    if (trial && trial.freeTrialStatus === 'ACTIVE') {
      windows.push(creditWindow({
        id: `kiro-${resource}-trial`,
        label: 'Welcome bonus',
        used: toFiniteNumber(trial.currentUsageWithPrecision) ?? toFiniteNumber(trial.currentUsage) ?? 0,
        limit: toFiniteNumber(trial.usageLimitWithPrecision) ?? toFiniteNumber(trial.usageLimit) ?? 0,
        resetsAt: toEpochMs(trial.freeTrialExpiry) ?? undefined,
      }))
    }
    const bonuses = Array.isArray(item.bonuses) ? item.bonuses : []
    bonuses.forEach((bonus, index) => {
      if (!bonus || (bonus.status !== 'ACTIVE' && bonus.status !== 'EXHAUSTED')) return
      windows.push(creditWindow({
        id: `kiro-${resource}-bonus-${index}`,
        label: typeof bonus.displayName === 'string' && bonus.displayName ? bonus.displayName : 'Bonus',
        used: toFiniteNumber(bonus.currentUsage) ?? 0,
        limit: toFiniteNumber(bonus.usageLimit) ?? 0,
        resetsAt: toEpochMs(bonus.expiresAt) ?? undefined,
      }))
    })
  }
  if (windows.length === 0) throw codedError('no_data', 'no Kiro usage limits available')

  const title = json.subscriptionInfo?.subscriptionTitle
  return {
    provider: 'kiro',
    product: 'subscription',
    planLabel: typeof title === 'string' && title.trim() ? title.trim() : undefined,
    accountLabel: 'Kiro CLI',
    status: deriveProviderStatus({ windows }),
    windows,
    wallets,
    source: 'official_api',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
  }
}

/** 本地会话里今天已消耗的 credits（usage_summary 实测值）。读不到返回 null。 */
function localCreditsToday(deps) {
  const fsMod = deps.fs || fs
  const sessionsDir = kiroSessionsDir(deps.home)
  if (!fsMod.existsSync(sessionsDir)) return null
  const dayStart = startOfLocalDay(deps.now())
  let today = 0
  let seen = false
  for (const file of findKiroTranscripts(fsMod, sessionsDir)) {
    for (const rec of parseKiroTranscript(fsMod, file)) {
      seen = true
      if (rec.timestamp >= dayStart) today += rec.credits
    }
  }
  return seen ? round2(today) : null
}

function usageLimitsUrl(profileArn) {
  return `https://management.${regionFromProfileArn(profileArn)}.kiro.dev/Get-Usage-Limits?${queryString({
    origin: 'KIRO_CLI',
    profileArn,
  })}`
}

function requestUsageLimits(auth, deps) {
  return requestJson(usageLimitsUrl(auth.profileArn), {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  })
}

async function fetchQuota(deps) {
  const auth = await (deps.kiroResolveAuth || resolveKiroAuth)(deps)
  if (!auth || !auth.accessToken) throw codedError('not_configured', 'Kiro CLI is not logged in')

  let json
  try {
    ;({ json } = await requestUsageLimits(auth, deps))
  } catch (err) {
    // A stored token can be revoked before its local expiry: let the CLI refresh once.
    if (!(err && err.code === 'auth' && auth.stored)) throw err
    ;({ json } = await requestUsageLimits(await cliTokenOrThrow(deps), deps))
  }

  const now = deps.now()
  const snapshot = mapUsageLimits(json, now)
  const today = localCreditsToday(deps)
  if (today !== null) {
    snapshot.windows.push({
      id: 'kiro-today',
      label: 'today',
      unit: 'credit',
      used: today,
      windowMinutes: 1440,
      resetsAt: startOfLocalDay(now) + DAY_MS,
    })
  }
  return snapshot
}
// Worst case: CLI token refresh (≤10s) + HTTP (≤5.5s), plus one 401 retry.
fetchQuota.timeoutMs = 20000

module.exports = {
  DAY_MS,
  startOfLocalDay,
  regionFromProfileArn,
  readStoredKiroToken,
  tokenFromKiroCli,
  cliTokenOrThrow,
  resolveKiroAuth,
  mapUsageLimits,
  localCreditsToday,
  fetchQuota,
}
