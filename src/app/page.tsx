'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type { StatsResponse, TimeRange } from '@/types'
import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { MetricStrip } from '@/components/dashboard/MetricStrip'
import { SingleMetricTrendChart } from '@/components/dashboard/SingleMetricTrendChart'
import { TopSourcesList } from '@/components/dashboard/TopSourcesList'
import { QuotaPreviewCard } from '@/components/dashboard/QuotaPreviewCard'
import { TimeRangeDropdown } from '@/components/dashboard/TimeRangeDropdown'
import { ShareCard } from '@/components/dashboard/ShareCard'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePreferences } from '@/lib/PreferencesContext'
import { useLang } from '@/lib/LanguageContext'
import { useLatestRequest, isAbortError } from '@/lib/useLatestRequest'

export default function OverviewPage() {
  const { lang, t } = useLang()
  const { currency, exchangeRate, theme, syncing, triggerSync, refreshKey } = usePreferences()

  const [timeRange, setTimeRange] = useState<TimeRange>(7)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [lastUpdatedDate, setLastUpdatedDate] = useState<string>('')

  const beginRequest = useLatestRequest()

  // 只有最新一次请求能更新页面：快速切换时间范围时，旧范围的慢响应会被丢弃
  const fetchStats = useCallback(async () => {
    const signal = beginRequest()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/stats?days=${timeRange}`, { signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed to fetch stats (HTTP ${res.status})`)
      const data = await res.json()
      if (signal.aborted) return
      const { available_sources, available_models, ...statsData } = data as Record<string, unknown>
      setStats(statsData as unknown as StatsResponse)
      setLastUpdatedDate(new Date().toLocaleString())
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return
      console.error('[TokenTrail] overview: stats request failed', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [beginRequest, timeRange])

  useEffect(() => {
    fetchStats()
  }, [fetchStats, refreshKey])

  const totalTokens = stats?.total_tokens ?? 0
  const isFirstLoadNoData = !loading && !error && (!stats || totalTokens === 0)

  return (
    <AppShell>
      {/* Page Header */}
      <PageHeader
        title={lang === 'zh' ? '总览' : 'Overview'}
        subtitle={lang === 'zh' ? '你的 AI 使用，一目了然' : 'Personal AI usage at a glance'}
        note={lastUpdatedDate ? `${lang === 'zh' ? '数据截至' : 'As of'} ${lastUpdatedDate}` : undefined}
        actions={
          <>
            {/* Time Range Selector */}
            <TimeRangeDropdown value={timeRange} onChange={setTimeRange} />

            {/* Sync Button */}
            <Button
              variant="secondary"
              loading={syncing}
              onClick={() => triggerSync()}
              icon={
                <svg className="w-4 h-4 text-workbench-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              }
            >
              {syncing ? (lang === 'zh' ? '同步中...' : 'Syncing...') : (lang === 'zh' ? '同步' : 'Sync')}
            </Button>

            {/* Share Card Trigger */}
            <ShareCard
              stats={stats}
              timeRange={timeRange}
              currency={currency}
              theme={theme}
              selectedSources={[]}
              selectedModels={[]}
            />
          </>
        }
      />

      {/* Main Content Body */}
      {error && stats && (
        <div className="mb-6 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center justify-between gap-3">
          <span>
            {lang === 'zh'
              ? `刷新失败，下面是 ${lastUpdatedDate} 的数据（${error}）`
              : `Refresh failed; showing data from ${lastUpdatedDate} (${error})`}
          </span>
          <Button size="sm" variant="secondary" onClick={() => fetchStats()}>
            {lang === 'zh' ? '重试' : 'Retry'}
          </Button>
        </div>
      )}

      {error && !stats ? (
        <EmptyState
          type="fetch_error"
          title={lang === 'zh' ? '加载总览失败' : 'Failed to load stats'}
          description={error}
          onAction={fetchStats}
        />
      ) : isFirstLoadNoData ? (
        <EmptyState
          type="first_load_no_data"
          title={lang === 'zh' ? '所选时间范围内暂无用量记录' : 'No usage in this time range'}
          description={
            lang === 'zh'
              ? '可以切换到更长的时间范围，或点「同步」拉取最新用量；如果从未接入过工具，请前往数据接入。'
              : 'Try a longer range or press Sync. If no tools are connected yet, visit Data Connections.'
          }
          actionLabel={lang === 'zh' ? '前往数据接入' : 'Go to Connections'}
          actionHref="/connections"
        />
      ) : (
        <div className="space-y-6 sm:space-y-8">
          {/* 1. Primary Metric Strip */}
          <MetricStrip
            stats={stats}
            loading={loading}
            currency={currency}
            exchangeRate={exchangeRate}
          />

          {/* 2. Single Metric Trend Area */}
          <div className="apple-glass-panel p-5 sm:p-7">
            <SingleMetricTrendChart
              data={stats?.daily || []}
              loading={loading}
              currency={currency}
              exchangeRate={exchangeRate}
            />
          </div>

          {/* 3. Bottom Row: Sources Distribution & Quotas Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            {/* Left: Sources Distribution */}
            <div className="apple-glass-panel p-5 sm:p-7 flex flex-col justify-between">
              <TopSourcesList
                sources={stats?.by_source || []}
                totalTokens={totalTokens}
                timeRange={timeRange}
                loading={loading}
              />
            </div>

            {/* Right: Quota Preview */}
            <div className="apple-glass-panel p-5 sm:p-7 flex flex-col justify-between">
              <QuotaPreviewCard />
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
