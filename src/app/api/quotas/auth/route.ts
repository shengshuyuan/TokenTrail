import { NextResponse } from 'next/server'
import { ensureInit } from '@/lib/init'
import { setConfig, saveQuotaSnapshotRows, type QuotaSnapshotRow } from '@/lib/db'
import { getQuotasForServer } from '@/lib/quotas/server'
import { setQuotaSecret } from '@/lib/quotas/secret-store'

const { createAdapters } = require('@/lib/quotas/providers/index.js') as {
  createAdapters: (overrides?: Record<string, unknown>) => {
    deps: Record<string, unknown>
    adapters: Record<string, (deps: Record<string, unknown>) => Promise<any>>
  }
}
const grok = require('@/lib/quotas/providers/grok.js') as {
  readGrokCliSession: (fsMod: unknown, home: unknown) => { loggedIn?: boolean; expiresAt?: number | null } | null
  grokCliSessionIsFresh: (session: unknown, now: number) => boolean
  isGrokLoginRunning: () => boolean
  startGrokOAuthLogin: (deps: Record<string, unknown>) => { ok: boolean; alreadyRunning?: boolean; reason?: string }
}
const gemini = require('@/lib/quotas/providers/gemini.js') as {
  readGeminiCliSession: (fsMod: unknown, home: unknown) => { loggedIn: boolean }
}
const kimi = require('@/lib/quotas/providers/kimi.js') as {
  readKimiCliSession: (fsMod: unknown, home: unknown, now?: number) => { loggedIn: boolean }
}
const codex = require('@/lib/quotas/providers/codex.js') as {
  readCodexCliSession: (
    fsMod: unknown,
    home: unknown,
    now?: number,
    env?: Record<string, string | undefined>
  ) => { loggedIn: boolean; expired?: boolean }
}
const { launchCliLogin } = require('@/lib/quotas/cli-login.js') as {
  launchCliLogin: (name: string, args: string[], deps?: Record<string, unknown>) => { ok: boolean; reason?: string }
}
const { runAdapter } = require('@/lib/quotas/refresh.js') as {
  runAdapter: (provider: string, adapter: (deps: Record<string, unknown>) => Promise<any>, deps: Record<string, unknown>) => Promise<any>
}

export const dynamic = 'force-dynamic'

function cliAuthStatus(provider: string) {
  const { deps } = createAdapters()
  if (provider === 'grok') {
    const session = grok.readGrokCliSession(deps.fs, deps.home)
    return { provider, loggedIn: grok.grokCliSessionIsFresh(session, Date.now()), loginRunning: grok.isGrokLoginRunning() }
  }
  if (provider === 'gemini') return { provider, ...gemini.readGeminiCliSession(deps.fs, deps.home) }
  if (provider === 'kimi') return { provider, ...kimi.readKimiCliSession(deps.fs, deps.home, Date.now()) }
  if (provider === 'codex') return { provider, ...codex.readCodexCliSession(deps.fs, deps.home, Date.now(), deps.env as Record<string, string | undefined>) }
  return null
}

async function persistVerifiedSnapshot(provider: string, snapshot: any) {
  const now = Date.now()
  const row: QuotaSnapshotRow = {
    provider,
    snapshot_json: JSON.stringify(snapshot),
    fetched_at: now,
    last_success_at: now,
    last_error_code: null,
  }
  saveQuotaSnapshotRows([row])
  const quotas = await getQuotasForServer()
  const readable = (snapshot.windows?.length ?? 0) > 0 || (snapshot.wallets?.length ?? 0) > 0
  return {
    success: true,
    snapshot,
    quotas,
    message: readable ? '连接成功，已同步官方额度。' : '登录已连接，但没有可读取的额度数据。',
  }
}

function snapshotFailureResponse(snapshot: any): NextResponse | null {
  const readable = (snapshot?.windows?.length ?? 0) > 0 || (snapshot?.wallets?.length ?? 0) > 0
  if (snapshot?.status === 'auth_error') {
    return NextResponse.json({ error: '凭证已失效，请重新完成官方登录或检查 Key' }, { status: 401 })
  }
  if (snapshot?.status === 'not_configured') {
    return NextResponse.json({ error: '未检测到有效登录或对应产品凭证' }, { status: 401 })
  }
  if (snapshot?.status === 'network_error') {
    return NextResponse.json({ error: '连接官方额度服务失败，请稍后重试' }, { status: 503 })
  }
  if (snapshot?.status === 'unsupported_version') {
    return NextResponse.json({ error: '已连接，但服务商额度响应格式发生变化，当前版本无法解析' }, { status: 502 })
  }
  if (snapshot?.status === 'unsupported') {
    return NextResponse.json({ error: '已连接，但该账号或产品暂未返回可读取的额度' }, { status: 422 })
  }
  if (!readable) {
    return NextResponse.json({ error: '连接已验证，但官方接口没有返回可读取的额度数据' }, { status: 422 })
  }
  return null
}

