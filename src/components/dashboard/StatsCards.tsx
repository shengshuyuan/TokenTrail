'use client'

import type { StatsResponse, Currency } from '@/types'
import { formatTokens, formatCost, formatNumber } from '@/lib/format'
import { formatExchangeRateDate, USD_CNY_EXCHANGE_RATE } from '@/lib/currency'
import { useLang } from '@/lib/LanguageContext'
import { MotionGroup, MotionItem } from '@/components/Motion'

interface StatsCardsProps {
  stats: StatsResponse | null
  loading: boolean
  currency: Currency
  exchangeRate: number
}

export function StatsCards({ stats, loading, currency, exchangeRate }: StatsCardsProps) {
  const { t } = useLang()
  const cards = [
    {
      label: t('stats.totalTokens'),
      value: stats ? formatTokens(stats.total_tokens) : '—',
      sub: stats ? `${formatNumber(stats.total_requests)} requests` : '—',
      icon: '⬡',
      tone: 'stat-tone-primary',
      accent: 'bg-eva-green',
    },
    {
      label: t('stats.totalCost'),
      value: stats ? formatCost(stats.total_cost_usd, currency, exchangeRate) : '—',
      sub: currency === 'USD'
        ? t('stats.settledUsd')
        : `${t('stats.rateLabel', { n: exchangeRate.toFixed(2) })} · ${formatExchangeRateDate(USD_CNY_EXCHANGE_RATE.asOf)}`,
      icon: '◆',
      tone: 'stat-tone-secondary',
      accent: 'bg-eva-purple',
    },
    {
      label: t('stats.dailyAvg'),
      value: stats ? formatTokens(stats.avg_daily_tokens) : '—',
      sub: t('stats.activeDays'),
      icon: '◈',
      tone: 'stat-tone-tertiary',
      accent: 'bg-eva-orange',
    },
    {
      label: t('stats.dailyCost'),
      value: stats ? formatCost(stats.avg_daily_cost_usd, currency, exchangeRate) : '—',
      sub: t('stats.costVelocity'),
      icon: '◇',
      tone: 'stat-tone-tertiary',
      accent: 'bg-eva-orange',
    },
    {
      label: t('stats.requests'),
      value: stats ? formatNumber(stats.total_requests) : '—',
      sub: t('stats.capturedCalls'),
      icon: '⬢',
      tone: 'stat-tone-neutral',
      accent: 'bg-eva-text',
    },
  ]

  return (
    <MotionGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card, index) => (
        <MotionItem key={card.label} index={index}>
          <div className="eva-panel eva-panel-hover min-h-[116px] p-4">
            <div className={`absolute left-0 top-0 h-full w-0.5 ${card.accent} opacity-70`} />
            <div className="mb-2 flex items-center gap-2">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border border-eva-border bg-eva-bg/45 text-xs ${card.tone}`}>
                {card.icon}
              </span>
              <span className="theme-label truncate text-[13px] font-medium uppercase tracking-[0.08em]">
                {card.label}
              </span>
            </div>
            <div className={`stat-value ${card.tone} ${loading && !stats ? 'animate-pulse' : ''}`}>
              {loading && !stats ? (
                <span className="inline-block h-7 w-20 rounded bg-eva-border-light/30" />
              ) : (
                <span key={`${currency}-${card.value}`} className="data-refresh inline-block">
                  {card.value}
                </span>
              )}
            </div>
            <div className="mt-2 truncate text-xs font-mono text-eva-text-dim/80">
              {card.sub}
            </div>
          </div>
        </MotionItem>
      ))}
    </MotionGroup>
  )
}
