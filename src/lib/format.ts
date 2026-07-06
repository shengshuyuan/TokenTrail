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
  return tokens.toString()
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
 * Format a number with commas (固定 en-US locale)。
 * e.g., 1234567 → "1,234,567"
 */
export function formatNumber(num: number): string {
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString('en-US')
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
