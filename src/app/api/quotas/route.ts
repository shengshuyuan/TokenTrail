import { NextResponse } from 'next/server'
import { ensureInit } from '@/lib/init'
import { getQuotasForServer } from '@/lib/quotas/server'

export const dynamic = 'force-dynamic'

/** GET /api/quotas — 立即返回缓存；过期则后台去重刷新。单家失败不影响整体。 */
export async function GET() {
  try {
    ensureInit()
    const result = await getQuotasForServer()
    return NextResponse.json(result)
  } catch {
    // 整层异常兜底：仍返回合法结构，前端按“加载中/未配置”呈现
    return NextResponse.json({
      status: 'not_configured',
      attention_count: 0,
      providers: [],
      updated_at: null,
      refreshing: false,
    })
  }
}
