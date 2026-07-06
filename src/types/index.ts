// TokenTrail 类型定义

/**
 * 来源工具标识。
 * 预定义了5个已知来源，但运行时接受任意字符串（方便扩展，不需要改代码）。
 */
export type Source = string

/** 已知的来源列表（用于显示名称映射和输入提示） */
export const KNOWN_SOURCES = ['codex', 'claude-code', 'openclaw', 'hermes', 'lobster'] as const

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

/** 主题类型 */
export type Theme = 'neon-mecha' | 'ember-scroll' | 'editorial-paper' | 'luminous-glass'

/** 时间范围选项 */
export type TimeRange = 1 | 7 | 30 | 90

/** 来源显示名称映射 */
export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  'codex': 'Codex',
  'codex-review': 'Codex Review',
  'claude-code': 'Claude Code',
  'openclaw': 'OpenClaw',
  'hermes': 'Hermes',
  'lobster': 'Lobster',
  'traework': 'TraeWork',
}
