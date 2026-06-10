import { getDb, upsertModelPricing } from './db'

/**
 * Seed the model_pricing table with reference prices.
 * Prices are in USD per 1M tokens.
 *
 * Cached pricing strategy:
 * - Anthropic Claude: 10% of input (official API pricing)
 * - OpenAI: 25% of input (official API pricing)
 * - DeepSeek: official pricing from API docs
 * - Others (unknown actual price): 50% of input (conservative estimate)
 *
 * This is idempotent - uses UPSERT.
 */
export function seedPricing() {
  const models = [
    // ─── Anthropic — Claude 4 系列 ─── cached = 10% of input
    { model_id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4', provider: 'anthropic', input_price_per_1m: 15.00, cached_input_price_per_1m: 1.50, output_price_per_1m: 75.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', provider: 'anthropic', input_price_per_1m: 0.80, cached_input_price_per_1m: 0.08, output_price_per_1m: 4.00, reasoning_price_per_1m: 0 },
    // ─── Anthropic — 简写 ID ─── cached = 10% of input
    { model_id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7', provider: 'anthropic', input_price_per_1m: 15.00, cached_input_price_per_1m: 1.50, output_price_per_1m: 75.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', provider: 'anthropic', input_price_per_1m: 0.80, cached_input_price_per_1m: 0.08, output_price_per_1m: 4.00, reasoning_price_per_1m: 0 },
    // ─── Anthropic — Claude 3 系列 ─── cached = 10% of input
    { model_id: 'claude-3-5-sonnet', display_name: 'Claude 3.5 Sonnet', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-5-haiku', display_name: 'Claude 3.5 Haiku', provider: 'anthropic', input_price_per_1m: 0.80, cached_input_price_per_1m: 0.08, output_price_per_1m: 4.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-opus', display_name: 'Claude 3 Opus', provider: 'anthropic', input_price_per_1m: 15.00, cached_input_price_per_1m: 1.50, output_price_per_1m: 75.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-sonnet', display_name: 'Claude 3 Sonnet', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-haiku', display_name: 'Claude 3 Haiku', provider: 'anthropic', input_price_per_1m: 0.25, cached_input_price_per_1m: 0.03, output_price_per_1m: 1.25, reasoning_price_per_1m: 0 },

    // ─── OpenAI ─── cached = 25% of input (official pricing)
    { model_id: 'gpt-4o', display_name: 'GPT-4o', provider: 'openai', input_price_per_1m: 2.50, cached_input_price_per_1m: 1.25, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-4o-mini', display_name: 'GPT-4o Mini', provider: 'openai', input_price_per_1m: 0.15, cached_input_price_per_1m: 0.075, output_price_per_1m: 0.60, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-4.1', display_name: 'GPT-4.1', provider: 'openai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 8.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-4.1-mini', display_name: 'GPT-4.1 Mini', provider: 'openai', input_price_per_1m: 0.40, cached_input_price_per_1m: 0.10, output_price_per_1m: 1.60, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-4.1-nano', display_name: 'GPT-4.1 Nano', provider: 'openai', input_price_per_1m: 0.10, cached_input_price_per_1m: 0.025, output_price_per_1m: 0.40, reasoning_price_per_1m: 0 },
    { model_id: 'o3', display_name: 'o3', provider: 'openai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 8.00, reasoning_price_per_1m: 8.00 },
    { model_id: 'o3-mini', display_name: 'o3 Mini', provider: 'openai', input_price_per_1m: 1.10, cached_input_price_per_1m: 0.275, output_price_per_1m: 4.40, reasoning_price_per_1m: 4.40 },
    { model_id: 'o4-mini', display_name: 'o4 Mini', provider: 'openai', input_price_per_1m: 1.10, cached_input_price_per_1m: 0.275, output_price_per_1m: 4.40, reasoning_price_per_1m: 4.40 },
    { model_id: 'codex-mini', display_name: 'Codex Mini', provider: 'openai', input_price_per_1m: 1.50, cached_input_price_per_1m: 0.375, output_price_per_1m: 6.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.4', display_name: 'GPT-5.4', provider: 'openai', input_price_per_1m: 5.00, cached_input_price_per_1m: 1.25, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },

    // ─── Google ─── cached ≈ 50% of input (estimated)
    { model_id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro', provider: 'google', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.625, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-2.5-flash', display_name: 'Gemini 2.5 Flash', provider: 'google', input_price_per_1m: 0.15, cached_input_price_per_1m: 0.075, output_price_per_1m: 0.60, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-2.0-flash', display_name: 'Gemini 2.0 Flash', provider: 'google', input_price_per_1m: 0.10, cached_input_price_per_1m: 0.05, output_price_per_1m: 0.40, reasoning_price_per_1m: 0 },

    // ─── DeepSeek ─── official pricing
    { model_id: 'deepseek-v3', display_name: 'DeepSeek V3', provider: 'deepseek', input_price_per_1m: 0.27, cached_input_price_per_1m: 0.07, output_price_per_1m: 1.10, reasoning_price_per_1m: 0 },
    { model_id: 'deepseek-r1', display_name: 'DeepSeek R1', provider: 'deepseek', input_price_per_1m: 0.55, cached_input_price_per_1m: 0.14, output_price_per_1m: 2.19, reasoning_price_per_1m: 2.19 },
    { model_id: 'deepseek-chat', display_name: 'DeepSeek Chat', provider: 'deepseek', input_price_per_1m: 0.27, cached_input_price_per_1m: 0.07, output_price_per_1m: 1.10, reasoning_price_per_1m: 0 },
    { model_id: 'deepseek-reasoner', display_name: 'DeepSeek Reasoner', provider: 'deepseek', input_price_per_1m: 0.55, cached_input_price_per_1m: 0.14, output_price_per_1m: 2.19, reasoning_price_per_1m: 2.19 },
    { model_id: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', provider: 'deepseek', input_price_per_1m: 0.50, cached_input_price_per_1m: 0.10, output_price_per_1m: 2.00, reasoning_price_per_1m: 0 },

    // ─── Qwen ─── cached ≈ 50% of input (estimated)
    { model_id: 'qwen-max', display_name: 'Qwen Max', provider: 'alibaba', input_price_per_1m: 1.60, cached_input_price_per_1m: 0.80, output_price_per_1m: 6.40, reasoning_price_per_1m: 0 },
    { model_id: 'qwen-plus', display_name: 'Qwen Plus', provider: 'alibaba', input_price_per_1m: 0.40, cached_input_price_per_1m: 0.20, output_price_per_1m: 1.60, reasoning_price_per_1m: 0 },
    { model_id: 'qwen-turbo', display_name: 'Qwen Turbo', provider: 'alibaba', input_price_per_1m: 0.10, cached_input_price_per_1m: 0.05, output_price_per_1m: 0.40, reasoning_price_per_1m: 0 },
    { model_id: 'qwen3-235b', display_name: 'Qwen3 235B', provider: 'alibaba', input_price_per_1m: 0.40, cached_input_price_per_1m: 0.20, output_price_per_1m: 1.60, reasoning_price_per_1m: 0 },
    { model_id: 'qwen3-32b', display_name: 'Qwen3 32B', provider: 'alibaba', input_price_per_1m: 0.10, cached_input_price_per_1m: 0.05, output_price_per_1m: 0.40, reasoning_price_per_1m: 0 },

    // ─── Meta ─── cached ≈ 50% of input (estimated)
    { model_id: 'llama-4-maverick', display_name: 'Llama 4 Maverick', provider: 'meta', input_price_per_1m: 0.20, cached_input_price_per_1m: 0.10, output_price_per_1m: 0.80, reasoning_price_per_1m: 0 },
    { model_id: 'llama-4-scout', display_name: 'Llama 4 Scout', provider: 'meta', input_price_per_1m: 0.10, cached_input_price_per_1m: 0.05, output_price_per_1m: 0.40, reasoning_price_per_1m: 0 },
    { model_id: 'llama-3.3-70b', display_name: 'Llama 3.3 70B', provider: 'meta', input_price_per_1m: 0.07, cached_input_price_per_1m: 0.035, output_price_per_1m: 0.28, reasoning_price_per_1m: 0 },

    // ─── 国产模型 ─── 参考 VibeCafe 实际价格
    { model_id: 'glm-5.1', display_name: 'GLM-5.1', provider: 'zhipu', input_price_per_1m: 0.60, cached_input_price_per_1m: 0.11, output_price_per_1m: 2.20, reasoning_price_per_1m: 0 },
    { model_id: 'glm-5-turbo', display_name: 'GLM-5 Turbo', provider: 'zhipu', input_price_per_1m: 0.30, cached_input_price_per_1m: 0.06, output_price_per_1m: 1.10, reasoning_price_per_1m: 0 },
    { model_id: 'glm-4.5-air', display_name: 'GLM-4.5 Air', provider: 'zhipu', input_price_per_1m: 0.10, cached_input_price_per_1m: 0.02, output_price_per_1m: 0.40, reasoning_price_per_1m: 0 },
    { model_id: 'glm-4.7', display_name: 'GLM-4.7', provider: 'zhipu', input_price_per_1m: 0.30, cached_input_price_per_1m: 0.06, output_price_per_1m: 1.10, reasoning_price_per_1m: 0 },
    { model_id: 'MiniMax-M2.7', display_name: 'MiniMax M2.7', provider: 'minimax', input_price_per_1m: 0.30, cached_input_price_per_1m: 0.03, output_price_per_1m: 1.20, reasoning_price_per_1m: 0 },
    { model_id: 'MiniMax-M2.7-highspeed', display_name: 'MiniMax M2.7 HighSpeed', provider: 'minimax', input_price_per_1m: 1.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 8.00, reasoning_price_per_1m: 0 },
    { model_id: 'mimo-v2.5-pro', display_name: 'MiMo V2.5 Pro', provider: 'mimo', input_price_per_1m: 0.40, cached_input_price_per_1m: 0.08, output_price_per_1m: 2.00, reasoning_price_per_1m: 0 },
    { model_id: 'zai/glm-5', display_name: 'ZAI GLM-5', provider: 'zhipu', input_price_per_1m: 1.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 5.00, reasoning_price_per_1m: 0 },
    { model_id: 'kimi-k2-thinking', display_name: 'Kimi K2 Thinking', provider: 'moonshot', input_price_per_1m: 0.60, cached_input_price_per_1m: 0.15, output_price_per_1m: 2.40, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.3-codex', display_name: 'GPT-5.3 Codex', provider: 'openai', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.75, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.5', display_name: 'GPT-5.5', provider: 'openai', input_price_per_1m: 8.00, cached_input_price_per_1m: 2.00, output_price_per_1m: 24.00, reasoning_price_per_1m: 0 },
  ]

  const db = getDb()
  const insertMany = db.transaction(() => {
    for (const model of models) {
      upsertModelPricing(model)
    }
  })

  insertMany()
  console.log(`[TokenTrail] Seeded ${models.length} model pricing entries`)
}
