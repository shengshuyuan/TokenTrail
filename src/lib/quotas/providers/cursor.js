// ─── 账号额度中心 · Cursor Adapter ───────────────────────────
// 复用本机 Cursor 登录态读取官方 GET https://cursor.com/api/usage-summary：
// - individualUsage.plan：套餐内含额度（单位美分），apiPercentUsed 为指定模型
//   消耗占比，totalPercentUsed 为含 Auto 在内的总占比（与 Cursor 后台展示一致）
// - individualUsage.onDemand：超出套餐后的按量付费额度（开启时才展示）
// - billingCycleStart / billingCycleEnd：计费周期，周期结束即重置
// 凭证只在服务端内存出现；邮箱、用户 ID 等账号隐私字段绝不进入快照。

const cursorLib = require('../../cursor.js')
const { codedError, requestJson, toEpochMs, toFiniteNumber } = require('../http.js')
const { deriveProviderStatus } = require('../status.js')

function roundPercent(value) {
  return Math.round(value * 10) / 10
}

/** 与其他 Provider 一致：额度行只展示百分比，不展示美元金额。 */
function percentWindow({ id, label, usedPercent, windowMinutes, resetsAt }) {
  const win = { id, label, unit: 'request' }
  if (usedPercent !== null && usedPercent !== undefined) {
    win.usedPercent = roundPercent(usedPercent)
  }
  if (windowMinutes) win.windowMinutes = windowMinutes
  if (resetsAt) win.resetsAt = resetsAt
  return win
}

function mapUsageSummary(json, now) {
  const individual = json && typeof json === 'object' ? json.individualUsage : null
  if (!individual || typeof individual !== 'object') {
    throw codedError('unsupported_version', 'unexpected cursor usage summary')
  }

  const cycleStart = toEpochMs(json.billingCycleStart)
  const cycleEnd = toEpochMs(json.billingCycleEnd)
  const windowMinutes = cycleStart && cycleEnd && cycleEnd > cycleStart
    ? Math.round((cycleEnd - cycleStart) / 60000)
    : undefined
  const resetsAt = cycleEnd ?? undefined

  const windows = []
  const plan = individual.plan
  if (plan && typeof plan === 'object' && plan.enabled !== false) {
    const apiPercent = toFiniteNumber(plan.apiPercentUsed)
    if (apiPercent !== null) {
      windows.push(percentWindow({
        id: 'cursor-api',
        label: 'api',
        usedPercent: apiPercent,
        windowMinutes,
        resetsAt,
      }))
    }
    const autoPercent = toFiniteNumber(plan.autoPercentUsed)
    if (autoPercent !== null) {
      windows.push(percentWindow({
        id: 'cursor-auto',
        label: 'auto',
        usedPercent: autoPercent,
        windowMinutes,
        resetsAt,
      }))
    }
    const totalPercent = toFiniteNumber(plan.totalPercentUsed)
    if (totalPercent !== null) {
      windows.push(percentWindow({
        id: 'cursor-total',
        label: 'total',
        usedPercent: totalPercent,
        windowMinutes,
        resetsAt,
      }))
    }
  }

  const onDemand = individual.onDemand
  if (onDemand && typeof onDemand === 'object' && onDemand.enabled === true) {
    const used = toFiniteNumber(onDemand.used)
    const limit = toFiniteNumber(onDemand.limit)
    const usedPercent = used !== null && limit ? (used / limit) * 100 : null
    if (usedPercent !== null) {
      windows.push(percentWindow({
        id: 'cursor-on-demand',
        label: 'on-demand',
        usedPercent,
        windowMinutes,
        resetsAt,
      }))
    }
  }

  if (windows.length === 0) throw codedError('no_data', 'no cursor usage data available')

  const membership = typeof json.membershipType === 'string' && json.membershipType ? json.membershipType : ''
  const planName = membership ? `Cursor ${membership.charAt(0).toUpperCase()}${membership.slice(1)}` : 'Cursor'

  return {
    provider: 'cursor',
    product: 'subscription',
    planLabel: planName,
    status: json.isUnlimited === true ? 'healthy' : deriveProviderStatus({ windows }),
    windows,
    wallets: [],
    source: 'official_api',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
  }
}

async function fetchQuota(deps) {
  const readSession = deps.readCursorSession || cursorLib.readCursorSession
  const session = readSession({ home: deps.home, now: deps.now() })
  if (!session || !session.ok) {
    if (session && session.reason === 'expired') throw codedError('auth', 'Cursor login expired')
    throw codedError('not_configured', 'Cursor is not logged in')
  }
  const { json } = await requestJson(cursorLib.USAGE_SUMMARY_URL, {
    headers: cursorLib.cursorRequestHeaders(session),
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  })
  return mapUsageSummary(json, deps.now())
}

module.exports = { mapUsageSummary, fetchQuota }
