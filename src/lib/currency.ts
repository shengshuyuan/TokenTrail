/**
 * 货币换算配置的唯一来源。
 * 采用 2026-06-26 ECB 参考汇率交叉计算后的近似中间价。
 */
export const USD_CNY_EXCHANGE_RATE = {
  rate: 6.8,
  asOf: '2026-06-26',
  source: 'ECB reference cross-rate',
} as const

export function formatExchangeRateDate(date = USD_CNY_EXCHANGE_RATE.asOf): string {
  const [, month, day] = date.split('-')
  return month && day ? `${month}/${day}` : date
}
