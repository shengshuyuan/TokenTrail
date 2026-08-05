'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DailyStat, StatsResponse, Currency } from '@/types'
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

/** Compact 7-day trend polyline for KPI cards. */
function Sparkline({
  values,
  toneClass,
}: {
  values: number[]
  toneClass: string
}) {
  const path = useMemo(() => {
    if (values.length < 2) return null
    const w = 72
    const h = 22
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const coords = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - 1 - ((v - min) / range) * (h - 3)
      return [x, y] as const
    })
    const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    // Soft fill under the line for a bit of mass without visual noise.
    const area = `0,${h} ${line} ${w},${h}`
    const end = coords[coords.length - 1]
    return { w, h, line, area, endX: end[0], endY: end[1] }
  }, [values])

  if (!path) {
    return <span className="inline-block h-[22px] w-[72px]" aria-hidden="true" />
  }

  return (
    <svg
      width={path.w}
      height={path.h}
      viewBox={`0 0 ${path.w} ${path.h}`}
      className={`stat-sparkline ${toneClass}`}
      aria-hidden="true"
    >
      <polygon points={path.area} className="stat-sparkline-fill" />
      <polyline
        points={path.line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={path.endX} cy={path.endY} r="1.8" fill="currentColor" />
    </svg>
  )
}

function lastNDaily(daily: DailyStat[] | undefined, n = 7): DailyStat[] {
  if (!daily || daily.length === 0) return []
  return daily.slice(-n)
}

export function StatsCards({ stats, loading, currency, exchangeRate }: StatsCardsProps) {
  const { t } = useLang()
  const recent = lastNDaily(stats?.daily, 7)
  const tokenSeries = recent.map(d => d.total_tokens)
  const costSeries = recent.map(d => d.cost_usd)
  const requestSeries = recent.map(d => d.count)

  const cards = [
    {
      key: 'tokens',
      label: t('stats.totalTokens'),
      rawValue: stats?.total_tokens ?? 0,
      format: (v: number) => formatTokens(v),
      sub: stats ? `${formatNumber(stats.total_requests)} requests` : '—',
      icon: '⬡',
      tone: 'stat-tone-primary',
      accent: 'bg-eva-green',
      spark: tokenSeries,
    },
    {
      key: 'cost',
      label: t('stats.totalCost'),
      rawValue: stats?.total_cost_usd ?? 0,
      format: (v: number) => formatCost(v, currency, exchangeRate),
      sub: currency === 'USD'
        ? t('stats.settledUsd')
        : `${t('stats.rateLabel', { n: exchangeRate.toFixed(2) })} · ${formatExchangeRateDate(USD_CNY_EXCHANGE_RATE.asOf)}`,
      icon: '◆',
      tone: 'stat-tone-secondary',
      accent: 'bg-eva-purple',
      spark: costSeries,
    },
    {
      key: 'daily-tokens',
      label: t('stats.dailyAvg'),
      rawValue: stats?.avg_daily_tokens ?? 0,
      format: (v: number) => formatTokens(v),
      sub: t('stats.activeDays'),
      icon: '◈',
      tone: 'stat-tone-tertiary',
      accent: 'bg-eva-orange',
      spark: tokenSeries,
    },
    {
      key: 'daily-cost',
      label: t('stats.dailyCost'),
      rawValue: stats?.avg_daily_cost_usd ?? 0,
      format: (v: number) => formatCost(v, currency, exchangeRate),
      sub: t('stats.costVelocity'),
      icon: '◇',
      tone: 'stat-tone-tertiary',
      accent: 'bg-eva-orange',
      spark: costSeries,
    },
    {
      key: 'requests',
      label: t('stats.requests'),
      rawValue: stats?.total_requests ?? 0,
      format: (v: number) => formatNumber(Math.round(v)),
      sub: t('stats.capturedCalls'),
      icon: '⬢',
      tone: 'stat-tone-neutral',
      accent: 'bg-eva-text',
      spark: requestSeries,
    },
  ]

  return (
    <MotionGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card, index) => (
        <MotionItem key={card.key} index={index}>
          <div className="eva-panel eva-panel-hover eva-panel-stat min-h-[132px] p-4">
            <span className="stat-sheen" aria-hidden="true" />
            <div className={`stat-accent-rail ${card.accent}`} />
            <div className="mb-2 flex items-center gap-2">
              <span className={`stat-icon flex h-6 w-6 shrink-0 items-center justify-center rounded border border-eva-border text-xs ${card.tone}`}>
                {card.icon}
              </span>
              <span className="theme-label truncate text-[13px] font-semibold uppercase">
                {card.label}
              </span>
              <span className="ml-auto shrink-0 opacity-90" title={t('stats.sparkHint')}>
                {!loading && stats && card.spark.length >= 2 ? (
                  <Sparkline values={card.spark} toneClass={card.tone} />
                ) : null}
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
