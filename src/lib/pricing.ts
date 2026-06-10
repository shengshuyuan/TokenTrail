import { getModelPricing } from './db'

/**
 * Calculate cost for a usage record based on model pricing.
 * All prices are in USD per 1M tokens.
 * SERVER-ONLY: depends on db.ts (better-sqlite3)
 */
export function calculateCost(params: {
  model: string
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
}): number {
  const pricing = getModelPricing(params.model)
  if (!pricing) {
    // 未知模型：记录警告，返回 0，不阻断上报流程
    console.warn(`[TokenTrail] Unknown model: "${params.model}" — cost set to $0. Add pricing via POST /api/pricing`)
    return 0
  }

  const inputCost = (params.input_tokens / 1_000_000) * pricing.input_price_per_1m
  const cachedCost = (params.cached_input_tokens / 1_000_000) * pricing.cached_input_price_per_1m
  const outputCost = (params.output_tokens / 1_000_000) * pricing.output_price_per_1m
  const reasoningCost = (params.reasoning_tokens / 1_000_000) * pricing.reasoning_price_per_1m

  return Math.round((inputCost + cachedCost + outputCost + reasoningCost) * 1_000_000) / 1_000_000
}
