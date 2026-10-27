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
    { model_id: 'anthropic/claude-sonnet-4', display_name: "Claude Sonnet 4", provider: 'anthropic', input_price_per_1m: 3, cached_input_price_per_1m: 0.3, output_price_per_1m: 15, reasoning_price_per_1m: 15 },
    { model_id: 'claude-3-5-haiku', display_name: "Claude 3.5 Haiku", provider: 'anthropic', input_price_per_1m: 0.8, cached_input_price_per_1m: 0.08, output_price_per_1m: 4, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-5-sonnet', display_name: "Claude 3.5 Sonnet", provider: 'anthropic', input_price_per_1m: 3, cached_input_price_per_1m: 0.3, output_price_per_1m: 15, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-haiku', display_name: "Claude 3 Haiku", provider: 'anthropic', input_price_per_1m: 0.25, cached_input_price_per_1m: 0.03, output_price_per_1m: 1.25, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-opus', display_name: "Claude 3 Opus", provider: 'anthropic', input_price_per_1m: 15, cached_input_price_per_1m: 1.5, output_price_per_1m: 75, reasoning_price_per_1m: 0 },
    { model_id: 'claude-3-sonnet', display_name: "Claude 3 Sonnet", provider: 'anthropic', input_price_per_1m: 3, cached_input_price_per_1m: 0.3, output_price_per_1m: 15, reasoning_price_per_1m: 0 },
    { model_id: 'claude-fable-5', display_name: "Claude Fable 5", provider: 'anthropic', input_price_per_1m: 10, cached_input_price_per_1m: 1, output_price_per_1m: 50, reasoning_price_per_1m: 50 },
    { model_id: 'claude-fable-5.1', display_name: "Claude Fable 5.1", provider: 'anthropic', input_price_per_1m: 10, cached_input_price_per_1m: 0.25, output_price_per_1m: 50, reasoning_price_per_1m: 50 },
    { model_id: 'claude-haiku-4-5', display_name: "Claude Haiku 4.5", provider: 'anthropic', input_price_per_1m: 1, cached_input_price_per_1m: 0.1, output_price_per_1m: 5, reasoning_price_per_1m: 5 },
    { model_id: 'claude-haiku-4-5-20251001', display_name: "Claude Haiku 4.5", provider: 'anthropic', input_price_per_1m: 1, cached_input_price_per_1m: 0.1, output_price_per_1m: 5, reasoning_price_per_1m: 0 },
    { model_id: 'claude-haiku-5.5', display_name: "Claude Haiku 5.5", provider: 'anthropic', input_price_per_1m: 0.1, cached_input_price_per_1m: 0.01, output_price_per_1m: 0.5, reasoning_price_per_1m: 0.5 },
    { model_id: 'claude-opus-4-20250514', display_name: "Claude Opus 4", provider: 'anthropic', input_price_per_1m: 15, cached_input_price_per_1m: 1.5, output_price_per_1m: 75, reasoning_price_per_1m: 0 },
    { model_id: 'claude-opus-4-7', display_name: "Claude Opus 4.7", provider: 'anthropic', input_price_per_1m: 5, cached_input_price_per_1m: 0.5, output_price_per_1m: 25, reasoning_price_per_1m: 25 },
    { model_id: 'claude-opus-4-7-thinking-high', display_name: "claude-opus-4-7-thinking-high", provider: 'anthropic', input_price_per_1m: 5, cached_input_price_per_1m: 0.5, output_price_per_1m: 25, reasoning_price_per_1m: 25 },
    { model_id: 'claude-opus-4.8', display_name: "Claude Opus 4.8", provider: 'anthropic', input_price_per_1m: 5, cached_input_price_per_1m: 0.5, output_price_per_1m: 25, reasoning_price_per_1m: 25 },
    { model_id: 'claude-opus-5', display_name: "Claude Opus 5", provider: 'anthropic', input_price_per_1m: 5, cached_input_price_per_1m: 0.5, output_price_per_1m: 25, reasoning_price_per_1m: 25 },
    { model_id: 'claude-opus-5-5-high-fast', display_name: "claude-opus-5-5-high-fast", provider: 'anthropic', input_price_per_1m: 4, cached_input_price_per_1m: 0.2, output_price_per_1m: 20, reasoning_price_per_1m: 20 },
    { model_id: 'claude-opus-5-5-medium', display_name: "claude-opus-5-5-medium", provider: 'anthropic', input_price_per_1m: 4, cached_input_price_per_1m: 0.2, output_price_per_1m: 20, reasoning_price_per_1m: 20 },
    { model_id: 'claude-opus-5-low', display_name: "Claude Opus 5 Low", provider: 'anthropic', input_price_per_1m: 5, cached_input_price_per_1m: 0.5, output_price_per_1m: 25, reasoning_price_per_1m: 25 },
    { model_id: 'claude-opus-5.5', display_name: "Claude Opus 5.5", provider: 'anthropic', input_price_per_1m: 4, cached_input_price_per_1m: 0.2, output_price_per_1m: 20, reasoning_price_per_1m: 20 },
    { model_id: 'claude-sonnet-4-20250514', display_name: "Claude Sonnet 4", provider: 'anthropic', input_price_per_1m: 3, cached_input_price_per_1m: 0.3, output_price_per_1m: 15, reasoning_price_per_1m: 0 },
    { model_id: 'claude-sonnet-4-5', display_name: "Claude Sonnet 4.5", provider: 'anthropic', input_price_per_1m: 3, cached_input_price_per_1m: 0.3, output_price_per_1m: 15, reasoning_price_per_1m: 15 },
    { model_id: 'claude-sonnet-4-6', display_name: "Claude Sonnet 4.6", provider: 'anthropic', input_price_per_1m: 3, cached_input_price_per_1m: 0.3, output_price_per_1m: 15, reasoning_price_per_1m: 15 },
    { model_id: 'claude-sonnet-5', display_name: "Claude Sonnet 5", provider: 'anthropic', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'claude-sonnet-5-5-high', display_name: "claude-sonnet-5-5-high", provider: 'anthropic', input_price_per_1m: 2, cached_input_price_per_1m: 0.1, output_price_per_1m: 10, reasoning_price_per_1m: 10 },

    // ─── OpenAI ─── OpenRouter pricing
    { model_id: 'codex-auto-review', display_name: "Codex Auto Review", provider: 'openai', input_price_per_1m: 0.75, cached_input_price_per_1m: 0.075, output_price_per_1m: 4.5, reasoning_price_per_1m: 0 },
    { model_id: 'codex-mini', display_name: "Codex Mini", provider: 'openai', input_price_per_1m: 1.5, cached_input_price_per_1m: 0.375, output_price_per_1m: 6, reasoning_price_per_1m: 0 },
    { model_id: 'gpt-4.1', display_name: "GPT-4.1", provider: 'openai', input_price_per_1m: 2, cached_input_price_per_1m: 0.5, output_price_per_1m: 8, reasoning_price_per_1m: 8 },
    { model_id: 'gpt-4.1-mini', display_name: "GPT-4.1 Mini", provider: 'openai', input_price_per_1m: 0.4, cached_input_price_per_1m: 0.1, output_price_per_1m: 1.6, reasoning_price_per_1m: 1.6 },
    { model_id: 'gpt-4.1-nano', display_name: "GPT-4.1 Nano", provider: 'openai', input_price_per_1m: 0.1, cached_input_price_per_1m: 0.025, output_price_per_1m: 0.4, reasoning_price_per_1m: 0.4 },
    { model_id: 'gpt-4o', display_name: "GPT-4o", provider: 'openai', input_price_per_1m: 2.5, cached_input_price_per_1m: 1.25, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'gpt-4o-mini', display_name: "GPT-4o Mini", provider: 'openai', input_price_per_1m: 0.15, cached_input_price_per_1m: 0.075, output_price_per_1m: 0.6, reasoning_price_per_1m: 0.6 },
    { model_id: 'gpt-5', display_name: "GPT-5", provider: 'openai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.125, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'gpt-5-mini', display_name: "GPT-5 Mini", provider: 'openai', input_price_per_1m: 0.25, cached_input_price_per_1m: 0.025, output_price_per_1m: 2, reasoning_price_per_1m: 2 },
    { model_id: 'gpt-5-nano', display_name: "GPT-5 Nano", provider: 'openai', input_price_per_1m: 0.05, cached_input_price_per_1m: 0.005, output_price_per_1m: 0.4, reasoning_price_per_1m: 0.4 },
    { model_id: 'gpt-5.1', display_name: "GPT-5.1", provider: 'openai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.125, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'gpt-5.1-codex', display_name: "GPT-5.1 Codex", provider: 'openai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.13, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'gpt-5.1-codex-max', display_name: "GPT-5.1 Codex Max", provider: 'openai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.125, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'gpt-5.1-codex-mini', display_name: "GPT-5.1 Codex Mini", provider: 'openai', input_price_per_1m: 0.25, cached_input_price_per_1m: 0.03, output_price_per_1m: 2, reasoning_price_per_1m: 2 },
    { model_id: 'gpt-5.2', display_name: "GPT-5.2", provider: 'openai', input_price_per_1m: 1.75, cached_input_price_per_1m: 0.175, output_price_per_1m: 14, reasoning_price_per_1m: 14 },
    { model_id: 'gpt-5.2-chat', display_name: "GPT-5.2 Chat", provider: 'openai', input_price_per_1m: 1.75, cached_input_price_per_1m: 0.175, output_price_per_1m: 14, reasoning_price_per_1m: 14 },
    { model_id: 'gpt-5.2-codex', display_name: "GPT-5.2 Codex", provider: 'openai', input_price_per_1m: 1.75, cached_input_price_per_1m: 0.175, output_price_per_1m: 14, reasoning_price_per_1m: 14 },
    { model_id: 'gpt-5.2-pro', display_name: "GPT-5.2 Pro", provider: 'openai', input_price_per_1m: 21, cached_input_price_per_1m: 2.1, output_price_per_1m: 168, reasoning_price_per_1m: 168 },
    { model_id: 'gpt-5.3-codex', display_name: "GPT-5.3 Codex", provider: 'openai', input_price_per_1m: 1.75, cached_input_price_per_1m: 0.175, output_price_per_1m: 14, reasoning_price_per_1m: 14 },
    { model_id: 'gpt-5.4', display_name: "GPT-5.4", provider: 'openai', input_price_per_1m: 2.5, cached_input_price_per_1m: 0.25, output_price_per_1m: 15, reasoning_price_per_1m: 15 },
    { model_id: 'gpt-5.4-mini', display_name: "GPT-5.4 Mini", provider: 'openai', input_price_per_1m: 0.75, cached_input_price_per_1m: 0.075, output_price_per_1m: 4.5, reasoning_price_per_1m: 4.5 },
    { model_id: 'gpt-5.4-nano', display_name: "GPT-5.4 Nano", provider: 'openai', input_price_per_1m: 0.2, cached_input_price_per_1m: 0.02, output_price_per_1m: 1.25, reasoning_price_per_1m: 1.25 },
    { model_id: 'gpt-5.4-pro', display_name: "GPT-5.4 Pro", provider: 'openai', input_price_per_1m: 30, cached_input_price_per_1m: 0, output_price_per_1m: 180, reasoning_price_per_1m: 180 },
    { model_id: 'gpt-5.5', display_name: "GPT-5.5", provider: 'openai', input_price_per_1m: 5, cached_input_price_per_1m: 0.5, output_price_per_1m: 30, reasoning_price_per_1m: 30 },
    { model_id: 'gpt-5.5-pro', display_name: "GPT-5.5 Pro", provider: 'openai', input_price_per_1m: 30, cached_input_price_per_1m: 0, output_price_per_1m: 180, reasoning_price_per_1m: 180 },
    { model_id: 'gpt-5.6-luna', display_name: "GPT-5.6 Luna", provider: 'openai', input_price_per_1m: 0.2, cached_input_price_per_1m: 0.02, output_price_per_1m: 1.2, reasoning_price_per_1m: 1.2 },
    { model_id: 'gpt-5.6-luna-pro', display_name: "GPT-5.6 Luna Pro", provider: 'openai', input_price_per_1m: 0.2, cached_input_price_per_1m: 0.02, output_price_per_1m: 1.2, reasoning_price_per_1m: 1.2 },
    { model_id: 'gpt-5.6-sol', display_name: "GPT-5.6 Sol", provider: 'openai', input_price_per_1m: 4, cached_input_price_per_1m: 0.4, output_price_per_1m: 20, reasoning_price_per_1m: 20 },
    { model_id: 'gpt-5.6-sol-pro', display_name: "GPT-5.6 Sol Pro", provider: 'openai', input_price_per_1m: 4, cached_input_price_per_1m: 0.4, output_price_per_1m: 20, reasoning_price_per_1m: 20 },
    { model_id: 'gpt-5.6-terra', display_name: "GPT-5.6 Terra", provider: 'openai', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 12, reasoning_price_per_1m: 12 },
    { model_id: 'gpt-5.6-terra-pro', display_name: "GPT-5.6 Terra Pro", provider: 'openai', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 12, reasoning_price_per_1m: 12 },
    { model_id: 'gpt-6-astra', display_name: "GPT-6 Astra", provider: 'openai', input_price_per_1m: 10, cached_input_price_per_1m: 1, output_price_per_1m: 50, reasoning_price_per_1m: 50 },
    { model_id: 'gpt-6-astra-pro', display_name: "GPT-6 Astra Pro", provider: 'openai', input_price_per_1m: 10, cached_input_price_per_1m: 1, output_price_per_1m: 50, reasoning_price_per_1m: 50 },
    { model_id: 'gpt-6-luna', display_name: "GPT-6 Luna", provider: 'openai', input_price_per_1m: 0.1, cached_input_price_per_1m: 0.01, output_price_per_1m: 0.5, reasoning_price_per_1m: 0.5 },
    { model_id: 'gpt-6-luna-pro', display_name: "GPT-6 Luna Pro", provider: 'openai', input_price_per_1m: 0.1, cached_input_price_per_1m: 0.01, output_price_per_1m: 0.5, reasoning_price_per_1m: 0.5 },
    { model_id: 'gpt-6-sol', display_name: "GPT-6 Sol", provider: 'openai', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'gpt-6-sol-pro', display_name: "GPT-6 Sol Pro", provider: 'openai', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'gpt-6.1-sol', display_name: "gpt-6.1-sol", provider: 'openai', input_price_per_1m: 2, cached_input_price_per_1m: 0.1, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'gpt-6.1-sol-pro', display_name: "GPT-6.1 Sol Pro", provider: 'openai', input_price_per_1m: 2, cached_input_price_per_1m: 0.1, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'o1-pro', display_name: "o1-pro", provider: 'openai', input_price_per_1m: 150, cached_input_price_per_1m: 15, output_price_per_1m: 600, reasoning_price_per_1m: 600 },
    { model_id: 'o3', display_name: "o3", provider: 'openai', input_price_per_1m: 2, cached_input_price_per_1m: 0.5, output_price_per_1m: 8, reasoning_price_per_1m: 8 },
    { model_id: 'o3-mini', display_name: "o3 Mini", provider: 'openai', input_price_per_1m: 1.1, cached_input_price_per_1m: 0.55, output_price_per_1m: 4.4, reasoning_price_per_1m: 4.4 },
    { model_id: 'o3-pro', display_name: "o3 Pro", provider: 'openai', input_price_per_1m: 20, cached_input_price_per_1m: 2, output_price_per_1m: 80, reasoning_price_per_1m: 80 },
    { model_id: 'o4-mini', display_name: "o4 Mini", provider: 'openai', input_price_per_1m: 1.1, cached_input_price_per_1m: 0.275, output_price_per_1m: 4.4, reasoning_price_per_1m: 4.4 },

    // ─── Google / Gemini / Antigravity ─── OpenRouter pricing
    { model_id: 'gemini-2.0-flash', display_name: "Gemini 2.0 Flash", provider: 'google', input_price_per_1m: 0.1, cached_input_price_per_1m: 0.05, output_price_per_1m: 0.4, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-2.5-flash', display_name: "Gemini 2.5 Flash", provider: 'google', input_price_per_1m: 0.3, cached_input_price_per_1m: 0.03, output_price_per_1m: 2.5, reasoning_price_per_1m: 2.5 },
    { model_id: 'gemini-2.5-flash-lite', display_name: "Gemini 2.5 Flash Lite", provider: 'google', input_price_per_1m: 0.1, cached_input_price_per_1m: 0.01, output_price_per_1m: 0.4, reasoning_price_per_1m: 0.4 },
    { model_id: 'gemini-2.5-pro', display_name: "Gemini 2.5 Pro", provider: 'google', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.125, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'gemini-3.1-flash-image', display_name: "Nano Banana 2 (Gemini 3.1 Flash Image)", provider: 'google', input_price_per_1m: 0.5, cached_input_price_per_1m: 0.05, output_price_per_1m: 3, reasoning_price_per_1m: 3 },
    { model_id: 'gemini-3.1-flash-image-preview', display_name: "Nano Banana 2 (Gemini 3.1 Flash Image Preview)", provider: 'google', input_price_per_1m: 0.5, cached_input_price_per_1m: 0.05, output_price_per_1m: 3, reasoning_price_per_1m: 3 },
    { model_id: 'gemini-3.1-flash-lite', display_name: "Gemini 3.1 Flash Lite", provider: 'google', input_price_per_1m: 0.25, cached_input_price_per_1m: 0.025, output_price_per_1m: 1.5, reasoning_price_per_1m: 1.5 },
    { model_id: 'gemini-3.1-flash-lite-image', display_name: "Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)", provider: 'google', input_price_per_1m: 0.25, cached_input_price_per_1m: 0.025, output_price_per_1m: 1.5, reasoning_price_per_1m: 1.5 },
    { model_id: 'gemini-3.1-flash-lite-preview', display_name: "Gemini 3.1 Flash Lite Preview", provider: 'google', input_price_per_1m: 0.25, cached_input_price_per_1m: 0.025, output_price_per_1m: 1.5, reasoning_price_per_1m: 1.5 },
    { model_id: 'gemini-3.1-pro-preview', display_name: "Gemini 3.1 Pro Preview", provider: 'google', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 12, reasoning_price_per_1m: 12 },
    { model_id: 'gemini-3.1-pro-preview-customtools', display_name: "Gemini 3.1 Pro Preview Custom Tools", provider: 'google', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 12, reasoning_price_per_1m: 12 },
    { model_id: 'gemini-3.5-flash', display_name: "Gemini 3.5 Flash", provider: 'google', input_price_per_1m: 1.5, cached_input_price_per_1m: 0.15, output_price_per_1m: 9, reasoning_price_per_1m: 9 },
    { model_id: 'gemini-3.5-flash-lite', display_name: "Gemini 3.5 Flash Lite", provider: 'google', input_price_per_1m: 0.3, cached_input_price_per_1m: 0.03, output_price_per_1m: 2.5, reasoning_price_per_1m: 2.5 },
    { model_id: 'gemini-3.6-flash', display_name: "Gemini 3.6 Flash", provider: 'google', input_price_per_1m: 0.75, cached_input_price_per_1m: 0.075, output_price_per_1m: 3.75, reasoning_price_per_1m: 3.75 },
    { model_id: 'gemini-3.6-pro', display_name: "Gemini 3.6 Pro", provider: 'google', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 12, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-3.7-flash', display_name: "Gemini 3.7 Flash", provider: 'google', input_price_per_1m: 0.75, cached_input_price_per_1m: 0.075, output_price_per_1m: 3.75, reasoning_price_per_1m: 3.75 },
    { model_id: 'gemini-3.7-pro', display_name: "Gemini 3.7 Pro", provider: 'google', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 12, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-3.8-flash', display_name: "Gemini 3.8 Flash", provider: 'google', input_price_per_1m: 0.75, cached_input_price_per_1m: 0.075, output_price_per_1m: 3.75, reasoning_price_per_1m: 3.75 },
    { model_id: 'gemini-3.8-pro', display_name: "Gemini 3.8 Pro", provider: 'google', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 12, reasoning_price_per_1m: 0 },
    { model_id: 'gemini-4-argon', display_name: "Gemini 4 Argon", provider: 'google', input_price_per_1m: 2, cached_input_price_per_1m: 0.1, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'gemini-nano-banana-2.1', display_name: "Nano Banana 2.1", provider: 'google', input_price_per_1m: 1.5, cached_input_price_per_1m: 0.15000000000000002, output_price_per_1m: 7.5, reasoning_price_per_1m: 7.5 },

    // ─── xAI / Grok ─── OpenRouter pricing
    { model_id: 'cursor-grok-4.5-high', display_name: "Cursor Grok 4.5 High", provider: 'xai', input_price_per_1m: 2, cached_input_price_per_1m: 0.3, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    { model_id: 'cursor-grok-4.5-high-fast', display_name: "Cursor Grok 4.5 High Fast", provider: 'xai', input_price_per_1m: 2, cached_input_price_per_1m: 0.3, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    { model_id: 'cursor-grok-4.6-high-fast', display_name: "Cursor Grok 4.6 High Fast", provider: 'xai', input_price_per_1m: 2, cached_input_price_per_1m: 0.5, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    { model_id: 'grok-4.20', display_name: "Grok 4.20", provider: 'xai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.2, output_price_per_1m: 2.5, reasoning_price_per_1m: 2.5 },
    { model_id: 'grok-4.3', display_name: "Grok 4.3", provider: 'xai', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.2, output_price_per_1m: 2.5, reasoning_price_per_1m: 2.5 },
    { model_id: 'grok-4.5', display_name: "Grok 4.5", provider: 'xai', input_price_per_1m: 2, cached_input_price_per_1m: 0.3, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    { model_id: 'grok-4.5-build', display_name: "Grok 4.5 Build", provider: 'xai', input_price_per_1m: 2, cached_input_price_per_1m: 0.3, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    { model_id: 'grok-4.6', display_name: "Grok 4.6", provider: 'xai', input_price_per_1m: 2, cached_input_price_per_1m: 0.5, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    { model_id: 'grok-4.6-build', display_name: "Grok 4.6 Build", provider: 'xai', input_price_per_1m: 2, cached_input_price_per_1m: 0.5, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    { model_id: 'grok-4.7', display_name: "Grok 4.7", provider: 'xai', input_price_per_1m: 2, cached_input_price_per_1m: 0.5, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    { model_id: 'grok-4.7-build-fast', display_name: "grok-4.7-build-fast", provider: 'xai', input_price_per_1m: 2, cached_input_price_per_1m: 0.5, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    // Cursor 套餐附带的 Grok Bot：只记用量，价目表与 cost 一律为 0
    { model_id: 'grok-bot-automation', display_name: "Grok Bot Automation", provider: 'xai', input_price_per_1m: 0, cached_input_price_per_1m: 0, output_price_per_1m: 0, reasoning_price_per_1m: 0 },
    { model_id: 'grok-bot-cua', display_name: "Grok Bot CUA", provider: 'xai', input_price_per_1m: 0, cached_input_price_per_1m: 0, output_price_per_1m: 0, reasoning_price_per_1m: 0 },
    { model_id: 'grok-bot-default', display_name: "Grok Bot Default", provider: 'xai', input_price_per_1m: 0, cached_input_price_per_1m: 0, output_price_per_1m: 0, reasoning_price_per_1m: 0 },
    { model_id: 'grok-bot-knowledge-work', display_name: "grok-bot-knowledge-work", provider: 'xai', input_price_per_1m: 0, cached_input_price_per_1m: 0, output_price_per_1m: 0, reasoning_price_per_1m: 0 },
    { model_id: 'grok-build-0.1', display_name: "Grok Build 0.1", provider: 'xai', input_price_per_1m: 1, cached_input_price_per_1m: 0.2, output_price_per_1m: 2, reasoning_price_per_1m: 2 },
    { model_id: 'grok-composer-2.5-fast', display_name: "Grok Composer 2.5 Fast", provider: 'xai', input_price_per_1m: 1, cached_input_price_per_1m: 0.2, output_price_per_1m: 2, reasoning_price_per_1m: 0 },

    // ─── 智谱 GLM / Z.ai ─── OpenRouter pricing
    { model_id: 'GLM-5.3', display_name: "GLM-5.3", provider: 'zhipu', input_price_per_1m: 1.4, cached_input_price_per_1m: 0.26, output_price_per_1m: 4.4, reasoning_price_per_1m: 4.4 },
    { model_id: 'GLM-5.3-Flash', display_name: "GLM-5.3-Flash", provider: 'zhipu', input_price_per_1m: 0.15, cached_input_price_per_1m: 0.03, output_price_per_1m: 0.5, reasoning_price_per_1m: 0.5 },
    { model_id: 'glm-4.5', display_name: "GLM-4.5", provider: 'zhipu', input_price_per_1m: 0.6, cached_input_price_per_1m: 0.11, output_price_per_1m: 2.2, reasoning_price_per_1m: 2.2 },
    { model_id: 'glm-4.5-air', display_name: "GLM-4.5 Air", provider: 'zhipu', input_price_per_1m: 0.2, cached_input_price_per_1m: 0.03, output_price_per_1m: 1.1, reasoning_price_per_1m: 1.1 },
    { model_id: 'glm-4.5-flash', display_name: "GLM-4.5 Flash", provider: 'zhipu', input_price_per_1m: 0.06, cached_input_price_per_1m: 0.01, output_price_per_1m: 0.4, reasoning_price_per_1m: 0 },
    { model_id: 'glm-4.6', display_name: "GLM-4.6", provider: 'zhipu', input_price_per_1m: 0.6, cached_input_price_per_1m: 0.11, output_price_per_1m: 2.2, reasoning_price_per_1m: 2.2 },
    { model_id: 'glm-4.7', display_name: "GLM-4.7", provider: 'zhipu', input_price_per_1m: 0.6, cached_input_price_per_1m: 0.11, output_price_per_1m: 2.2, reasoning_price_per_1m: 2.2 },
    { model_id: 'glm-4.7-flash', display_name: "GLM-4.7 Flash", provider: 'zhipu', input_price_per_1m: 0.0605, cached_input_price_per_1m: 0.01, output_price_per_1m: 0.4, reasoning_price_per_1m: 0.4 },
    { model_id: 'glm-5', display_name: "GLM-5", provider: 'zhipu', input_price_per_1m: 1, cached_input_price_per_1m: 0.2, output_price_per_1m: 3.2, reasoning_price_per_1m: 3.2 },
    { model_id: 'glm-5-turbo', display_name: "GLM-5 Turbo", provider: 'zhipu', input_price_per_1m: 1.2, cached_input_price_per_1m: 0.24, output_price_per_1m: 4, reasoning_price_per_1m: 4 },
    { model_id: 'glm-5.1', display_name: "GLM-5.1", provider: 'zhipu', input_price_per_1m: 1.4, cached_input_price_per_1m: 0.26, output_price_per_1m: 4.4, reasoning_price_per_1m: 4.4 },
    { model_id: 'glm-5.2', display_name: "GLM-5.2", provider: 'zhipu', input_price_per_1m: 1.4, cached_input_price_per_1m: 0.26, output_price_per_1m: 4.4, reasoning_price_per_1m: 4.4 },
    { model_id: 'glm-5.3', display_name: "GLM-5.3", provider: 'zhipu', input_price_per_1m: 1.4, cached_input_price_per_1m: 0.26, output_price_per_1m: 4.4, reasoning_price_per_1m: 4.4 },
    { model_id: 'glm-5.3-flash', display_name: "GLM-5.3 Flash", provider: 'zhipu', input_price_per_1m: 0.15, cached_input_price_per_1m: 0.03, output_price_per_1m: 0.5, reasoning_price_per_1m: 0.5 },
    { model_id: 'glm-5.3-flashx', display_name: "GLM-5.3 FlashX", provider: 'zhipu', input_price_per_1m: 0.37, cached_input_price_per_1m: 0.09, output_price_per_1m: 1.25, reasoning_price_per_1m: 1.25 },
    { model_id: 'glm-5.3-prime', display_name: "GLM-5.3 Prime", provider: 'zhipu', input_price_per_1m: 2.8, cached_input_price_per_1m: 0.56, output_price_per_1m: 8.8, reasoning_price_per_1m: 8.8 },
    { model_id: 'zai/glm-5', display_name: "ZAI GLM-5", provider: 'zhipu', input_price_per_1m: 1, cached_input_price_per_1m: 0.2, output_price_per_1m: 3.2, reasoning_price_per_1m: 3.2 },

    // ─── Moonshot / Kimi ─── OpenRouter pricing
    { model_id: 'k3', display_name: "Kimi K3", provider: 'moonshot', input_price_per_1m: 3, cached_input_price_per_1m: 0.3, output_price_per_1m: 15, reasoning_price_per_1m: 15 },
    { model_id: 'kimi-code/k3', display_name: "Kimi Code K3", provider: 'moonshot', input_price_per_1m: 3, cached_input_price_per_1m: 0.3, output_price_per_1m: 15, reasoning_price_per_1m: 15 },
    { model_id: 'kimi-code/k3.1', display_name: "Kimi Code K3.1", provider: 'moonshot', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'kimi-code/kimi-for-coding', display_name: "Kimi for Coding", provider: 'moonshot', input_price_per_1m: 0.95, cached_input_price_per_1m: 0.19, output_price_per_1m: 4, reasoning_price_per_1m: 4 },
    { model_id: 'kimi-for-coding', display_name: "Kimi for Coding", provider: 'moonshot', input_price_per_1m: 0.95, cached_input_price_per_1m: 0.19, output_price_per_1m: 4, reasoning_price_per_1m: 4 },
    { model_id: 'kimi-k2', display_name: "Kimi K2", provider: 'moonshot', input_price_per_1m: 0.57, cached_input_price_per_1m: 0.1425, output_price_per_1m: 2.3, reasoning_price_per_1m: 2.3 },
    { model_id: 'kimi-k2-thinking', display_name: "Kimi K2 Thinking", provider: 'moonshot', input_price_per_1m: 0.6, cached_input_price_per_1m: 0.15, output_price_per_1m: 2.5, reasoning_price_per_1m: 2.5 },
    { model_id: 'kimi-k2.5', display_name: "Kimi K2.5", provider: 'moonshot', input_price_per_1m: 0.532, cached_input_price_per_1m: 0.15, output_price_per_1m: 2.85, reasoning_price_per_1m: 2.85 },
    { model_id: 'kimi-k2.6', display_name: "Kimi K2.6", provider: 'moonshot', input_price_per_1m: 0.95, cached_input_price_per_1m: 0.16, output_price_per_1m: 4, reasoning_price_per_1m: 4 },
    { model_id: 'kimi-k2.7-code', display_name: "Kimi K2.7 Code", provider: 'moonshot', input_price_per_1m: 0.95, cached_input_price_per_1m: 0.19, output_price_per_1m: 4, reasoning_price_per_1m: 4 },
    { model_id: 'kimi-k3', display_name: "Kimi K3", provider: 'moonshot', input_price_per_1m: 3, cached_input_price_per_1m: 0.3, output_price_per_1m: 15, reasoning_price_per_1m: 15 },
    { model_id: 'kimi-k3.1', display_name: "Kimi K3.1", provider: 'moonshot', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'kimi-k3.1-pro', display_name: "Kimi K3.1 Pro", provider: 'moonshot', input_price_per_1m: 2, cached_input_price_per_1m: 0.2, output_price_per_1m: 10, reasoning_price_per_1m: 10 },
    { model_id: 'kimi-k3.1-pro-highspeed', display_name: "Kimi K3.1 Pro HighSpeed", provider: 'moonshot', input_price_per_1m: 4, cached_input_price_per_1m: 0.2, output_price_per_1m: 20, reasoning_price_per_1m: 20 },

    // ─── DeepSeek ─── OpenRouter pricing
    { model_id: 'deepseek-chat', display_name: "DeepSeek Chat", provider: 'deepseek', input_price_per_1m: 0.2574, cached_input_price_per_1m: 0.07, output_price_per_1m: 0.89, reasoning_price_per_1m: 0.89 },
    { model_id: 'deepseek-flash', display_name: "DeepSeek Flash", provider: 'deepseek', input_price_per_1m: 0.13, cached_input_price_per_1m: 0.0196, output_price_per_1m: 0.28, reasoning_price_per_1m: 0.28 },
    { model_id: 'deepseek-r1', display_name: "DeepSeek R1", provider: 'deepseek', input_price_per_1m: 0.7, cached_input_price_per_1m: 0.14, output_price_per_1m: 2.5, reasoning_price_per_1m: 2.5 },
    { model_id: 'deepseek-reasoner', display_name: "DeepSeek Reasoner", provider: 'deepseek', input_price_per_1m: 0.7, cached_input_price_per_1m: 0.14, output_price_per_1m: 2.5, reasoning_price_per_1m: 2.5 },
    { model_id: 'deepseek-v3', display_name: "DeepSeek V3", provider: 'deepseek', input_price_per_1m: 0.27, cached_input_price_per_1m: 0.07, output_price_per_1m: 1.1, reasoning_price_per_1m: 0 },
    { model_id: 'deepseek-v3.2', display_name: "DeepSeek V3.2", provider: 'deepseek', input_price_per_1m: 0.28, cached_input_price_per_1m: 0.13, output_price_per_1m: 0.8, reasoning_price_per_1m: 0.8 },
    { model_id: 'deepseek-v3.2-exp', display_name: "DeepSeek V3.2 Exp", provider: 'deepseek', input_price_per_1m: 0.27, cached_input_price_per_1m: 0.027000000000000003, output_price_per_1m: 0.41, reasoning_price_per_1m: 0.41 },
    { model_id: 'deepseek-v4-flash', display_name: "DeepSeek V4 Flash", provider: 'deepseek', input_price_per_1m: 0.13, cached_input_price_per_1m: 0.0196, output_price_per_1m: 0.28, reasoning_price_per_1m: 0.28 },
    { model_id: 'deepseek-v4-flash-vision-exp', display_name: "DeepSeek V4 Flash Vision Exp", provider: 'deepseek', input_price_per_1m: 0.44, cached_input_price_per_1m: 0.014, output_price_per_1m: 1.32, reasoning_price_per_1m: 1.32 },
    { model_id: 'deepseek-v4-pro', display_name: "DeepSeek V4 Pro", provider: 'deepseek', input_price_per_1m: 1.3, cached_input_price_per_1m: 0.135, output_price_per_1m: 2.6, reasoning_price_per_1m: 2.6 },
    { model_id: 'deepseek-v4.1-flash', display_name: "DeepSeek V4.1 Flash", provider: 'deepseek', input_price_per_1m: 0.21, cached_input_price_per_1m: 0.006, output_price_per_1m: 0.84, reasoning_price_per_1m: 0.84 },
    { model_id: 'deepseek-v4.1-flash-1017', display_name: "DeepSeek V4.1 Flash 1017", provider: 'deepseek', input_price_per_1m: 0.15, cached_input_price_per_1m: 0.003, output_price_per_1m: 0.6, reasoning_price_per_1m: 0.6 },

    // ─── Alibaba / Qwen ─── OpenRouter pricing
    { model_id: 'qwen-max', display_name: "Qwen Max", provider: 'alibaba', input_price_per_1m: 0.78, cached_input_price_per_1m: 0.156, output_price_per_1m: 3.9, reasoning_price_per_1m: 0 },
    { model_id: 'qwen-plus', display_name: "Qwen Plus", provider: 'alibaba', input_price_per_1m: 0.26, cached_input_price_per_1m: 0.052, output_price_per_1m: 0.78, reasoning_price_per_1m: 0.78 },
    { model_id: 'qwen-turbo', display_name: "Qwen Turbo", provider: 'alibaba', input_price_per_1m: 0.1, cached_input_price_per_1m: 0.05, output_price_per_1m: 0.4, reasoning_price_per_1m: 0 },
    { model_id: 'qwen3-235b', display_name: "Qwen3 235B", provider: 'alibaba', input_price_per_1m: 0.455, cached_input_price_per_1m: 0.091, output_price_per_1m: 1.82, reasoning_price_per_1m: 0 },
    { model_id: 'qwen3-32b', display_name: "Qwen3 32B", provider: 'alibaba', input_price_per_1m: 0.14, cached_input_price_per_1m: 0.09, output_price_per_1m: 0.4, reasoning_price_per_1m: 0.4 },
    { model_id: 'qwen3-coder', display_name: "Qwen3 Coder", provider: 'alibaba', input_price_per_1m: 0.3, cached_input_price_per_1m: 0.04, output_price_per_1m: 1.5, reasoning_price_per_1m: 1.5 },
    { model_id: 'qwen3.6-flash', display_name: "Qwen3.6 Flash", provider: 'alibaba', input_price_per_1m: 0.1875, cached_input_price_per_1m: 0.0375, output_price_per_1m: 1.125, reasoning_price_per_1m: 1.125 },
    { model_id: 'qwen3.6-plus', display_name: "Qwen3.6 Plus", provider: 'alibaba', input_price_per_1m: 0.325, cached_input_price_per_1m: 0.065, output_price_per_1m: 1.95, reasoning_price_per_1m: 1.95 },
    { model_id: 'qwen3.7-flash', display_name: "Qwen3.7 Flash", provider: 'alibaba', input_price_per_1m: 0.03, cached_input_price_per_1m: 0.006, output_price_per_1m: 0.13, reasoning_price_per_1m: 0.13 },
    { model_id: 'qwen3.7-max', display_name: "Qwen3.7 Max", provider: 'alibaba', input_price_per_1m: 1.475, cached_input_price_per_1m: 0.295, output_price_per_1m: 4.425, reasoning_price_per_1m: 4.425 },
    { model_id: 'qwen3.7-plus', display_name: "Qwen3.7 Plus", provider: 'alibaba', input_price_per_1m: 0.32, cached_input_price_per_1m: 0.064, output_price_per_1m: 1.28, reasoning_price_per_1m: 1.28 },
    { model_id: 'qwen3.8-2.4t-a95b', display_name: "Qwen3.8 2.4T A95B", provider: 'alibaba', input_price_per_1m: 2, cached_input_price_per_1m: 0.25, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    { model_id: 'qwen3.8-27b', display_name: "Qwen3.8 27B", provider: 'alibaba', input_price_per_1m: 0.425, cached_input_price_per_1m: 0.085, output_price_per_1m: 2.55, reasoning_price_per_1m: 2.55 },
    { model_id: 'qwen3.8-flash', display_name: "Qwen3.8 Flash", provider: 'alibaba', input_price_per_1m: 0.15, cached_input_price_per_1m: 0.016, output_price_per_1m: 0.47, reasoning_price_per_1m: 0.47 },
    { model_id: 'qwen3.8-max-0902', display_name: "Qwen3.8 Max (0902)", provider: 'alibaba', input_price_per_1m: 2, cached_input_price_per_1m: 0.25, output_price_per_1m: 6, reasoning_price_per_1m: 6 },
    { model_id: 'qwen3.8-max-prime', display_name: "Qwen3.8 Max Prime", provider: 'alibaba', input_price_per_1m: 4, cached_input_price_per_1m: 0.5, output_price_per_1m: 12, reasoning_price_per_1m: 12 },
    { model_id: 'qwen3.8-omni-flash', display_name: "Qwen3.8 Omni Flash", provider: 'alibaba', input_price_per_1m: 0.15, cached_input_price_per_1m: 0.016, output_price_per_1m: 0.47, reasoning_price_per_1m: 0.47 },

    // ─── Tencent / Hunyuan ─── OpenRouter pricing
    { model_id: 'hy3', display_name: "Hy3", provider: 'tencent', input_price_per_1m: 0.132, cached_input_price_per_1m: 0.033, output_price_per_1m: 0.528, reasoning_price_per_1m: 0.528 },
    { model_id: 'hy4-preview', display_name: "Hy4 preview", provider: 'tencent', input_price_per_1m: 0.834, cached_input_price_per_1m: 0.042, output_price_per_1m: 2.501, reasoning_price_per_1m: 2.501 },

    // ─── Meta ─── OpenRouter pricing
    { model_id: 'llama-3.1-405b', display_name: "Llama 3.1 405B", provider: 'meta', input_price_per_1m: 1, cached_input_price_per_1m: 0.2, output_price_per_1m: 1, reasoning_price_per_1m: 0 },
    { model_id: 'llama-3.1-70b', display_name: "Llama 3.1 70B", provider: 'meta', input_price_per_1m: 0.4, cached_input_price_per_1m: 0.08, output_price_per_1m: 0.4, reasoning_price_per_1m: 0 },
    { model_id: 'llama-3.1-8b', display_name: "Llama 3.1 8B", provider: 'meta', input_price_per_1m: 0.05, cached_input_price_per_1m: 0.025, output_price_per_1m: 0.08, reasoning_price_per_1m: 0 },
    { model_id: 'llama-3.3-70b', display_name: "Llama 3.3 70B", provider: 'meta', input_price_per_1m: 0.59, cached_input_price_per_1m: 0.295, output_price_per_1m: 0.79, reasoning_price_per_1m: 0 },
    { model_id: 'llama-4-maverick', display_name: "Llama 4 Maverick", provider: 'meta', input_price_per_1m: 0.35, cached_input_price_per_1m: 0.05, output_price_per_1m: 1, reasoning_price_per_1m: 1 },
    { model_id: 'llama-4-scout', display_name: "Llama 4 Scout", provider: 'meta', input_price_per_1m: 0.1, cached_input_price_per_1m: 0.036, output_price_per_1m: 0.3, reasoning_price_per_1m: 0.3 },
    { model_id: 'muse-glimmer-30b', display_name: "Muse Glimmer 30B", provider: 'meta', input_price_per_1m: 0.3, cached_input_price_per_1m: 0.04, output_price_per_1m: 1.2, reasoning_price_per_1m: 1.2 },
    { model_id: 'muse-spark-1.3', display_name: "Muse Spark 1.3", provider: 'meta', input_price_per_1m: 1.25, cached_input_price_per_1m: 0.15, output_price_per_1m: 4.25, reasoning_price_per_1m: 4.25 },
    { model_id: 'muse-spark-1.3-contributor', display_name: "Muse Spark 1.3 Contributor", provider: 'meta', input_price_per_1m: 0.1, cached_input_price_per_1m: 0.002, output_price_per_1m: 0.2, reasoning_price_per_1m: 0.2 },

    // ─── MiniMax ─── OpenRouter pricing
    { model_id: 'MiniMax-M2.7', display_name: "MiniMax M2.7", provider: 'minimax', input_price_per_1m: 0.3, cached_input_price_per_1m: 0.06, output_price_per_1m: 1.2, reasoning_price_per_1m: 1.2 },
    { model_id: 'MiniMax-M2.7-highspeed', display_name: "MiniMax M2.7 HighSpeed", provider: 'minimax', input_price_per_1m: 0.3, cached_input_price_per_1m: 0.06, output_price_per_1m: 1.2, reasoning_price_per_1m: 1.2 },
    { model_id: 'minimax-01', display_name: "MiniMax-01", provider: 'minimax', input_price_per_1m: 0.2, cached_input_price_per_1m: 0, output_price_per_1m: 1.1, reasoning_price_per_1m: 1.1 },
    { model_id: 'minimax-m2.5', display_name: "MiniMax M2.5", provider: 'minimax', input_price_per_1m: 0.3, cached_input_price_per_1m: 0.03, output_price_per_1m: 1.2, reasoning_price_per_1m: 1.2 },
    { model_id: 'minimax-m2.7-highspeed', display_name: "MiniMax M2.7 HighSpeed", provider: 'minimax', input_price_per_1m: 0.3, cached_input_price_per_1m: 0.06, output_price_per_1m: 1.2, reasoning_price_per_1m: 1.2 },
    { model_id: 'minimax-m3', display_name: "MiniMax M3", provider: 'minimax', input_price_per_1m: 0.3, cached_input_price_per_1m: 0.06, output_price_per_1m: 1.2, reasoning_price_per_1m: 1.2 },
    { model_id: 'minimax-m3.1-flash', display_name: "MiniMax M3.1 Flash", provider: 'minimax', input_price_per_1m: 0.15, cached_input_price_per_1m: 0.015, output_price_per_1m: 0.6, reasoning_price_per_1m: 0.6 },

    // ─── Xiaomi / MiMo ─── OpenRouter pricing
    { model_id: 'mimo-v2.5', display_name: "MiMo V2.5", provider: 'mimo', input_price_per_1m: 0.119, cached_input_price_per_1m: 0.0026, output_price_per_1m: 0.238, reasoning_price_per_1m: 0.238 },
    { model_id: 'mimo-v2.5-pro', display_name: "MiMo V2.5 Pro", provider: 'mimo', input_price_per_1m: 0.435, cached_input_price_per_1m: 0.0036, output_price_per_1m: 0.87, reasoning_price_per_1m: 0.87 },
    { model_id: 'mimo-v2.6-flash', display_name: "MiMo V2.6 Flash", provider: 'mimo', input_price_per_1m: 0.14, cached_input_price_per_1m: 0.0028, output_price_per_1m: 0.28, reasoning_price_per_1m: 0.28 },
    { model_id: 'mimo-v2.6-pro', display_name: "MiMo V2.6 Pro", provider: 'mimo', input_price_per_1m: 0.435, cached_input_price_per_1m: 0.0036, output_price_per_1m: 0.87, reasoning_price_per_1m: 0.87 },
    { model_id: 'mimo-v2.6-pro-ultraspeed', display_name: "MiMo V2.6 Pro UltraSpeed", provider: 'mimo', input_price_per_1m: 4.35, cached_input_price_per_1m: 0.036, output_price_per_1m: 8.7, reasoning_price_per_1m: 8.7 },

    // ─── 阶跃星辰 / StepFun ─── OpenRouter pricing
    { model_id: 'step-3.7-flash', display_name: "Step 3.7 Flash", provider: 'stepfun', input_price_per_1m: 0.2, cached_input_price_per_1m: 0.04, output_price_per_1m: 1.15, reasoning_price_per_1m: 1.15 },

    // ─── Other ─── OpenRouter pricing
    { model_id: 'composer-2.5-fast', display_name: "composer-2.5-fast", provider: 'unknown', input_price_per_1m: 0, cached_input_price_per_1m: 0, output_price_per_1m: 0, reasoning_price_per_1m: 0 },

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
