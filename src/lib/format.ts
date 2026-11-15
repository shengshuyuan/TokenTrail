/**
 * Client-safe formatting utilities.
 * No server-side imports (no DB, no fs).
 */
import { USD_CNY_EXCHANGE_RATE } from '@/lib/currency'

/**
 * Format token count for display.
 * e.g., 1234567 → "1.23M", 12345 → "12.35K", 123 → "123"
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens)) return '—'
  if (tokens >= 1_000_000) {
    return (tokens / 1_000_000).toFixed(2) + 'M'
  }
  if (tokens >= 1_000) {
    return (tokens / 1_000).toFixed(2) + 'K'
  }
  // Round so rAF count-up intermediates never leak long floats for small counts.
  return Math.round(tokens).toString()
}

/**
 * Format cost for display.
 * USD: "$12.35"
 * RMB: "¥89.54"
 * 接收原始 USD 值，内部处理汇率转换。
 */
export function formatCost(
  usd: number,
  currency: 'USD' | 'RMB',
  exchangeRate: number = USD_CNY_EXCHANGE_RATE.rate
): string {
  if (!Number.isFinite(usd)) return '—'
  if (currency === 'RMB') {
    const rmb = usd * exchangeRate
    if (rmb >= 1) {
      return '¥' + rmb.toFixed(2)
    }
    return '¥' + rmb.toFixed(4)
  }
  if (usd >= 1) {
    return '$' + usd.toFixed(2)
  }
  return '$' + usd.toFixed(4)
}

/**
 * Format a credit quantity for display (Kiro CLI bills in credits, not tokens).
 * Keeps two decimals under 1000, then compacts with K/M like tokens.
 * e.g., 386.2704 → "386.27", 1234.5 → "1.23K"
 */
export function formatCredits(credits: number): string {
  if (!Number.isFinite(credits)) return '—'
  if (credits >= 1_000_000) return (credits / 1_000_000).toFixed(2) + 'M'
  if (credits >= 1_000) return (credits / 1_000).toFixed(2) + 'K'
  return credits.toFixed(2)
}

/**
 * Format a number with commas (固定 en-US locale)。
 * e.g., 1234567 → "1,234,567"
 */
export function formatNumber(num: number): string {
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString('en-US')
}

/** 模型名末尾表示「力度 / 速度」的变体词，不改变底层模型，合并家族时去掉。 */
const MODEL_VARIANT_SUFFIXES = new Set([
  'fast', 'high', 'medium', 'low', 'minimal', 'xhigh', 'thinking', 'highspeed', 'preview', 'exp', 'latest',
])

/**
 * 把一个模型名归到它的「家族」，用于用量页「按模型」合并变体：
 * - 小写（`GLM-5.3-Flash` 与 `glm-5.3-flash` 合并）
 * - 去掉 `provider/` 前缀（`kimi-code/k3` → `k3`）
 * - 去掉末尾的力度 / 速度词（`claude-opus-5-5-medium-fast` → `claude-opus-5.5`、`grok-4.7-build-fast` → `grok-4.7-build`）
 * - 版本号 `5-5` 统一成 `5.5`，不同来源对同一模型的写法才会对上
 * flash / mini / pro / turbo 这类是不同档位的模型，不是变体，保留。
 * e.g. modelFamily('claude-fable-5-1-thinking-high') → 'claude-fable-5.1'
 */
export function modelFamily(model: string): string {
  let id = String(model || '').trim().toLowerCase()
  if (!id) return id
  const slash = id.lastIndexOf('/')
  if (slash >= 0 && slash < id.length - 1 && !id.includes(':')) id = id.slice(slash + 1)
  const parts = id.split('-')
  while (parts.length > 1 && MODEL_VARIANT_SUFFIXES.has(parts[parts.length - 1])) parts.pop()
  id = parts.join('-')
  // 末尾的 `-5-5` / `-4-6` 这类分段版本号写成 `5.5` / `4.6`
  return id.replace(/-(\d+)-(\d+)$/, '-$1.$2')
}

/**
 * Format a date string for display。
 * "2026-05-30" → "05/30"
 * 防御无效输入。
 */
export function formatShortDate(dateStr: string): string {
  if (!dateStr) return '—'
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  return `${parts[1]}/${parts[2]}`
}
