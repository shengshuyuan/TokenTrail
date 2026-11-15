// ─── 账号额度中心 · WorkBuddy Adapter ────────────────────────
// WorkBuddy 的额度只在自己网页里（/profile/credits-usage），本地没有缓存，
// 也没法在不碰登录态的前提下读到「剩余积分」。所以这里只做能对账的部分：
//
//   1. 已消耗积分：读 ~/.workbuddy/workbuddy.db · session_usage.credit_json，
//      用的是官方扣费值，不是「token × 倍率」推出来的。
//   2. 剩余积分：本地读不到。用户可在官网看到后写进本地配置
//      WORKBUDDY_CREDITS_BALANCE，这里只做展示，不猜、不留假 0%。
//
// 保留期提醒：credit_json 会被 WorkBuddy 滚动清理，所以「本月」在首次同步之前
// 是偏低的；TokenTrail 自己的 usage_records 才是长期账本（source = workbuddy）。

const fs = require('fs')
const path = require('path')
const { codedError, toFiniteNumber } = require('../http.js')
const { deriveProviderStatus } = require('../status.js')
const { collectCredits } = require('../../workbuddy.js')

const DAY_MS = 24 * 60 * 60 * 1000
const CREDITS_URL = 'https://www.workbuddy.cn/profile/credits-usage'

function round2(value) {
  return Math.round(value * 100) / 100
}

function startOfLocalDay(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfLocalMonth(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  return d.getTime()
}

function workbuddyRoot(deps) {
  const env = deps.env || process.env
  if (env.WORKBUDDY_HOME) return env.WORKBUDDY_HOME
  return path.join(deps.home, '.workbuddy')
}

/** 本地已扣积分按今天 / 近 7 天 / 本月汇总；没有任何记录返回 null。 */
function localCreditTotals(root, now) {
  if (!fs.existsSync(root)) return null
  // 这里只汇总金额，不需要项目归因：省掉全量会话索引（几十 MB），
  // 每个会话的扣费时间由 conversationRequestId 单独回查（带 30s 缓存）。
  const rows = collectCredits(root)
  if (rows.length === 0) return null

  const dayStart = startOfLocalDay(now)
  const monthStart = startOfLocalMonth(now)
  const weekStart = dayStart - 6 * DAY_MS

  let today = 0
  let week = 0
  let month = 0
  for (const row of rows) {
    if (row.timestamp >= monthStart) month += row.credits
    if (row.timestamp >= weekStart) week += row.credits
    if (row.timestamp >= dayStart) today += row.credits
  }
  return {
    today: round2(today),
    week: round2(week),
    month: round2(month),
    latestAt: rows.reduce((max, row) => Math.max(max, row.timestamp), 0),
    rows,
  }
}

function spentSince(rows, balanceAt) {
  let spent = 0
  for (const row of rows) {
    if (row.timestamp >= balanceAt) spent += row.credits
  }
  return round2(spent)
}

// 已确认本地扣费样本不完整（session_usage.credit_json 会被服务端覆盖，只留最近 1-2 条），
// 所以「基线 − 本地扣费」会因样本缺失而虚高，跟官网对不上；token 反推积分又因费率不稳定更不准。
// 结论：余额只做「最后确认值」展示，由用户用官方接口/网页校准，TokenTrail 不做有损推算。
const BALANCE_POLICY = 'confirmed-only'

function emptyCreditSnapshot(now) {
  return {
    provider: 'workbuddy',
    product: 'subscription',
    accountLabel: 'WorkBuddy',
    status: 'partial',
    windows: [],
    wallets: [],
    source: 'local_session',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
    error: { code: 'no_data', safeMessage: 'no WorkBuddy credit usage recorded yet' },
    action: { label: '查看官方额度', url: CREDITS_URL, kind: 'open_url' },
  }
}

async function fetchQuota(deps) {
  const now = deps.now()
  const root = workbuddyRoot(deps)
  if (!fs.existsSync(root)) throw codedError('not_configured', 'WorkBuddy data directory not found')

  const totals = localCreditTotals(root, now)
  if (!totals) return emptyCreditSnapshot(now)

  const dayStart = startOfLocalDay(now)
  const windows = [
    {
      id: 'workbuddy-today',
      label: 'today',
      unit: 'credit',
      used: totals.today,
      windowMinutes: 1440,
      resetsAt: dayStart + DAY_MS,
    },
    {
      id: 'workbuddy-week',
      label: 'week',
      unit: 'credit',
      used: totals.week,
      windowMinutes: 10080,
    },
    {
      id: 'workbuddy-month',
      label: 'month',
      unit: 'credit',
      used: totals.month,
      windowMinutes: Math.max(1, Math.round((now - startOfLocalMonth(now)) / 60000)),
      resetsAt: (() => {
        const d = new Date(now)
        d.setHours(0, 0, 0, 0)
        d.setDate(1)
        d.setMonth(d.getMonth() + 1)
        return d.getTime()
      })(),
    },
  ]

  // 剩余积分：本地只有「已扣费样本」且会被服务端覆盖（不完整），所以无法可靠推算。
  // 任何「基线 − 本地扣费」都会因样本缺失而虚高，与官网对不上。
  // 因此余额只显示「最后一次在官网确认的官方值」：你看到多少就填多少，两边自然一致。
  const wallets = []
  const env = deps.env || process.env
  const confirmedBalance = toFiniteNumber(env.WORKBUDDY_CREDITS_BALANCE)
  if (confirmedBalance !== null && confirmedBalance >= 0) {
    wallets.push({ label: 'workbuddy-remaining', balance: round2(confirmedBalance), currency: 'credits' })
  }

  return {
    provider: 'workbuddy',
    product: 'subscription',
    accountLabel: 'WorkBuddy',
    status: deriveProviderStatus({ windows }),
    windows,
    wallets,
    source: 'local_session',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
    action: { label: '查看官方额度', url: CREDITS_URL, kind: 'open_url' },
  }
}
fetchQuota.timeoutMs = 8000

module.exports = {
  DAY_MS,
  startOfLocalDay,
  startOfLocalMonth,
  workbuddyRoot,
  localCreditTotals,
  fetchQuota,
}
