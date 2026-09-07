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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 py-6 border-b border-workbench-border animate-pulse">
        <div className="space-y-2">
          <div className="h-11 w-36 bg-gray-200 rounded-md" />
          <div className="h-4 w-16 bg-gray-100 rounded" />
        </div>
        <div className="space-y-2 sm:border-l sm:border-workbench-border sm:pl-8">
          <div className="h-11 w-32 bg-gray-200 rounded-md" />
          <div className="h-4 w-16 bg-gray-100 rounded" />
        </div>
        <div className="space-y-2 sm:border-l sm:border-workbench-border sm:pl-8">
          <div className="h-11 w-24 bg-gray-200 rounded-md" />
          <div className="h-4 w-16 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  const totalTokens = stats?.total_tokens ?? 0
  const totalCostUsd = stats?.total_cost_usd ?? 0
  const totalRequests = stats?.total_requests ?? 0
  const estimatedTokens = stats?.estimated_tokens ?? 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-0 py-6 mb-8 border-b border-workbench-border">
      {/* 1. Total Tokens (Primary - Emerald Green #157F68) */}
      <div className="sm:pr-8 flex flex-col justify-between">
        <div>
          <div className="text-4xl sm:text-[44px] font-bold text-workbench-accent tracking-tight font-mono tabular-nums leading-none">
            {formatTokens(totalTokens)}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-sm font-medium text-workbench-text-muted">Tokens</span>
            {estimatedTokens > 0 && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/60 font-mono"
                title="Antigravity / TraeWork 等字符估算量，不计入主统计"
              >
                {t('stats.estimated', { n: formatTokens(estimatedTokens) })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Estimated Cost (Deep Gray #202427) */}
      <div className="sm:border-l sm:border-workbench-border sm:px-8 flex flex-col justify-between">
        <div>
          <div className="text-4xl sm:text-[44px] font-bold text-workbench-text tracking-tight font-mono tabular-nums leading-none">
            {formatCost(totalCostUsd, currency, exchangeRate)}
          </div>
          <div className="text-sm font-medium text-workbench-text-muted mt-2">
            {t('stats.totalCost')}
          </div>
        </div>
      </div>

      {/* 3. Requests (Deep Gray #202427) */}
      <div className="sm:border-l sm:border-workbench-border sm:pl-8 flex flex-col justify-between">
        <div>
          <div className="text-4xl sm:text-[44px] font-bold text-workbench-text tracking-tight font-mono tabular-nums leading-none">
            {formatNumber(totalRequests)}
          </div>
          <div className="text-sm font-medium text-workbench-text-muted mt-2">
            {t('stats.requests')}
          </div>
        </div>
      </div>
    </div>
  )
}
