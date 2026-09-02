// ─── 账号额度中心 · GLM Coding Plan Adapter ─────────────────
// 对齐智谱官方 glm-plan-usage 插件的实现：
// - 凭证来自 ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN（国内/国际均可）
// - 端点 {base}/api/monitor/usage/quota/limit，鉴权头为裸 token（无 Bearer）
// - 只认 api.z.ai / bigmodel.cn 域名，其他 base URL 一律视为未配置
// - 响应结构变化 → unsupported_version，绝不显示错误数值
// 凭证只在服务端内存中出现，绝不写入数据库或返回前端。

const path = require('path')
const { codedError, readJsonIfExists, requestJson, toEpochMs } = require('../http.js')
const { deriveProviderStatus } = require('../status.js')

const ALLOWED_HOST_PATTERNS = [/^api\.z\.ai$/i, /^(open|dev)\.bigmodel\.cn$/i]

// 凭证发现顺序：显式环境变量 → Claude Code 配置 → Coding Helper 配置
const CLAUDE_SETTINGS_PATH = () => path.join('.claude', 'settings.json')
const HELPER_CONFIG_PATHS = [
  () => path.join('.zai', 'config.json'),
  () => path.join('.config', 'zai', 'config.json'),
]

function hostAllowed(baseUrl) {
  try {
    const host = new URL(baseUrl).host
    return ALLOWED_HOST_PATTERNS.some((re) => re.test(host))
  } catch {
    return false
  }
}

/** 从对象里挑出字符串类型的 base URL 与 token。 */
function pickCredentials(source) {
  if (!source || typeof source !== 'object') return null
  let baseUrl = source.ANTHROPIC_BASE_URL || source.baseUrl || source.base_url || source.BASE_URL
  const token =
    source.ANTHROPIC_AUTH_TOKEN || source.authToken || source.auth_token || source.GLM_API_KEY || source.ZAI_API_KEY || source.ZHIPUAI_API_KEY || source.glm_api_key
  if (!baseUrl && typeof token === 'string' && token.trim()) {
    baseUrl = 'https://api.z.ai'
  }
  if (typeof baseUrl === 'string' && typeof token === 'string' && baseUrl.trim() && token.trim()) {
    return { baseUrl: baseUrl.trim(), token: token.trim() }
  }
  return null
}

/** 凭证发现：env → ~/.claude/settings.json → Coding Helper 配置。 */
function resolveCredentials(deps) {
  const fromEnv = pickCredentials(deps.env)
  if (fromEnv && hostAllowed(fromEnv.baseUrl)) return fromEnv

  const settings = readJsonIfExists(deps.fs, path.join(deps.home, CLAUDE_SETTINGS_PATH()))
  const fromSettings = pickCredentials(settings?.env)
  if (fromSettings && hostAllowed(fromSettings.baseUrl)) return fromSettings

  for (const p of HELPER_CONFIG_PATHS) {
    const helper = readJsonIfExists(deps.fs, path.join(deps.home, p()))
    const fromHelper = pickCredentials({
      baseUrl: helper?.baseUrl ?? helper?.base_url,
      authToken: helper?.apiKey ?? helper?.api_key ?? helper?.token,
    })
    if (fromHelper && hostAllowed(fromHelper.baseUrl)) return fromHelper
  }

  return null
}

const PLAN_LABEL_KEYS = ['plan', 'plan_name', 'planName', 'plan_level', 'planLevel', 'tier', 'grade']

function planLabelFromResponse(json) {
  json = unwrapQuotaEnvelope(json)
  for (const key of PLAN_LABEL_KEYS) {
    const value = json?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  if (typeof json?.level === 'string' && json.level.trim()) return json.level.trim()
  return undefined
}

function unwrapQuotaEnvelope(json) {
  if (json && typeof json === 'object' && json.data && typeof json.data === 'object') {
    return json.data
  }
  return json
}

/**
 * limits[] → 主行窗口 + 次级 notice（MCP 用量放详情，不占主行）。
 * 未知 type 容错忽略；percentage 缺失时不构造百分比。
 */
function mapLimitEntries(limits) {
  const windows = []
  const notices = []
  let hasUnreadable = false

  for (const item of Array.isArray(limits) ? limits : []) {
    if (!item || typeof item !== 'object' || typeof item.type !== 'string') {
      hasUnreadable = true
      continue
    }
    const type = item.type
    const percent = typeof item.percentage === 'number' ? item.percentage : null

    if (type === 'TOKENS_LIMIT') {
      windows.push({
        id: 'tokens-5h',
        label: '5h',
        unit: 'token',
        usedPercent: percent ?? undefined,
        windowMinutes: 300,
        resetsAt: toEpochMs(item.nextResetTime) ?? undefined,
      })
      continue
    }
    if (type === 'TIME_LIMIT') {
      // MCP 月度用量：结构化编码，UI 端本地化展示
      const current = typeof item.currentValue === 'number' ? item.currentValue : null
      const total = typeof item.usage === 'number' ? item.usage : null
      if (current !== null || total !== null) {
        notices.push(`mcp|${current ?? '?'}|${total ?? '?'}|${typeof percent === 'number' ? percent : ''}`)
      }
      continue
    }
    if (/WEEK/i.test(type)) {
      windows.push({
        id: 'tokens-week',
        label: 'week',
        unit: 'token',
        usedPercent: percent ?? undefined,
        resetsAt: toEpochMs(item.nextResetTime) ?? undefined,
      })
      continue
    }
    // 未知类型：忽略但记录，避免误读
    hasUnreadable = true
  }

  return { windows, notices, hasUnreadable }
}

async function fetchQuota(deps) {
  const creds = resolveCredentials(deps)
  if (!creds) {
    throw codedError('not_configured', 'GLM Coding Plan is not configured')
  }

  const base = new URL(creds.baseUrl)
  const endpoint = `${base.protocol}//${base.host}/api/monitor/usage/quota/limit`
  const { json } = await requestJson(endpoint, {
    method: 'GET',
    // 官方脚本使用裸 token（无 Bearer 前缀）
    headers: { Authorization: creds.token },
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  })

  const data = unwrapQuotaEnvelope(json)
  if (!data || !Array.isArray(data.limits)) {
    throw codedError('unsupported_version', 'unexpected quota response')
  }

  const { windows, notices, hasUnreadable } = mapLimitEntries(data.limits)
  if (windows.length === 0 && notices.length === 0) {
    throw codedError('no_data', 'no quota limits available')
  }

  const now = deps.now()
  const snapshot = {
    provider: 'glm',
    product: 'subscription',
    planLabel: planLabelFromResponse(data),
    windows,
    wallets: [],
    source: 'official_api',
    fetchedAt: now,
    lastSuccessAt: now,
    stale: false,
    notices: notices.length > 0 ? notices : undefined,
  }
  snapshot.status = deriveProviderStatus({ windows, fallback: notices.length > 0 ? 'partial' : 'healthy', hasUnreadable })
  if (snapshot.status === 'healthy' && notices.length > 0 && windows.length === 0) {
    snapshot.status = 'partial'
  }
  return snapshot
}

module.exports = {
  ALLOWED_HOST_PATTERNS,
  hostAllowed,
  pickCredentials,
  resolveCredentials,
  mapLimitEntries,
  planLabelFromResponse,
  unwrapQuotaEnvelope,
  fetchQuota,
}
