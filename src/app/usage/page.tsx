'use client'

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { StatsResponse, UsageRecord, TimeRange, Currency } from '@/types'
import { SOURCE_DISPLAY_NAMES } from '@/types'
import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { DataTable } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProviderBrandIcon } from '@/components/dashboard/QuotaBrandIcons'
import { formatCost, formatNumber, formatTokens } from '@/lib/format'
import { usePreferences } from '@/lib/PreferencesContext'
import { useLang } from '@/lib/LanguageContext'

export default function UsagePage() {
  return (
    <Suspense fallback={<UsagePageSkeleton />}>
      <UsagePageInner />
    </Suspense>
  )
}

function UsagePageSkeleton() {
  return (
    <AppShell>
      <div className="py-12 flex justify-center text-workbench-text-muted">
        加载用量分析...
      </div>
    </AppShell>
  )
}

type GroupTab = 'source' | 'model' | 'project'
type MetricMode = 'tokens' | 'cost'

function UsagePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { lang, t } = useLang()
  const { currency, exchangeRate, showProjectNames, refreshKey } = usePreferences()

  // Initialize filters from URL query parameters
  const initialDays = Number(searchParams.get('days')) || 7
  const initialTimeRange: TimeRange = [1, 7, 30, 90].includes(initialDays)
    ? (initialDays as TimeRange)
    : 7
  const initialSource = searchParams.get('source')
  const initialModel = searchParams.get('model')

  const [timeRange, setTimeRange] = useState<TimeRange>(initialTimeRange)
  const [selectedSources, setSelectedSources] = useState<string[]>(
    initialSource ? initialSource.split(',').filter(Boolean) : []
  )
  const [selectedModels, setSelectedModels] = useState<string[]>(
    initialModel ? initialModel.split(',').filter(Boolean) : []
  )
  const [metricMode, setMetricMode] = useState<MetricMode>('tokens')
  const [activeGroupTab, setActiveGroupTab] = useState<GroupTab>('source')

  // Data states
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [availableSources, setAvailableSources] = useState<string[]>([])
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([])
  const [statsLoading, setStatsLoading] = useState(true)

  // Raw records states
  const [rawRecords, setRawRecords] = useState<UsageRecord[]>([])
  const [page, setPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [recordsLoading, setRecordsLoading] = useState(false)

  // Synchronize state with URL search params
  const updateUrlParams = useCallback(
    (days: TimeRange, sources: string[], models: string[]) => {
      const params = new URLSearchParams()
      params.set('days', days.toString())
      if (sources.length > 0) params.set('source', sources.join(','))
      if (models.length > 0) params.set('model', models.join(','))
      router.replace(`/usage?${params.toString()}`, { scroll: false })
    },
    [router]
  )

  // Fetch Stats Data
  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true)
      const params = new URLSearchParams()
      params.set('days', timeRange.toString())
      if (selectedSources.length > 0) params.set('source', selectedSources.join(','))
      if (selectedModels.length > 0) params.set('model', selectedModels.join(','))

      const res = await fetch(`/api/stats?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        const { available_sources, available_models, ...statsData } = data
        if (Array.isArray(available_sources)) setAvailableSources(available_sources)
        if (Array.isArray(available_models)) setAvailableModels(available_models)
        setStats(statsData as StatsResponse)
      }
    } finally {
      setStatsLoading(false)
    }
  }, [timeRange, selectedSources, selectedModels])

  // Fetch Raw Paginated Usage Records
  const fetchRawRecords = useCallback(async () => {
    try {
      setRecordsLoading(true)
      const params = new URLSearchParams()
      params.set('days', timeRange.toString())
      params.set('page', page.toString())
      if (selectedSources.length > 0) params.set('source', selectedSources.join(','))
      if (selectedModels.length > 0) params.set('model', selectedModels.join(','))

      const res = await fetch(`/api/usage?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setRawRecords(Array.isArray(data.records) ? data.records : [])
        setTotalRecords(typeof data.total === 'number' ? data.total : 0)
        setTotalPages(typeof data.total_pages === 'number' ? data.total_pages : 1)
      }
    } finally {
      setRecordsLoading(false)
    }
  }, [timeRange, selectedSources, selectedModels, page])

  useEffect(() => {
    fetchStats()
  }, [fetchStats, refreshKey])

  useEffect(() => {
    fetchRawRecords()
  }, [fetchRawRecords, refreshKey])

  // Handle filter changes
  const handleRangeChange = (range: TimeRange) => {
    setTimeRange(range)
    setPage(1)
    updateUrlParams(range, selectedSources, selectedModels)
  }

  const toggleSource = (source: string) => {
    const next = selectedSources.includes(source)
      ? selectedSources.filter((s) => s !== source)
      : [...selectedSources, source]
    setSelectedSources(next)
    setPage(1)
    updateUrlParams(timeRange, next, selectedModels)
  }

  const toggleModel = (model: string) => {
    const next = selectedModels.includes(model)
      ? selectedModels.filter((m) => m !== model)
      : [...selectedModels, model]
    setSelectedModels(next)
    setPage(1)
    updateUrlParams(timeRange, selectedSources, next)
  }

  const clearAllFilters = () => {
    setSelectedSources([])
    setSelectedModels([])
    setPage(1)
    updateUrlParams(timeRange, [], [])
  }

  const hasActiveFilters = selectedSources.length > 0 || selectedModels.length > 0

  // Grouping items to display
  const groupItems =
    activeGroupTab === 'source'
      ? (stats?.by_source || []).map((s) => ({
          key: s.source,
          name: SOURCE_DISPLAY_NAMES[s.source] || s.source,
          provider: s.source,
          tokens: s.total_tokens,
          cost: s.cost_usd,
          count: s.count,
        }))
      : activeGroupTab === 'model'
      ? (stats?.by_model || []).map((m) => ({
          key: m.model,
          name: m.display_name || m.model,
          provider: 'model',
          tokens: m.total_tokens,
          cost: m.cost_usd,
          count: m.count,
        }))
      : (stats?.by_project || []).map((p) => ({
          key: p.project || 'default',
          name: !p.project
            ? lang === 'zh' ? '未归类项目' : 'Default Project'
            : showProjectNames
            ? p.project
            : '••••••',
          provider: 'project',
          tokens: p.total_tokens,
          cost: p.cost_usd,
          count: p.count,
        }))

  const totalTokens = stats?.total_tokens ?? 0
  const totalCostUsd = stats?.total_cost_usd ?? 0
  const totalRequests = stats?.total_requests ?? 0

  return (
    <AppShell>
      {/* Page Header */}
      <PageHeader
        title={lang === 'zh' ? '用量分析' : 'Usage Analysis'}
        subtitle={lang === 'zh' ? '查明消耗来源，深入洞察模型分布与调用明细' : 'Investigate consumption sources, models, and call history'}
      />

      {/* Filter Control Bar */}
      <div className="bg-workbench-surface border border-workbench-border rounded-xl p-5 mb-8 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Time range selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider">
              {lang === 'zh' ? '时间窗口' : 'Window'}
            </span>
            <SegmentedControl
              size="sm"
              options={[
                { value: 1, label: lang === 'zh' ? '今天' : '1D' },
                { value: 7, label: lang === 'zh' ? '7天' : '7D' },
                { value: 30, label: lang === 'zh' ? '30天' : '30D' },
                { value: 90, label: lang === 'zh' ? '90天' : '90D' },
              ]}
              value={timeRange}
              onChange={(v) => handleRangeChange(v as TimeRange)}
            />
          </div>

          {/* Metric switcher */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider">
              {lang === 'zh' ? '展示指标' : 'Metric'}
            </span>
            <SegmentedControl
              size="sm"
              options={[
                { value: 'tokens', label: 'Tokens' },
                { value: 'cost', label: lang === 'zh' ? '估算费用' : 'Cost' },
              ]}
              value={metricMode}
              onChange={(v) => setMetricMode(v as MetricMode)}
            />
          </div>
        </div>

        {/* Source Pills Filter */}
        {availableSources.length > 0 && (
          <div className="pt-2 border-t border-workbench-border/60 flex items-start gap-2">
            <span className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider pt-1 shrink-0">
              {lang === 'zh' ? '来源' : 'Source'}
            </span>
            <div className="flex flex-wrap gap-1.5 flex-1">
              {availableSources.map((source) => {
                const isSelected = selectedSources.includes(source)
                const name = SOURCE_DISPLAY_NAMES[source] || source
                return (
                  <button
                    key={source}
                    type="button"
                    onClick={() => toggleSource(source)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-workbench-accent text-white shadow-2xs'
                        : 'bg-workbench-sidebar text-workbench-text hover:bg-workbench-surface border border-workbench-border/60'
                    }`}
                  >
                    <span>{name}</span>
                    {isSelected && <span>×</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Model Pills Filter */}
        {availableModels.length > 0 && (
          <div className="pt-2 border-t border-workbench-border/60 flex items-start gap-2">
            <span className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider pt-1 shrink-0">
              {lang === 'zh' ? '模型' : 'Model'}
            </span>
            <div className="flex flex-wrap gap-1.5 flex-1">
              {availableModels.map((model) => {
                const isSelected = selectedModels.includes(model.id)
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => toggleModel(model.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                      isSelected
                        ? 'bg-workbench-accent text-white shadow-2xs font-bold'
                        : 'bg-workbench-sidebar text-workbench-text hover:bg-workbench-surface border border-workbench-border/60'
                    }`}
                  >
                    <span>{model.name}</span>
                    {isSelected && <span>×</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Clear filters banner if active */}
        {hasActiveFilters && (
          <div className="pt-2 border-t border-workbench-border/60 flex items-center justify-between text-xs">
            <span className="text-workbench-text-muted">
              {lang === 'zh'
                ? `已应用 ${selectedSources.length + selectedModels.length} 个筛选条件`
                : `${selectedSources.length + selectedModels.length} active filter(s)`}
            </span>
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-workbench-accent font-medium hover:underline cursor-pointer"
            >
              {lang === 'zh' ? '清空全部筛选' : 'Clear all filters'}
            </button>
          </div>
        )}
      </div>

      {/* Summary Strip for Filtered Data */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5 mb-8 bg-workbench-surface border border-workbench-border rounded-xl shadow-xs">
        <div>
          <div className="text-xs font-medium text-workbench-text-muted mb-1">
            {lang === 'zh' ? '当前消耗' : 'Filtered Tokens'}
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-workbench-accent tabular-nums">
            {formatTokens(totalTokens)}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-workbench-text-muted mb-1">
            {lang === 'zh' ? '估算费用' : 'Estimated Cost'}
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-workbench-text tabular-nums">
            {formatCost(totalCostUsd, currency, exchangeRate)}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-workbench-text-muted mb-1">
            {lang === 'zh' ? '请求次数' : 'Calls'}
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-workbench-text tabular-nums">
            {formatNumber(totalRequests)}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-workbench-text-muted mb-1">
            {lang === 'zh' ? '日均用量' : 'Daily Average'}
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-workbench-text tabular-nums">
            {formatTokens(stats?.avg_daily_tokens ?? 0)}
          </div>
        </div>
      </div>

      {/* Section 1: Grouped Breakdown Table */}
      <div className="bg-workbench-surface border border-workbench-border rounded-xl p-5 sm:p-7 shadow-xs mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h2 className="text-lg font-bold text-workbench-text tracking-tight">
            {lang === 'zh' ? '分组构成' : 'Group Breakdown'}
          </h2>
          <SegmentedControl
            size="sm"
            options={[
              { value: 'source', label: lang === 'zh' ? '按来源' : 'By Source' },
              { value: 'model', label: lang === 'zh' ? '按模型' : 'By Model' },
              { value: 'project', label: lang === 'zh' ? '按项目' : 'By Project' },
            ]}
            value={activeGroupTab}
            onChange={(v) => setActiveGroupTab(v as GroupTab)}
          />
        </div>

        {statsLoading ? (
          <div className="py-12 text-center text-sm text-workbench-text-muted animate-pulse">
            加载构成数据...
          </div>
        ) : groupItems.length === 0 ? (
          <EmptyState
            type="filter_no_results"
            onAction={clearAllFilters}
            actionLabel={hasActiveFilters ? (lang === 'zh' ? '清空筛选' : 'Clear filters') : undefined}
          />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-12 text-xs font-medium text-workbench-text-muted pb-2 border-b border-workbench-border">
              <span className="col-span-5 sm:col-span-4">
                {activeGroupTab === 'source' ? '来源' : activeGroupTab === 'model' ? '模型' : '项目'}
              </span>
              <span className="col-span-4 sm:col-span-4 text-right pr-4">
                {metricMode === 'tokens' ? 'Tokens' : '估算费用'}
              </span>
              <span className="hidden sm:block sm:col-span-2 text-right pr-2">请求数</span>
              <span className="col-span-3 sm:col-span-2 text-right">占比</span>
            </div>

            {groupItems.map((item) => {
              const val = metricMode === 'tokens' ? item.tokens : item.cost
              const totalVal = metricMode === 'tokens' ? totalTokens : totalCostUsd
              const pct = totalVal > 0 ? (val / totalVal) * 100 : 0

              return (
                <div
                  key={item.key}
                  className="grid grid-cols-12 items-center py-2.5 px-2 rounded-lg hover:bg-black/[0.02] transition-colors"
                >
                  <div className="col-span-5 sm:col-span-4 flex items-center gap-2.5 min-w-0 pr-2">
                    {activeGroupTab === 'source' && (
                      <ProviderBrandIcon provider={item.provider} className="size-6 shrink-0" />
                    )}
                    <span className="text-sm font-medium text-workbench-text truncate">
                      {item.name}
                    </span>
                  </div>

                  <div className="col-span-4 sm:col-span-4 flex items-center gap-3 justify-end pr-4">
                    <div className="hidden sm:block flex-1 h-1.5 bg-workbench-border/80 rounded-full overflow-hidden max-w-[120px]">
                      <div
                        className="h-full bg-workbench-accent rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono text-workbench-text tabular-nums font-semibold">
                      {metricMode === 'tokens'
                        ? formatTokens(item.tokens)
                        : formatCost(item.cost, currency, exchangeRate)}
                    </span>
                  </div>

                  <div className="hidden sm:block sm:col-span-2 text-right pr-2">
                    <span className="text-sm font-mono text-workbench-text-muted tabular-nums">
                      {formatNumber(item.count)}
                    </span>
                  </div>

                  <div className="col-span-3 sm:col-span-2 text-right">
                    <span className="text-sm font-mono text-workbench-text-muted tabular-nums">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Section 2: Raw Records Table */}
      <div className="bg-workbench-surface border border-workbench-border rounded-xl p-5 sm:p-7 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-workbench-text tracking-tight">
              {lang === 'zh' ? '原始调用记录' : 'Raw Records'}
            </h2>
            <p className="text-xs text-workbench-text-muted mt-0.5">
              {lang === 'zh'
                ? `共 ${totalRecords} 条明细记录，每页 10 条`
                : `${totalRecords} total record(s), 10 per page`}
            </p>
          </div>

          {/* Pagination buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1 || recordsLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {lang === 'zh' ? '上一页' : 'Prev'}
            </Button>
            <span className="text-xs font-mono text-workbench-text-muted px-2">
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages || recordsLoading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {lang === 'zh' ? '下一页' : 'Next'}
            </Button>
          </div>
        </div>

        <DataTable loading={recordsLoading}>
          <thead>
            <tr className="border-b border-workbench-border bg-workbench-sidebar text-xs font-medium text-workbench-text-muted">
              <th className="py-2.5 px-3">时间</th>
              <th className="py-2.5 px-3">来源</th>
              <th className="py-2.5 px-3">模型</th>
              <th className="py-2.5 px-3">项目</th>
              <th className="py-2.5 px-3 text-right">输入</th>
              <th className="py-2.5 px-3 text-right">缓存</th>
              <th className="py-2.5 px-3 text-right">输出</th>
              <th className="py-2.5 px-3 text-right">思考</th>
              <th className="py-2.5 px-3 text-right">估算费用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-workbench-border/60">
            {rawRecords.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-workbench-text-muted">
                  {recordsLoading ? '加载中...' : '暂无明细记录'}
                </td>
              </tr>
            ) : (
              rawRecords.map((r) => {
                const dateStr = new Date(r.timestamp).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                })
                const projectName = !r.project
                  ? '—'
                  : showProjectNames
                  ? r.project
                  : '••••••'

                return (
                  <tr key={r.id} className="hover:bg-black/[0.02] transition-colors text-xs font-mono">
                    <td className="py-2.5 px-3 text-workbench-text-muted whitespace-nowrap">
                      {dateStr}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <ProviderBrandIcon provider={r.source} className="size-4 shrink-0" />
                        <span className="font-sans font-medium text-workbench-text">
                          {SOURCE_DISPLAY_NAMES[r.source] || r.source}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-workbench-text font-bold whitespace-nowrap">
                      {r.model}
                    </td>
                    <td className="py-2.5 px-3 text-workbench-text-muted whitespace-nowrap font-sans">
                      {projectName}
                    </td>
                    <td className="py-2.5 px-3 text-right text-workbench-text tabular-nums">
                      {formatNumber(r.input_tokens)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-workbench-text-muted tabular-nums">
                      {r.cached_input_tokens > 0 ? formatNumber(r.cached_input_tokens) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-workbench-accent tabular-nums font-semibold">
                      {formatNumber(r.output_tokens)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-workbench-text-muted tabular-nums">
                      {r.reasoning_tokens > 0 ? formatNumber(r.reasoning_tokens) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-workbench-text tabular-nums font-semibold">
                      {formatCost(r.cost_usd, currency, exchangeRate)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </DataTable>
      </div>
    </AppShell>
  )
}
