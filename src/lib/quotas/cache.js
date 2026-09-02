// ─── 账号额度中心 · 缓存语义（纯函数；存储实现由调用方注入） ───
// store 接口：{ loadAll(): Promise<Row[]>, saveAll(rows): Promise<void> }
// Row：{ provider, snapshot_json, fetched_at, last_success_at, last_error_code }
// 库里只存规范化快照，严禁存凭证。

const { isCacheFresh, isDataStale } = require('./status.js')

// 刷新节奏
const ADAPTER_TIMEOUT_MS = 5500 // 单 Adapter 超时 5–6s
const ROUND_TIMEOUT_MS = 10000 // 整轮刷新最长 10s
const MANUAL_REFRESH_MIN_INTERVAL_MS = 30 * 1000 // 手动刷新最短间隔

/**
 * 读取存储行 → 快照视图：解析 JSON、按 last_success_at 计算过期标记。
 * 解析失败的行按缺失处理（不抛错，不污染其余 Provider）。
 */
function rowsToSnapshots(rows, now) {
  const byProvider = new Map()
  for (const row of rows || []) {
    if (!row || !row.provider) continue
    try {
      const snap = JSON.parse(row.snapshot_json)
      if (!snap || typeof snap !== 'object' || typeof snap.provider !== 'string') continue
      snap.lastSuccessAt = row.last_success_at ?? snap.lastSuccessAt ?? null
      snap.lastErrorCode = row.last_error_code ?? null
      snap.stale = isDataStale(snap.lastSuccessAt, now)
      byProvider.set(snap.provider, snap)
    } catch {
      // malformed 行等价于无缓存
    }
  }
  return byProvider
}

/**
 * 失败时保留上一次成功数据：
 * 仅网络类失败（timeout/network/rate_limited/malformed）回退旧数据并标记过期；
 * 鉴权失败（auth）展示鉴权错误本身，不拿旧数据伪装正常。
 */
function withPreviousFallback(next, previous, now) {
  const fallbackEligible = new Set(['timeout', 'network', 'rate_limited', 'malformed'])
  const hasPrevData = previous && Array.isArray(previous.windows) && previous.windows.length > 0
  if (!next.error || !fallbackEligible.has(next.error.code) || !hasPrevData) return next

  return {
    ...previous,
    windows: previous.windows,
    wallets: previous.wallets || [],
    accountLabel: previous.accountLabel,
    planLabel: previous.planLabel,
    status: previous.status === 'healthy' ? 'stale' : previous.status,
    stale: isDataStale(previous.lastSuccessAt, now),
    notices: previous.notices,
    action: previous.action,
    fetchedAt: now,
    lastSuccessAt: previous.lastSuccessAt,
    error: next.error,
  }
}

module.exports = {
  ADAPTER_TIMEOUT_MS,
  ROUND_TIMEOUT_MS,
  MANUAL_REFRESH_MIN_INTERVAL_MS,
  rowsToSnapshots,
  withPreviousFallback,
  isCacheFresh,
}
