import { NextResponse } from 'next/server'
import { ensureInit } from '@/lib/init'
import { saveQuotaSnapshotRows, type QuotaSnapshotRow } from '@/lib/db'
import { getQuotasForServer } from '@/lib/quotas/server'
import type { ProviderQuotaSnapshot, ProviderId } from '@/lib/quotas/types'

export const dynamic = 'force-dynamic'

const VALID_PROVIDERS: Set<string> = new Set(['codex', 'gemini', 'grok', 'glm', 'kimi'])

/** POST /api/quotas/manual — 用户手动录入或通过提取脚本导入额度快照 */
export async function POST(req: Request) {
  try {
    ensureInit()
    const body = await req.json()
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const provider = String(body.provider || '').toLowerCase()
    if (!VALID_PROVIDERS.has(provider)) {
      return NextResponse.json({ error: `Invalid provider: ${provider}` }, { status: 400 })
    }

    const now = Date.now()
    const snapshot: ProviderQuotaSnapshot = {
      provider: provider as ProviderId,
      product: body.product || 'subscription',
      accountLabel: body.accountLabel || undefined,
      planLabel: body.planLabel || undefined,
      status: body.status || 'healthy',
      windows: Array.isArray(body.windows) ? body.windows : [],
      wallets: Array.isArray(body.wallets) ? body.wallets : [],
      source: 'manual' as any,
      fetchedAt: now,
      lastSuccessAt: now,
      stale: false,
      notices: Array.isArray(body.notices) ? body.notices : undefined,
    }

    const row: QuotaSnapshotRow = {
      provider,
      snapshot_json: JSON.stringify(snapshot),
      fetched_at: now,
      last_success_at: now,
      last_error_code: null,
    }

    saveQuotaSnapshotRows([row])

    const quotas = await getQuotasForServer()
    return NextResponse.json({ success: true, snapshot, quotas })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal Server Error' },
      { status: 500 }
    )
  }
}
