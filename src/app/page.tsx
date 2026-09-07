'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
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

export default function OverviewPage() {
  const { lang, t } = useLang()
  const { currency, exchangeRate, theme, syncing, triggerSync, refreshKey } = usePreferences()

  const [timeRange, setTimeRange] = useState<TimeRange>(7)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [lastUpdatedDate, setLastUpdatedDate] = useState<string>('')

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/stats?days=${timeRange}`)
      if (!res.ok) throw new Error('Failed to fetch stats')
      const data = await res.json()
      const { available_sources, available_models, ...statsData } = data as Record<string, unknown>
      setStats(statsData as unknown as StatsResponse)
      setLastUpdatedDate(new Date().toISOString().slice(0, 10))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [timeRange])

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
      {error ? (
        <EmptyState
          type="fetch_error"
          title={lang === 'zh' ? '加载总览失败' : 'Failed to load stats'}
          description={error}
          onAction={fetchStats}
        />
      ) : isFirstLoadNoData ? (
        <EmptyState
          type="first_load_no_data"
          title={lang === 'zh' ? '暂无用量记录' : 'No usage data yet'}
          description={
            lang === 'zh'
              ? '尚未捕获或同步到 AI 用量。前往数据接入配置工具并一键同步。'
              : 'No AI usage recorded yet. Visit Data Connections to set up your tools.'
          }
          actionLabel={lang === 'zh' ? '前往数据接入' : 'Go to Connections'}
          actionHref="/connections"
        />
      ) : (
        <div className="space-y-10">
          {/* 1. Primary Metric Strip */}
          <MetricStrip
            stats={stats}
            loading={loading}
            currency={currency}
            exchangeRate={exchangeRate}
          />

          {/* 2. Single Metric Trend Area */}
          <div className="bg-workbench-surface border border-workbench-border rounded-xl p-5 sm:p-7 shadow-xs">
            <SingleMetricTrendChart
              data={stats?.daily || []}
              loading={loading}
              currency={currency}
              exchangeRate={exchangeRate}
            />
          </div>

          {/* 3. Bottom Row: Sources Distribution & Quotas Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 pt-2">
            {/* Left: Sources Distribution */}
            <div className="bg-workbench-surface border border-workbench-border rounded-xl p-5 sm:p-7 shadow-xs flex flex-col justify-between">
              <TopSourcesList
                sources={stats?.by_source || []}
                totalTokens={totalTokens}
                timeRange={timeRange}
                loading={loading}
              />
            </div>

            {/* Right: Quota Preview */}
            <div className="bg-workbench-surface border border-workbench-border rounded-xl p-5 sm:p-7 shadow-xs flex flex-col justify-between">
              <QuotaPreviewCard />
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
