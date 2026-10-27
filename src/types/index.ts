// TokenTrail 类型定义

/**
 * 来源工具标识。
 * 预定义了5个已知来源，但运行时接受任意字符串（方便扩展，不需要改代码）。
 */
export type Source = string

/** 已知的来源列表（用于显示名称映射和输入提示） */
export const KNOWN_SOURCES = ['codex', 'kimi-code', 'claude-code', 'kiro', 'openclaw', 'hermes', 'lobster'] as const

/** 用量上报请求 */
export interface UsageReport {
  source: Source
  project?: string
  model: string
  input_tokens: number
  /** 缓存输入 token 数（独立于 input_tokens，不重复计算） */
  cached_input_tokens?: number
  output_tokens: number
  /** 推理 token 数（独立于 output_tokens，如 o3 系列的 reasoning tokens） */
  reasoning_tokens?: number
  request_id?: string
  timestamp?: number // Unix ms
}

/** 数据库中的用量记录 */
export interface UsageRecord {
  id: number
  source: string
  project: string
  model: string
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cost_usd: number
  request_id: string | null
  timestamp: number
  created_at: string
  /** 1 = token 数是估算值（如 TraeWork 按字符估算），不计入汇总 */
  estimated?: number
  /** Credit 计量用量（Kiro CLI 按 credits 计费，无 token 时携带数量） */
  credits?: number
}

/** 模型价格配置 */
export interface ModelPricing {
  id: number
  model_id: string
  display_name: string
  provider: string
  input_price_per_1m: number
  cached_input_price_per_1m: number
  output_price_per_1m: number
  reasoning_price_per_1m: number
  updated_at: string
}

/** Dashboard 查询参数 */
export interface UsageQuery {
  days?: number // 1 | 7 | 30 | 90
  source?: string // 逗号分隔
  model?: string // 逗号分隔
}

/** 聚合统计响应 */
export interface StatsResponse {
  total_tokens: number
  total_cost_usd: number
  total_requests: number
  /** 估算用量单独统计（Antigravity / TraeWork 扫描等），不含在主口径内 */
  estimated_tokens: number
  estimated_cost_usd: number
  estimated_requests: number
  /** 估算 token 按来源拆开，供「另有估算」标签点名 */
  estimated_by_source?: { source: string; total_tokens: number }[]
  /** Cursor 实测用量的三类分组；其他来源不计入 */
  cursor_groups?: {
    named: { total_tokens: number; cost_usd: number; count: number }
    own: { total_tokens: number; cost_usd: number; count: number }
    grok: { total_tokens: number; cost_usd: number; count: number }
  }
  avg_daily_tokens: number
  avg_daily_cost_usd: number
  by_source: SourceStat[]
  by_model: ModelStat[]
  by_project: ProjectStat[]
  daily: DailyStat[]
}

export interface SourceStat {
  source: string
  total_tokens: number
  cost_usd: number
  count: number
}

export interface ModelStat {
  model: string
  display_name: string
  total_tokens: number
  cost_usd: number
  count: number
}

export interface ProjectStat {
  project: string
  total_tokens: number
  cost_usd: number
  count: number
}

export interface DailyStat {
  date: string
  total_tokens: number
  cost_usd: number
  count: number
}

/** 货币类型 */
export type Currency = 'USD' | 'RMB'

/** 主题类型：保留三种视觉特征明确的风格 */
export type Theme = 'quiet-workbench' | 'neon-mecha' | 'editorial-paper'

/** 时间范围选项 */
export type TimeRange = 1 | 7 | 30 | 90

/** 来源显示名称映射 */
export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  'codex': 'Codex',
  'codex-review': 'Codex Review',
  'claude-code': 'Claude Code',
  'kimi-code': 'Kimi Code',
  'kiro': 'Kiro CLI',
  'openclaw': 'OpenClaw',
  'hermes': 'Hermes',
  'lobster': 'Lobster',
  'traework': 'TraeWork',
  'antigravity': 'Antigravity',
  'grok': 'Grok',
  'cursor': 'Cursor',
  'vibecafe': 'VibeCafé',
}
