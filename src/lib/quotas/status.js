// ─── 账号额度中心 · 状态推导（纯函数，供 refresh 与 UI 复用） ───

// 单窗口使用率 → 窗口状态
const WARNING_PERCENT = 80
const CRITICAL_PERCENT = 95
const EXHAUSTED_PERCENT = 100

// 颜色分桶：红 > 黄 > 绿 > 灰
const RED_STATUSES = new Set(['critical', 'exhausted', 'auth_error'])
const YELLOW_STATUSES = new Set(['warning', 'partial', 'stale', 'network_error', 'unsupported_version'])
const GREEN_STATUSES = new Set(['healthy'])
// 其余（loading / not_configured / unsupported）归灰色

const STATUS_SEVERITY = [
  'loading',
  'not_configured',
  'unsupported',
  'healthy',
  'unsupported_version',
  'network_error',
  'stale',
  'partial',
  'warning',
  'auth_error',
  'critical',
  'exhausted',
]

function windowStatusFromPercent(percent) {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
  if (percent >= EXHAUSTED_PERCENT) return 'exhausted'
  if (percent >= CRITICAL_PERCENT) return 'critical'
  if (percent >= WARNING_PERCENT) return 'warning'
  return 'healthy'
}

function statusColorBucket(status) {
  if (RED_STATUSES.has(status)) return 'red'
  if (YELLOW_STATUSES.has(status)) return 'yellow'
  if (GREEN_STATUSES.has(status)) return 'green'
  return 'grey'
}

function severityRank(status) {
  const idx = STATUS_SEVERITY.indexOf(status)
  return idx === -1 ? 0 : idx
}

/**
 * 由窗口列表推导 Provider 状态：按“最严重窗口”决定；
 * 只有部分窗口可读时为 partial；无任何可判定窗口时回落到 fallback。
 */
function deriveProviderStatus({ windows = [], fallback = 'healthy', hasUnreadable = false } = {}) {
  let worst = null
  let judged = 0
  for (const win of windows) {
    let s = null
    if (typeof win.usedPercent === 'number') {
      s = windowStatusFromPercent(win.usedPercent)
    } else if (win.limit != null && win.limit > 0 && typeof win.used === 'number') {
      s = windowStatusFromPercent((win.used / win.limit) * 100)
    }
    if (!s) continue
    judged += 1
    if (!worst || severityRank(s) > severityRank(worst)) worst = s
  }

  if (worst === null) {
    return hasUnreadable ? 'partial' : fallback
  }
  // 有可判定窗口，但同时存在读不到的窗口 → partial 不覆盖更严重的颜色
  if (hasUnreadable && severityRank(worst) < severityRank('warning')) return 'partial'
  return worst
}

/** 过期数据不能继续伪装成实时正常：原本健康的快照过期后按黄色 stale 呈现。 */
function effectiveSnapshotStatus(snap) {
  if (snap && snap.stale && statusColorBucket(snap.status) === 'green') return 'stale'
  return snap ? snap.status : 'loading'
}

/**
 * 全局聚合：状态取“最值得关注”的一家；attention 统计红/黄 Provider 数量；
 * 全部灰（未配置/不支持/加载中）时全局为灰色。
 */
function aggregateQuotaStatus(snapshots = []) {
  let status = 'not_configured'
  let attention = 0
  let hasColored = false

  for (const snap of snapshots) {
    const effective = effectiveSnapshotStatus(snap)
    const bucket = statusColorBucket(effective)
    if (bucket === 'red' || bucket === 'yellow') attention += 1
    if (bucket !== 'grey') hasColored = true
    if (severityRank(effective) > severityRank(status)) status = effective
  }

  // 全部未配置/不支持/加载中 → 灰色；不允许灰色覆盖彩色，因此只在无彩色时落地
  if (!hasColored) status = 'not_configured'

  return { status, attention_count: attention }
}

// ─── 新鲜度 ──────────────────────────────────────────────────

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 15 * 60 * 1000

/** 缓存 5 分钟内视为新鲜，无需后台刷新。 */
function isCacheFresh(fetchedAt, now) {
  return typeof fetchedAt === 'number' && now - fetchedAt < FRESH_MS
}

/** 距上次成功读取超过 15 分钟 → 旧数据必须标记过期。 */
function isDataStale(lastSuccessAt, now) {
  return typeof lastSuccessAt !== 'number' || now - lastSuccessAt > STALE_MS
}

module.exports = {
  WARNING_PERCENT,
  CRITICAL_PERCENT,
  EXHAUSTED_PERCENT,
  FRESH_MS,
  STALE_MS,
  STATUS_SEVERITY,
  windowStatusFromPercent,
  statusColorBucket,
  severityRank,
  deriveProviderStatus,
  effectiveSnapshotStatus,
  aggregateQuotaStatus,
  isCacheFresh,
  isDataStale,
}
