// ─── 账号额度中心 · 统一数据结构 ─────────────────────────────
// 所有 Provider Adapter 输出该结构；React 组件不得直接理解供应商原始响应。
// 快照只允许包含规范化额度数据，严禁出现凭证（API Key / OAuth Token /
// Cookie / Authorization 头）与账号隐私字段（邮箱、完整账号 ID、Team ID）。

export type ProviderId = 'codex' | 'gemini' | 'grok' | 'glm' | 'kimi'

export type QuotaStatus =
  | 'loading'
  | 'healthy'
  | 'warning'
  | 'critical'
  | 'exhausted'
  | 'partial'
  | 'stale'
  | 'not_configured'
  | 'auth_error'
  | 'network_error'
  | 'unsupported'
  | 'unsupported_version'

export type QuotaUnit = 'request' | 'credit' | 'token' | 'compute' | 'unknown'

export interface QuotaWindow {
  id: string
  label: string
  unit: QuotaUnit
  used?: number
  limit?: number
  remaining?: number
  usedPercent?: number
  windowMinutes?: number
  resetsAt?: number
}

export interface QuotaWallet {
  label: string
  balance: number
  currency: string
  monthlyUsed?: number
  monthlyLimit?: number
}

export type QuotaSource = 'local_session' | 'local_cli' | 'official_api' | 'manual' | 'unavailable'

export interface QuotaSnapshotError {
  code:
    | 'auth'
    | 'rate_limited'
    | 'timeout'
    | 'network'
    | 'malformed'
    | 'unsupported'
    | 'unsupported_version'
    | 'not_configured'
    | 'no_data'
    | 'unknown'
  /** 英文兜底文案；UI 优先按 code 走 i18n。严禁包含响应原文或堆栈。 */
  safeMessage: string
}

export interface QuotaSnapshotAction {
  label: string
  url?: string
  kind: 'open_url' | 'retry'
}

export interface ProviderQuotaSnapshot {
  provider: ProviderId
  product: 'subscription' | 'api' | 'mixed'
  accountLabel?: string
  planLabel?: string
  status: QuotaStatus
  windows: QuotaWindow[]
  wallets: QuotaWallet[]
  source: QuotaSource
  fetchedAt?: number
  lastSuccessAt?: number
  stale: boolean
  /** 次级信息（如 MCP 用量、订阅额度不可自动读取的说明），不参与主行状态判定。 */
  notices?: string[]
  action?: QuotaSnapshotAction
  error?: QuotaSnapshotError
}

export interface QuotasResponse {
  status: QuotaStatus
  attention_count: number
  providers: ProviderQuotaSnapshot[]
  updated_at: number | null
  refreshing: boolean
}
