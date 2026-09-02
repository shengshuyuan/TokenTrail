import { NextRequest, NextResponse } from 'next/server'
import { ensureInit } from '@/lib/init'
import {
  getQuotasForServer,
  refreshQuotasForServer,
  manualRefreshThrottled,
  markManualRefresh,
} from '@/lib/quotas/server'
import { rejectUnsafeLocalMutation } from '@/lib/local-request'

export const dynamic = 'force-dynamic'

/**
 * POST /api/quotas/refresh — 强制发起一轮刷新。
 * - 并发刷新合并（去重），每个 Adapter 独立超时
 * - 手动刷新最短间隔 30s；过频时返回当前缓存 + throttled 标记
 * - 返回每家结果，单家失败不影响其他
 */
export async function POST(request: NextRequest) {
  const rejected = rejectUnsafeLocalMutation(request)
  if (rejected) return rejected

  try {
    ensureInit()

    if (manualRefreshThrottled()) {
      const cached = (await getQuotasForServer()) as Record<string, unknown>
      return NextResponse.json({ ...cached, throttled: true })
    }

    markManualRefresh()
    const result = (await refreshQuotasForServer()) as Record<string, unknown>
    return NextResponse.json({ ...result, refreshing: false })
  } catch {
    return NextResponse.json({ success: false, error: 'refresh failed' }, { status: 500 })
  }
}
