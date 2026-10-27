import { NextRequest, NextResponse } from 'next/server'
import { ensureInit } from '@/lib/init'
import {
  getQuotasForServer,
  parseVisibleProviders,
  refreshQuotasForServer,
  manualRefreshThrottled,
  manualRefreshRetry,
  markManualRefreshResult,
} from '@/lib/quotas/server'
import { QUOTA_PROVIDER_IDS } from '@/lib/quotas/types'
import { rejectUnsafeLocalMutation } from '@/lib/local-request'

export const dynamic = 'force-dynamic'
const PROVIDER_IDS = new Set<string>(QUOTA_PROVIDER_IDS)

/**
 * POST /api/quotas/refresh — 强制发起一轮刷新。
 * - body.provider：只刷新这一家；body.providers：设置里仍开启的产品（关闭的不查询）
 * - 并发刷新合并（去重），每个 Adapter 独立超时
 * - 手动刷新最短间隔 30s；过频时返回当前缓存 + throttled 标记
 * - 返回每家结果，单家失败不影响其他
 */
export async function POST(request: NextRequest) {
  const rejected = rejectUnsafeLocalMutation(request)
  if (rejected) return rejected

  try {
    ensureInit()
    const raw = await request.text()
    let body: { provider?: unknown; providers?: unknown } | null = null
    if (raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid body')
        body = parsed as { provider?: unknown; providers?: unknown }
      } catch {
        return NextResponse.json({ success: false, error: 'invalid request body' }, { status: 400 })
      }
    }
    const provider = body?.provider
    if (provider !== undefined && (typeof provider !== 'string' || !PROVIDER_IDS.has(provider))) {
      return NextResponse.json({ success: false, error: 'invalid provider' }, { status: 400 })
    }
    if (body?.providers !== undefined && !Array.isArray(body.providers)) {
      return NextResponse.json({ success: false, error: 'invalid providers' }, { status: 400 })
    }
    const visible = parseVisibleProviders(body?.providers)
    if (provider && visible && !visible.includes(provider)) {
      return NextResponse.json({ success: false, error: 'provider is hidden in settings' }, { status: 400 })
    }

    const cached = (await getQuotasForServer({ backgroundRefresh: false }, visible)) as {
      providers?: Array<{ provider: string; retryAfterAt?: number }>
      [key: string]: unknown
    }
    const now = Date.now()
    const requested = provider ? [provider] : visible ?? [...PROVIDER_IDS]
    if (requested.length === 0) {
      return NextResponse.json({ ...cached, refresh: { total: 0, succeeded: 0, failed: 0, stale: 0, skipped: 0 }, refreshing: false })
    }
    const retryAt = new Map(cached.providers?.map((snap) => [snap.provider, snap.retryAfterAt ?? 0]))
    const eligible = requested.filter((id) => (retryAt.get(id) ?? 0) <= now)
    if (manualRefreshThrottled(provider ?? 'all', now) || eligible.length === 0) {
      const retry = manualRefreshRetry(provider ?? 'all')
      const providerRetryAfterMs = Math.min(...requested.map((id) => Math.max(0, (retryAt.get(id) ?? 0) - now)).filter(Boolean))
      const retryAfterMs = Math.max(retry.retryAfterMs, Number.isFinite(providerRetryAfterMs) ? providerRetryAfterMs : 0)
      return NextResponse.json({ ...cached, throttled: true, retryAfterMs, nextAllowedAt: now + retryAfterMs })
    }

    const result = (await refreshQuotasForServer(eligible, visible)) as Record<string, unknown>
    const summary = result.refresh as { succeededProviders?: string[] } | undefined
    markManualRefreshResult(provider, summary?.succeededProviders ?? [])
    return NextResponse.json({
      ...result,
      refresh: { ...summary, skipped: requested.length - eligible.length },
      refreshing: false,
    })
  } catch {
    return NextResponse.json({ success: false, error: 'refresh failed' }, { status: 500 })
  }
}
