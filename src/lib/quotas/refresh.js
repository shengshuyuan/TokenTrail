// ─── 账号额度中心 · 刷新编排 ─────────────────────────────────
// - 每家 Adapter 独立超时、独立报错（Promise.allSettled 语义）
// - 并发刷新合并：同一时刻只允许一轮在跑
// - 不因某家失败而整体失败
// 依赖全部注入（adapters/store/now/home/fetchImpl），便于测试与解耦。

const {
  ADAPTER_TIMEOUT_MS,
  ROUND_TIMEOUT_MS,
  MANUAL_REFRESH_MIN_INTERVAL_MS,
  rowsToSnapshots,
  withPreviousFallback,
} = require('./cache.js')
const { aggregateQuotaStatus, effectiveSnapshotStatus, isCacheFresh } = require('./status.js')

// 服务进程级单例：并发刷新合并 + 手动刷新节流（测试可通过 deps 覆盖）
const defaultInflight = new Map()
let defaultLastManualAt = 0

function resolveInflight(deps) {
  return deps.inflight ?? defaultInflight
}

/** Adapter 抛错 → 快照的错误状态映射（错误信息一律白名单化，不带堆栈/响应原文）。 */
const THROW_STATUS_BY_CODE = {
  auth: 'auth_error',
  not_configured: 'not_configured',
  no_data: 'not_configured',
  unsupported: 'unsupported',
  unsupported_version: 'unsupported_version',
  timeout: 'network_error',
  network: 'network_error',
  rate_limited: 'network_error',
  malformed: 'network_error',
}

/** Adapter 永远 resolve 为快照；抛出的任何异常都收敛为白名单错误码。 */
async function runAdapter(providerId, fetchQuota, deps) {
  let snapshot
  // 外层是兜底超时：adapter 内部请求超时（deps.timeoutMs）之外再留余量，
  // 用于卡死在文件扫描等无超时环节的极端情况
  const backstopMs = (deps.timeoutMs ?? ADAPTER_TIMEOUT_MS) + 1000
  try {
    const timeout = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        const err = new Error('adapter timeout')
        err.code = 'timeout'
        reject(err)
      }, backstopMs)
    })
    // 输家仍需挂 no-op catch，避免超时胜出后 fetch 的 rejection 无人接住
    const work = Promise.resolve().then(() => fetchQuota(deps))
    work.catch(() => {})
    snapshot = await Promise.race([work, timeout])
  } catch (err) {
    const code = err && typeof err.code === 'string' ? err.code : 'network'
    snapshot = {
      provider: providerId,
      status: THROW_STATUS_BY_CODE[code] ?? 'network_error',
      error: { code: code in THROW_STATUS_BY_CODE ? code : 'unknown', safeMessage: 'provider request failed' },
    }
  }

  // 规范化兜底：Adapter 输出缺字段时补齐，UI 永远拿到完整形状
  return {
    product: 'subscription',
    status: 'not_configured',
    windows: [],
    wallets: [],
    source: 'unavailable',
    stale: false,
    ...snapshot,
    provider: providerId,
    fetchedAt: deps.now(),
  }
}

/**
 * 强制发起一轮刷新。
 * @returns {{ providers, duration_ms, deduped }} deduped=true 表示本轮与其他并发调用合并
 */
async function refreshAll(deps) {
  const adapters = deps.adapters
  const providerIds = Object.keys(adapters)
  const inflight = resolveInflight(deps)

  {
    const existing = inflight.get('round')
    if (existing) {
      const result = await existing
      return { ...result, deduped: true }
    }
  }

  const promise = (async () => {
    const start = deps.now()
    const previousRows = await deps.store.loadAll()
    const previous = rowsToSnapshots(previousRows, deps.now())

    // 并发跑所有 Adapter，单个失败不影响其他
    const settled = await Promise.allSettled(
      providerIds.map((id) => runAdapter(id, adapters[id], deps))
    )

    const providers = []
    const rows = []
    settled.forEach((outcome, i) => {
      const id = providerIds[i]
      let snap = outcome.status === 'fulfilled' ? outcome.value : {
        provider: id,
        product: 'subscription',
        status: 'network_error',
        windows: [],
        wallets: [],
        source: 'unavailable',
        stale: false,
        error: { code: 'network', safeMessage: 'provider request failed' },
      }

      // 429 / 超时 / 网络失败：保留上一次成功数据
      snap = withPreviousFallback(snap, previous.get(id), deps.now())
      providers.push(snap)
      rows.push(toRow(snap, previous.get(id)))
    })

    await deps.store.saveAll(rows)
    return { providers, updated_at: deps.now(), duration_ms: deps.now() - start }
  })()

  inflight.set('round', promise)
  try {
    return await promise
  } finally {
    if (inflight.get('round') === promise) inflight.set('round', null)
  }
}

function toRow(snap, previous) {
  const failed = Boolean(snap.error)
  const lastSuccessAt = failed ? previous?.lastSuccessAt ?? null : snap.fetchedAt ?? null
  return {
    provider: snap.provider,
    snapshot_json: JSON.stringify(snap),
    fetched_at: snap.fetchedAt ?? null,
    last_success_at: lastSuccessAt,
    last_error_code: snap.error?.code ?? null,
  }
}

/** 手动刷新节流：30 秒内重复点击直接返回当前缓存。 */
function canManualRefresh(lastManualAt, now) {
  return now - (lastManualAt ?? 0) >= MANUAL_REFRESH_MIN_INTERVAL_MS
}

function markManualRefresh(now) {
  defaultLastManualAt = now
}

function getLastManualRefreshAt() {
  return defaultLastManualAt
}

/**
 * GET /api/quotas 语义：立即返回缓存；缓存过期则在后台发起去重刷新。
 * 首次无缓存时也触发后台刷新，本次返回 loading 快照。
 */
async function getQuotas(deps) {
  const now = deps.now()
  const rows = await deps.store.loadAll()
  const byProvider = rowsToSnapshots(rows, now)
  const providerIds = Object.keys(deps.adapters)

  const providers = providerIds.map((id) => {
    const snap = byProvider.get(id)
    if (snap) return { ...snap, stale: snap.stale }
    return {
      provider: id,
      product: 'subscription',
      status: 'loading',
      windows: [],
      wallets: [],
      source: 'unavailable',
      stale: false,
    }
  })

  const staleProviders = providers.filter(
    (p) => p.status === 'loading' || !isCacheFresh(p.fetchedAt, now)
  )

  const { status, attention_count } = aggregateQuotaStatus(providers)
  const updated_at = providers.reduce((acc, p) => Math.max(acc ?? 0, p.fetchedAt ?? 0), null) || null

  const response = {
    status,
    attention_count,
    providers,
    updated_at,
    refreshing: false,
  }

  // 缓存过期/缺失：后台去重刷新（不阻塞响应）
  if (staleProviders.length > 0) {
    response.refreshing = true
    // 不 await：交给 Next 的请求生命周期之外的 waitUntil 不可用时，
    // 直接游离执行；服务常驻，进程不会退出。
    void refreshAll(deps).catch(() => {})
  }

  return response
}

module.exports = {
  runAdapter,
  refreshAll,
  getQuotas,
  canManualRefresh,
  markManualRefresh,
  getLastManualRefreshAt,
  effectiveSnapshotStatus,
}
