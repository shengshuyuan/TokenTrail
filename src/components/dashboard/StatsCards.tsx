'use client'

import type { StatsResponse, Currency } from '@/types'
import { formatTokens, formatCost, formatNumber } from '@/lib/format'
import { useLang } from '@/lib/LanguageContext'

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
      color: 'text-eva-green',
      accent: 'bg-eva-green',
    },
    {
      label: t('stats.totalCost'),
      value: stats ? formatCost(stats.total_cost_usd, currency, exchangeRate) : '—',
      sub: currency === 'USD' ? t('stats.settledUsd') : t('stats.rateLabel', { n: exchangeRate }),
      icon: '◆',
      color: 'text-eva-purple',
      accent: 'bg-eva-purple',
    },
    {
      label: t('stats.dailyAvg'),
      value: stats ? formatTokens(stats.avg_daily_tokens) : '—',
      sub: t('stats.activeDays'),
      icon: '◈',
      color: 'text-eva-orange',
      accent: 'bg-eva-orange',
    },
    {
      label: t('stats.dailyCost'),
      value: stats ? formatCost(stats.avg_daily_cost_usd, currency, exchangeRate) : '—',
      sub: t('stats.costVelocity'),
      icon: '◇',
      color: 'text-eva-orange',
      accent: 'bg-eva-orange',
    },
    {
      label: t('stats.requests'),
      value: stats ? formatNumber(stats.total_requests) : '—',
      sub: t('stats.capturedCalls'),
      icon: '⬢',
      color: 'text-eva-text',
      accent: 'bg-eva-text',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className="eva-panel eva-panel-hover min-h-[116px] p-4"
        >
          <div className={`absolute left-0 top-0 h-full w-0.5 ${card.accent} opacity-70`} />
          <div className="mb-2 flex items-center gap-2">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border border-eva-border bg-eva-bg/45 text-xs ${card.color}`}>
              {card.icon}
            </span>
            <span className="truncate text-[10px] font-mono uppercase tracking-[0.1em] text-eva-text-dim">
              {card.label}
            </span>
          </div>
          <div className={`stat-value ${card.color} ${loading && !stats ? 'animate-pulse' : ''}`}>
            {loading && !stats ? (
              <span className="inline-block h-7 w-20 bg-eva-border-light/30 rounded" />
            ) : (
              card.value
            )}
          </div>
          <div className="mt-2 text-[10px] font-mono text-eva-text-dim/45 truncate">
            {card.sub}
          </div>
        </div>
      ))}
    </div>
  )
}
