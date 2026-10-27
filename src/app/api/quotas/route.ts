import { NextRequest, NextResponse } from 'next/server'
import { ensureInit } from '@/lib/init'
import { getQuotasForServer, parseVisibleProviders } from '@/lib/quotas/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/quotas — 立即返回缓存；过期则后台去重刷新。单家失败不影响整体。
 * ?providers=codex,kiro 只返回并刷新这些产品（设置里关闭的产品不查询）。
 */
export async function GET(request: NextRequest) {
  try {
    ensureInit()
    const visible = parseVisibleProviders(request.nextUrl.searchParams.get('providers') ?? undefined)
    const result = await getQuotasForServer(undefined, visible)
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
