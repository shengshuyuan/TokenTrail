'use client'

import { useEffect, useRef, useState } from 'react'
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

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * rAF count-up for dashboard numbers. Mounts with the final value (the main
 * thread is busy during initial page load, so a from-zero animation would be
 * swallowed), then glides across deltas on data refresh when the thread is
 * idle. Honors prefers-reduced-motion.
 */
function AnimatedValue({ value, format }: { value: number; format: (v: number) => string }) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef(0)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      fromRef.current = value
      return
    }
    const from = fromRef.current
    if (from === value) {
      setDisplay(value)
      return
    }
    const start = performance.now()
    const duration = 720
    let current = from
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      // easeOutExpo, landing exactly on the target at the end
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)
      current = from + (value - from) * eased
      setDisplay(current)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = value
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      // Keep the mid-flight value so the next delta doesn't jump backwards.
      fromRef.current = current
    }
  }, [value, reduced])

  return <span className="inline-block">{format(display)}</span>
}

export function StatsCards({ stats, loading, currency, exchangeRate }: StatsCardsProps) {
  const { t } = useLang()
  const cards = [
    {
      label: t('stats.totalTokens'),
      rawValue: stats?.total_tokens ?? 0,
      format: (v: number) => formatTokens(v),
      sub: stats ? `${formatNumber(stats.total_requests)} requests` : '—',
      icon: '⬡',
      tone: 'stat-tone-primary',
      accent: 'bg-eva-green',
    },
    {
      label: t('stats.totalCost'),
      rawValue: stats?.total_cost_usd ?? 0,
      format: (v: number) => formatCost(v, currency, exchangeRate),
      sub: currency === 'USD'
        ? t('stats.settledUsd')
        : `${t('stats.rateLabel', { n: exchangeRate.toFixed(2) })} · ${formatExchangeRateDate(USD_CNY_EXCHANGE_RATE.asOf)}`,
      icon: '◆',
      tone: 'stat-tone-secondary',
      accent: 'bg-eva-purple',
    },
    {
      label: t('stats.dailyAvg'),
      rawValue: stats?.avg_daily_tokens ?? 0,
      format: (v: number) => formatTokens(v),
      sub: t('stats.activeDays'),
      icon: '◈',
      tone: 'stat-tone-tertiary',
      accent: 'bg-eva-orange',
    },
    {
      label: t('stats.dailyCost'),
      rawValue: stats?.avg_daily_cost_usd ?? 0,
      format: (v: number) => formatCost(v, currency, exchangeRate),
      sub: t('stats.costVelocity'),
      icon: '◇',
      tone: 'stat-tone-tertiary',
      accent: 'bg-eva-orange',
    },
    {
      label: t('stats.requests'),
      rawValue: stats?.total_requests ?? 0,
      format: (v: number) => formatNumber(Math.round(v)),
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
          <div className="eva-panel eva-panel-hover eva-panel-stat min-h-[116px] p-4">
            <span className="stat-sheen" aria-hidden="true" />
            <div className={`stat-accent-rail ${card.accent}`} />
            <div className="mb-2 flex items-center gap-2">
              <span className={`stat-icon flex h-6 w-6 shrink-0 items-center justify-center rounded border border-eva-border bg-eva-bg/45 text-xs ${card.tone}`}>
                {card.icon}
              </span>
              <span className="theme-label truncate text-[13px] font-semibold uppercase">
                {card.label}
              </span>
            </div>
            <div className={`stat-value ${card.tone} ${loading && !stats ? 'animate-pulse' : ''}`}>
              {loading && !stats ? (
                <span className="inline-block h-7 w-20 rounded bg-eva-border-light/30" />
              ) : !stats ? (
                '—'
              ) : (
                <AnimatedValue value={card.rawValue} format={card.format} />
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