async function verifiedResponse(provider: string, snapshot: any) {
  const failure = snapshotFailureResponse(snapshot)
  if (failure) return failure
  return NextResponse.json(await persistVerifiedSnapshot(provider, snapshot))
}

/** GET /api/quotas/auth?provider=grok — 轮询浏览器 OAuth 是否完成（不返回凭证）。 */
export async function GET(req: Request) {
  try {
    ensureInit()
    const provider = new URL(req.url).searchParams.get('provider')?.toLowerCase()
    if (!provider || !['grok', 'gemini', 'kimi', 'codex'].includes(provider)) {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
    }
    return NextResponse.json(cliAuthStatus(provider))
  } catch (err: any) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/quotas/auth — 用户主动发起授权与连接校验
 * CLI providers open a visible Terminal window so browser/device authorization and
 * failures are observable. Secrets are stored in macOS Keychain; SQLite only keeps
 * non-secret IDs and normalized quota snapshots.
 */
export async function POST(req: Request) {
  try {
    ensureInit()
    const body = await req.json()
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const provider = String(body.provider || '').toLowerCase()
    const creds = body.credentials || {}

    // 1. 根据 Provider 构造临时测试环境变量
    const testEnv: Record<string, string | undefined> = { ...process.env }

    if (provider === 'glm') {
      const token = creds.token || creds.GLM_API_KEY || creds.ANTHROPIC_AUTH_TOKEN
      const baseUrl = creds.baseUrl || creds.ANTHROPIC_BASE_URL || 'https://api.z.ai'
      if (!token || !token.trim()) {
        return NextResponse.json({ error: '请输入智谱 GLM API Key 或 Token' }, { status: 400 })
      }
      testEnv.GLM_API_KEY = token.trim()
      testEnv.ANTHROPIC_AUTH_TOKEN = token.trim()
      testEnv.ANTHROPIC_BASE_URL = baseUrl.trim()
    } else if (provider === 'grok') {
      const method = String(body.method || (creds.key ? 'apikey' : 'oauth')).toLowerCase()
      if (method === 'oauth') {
        const { deps, adapters } = createAdapters({ env: testEnv, timeoutMs: 7000 })
        if (grok.grokCliSessionIsFresh(grok.readGrokCliSession(deps.fs, deps.home), Date.now())) {
          const snapshot = await runAdapter(provider, adapters.grok, deps)
          return verifiedResponse(provider, snapshot)
        }
        const started = grok.startGrokOAuthLogin(deps)
        if (!started.ok) {
          return NextResponse.json(
            {
              error: started.reason === 'grok_cli_missing' ? '未找到 Grok CLI，无法打开授权页' : '无法启动浏览器授权',
              fallback: 'apikey',
              manualCommand: 'grok login --oauth',
            },
            { status: 409 }
          )
        }
        return NextResponse.json({
          pending: true,
          message: '已打开终端；Grok CLI 将打开浏览器，请完成官方授权',
          manualCommand: 'grok login --oauth',
        })
      }
      const key = creds.key || creds.XAI_MANAGEMENT_KEY
      const teamId = creds.teamId || creds.XAI_TEAM_ID
      if (!key || !teamId) {
        return NextResponse.json({ error: '请输入 xAI Management Key 与 Team ID' }, { status: 400 })
      }
      testEnv.XAI_MANAGEMENT_KEY = key.trim()
      testEnv.XAI_TEAM_ID = teamId.trim()
    } else if (provider === 'kimi') {
      const method = String(body.method || (creds.key ? 'kimi_code_key' : 'oauth')).toLowerCase()
      if (method === 'oauth') {
        const { deps } = createAdapters({ env: testEnv })
        if (!kimi.readKimiCliSession(deps.fs, deps.home, Date.now()).loggedIn) {
          const started = launchCliLogin('kimi', ['login'], deps)
          if (!started.ok) return NextResponse.json({ error: '未找到 Kimi CLI 或无法打开终端授权', manualCommand: 'kimi login' }, { status: 409 })
          return NextResponse.json({ pending: true, message: '已打开终端；Kimi CLI 将打开官方登录页，请完成授权', manualCommand: 'kimi login' })
        }
      } else if (method === 'kimi_code_key') {
        const key = creds.key || creds.KIMI_CODE_API_KEY
        if (!key || !key.trim()) return NextResponse.json({ error: '请输入 Kimi Code API Key' }, { status: 400 })
        testEnv.KIMI_CODE_API_KEY = key.trim()
      } else if (method === 'moonshot') {
        const key = creds.key || creds.MOONSHOT_API_KEY
        if (!key || !key.trim()) return NextResponse.json({ error: '请输入 Moonshot 开放平台 API Key' }, { status: 400 })
        testEnv.MOONSHOT_API_KEY = key.trim()
      } else {
        return NextResponse.json({ error: 'Unsupported Kimi authorization method' }, { status: 400 })
      }
    } else if (provider === 'codex') {
      const method = String(body.method || (creds.key ? 'apikey' : 'oauth')).toLowerCase()
      if (method === 'oauth') {
        const { deps, adapters } = createAdapters({ env: testEnv, timeoutMs: 7000 })
        const session = codex.readCodexCliSession(deps.fs, deps.home, Date.now(), testEnv)
        if (!session.loggedIn) {
          const started = launchCliLogin('codex', ['login'], deps)
          if (!started.ok) {
            return NextResponse.json(
              { error: '未找到 Codex CLI 或无法打开终端授权', manualCommand: 'codex login' },
              { status: 409 }
            )
          }
          return NextResponse.json({
            pending: true,
            message: '已打开终端；Codex CLI 将打开 ChatGPT 官方登录页，请完成授权',
            manualCommand: 'codex login',
          })
        }
        const snapshot = await runAdapter(provider, adapters.codex, deps)
        if (snapshot.status === 'auth_error') {
          return NextResponse.json({ error: 'Codex 登录已失效，请重新登录' }, { status: 401 })
        }
        if (snapshot.status === 'network_error') {
          return NextResponse.json({ error: '连接 Codex 失败，请稍后重试' }, { status: 503 })
        }
        return NextResponse.json(await persistVerifiedSnapshot(provider, snapshot))
      }
      const key = creds.key || creds.OPENAI_API_KEY
      if (!key || !key.trim()) {
        return NextResponse.json({ error: '请输入 OpenAI API Key' }, { status: 400 })
      }
      testEnv.OPENAI_API_KEY = key.trim()
    } else if (provider === 'gemini') {
      const project = creds.project || creds.GOOGLE_CLOUD_PROJECT
      if (project) testEnv.GOOGLE_CLOUD_PROJECT = project.trim()
      const { deps, adapters } = createAdapters({ env: testEnv, timeoutMs: 7000 })
      if (!gemini.readGeminiCliSession(deps.fs, deps.home).loggedIn) {
        const started = launchCliLogin('gemini', [], deps)
        if (!started.ok) return NextResponse.json({ error: '未找到 Gemini CLI 或无法打开终端授权', manualCommand: 'gemini' }, { status: 409 })
        return NextResponse.json({ pending: true, message: '已打开终端；请选择 Sign in with Google，浏览器将自动打开', manualCommand: 'gemini' })
      }
      const snapshot = await runAdapter(provider, adapters.gemini, deps)
      if (snapshot.status === 'auth_error') {
        return NextResponse.json({ error: 'Gemini 登录已失效，请重新登录' }, { status: 401 })
      }
      if (project) setConfig('GOOGLE_CLOUD_PROJECT', project.trim())
      return NextResponse.json(await persistVerifiedSnapshot(provider, snapshot))
    }

    // 2. 运行对应的 Adapter 进行实时连接测试
    const { deps, adapters } = createAdapters({ env: testEnv, timeoutMs: 7000 })
    const adapter = adapters[provider]
    if (!adapter) {
      return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 })
    }

    const snapshot = await runAdapter(provider, adapter, deps)

    const failed = snapshotFailureResponse(snapshot)
    if (failed) return failed

    // 3. 验证成功：密钥进 Keychain，SQLite 仅保存非敏感配置
    if (provider === 'glm') {
      if (testEnv.GLM_API_KEY) setQuotaSecret('GLM_API_KEY', testEnv.GLM_API_KEY)
      if (testEnv.ANTHROPIC_AUTH_TOKEN) setQuotaSecret('ANTHROPIC_AUTH_TOKEN', testEnv.ANTHROPIC_AUTH_TOKEN)
      if (testEnv.ANTHROPIC_BASE_URL) setConfig('ANTHROPIC_BASE_URL', testEnv.ANTHROPIC_BASE_URL)
    } else if (provider === 'grok') {
      if (testEnv.XAI_MANAGEMENT_KEY) setQuotaSecret('XAI_MANAGEMENT_KEY', testEnv.XAI_MANAGEMENT_KEY)
      if (testEnv.XAI_TEAM_ID) setConfig('XAI_TEAM_ID', testEnv.XAI_TEAM_ID)
    } else if (provider === 'kimi') {
      if (testEnv.KIMI_CODE_API_KEY) setQuotaSecret('KIMI_CODE_API_KEY', testEnv.KIMI_CODE_API_KEY)
      if (testEnv.MOONSHOT_API_KEY) setQuotaSecret('MOONSHOT_API_KEY', testEnv.MOONSHOT_API_KEY)
    } else if (provider === 'codex' && testEnv.OPENAI_API_KEY) {
      setQuotaSecret('OPENAI_API_KEY', testEnv.OPENAI_API_KEY)
    } else if (provider === 'gemini' && testEnv.GOOGLE_CLOUD_PROJECT) {
      setConfig('GOOGLE_CLOUD_PROJECT', testEnv.GOOGLE_CLOUD_PROJECT)
    }

    return NextResponse.json(await persistVerifiedSnapshot(provider, snapshot))
  } catch (err: any) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal Server Error' },
      { status: 500 }
    )
  }
}
