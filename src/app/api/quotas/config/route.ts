import { NextResponse } from 'next/server'
import { ensureInit } from '@/lib/init'
import { getConfig, setConfig } from '@/lib/db'
import { refreshQuotasForServer } from '@/lib/quotas/server'
import { getQuotaSecret, QUOTA_SECRET_KEYS, setQuotaSecret } from '@/lib/quotas/secret-store'

export const dynamic = 'force-dynamic'

const ALLOWED_CONFIG_KEYS = [
  'XAI_TEAM_ID',
  'ANTHROPIC_BASE_URL',
  'GOOGLE_CLOUD_PROJECT',
] as const

/** GET /api/quotas/config — 查询本地凭证是否已配置（不返回明文 Key） */
export async function GET() {
  try {
    ensureInit()
    const configured: Record<string, boolean> = {}
    for (const key of QUOTA_SECRET_KEYS) configured[key] = Boolean(getQuotaSecret(key) || getConfig(key))
    for (const key of ALLOWED_CONFIG_KEYS) {
      const val = getConfig(key) || process.env[key]
      configured[key] = Boolean(val && val.trim())
    }
    return NextResponse.json({ configured })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/** POST /api/quotas/config — 安全保存本地 Provider API 凭证到 SQLite app_config 表 */
export async function POST(req: Request) {
  try {
    ensureInit()
    const body = await req.json()
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    for (const key of ALLOWED_CONFIG_KEYS) {
      if (typeof body[key] === 'string') {
        const trimmed = body[key].trim()
        if (trimmed) {
          setConfig(key, trimmed)
        }
      }
    }
    for (const key of QUOTA_SECRET_KEYS) {
      if (typeof body[key] === 'string' && body[key].trim()) setQuotaSecret(key, body[key])
    }

    // 保存后尝试触发一轮后台刷新
    const quotas = await refreshQuotasForServer().catch(() => null)

    return NextResponse.json({ success: true, quotas })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal Server Error' },
      { status: 500 }
    )
  }
}
