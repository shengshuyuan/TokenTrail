'use client'

import React from 'react'
import type { StatsResponse, Currency } from '@/types'
import { formatCost, formatNumber, formatTokens } from '@/lib/format'
import { useLang } from '@/lib/LanguageContext'

interface MetricStripProps {
  stats: StatsResponse | null
  loading?: boolean
  currency: Currency
  exchangeRate: number
}

export function MetricStrip({ stats, loading = false, currency, exchangeRate }: MetricStripProps) {
  const { t } = useLang()

  if (loading && !stats) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 animate-pulse">
        <div className="apple-glass-metric p-5 sm:p-6 space-y-3">
          <div className="h-4 w-20 bg-workbench-border/50 rounded" />
          <div className="h-10 w-36 bg-workbench-border/60 rounded-lg" />
          <div className="h-4 w-16 bg-workbench-border/40 rounded" />
        </div>
        <div className="apple-glass-metric p-5 sm:p-6 space-y-3">
          <div className="h-4 w-20 bg-workbench-border/50 rounded" />
          <div className="h-10 w-32 bg-workbench-border/60 rounded-lg" />
          <div className="h-4 w-24 bg-workbench-border/40 rounded" />
        </div>
        <div className="apple-glass-metric p-5 sm:p-6 space-y-3">
          <div className="h-4 w-20 bg-workbench-border/50 rounded" />
          <div className="h-10 w-28 bg-workbench-border/60 rounded-lg" />
          <div className="h-4 w-24 bg-workbench-border/40 rounded" />
        </div>
      </div>
    )
  }

  const totalTokens = stats?.total_tokens ?? 0
  const totalCostUsd = stats?.total_cost_usd ?? 0
  const totalRequests = stats?.total_requests ?? 0
  const estimatedTokens = stats?.estimated_tokens ?? 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
      {/* 1. Total Tokens (Primary - Emerald Green #157F68) */}
      <div className="apple-glass-metric p-5 sm:p-6 flex flex-col justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-workbench-text-muted mb-2">
            Tokens
          </div>
          <div className="text-3xl sm:text-[38px] font-bold text-workbench-accent tracking-tight font-mono tabular-nums leading-none">
            {formatTokens(totalTokens)}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs font-medium text-workbench-text-muted">Total captured</span>
            {estimatedTokens > 0 && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-mono"
                title="Antigravity / TraeWork 等字符估算量，不计入主统计"
              >
                {t('stats.estimated', { n: formatTokens(estimatedTokens) })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Estimated Cost (Deep Gray #202427) */}
      <div className="apple-glass-metric p-5 sm:p-6 flex flex-col justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-workbench-text-muted mb-2">
            {t('stats.totalCost')}
          </div>
          <div className="text-3xl sm:text-[38px] font-bold text-workbench-text tracking-tight font-mono tabular-nums leading-none">
            {formatCost(totalCostUsd, currency, exchangeRate)}
          </div>
          <div className="text-xs font-medium text-workbench-text-muted mt-3">
            {currency === 'USD' ? 'Estimated USD' : 'Estimated CNY'}
          </div>
        </div>
      </div>

      {/* 3. Requests (Deep Gray #202427) */}
      <div className="apple-glass-metric p-5 sm:p-6 flex flex-col justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-workbench-text-muted mb-2">
            {t('stats.requests')}
          </div>
          <div className="text-3xl sm:text-[38px] font-bold text-workbench-text tracking-tight font-mono tabular-nums leading-none">
            {formatNumber(totalRequests)}
          </div>
          <div className="text-xs font-medium text-workbench-text-muted mt-3">
            API calls recorded
          </div>
        </div>
      </div>
    </div>
  )
}
