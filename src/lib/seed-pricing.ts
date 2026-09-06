import { getDb } from './db'

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
 * Idempotent and non-destructive: only inserts models that are missing.
 * Never overwrites prices customized via POST /api/pricing or Excel import.
 */
export function seedPricing() {
  const models = [
    // ─── Anthropic ─── OpenRouter pricing
    { model_id: 'claude-opus-5', display_name: 'Claude Opus 5', provider: 'anthropic', input_price_per_1m: 5.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 25.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-opus-5-low', display_name: 'Claude Opus 5 Low', provider: 'anthropic', input_price_per_1m: 5.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 25.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', provider: 'anthropic', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.20, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-fable-5.1', display_name: 'Claude Fable 5.1', provider: 'anthropic', input_price_per_1m: 10.00, cached_input_price_per_1m: 0.25, output_price_per_1m: 50.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-fable-5', display_name: 'Claude Fable 5', provider: 'anthropic', input_price_per_1m: 10.00, cached_input_price_per_1m: 1.00, output_price_per_1m: 50.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7', provider: 'anthropic', input_price_per_1m: 5.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 25.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4', provider: 'anthropic', input_price_per_1m: 15.00, cached_input_price_per_1m: 1.50, output_price_per_1m: 75.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'anthropic/claude-sonnet-4', display_name: 'Claude Sonnet 4', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', provider: 'anthropic', input_price_per_1m: 1.00, cached_input_price_per_1m: 0.10, output_price_per_1m: 5.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', provider: 'anthropic', input_price_per_1m: 1.00, cached_input_price_per_1m: 0.10, output_price_per_1m: 5.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-5-sonnet', display_name: 'Claude 3.5 Sonnet', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-5-haiku', display_name: 'Claude 3.5 Haiku', provider: 'anthropic', input_price_per_1m: 0.80, cached_input_price_per_1m: 0.08, output_price_per_1m: 4.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-opus', display_name: 'Claude 3 Opus', provider: 'anthropic', input_price_per_1m: 15.00, cached_input_price_per_1m: 1.50, output_price_per_1m: 75.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-sonnet', display_name: 'Claude 3 Sonnet', provider: 'anthropic', input_price_per_1m: 3.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-haiku', display_name: 'Claude 3 Haiku', provider: 'anthropic', input_price_per_1m: 0.25, cached_input_price_per_1m: 0.03, output_price_per_1m: 1.25, reasoning_price_per_1m: 0 },

    // ─── OpenAI ─── OpenRouter pricing
    { model_id: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', provider: 'openai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.20, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.6-sol-pro', display_name: 'GPT-5.6 Sol Pro', provider: 'openai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.20, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.6-terra', display_name: 'GPT-5.6 Terra', provider: 'openai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.20, output_price_per_1m: 12.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.6-terra-pro', display_name: 'GPT-5.6 Terra Pro', provider: 'openai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.20, output_price_per_1m: 12.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.6-luna', display_name: 'GPT-5.6 Luna', provider: 'openai', input_price_per_1m: 0.20, cached_input_price_per_1m: 0.02, output_price_per_1m: 1.20, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.6-luna-pro', display_name: 'GPT-5.6 Luna Pro', provider: 'openai', input_price_per_1m: 0.20, cached_input_price_per_1m: 0.02, output_price_per_1m: 1.20, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.5', display_name: 'GPT-5.5', provider: 'openai', input_price_per_1m: 5.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 30.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.5-pro', display_name: 'GPT-5.5 Pro', provider: 'openai', input_price_per_1m: 30.00, cached_input_price_per_1m: 0, output_price_per_1m: 180.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.4', display_name: 'GPT-5.4', provider: 'openai', input_price_per_1m: 2.50, cached_input_price_per_1m: 0.25, output_price_per_1m: 15.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.4-mini', display_name: 'GPT-5.4 Mini', provider: 'openai', input_price_per_1m: 0.75, cached_input_price_per_1m: 0.075, output_price_per_1m: 4.50, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.4-nano', display_name: 'GPT-5.4 Nano', provider: 'openai', input_price_per_1m: 0.20, cached_input_price_per_1m: 0.02, output_price_per_1m: 1.25, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.3-codex', display_name: 'GPT-5.3 Codex', provider: 'openai', input_price_per_1m: 1.75, cached_input_price_per_1m: 0.175, output_price_per_1m: 14.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.2-codex', display_name: 'GPT-5.2 Codex', provider: 'openai', input_price_per_1m: 1.75, cached_input_price_per_1m: 0.175, output_price_per_1m: 14.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.1-codex-max', display_name: 'GPT-5.1 Codex Max', provider: 'openai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.125, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.1-codex', display_name: 'GPT-5.1 Codex', provider: 'openai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.13, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5.1-codex-mini', display_name: 'GPT-5.1 Codex Mini', provider: 'openai', input_price_per_1m: 0.25, cached_input_price_per_1m: 0.03, output_price_per_1m: 2.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5', display_name: 'GPT-5', provider: 'openai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.125, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5-mini', display_name: 'GPT-5 Mini', provider: 'openai', input_price_per_1m: 0.25, cached_input_price_per_1m: 0.025, output_price_per_1m: 2.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-5-nano', display_name: 'GPT-5 Nano', provider: 'openai', input_price_per_1m: 0.05, cached_input_price_per_1m: 0.005, output_price_per_1m: 0.40, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-4o', display_name: 'GPT-4o', provider: 'openai', input_price_per_1m: 2.50, cached_input_price_per_1m: 1.25, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-4o-mini', display_name: 'GPT-4o Mini', provider: 'openai', input_price_per_1m: 0.15, cached_input_price_per_1m: 0.075, output_price_per_1m: 0.60, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-4.1', display_name: 'GPT-4.1', provider: 'openai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 8.00, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-4.1-mini', display_name: 'GPT-4.1 Mini', provider: 'openai', input_price_per_1m: 0.40, cached_input_price_per_1m: 0.10, output_price_per_1m: 1.60, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-4.1-nano', display_name: 'GPT-4.1 Nano', provider: 'openai', input_price_per_1m: 0.10, cached_input_price_per_1m: 0.025, output_price_per_1m: 0.40, reasoning_price_per_1m: 0 },
    { model_id: 'o3', display_name: 'o3', provider: 'openai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 8.00, reasoning_price_per_1m: 8.00 },
    { model_id: 'o3-mini', display_name: 'o3 Mini', provider: 'openai', input_price_per_1m: 1.10, cached_input_price_per_1m: 0.55, output_price_per_1m: 4.40, reasoning_price_per_1m: 4.40 },
    { model_id: 'o4-mini', display_name: 'o4 Mini', provider: 'openai', input_price_per_1m: 1.10, cached_input_price_per_1m: 0.275, output_price_per_1m: 4.40, reasoning_price_per_1m: 4.40 },
    { model_id: 'codex-mini', display_name: 'Codex Mini', provider: 'openai', input_price_per_1m: 1.50, cached_input_price_per_1m: 0.375, output_price_per_1m: 6.00, reasoning_price_per_1m: 0 },
    { model_id: 'codex-auto-review', display_name: 'Codex Auto Review', provider: 'openai', input_price_per_1m: 0.75, cached_input_price_per_1m: 0.075, output_price_per_1m: 4.50, reasoning_price_per_1m: 0 },

    // ─── Google / Gemini / Antigravity ─── OpenRouter pricing
    { model_id: 'gemini-3.8-flash', display_name: 'Gemini 3.8 Flash', provider: 'google', input_price_per_1m: 0.75, cached_input_price_per_1m: 0.075, output_price_per_1m: 3.75, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-3.8-pro', display_name: 'Gemini 3.8 Pro', provider: 'google', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.20, output_price_per_1m: 12.00, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-3.7-flash', display_name: 'Gemini 3.7 Flash', provider: 'google', input_price_per_1m: 0.75, cached_input_price_per_1m: 0.075, output_price_per_1m: 3.75, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-3.7-pro', display_name: 'Gemini 3.7 Pro', provider: 'google', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.20, output_price_per_1m: 12.00, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-3.6-flash', display_name: 'Gemini 3.6 Flash', provider: 'google', input_price_per_1m: 0.75, cached_input_price_per_1m: 0.075, output_price_per_1m: 3.75, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-3.6-pro', display_name: 'Gemini 3.6 Pro', provider: 'google', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.20, output_price_per_1m: 12.00, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-3.5-flash', display_name: 'Gemini 3.5 Flash', provider: 'google', input_price_per_1m: 1.50, cached_input_price_per_1m: 0.15, output_price_per_1m: 9.00, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-3.5-flash-lite', display_name: 'Gemini 3.5 Flash Lite', provider: 'google', input_price_per_1m: 0.30, cached_input_price_per_1m: 0.03, output_price_per_1m: 2.50, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro', provider: 'google', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.125, output_price_per_1m: 10.00, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-2.5-flash', display_name: 'Gemini 2.5 Flash', provider: 'google', input_price_per_1m: 0.30, cached_input_price_per_1m: 0.03, output_price_per_1m: 2.50, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-2.5-flash-lite', display_name: 'Gemini 2.5 Flash Lite', provider: 'google', input_price_per_1m: 0.10, cached_input_price_per_1m: 0.01, output_price_per_1m: 0.40, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-2.0-flash', display_name: 'Gemini 2.0 Flash', provider: 'google', input_price_per_1m: 0.10, cached_input_price_per_1m: 0.05, output_price_per_1m: 0.40, reasoning_price_per_1m: 0 },

    // ─── xAI / Grok ─── OpenRouter pricing
    { model_id: 'grok-4.6', display_name: 'Grok 4.6', provider: 'xai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 6.00, reasoning_price_per_1m: 0 },
    { model_id: 'grok-4.6-build', display_name: 'Grok 4.6 Build', provider: 'xai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 6.00, reasoning_price_per_1m: 0 },
    { model_id: 'grok-4.5', display_name: 'Grok 4.5', provider: 'xai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 6.00, reasoning_price_per_1m: 0 },
    { model_id: 'grok-4.5-build', display_name: 'Grok 4.5 Build', provider: 'xai', input_price_per_1m: 1.00, cached_input_price_per_1m: 0.20, output_price_per_1m: 2.00, reasoning_price_per_1m: 0 },
    { model_id: 'grok-4.3', display_name: 'Grok 4.3', provider: 'xai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.20, output_price_per_1m: 2.50, reasoning_price_per_1m: 0 },
    { model_id: 'grok-4.20', display_name: 'Grok 4.20', provider: 'xai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.20, output_price_per_1m: 2.50, reasoning_price_per_1m: 0 },
    { model_id: 'cursor-grok-4.5-high', display_name: 'Cursor Grok 4.5 High', provider: 'xai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.30, output_price_per_1m: 6.00, reasoning_price_per_1m: 0 },
    { model_id: 'cursor-grok-4.6-high-fast', display_name: 'Cursor Grok 4.6 High Fast', provider: 'xai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 6.00, reasoning_price_per_1m: 0 },
    { model_id: 'grok-bot-default', display_name: 'Grok Bot Default', provider: 'xai', input_price_per_1m: 2.00, cached_input_price_per_1m: 0.50, output_price_per_1m: 6.00, reasoning_price_per_1m: 0 },

    // ─── 智谱 GLM / Z.ai ─── OpenRouter pricing
    { model_id: 'glm-5.3-flash', display_name: 'GLM-5.3 Flash', provider: 'zhipu', input_price_per_1m: 0.0750, cached_input_price_per_1m: 0.0150, output_price_per_1m: 0.2500, reasoning_price_per_1m: 0 },
    { model_id: 'glm-5.3', display_name: 'GLM-5.3', provider: 'zhipu', input_price_per_1m: 1.4000, cached_input_price_per_1m: 0.1400, output_price_per_1m: 4.4000, reasoning_price_per_1m: 0 },
    { model_id: 'glm-5.2', display_name: 'GLM-5.2', provider: 'zhipu', input_price_per_1m: 0.9660, cached_input_price_per_1m: 0.1932, output_price_per_1m: 3.0360, reasoning_price_per_1m: 0 },
    { model_id: 'glm-5.1', display_name: 'GLM-5.1', provider: 'zhipu', input_price_per_1m: 0.9660, cached_input_price_per_1m: 0.1794, output_price_per_1m: 3.0360, reasoning_price_per_1m: 0 },
    { model_id: 'glm-5-turbo', display_name: 'GLM-5 Turbo', provider: 'zhipu', input_price_per_1m: 1.2000, cached_input_price_per_1m: 0.2400, output_price_per_1m: 4.0000, reasoning_price_per_1m: 0 },
    { model_id: 'glm-5', display_name: 'GLM-5', provider: 'zhipu', input_price_per_1m: 0.6000, cached_input_price_per_1m: 0.1200, output_price_per_1m: 1.9200, reasoning_price_per_1m: 0 },
    { model_id: 'zai/glm-5', display_name: 'ZAI GLM-5', provider: 'zhipu', input_price_per_1m: 0.6000, cached_input_price_per_1m: 0.1200, output_price_per_1m: 1.9200, reasoning_price_per_1m: 0 },
    { model_id: 'glm-4.7', display_name: 'GLM-4.7', provider: 'zhipu', input_price_per_1m: 0.4000, cached_input_price_per_1m: 0.0800, output_price_per_1m: 1.7500, reasoning_price_per_1m: 0 },
    { model_id: 'glm-4.7-flash', display_name: 'GLM-4.7 Flash', provider: 'zhipu', input_price_per_1m: 0.0600, cached_input_price_per_1m: 0.0100, output_price_per_1m: 0.4000, reasoning_price_per_1m: 0 },
    { model_id: 'glm-4.5', display_name: 'GLM-4.5', provider: 'zhipu', input_price_per_1m: 0.6000, cached_input_price_per_1m: 0.1100, output_price_per_1m: 2.2000, reasoning_price_per_1m: 0 },
    { model_id: 'glm-4.5-air', display_name: 'GLM-4.5 Air', provider: 'zhipu', input_price_per_1m: 0.1300, cached_input_price_per_1m: 0.0250, output_price_per_1m: 0.8500, reasoning_price_per_1m: 0 },
    { model_id: 'glm-4.5-flash', display_name: 'GLM-4.5 Flash', provider: 'zhipu', input_price_per_1m: 0.0600, cached_input_price_per_1m: 0.0100, output_price_per_1m: 0.4000, reasoning_price_per_1m: 0 },

    // ─── Moonshot / Kimi ─── OpenRouter pricing
    { model_id: 'kimi-k3', display_name: 'Kimi K3', provider: 'moonshot', input_price_per_1m: 3.0000, cached_input_price_per_1m: 0.3000, output_price_per_1m: 15.0000, reasoning_price_per_1m: 0 },
    { model_id: 'kimi-code/k3', display_name: 'Kimi Code K3', provider: 'moonshot', input_price_per_1m: 3.0000, cached_input_price_per_1m: 0.3000, output_price_per_1m: 15.0000, reasoning_price_per_1m: 0 },
    { model_id: 'k3', display_name: 'Kimi K3', provider: 'moonshot', input_price_per_1m: 3.0000, cached_input_price_per_1m: 0.3000, output_price_per_1m: 15.0000, reasoning_price_per_1m: 0 },
    { model_id: 'kimi-k2.7-code', display_name: 'Kimi K2.7 Code', provider: 'moonshot', input_price_per_1m: 0.6600, cached_input_price_per_1m: 0.1800, output_price_per_1m: 3.4000, reasoning_price_per_1m: 0 },
    { model_id: 'kimi-code/kimi-for-coding', display_name: 'Kimi for Coding', provider: 'moonshot', input_price_per_1m: 0.6600, cached_input_price_per_1m: 0.1800, output_price_per_1m: 3.4000, reasoning_price_per_1m: 0 },
    { model_id: 'kimi-for-coding', display_name: 'Kimi for Coding', provider: 'moonshot', input_price_per_1m: 0.6600, cached_input_price_per_1m: 0.1800, output_price_per_1m: 3.4000, reasoning_price_per_1m: 0 },
    { model_id: 'kimi-k2.6', display_name: 'Kimi K2.6', provider: 'moonshot', input_price_per_1m: 0.9500, cached_input_price_per_1m: 0.1600, output_price_per_1m: 4.0000, reasoning_price_per_1m: 0 },
    { model_id: 'kimi-k2.5', display_name: 'Kimi K2.5', provider: 'moonshot', input_price_per_1m: 0.4500, cached_input_price_per_1m: 0.0700, output_price_per_1m: 2.2500, reasoning_price_per_1m: 0 },
    { model_id: 'kimi-k2-thinking', display_name: 'Kimi K2 Thinking', provider: 'moonshot', input_price_per_1m: 0.6000, cached_input_price_per_1m: 0.1500, output_price_per_1m: 2.5000, reasoning_price_per_1m: 0 },
    { model_id: 'kimi-k2', display_name: 'Kimi K2', provider: 'moonshot', input_price_per_1m: 0.5700, cached_input_price_per_1m: 0.1425, output_price_per_1m: 2.3000, reasoning_price_per_1m: 0 },

    // ─── DeepSeek ─── OpenRouter pricing
    { model_id: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', provider: 'deepseek', input_price_per_1m: 1.0423, cached_input_price_per_1m: 0.0869, output_price_per_1m: 2.0845, reasoning_price_per_1m: 0 },
    { model_id: 'deepseek-v4-flash', display_name: 'DeepSeek V4 Flash', provider: 'deepseek', input_price_per_1m: 0.0886, cached_input_price_per_1m: 0.0177, output_price_per_1m: 0.1772, reasoning_price_per_1m: 0 },
    { model_id: 'deepseek-v4-flash-vision-exp', display_name: 'DeepSeek V4 Flash Vision Exp', provider: 'deepseek', input_price_per_1m: 0.2200, cached_input_price_per_1m: 0.0070, output_price_per_1m: 0.6600, reasoning_price_per_1m: 0 },
    { model_id: 'deepseek-v3', display_name: 'DeepSeek V3', provider: 'deepseek', input_price_per_1m: 0.2700, cached_input_price_per_1m: 0.0700, output_price_per_1m: 1.1000, reasoning_price_per_1m: 0 },
    { model_id: 'deepseek-chat', display_name: 'DeepSeek Chat', provider: 'deepseek', input_price_per_1m: 0.3200, cached_input_price_per_1m: 0.0700, output_price_per_1m: 0.8900, reasoning_price_per_1m: 0 },
    { model_id: 'deepseek-r1', display_name: 'DeepSeek R1', provider: 'deepseek', input_price_per_1m: 0.7000, cached_input_price_per_1m: 0.1400, output_price_per_1m: 2.5000, reasoning_price_per_1m: 2.5000 },
    { model_id: 'deepseek-reasoner', display_name: 'DeepSeek Reasoner', provider: 'deepseek', input_price_per_1m: 0.7000, cached_input_price_per_1m: 0.1400, output_price_per_1m: 2.5000, reasoning_price_per_1m: 2.5000 },

    // ─── Alibaba / Qwen ─── OpenRouter pricing
    { model_id: 'qwen3.7-max', display_name: 'Qwen3.7 Max', provider: 'alibaba', input_price_per_1m: 1.4750, cached_input_price_per_1m: 0.2950, output_price_per_1m: 4.4250, reasoning_price_per_1m: 0 },
    { model_id: 'qwen3.7-plus', display_name: 'Qwen3.7 Plus', provider: 'alibaba', input_price_per_1m: 0.3200, cached_input_price_per_1m: 0.0640, output_price_per_1m: 1.2800, reasoning_price_per_1m: 0 },
    { model_id: 'qwen3.6-plus', display_name: 'Qwen3.6 Plus', provider: 'alibaba', input_price_per_1m: 0.3250, cached_input_price_per_1m: 0.0650, output_price_per_1m: 1.9500, reasoning_price_per_1m: 0 },
    { model_id: 'qwen3.6-flash', display_name: 'Qwen3.6 Flash', provider: 'alibaba', input_price_per_1m: 0.1875, cached_input_price_per_1m: 0.0375, output_price_per_1m: 1.1250, reasoning_price_per_1m: 0 },
    { model_id: 'qwen-max', display_name: 'Qwen Max', provider: 'alibaba', input_price_per_1m: 0.7800, cached_input_price_per_1m: 0.1560, output_price_per_1m: 3.9000, reasoning_price_per_1m: 0 },
    { model_id: 'qwen-plus', display_name: 'Qwen Plus', provider: 'alibaba', input_price_per_1m: 0.2600, cached_input_price_per_1m: 0.0520, output_price_per_1m: 0.7800, reasoning_price_per_1m: 0 },
    { model_id: 'qwen3-coder', display_name: 'Qwen3 Coder', provider: 'alibaba', input_price_per_1m: 0.3000, cached_input_price_per_1m: 0.1000, output_price_per_1m: 1.0000, reasoning_price_per_1m: 0 },
    { model_id: 'qwen3-235b', display_name: 'Qwen3 235B', provider: 'alibaba', input_price_per_1m: 0.4550, cached_input_price_per_1m: 0.0910, output_price_per_1m: 1.8200, reasoning_price_per_1m: 0 },
    { model_id: 'qwen3-32b', display_name: 'Qwen3 32B', provider: 'alibaba', input_price_per_1m: 0.0800, cached_input_price_per_1m: 0.0160, output_price_per_1m: 0.2800, reasoning_price_per_1m: 0 },
    { model_id: 'qwen-turbo', display_name: 'Qwen Turbo', provider: 'alibaba', input_price_per_1m: 0.1000, cached_input_price_per_1m: 0.0500, output_price_per_1m: 0.4000, reasoning_price_per_1m: 0 },

    // ─── Meta ─── OpenRouter pricing
    { model_id: 'llama-4-maverick', display_name: 'Llama 4 Maverick', provider: 'meta', input_price_per_1m: 0.2000, cached_input_price_per_1m: 0.0400, output_price_per_1m: 0.6960, reasoning_price_per_1m: 0 },
    { model_id: 'llama-4-scout', display_name: 'Llama 4 Scout', provider: 'meta', input_price_per_1m: 0.1000, cached_input_price_per_1m: 0.0200, output_price_per_1m: 0.3000, reasoning_price_per_1m: 0 },
    { model_id: 'llama-3.3-70b', display_name: 'Llama 3.3 70B', provider: 'meta', input_price_per_1m: 0.1000, cached_input_price_per_1m: 0.0200, output_price_per_1m: 0.3200, reasoning_price_per_1m: 0 },
    { model_id: 'llama-3.1-405b', display_name: 'Llama 3.1 405B', provider: 'meta', input_price_per_1m: 1.0000, cached_input_price_per_1m: 0.2000, output_price_per_1m: 1.0000, reasoning_price_per_1m: 0 },
    { model_id: 'llama-3.1-70b', display_name: 'Llama 3.1 70B', provider: 'meta', input_price_per_1m: 0.4000, cached_input_price_per_1m: 0.0800, output_price_per_1m: 0.4000, reasoning_price_per_1m: 0 },
    { model_id: 'llama-3.1-8b', display_name: 'Llama 3.1 8B', provider: 'meta', input_price_per_1m: 0.0500, cached_input_price_per_1m: 0.0250, output_price_per_1m: 0.0800, reasoning_price_per_1m: 0 },
    { model_id: 'muse-spark-1.3', display_name: 'Muse Spark 1.3', provider: 'meta', input_price_per_1m: 1.2500, cached_input_price_per_1m: 0.1500, output_price_per_1m: 4.2500, reasoning_price_per_1m: 0 },
    { model_id: 'muse-spark-1.3-contributor', display_name: 'Muse Spark 1.3 Contributor', provider: 'meta', input_price_per_1m: 0.1000, cached_input_price_per_1m: 0.0020, output_price_per_1m: 0.2000, reasoning_price_per_1m: 0 },
    { model_id: 'muse-glimmer-30b', display_name: 'Muse Glimmer 30B', provider: 'meta', input_price_per_1m: 0.3000, cached_input_price_per_1m: 0.0400, output_price_per_1m: 1.1000, reasoning_price_per_1m: 0 },

    // ─── MiniMax ─── OpenRouter pricing
    { model_id: 'MiniMax-M2.7', display_name: 'MiniMax M2.7', provider: 'minimax', input_price_per_1m: 0.3000, cached_input_price_per_1m: 0.0600, output_price_per_1m: 1.2000, reasoning_price_per_1m: 0 },
    { model_id: 'MiniMax-M2.7-highspeed', display_name: 'MiniMax M2.7 HighSpeed', provider: 'minimax', input_price_per_1m: 0.3000, cached_input_price_per_1m: 0.0600, output_price_per_1m: 1.2000, reasoning_price_per_1m: 0 },
    { model_id: 'minimax-m2.7-highspeed', display_name: 'MiniMax M2.7 HighSpeed', provider: 'minimax', input_price_per_1m: 0.3000, cached_input_price_per_1m: 0.0600, output_price_per_1m: 1.2000, reasoning_price_per_1m: 0 },
    { model_id: 'minimax-m3', display_name: 'MiniMax M3', provider: 'minimax', input_price_per_1m: 0.3000, cached_input_price_per_1m: 0.0600, output_price_per_1m: 1.2000, reasoning_price_per_1m: 0 },
    { model_id: 'minimax-m2.5', display_name: 'MiniMax M2.5', provider: 'minimax', input_price_per_1m: 0.2700, cached_input_price_per_1m: 0.0270, output_price_per_1m: 1.0800, reasoning_price_per_1m: 0 },
    { model_id: 'minimax-01', display_name: 'MiniMax-01', provider: 'minimax', input_price_per_1m: 0.2000, cached_input_price_per_1m: 0.0000, output_price_per_1m: 1.1000, reasoning_price_per_1m: 0 },

    // ─── 其他常用国内模型 ───
    { model_id: 'mimo-v2.5-pro', display_name: 'MiMo V2.5 Pro', provider: 'mimo', input_price_per_1m: 0.4000, cached_input_price_per_1m: 0.0800, output_price_per_1m: 2.0000, reasoning_price_per_1m: 0 },
  ]

  const db = getDb()
  // Insert missing models. On conflict, only upgrade zero-price placeholders
  // (auto-registered by ensureModelPricing) — never clobber Excel/API custom prices.
  const upsertSeed = db.prepare(`
    INSERT INTO model_pricing (
      model_id, display_name, provider,
      input_price_per_1m, cached_input_price_per_1m,
      output_price_per_1m, reasoning_price_per_1m
    ) VALUES (
      @model_id, @display_name, @provider,
      @input_price_per_1m, @cached_input_price_per_1m,
      @output_price_per_1m, @reasoning_price_per_1m
    )
    ON CONFLICT(model_id) DO UPDATE SET
      display_name = excluded.display_name,
      provider = excluded.provider,
      input_price_per_1m = excluded.input_price_per_1m,
      cached_input_price_per_1m = excluded.cached_input_price_per_1m,
      output_price_per_1m = excluded.output_price_per_1m,
      reasoning_price_per_1m = excluded.reasoning_price_per_1m,
      updated_at = CURRENT_TIMESTAMP
    WHERE model_pricing.input_price_per_1m = 0
      AND model_pricing.cached_input_price_per_1m = 0
      AND model_pricing.output_price_per_1m = 0
      AND model_pricing.reasoning_price_per_1m = 0
      AND (
        excluded.input_price_per_1m != 0
        OR excluded.cached_input_price_per_1m != 0
        OR excluded.output_price_per_1m != 0
        OR excluded.reasoning_price_per_1m != 0
      )
  `)

  let changed = 0
  const insertMany = db.transaction(() => {
    for (const model of models) {
      const result = upsertSeed.run({
        ...model,
        cached_input_price_per_1m: model.cached_input_price_per_1m ?? 0,
        reasoning_price_per_1m: model.reasoning_price_per_1m ?? 0,
      })
      if (result.changes > 0) changed++
    }
  })

  insertMany()
  if (changed > 0) {
    console.log(`[TokenTrail] Seeded/updated ${changed} model pricing entries (${models.length} in catalog)`)
  }
}
