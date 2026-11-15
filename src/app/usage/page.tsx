'use client'

import React, { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { StatsResponse, UsageRecord, TimeRange, Currency } from '@/types'
import { SOURCE_DISPLAY_NAMES } from '@/types'
import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { DataTable } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProviderBrandIcon } from '@/components/dashboard/QuotaBrandIcons'
import { formatCost, formatNumber, formatTokens, formatCredits, modelFamily } from '@/lib/format'
import { usePreferences } from '@/lib/PreferencesContext'
import { useLang } from '@/lib/LanguageContext'
import { useLatestRequest, isAbortError } from '@/lib/useLatestRequest'

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
type RecordKind = 'measured' | 'estimated' | 'all'

/**
 * Cursor Auto 模式的记录靠 request_id 识别（cursor:<ts>:<对话>:default 或 …:default/<模型>）：
 * 模型名已被同步改成本机对话记录里的底层模型，明细里补一个「Auto」标签说明来历。
 * 模型仍是 "auto" 说明本机没有这段对话，底层模型未知。
 */
function cursorAutoTag(record: Pick<UsageRecord, 'request_id' | 'model'>): 'resolved' | 'unresolved' | null {
  const id = record.request_id || ''
  if (!id.startsWith('cursor:') || !(id.endsWith(':default') || id.includes(':default/'))) return null
  return record.model === 'auto' ? 'unresolved' : 'resolved'
}

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
  // 「按模型」时把 medium / fast / high 这类变体合并成一个家族（见 modelFamily）
  const [mergeVariants, setMergeVariants] = useState(false)

  // Data states
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [availableSources, setAvailableSources] = useState<string[]>([])
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)
  const beginStatsRequest = useLatestRequest()

  // Raw records states
  const [rawRecords, setRawRecords] = useState<UsageRecord[]>([])
  const [page, setPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsError, setRecordsError] = useState<string | null>(null)
  // 默认只看实测，与上方汇总口径一致；估算记录需要主动切换查看
  const [recordKind, setRecordKind] = useState<RecordKind>('measured')
  const [modelQuery, setModelQuery] = useState('')
  const [modelsExpanded, setModelsExpanded] = useState(false)
  const beginRecordsRequest = useLatestRequest()

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

  // Fetch Stats Data（只有最新一次请求可以更新页面，避免慢响应覆盖新筛选）
  const fetchStats = useCallback(async () => {
    const signal = beginStatsRequest()
    setStatsLoading(true)
    setStatsError(null)
    try {
      const params = new URLSearchParams()
      params.set('days', timeRange.toString())
      if (selectedSources.length > 0) params.set('source', selectedSources.join(','))
      if (selectedModels.length > 0) params.set('model', selectedModels.join(','))

      const res = await fetch(`/api/stats?${params.toString()}`, { signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (signal.aborted) return
      const { available_sources, available_models, ...statsData } = data
      if (Array.isArray(available_sources)) setAvailableSources(available_sources)
      if (Array.isArray(available_models)) setAvailableModels(available_models)
      setStats(statsData as StatsResponse)
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return
      console.error('[TokenTrail] usage page: stats request failed', err)
      setStatsError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!signal.aborted) setStatsLoading(false)
    }
  }, [beginStatsRequest, timeRange, selectedSources, selectedModels])

  // Fetch Raw Paginated Usage Records
  const fetchRawRecords = useCallback(async () => {
    const signal = beginRecordsRequest()
    setRecordsLoading(true)
    setRecordsError(null)
    try {
      const params = new URLSearchParams()
      params.set('days', timeRange.toString())
      params.set('page', page.toString())
      params.set('kind', recordKind)
      if (selectedSources.length > 0) params.set('source', selectedSources.join(','))
      if (selectedModels.length > 0) params.set('model', selectedModels.join(','))

      const res = await fetch(`/api/usage?${params.toString()}`, { signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (signal.aborted) return
      setRawRecords(Array.isArray(data.records) ? data.records : [])
      setTotalRecords(typeof data.total === 'number' ? data.total : 0)
      setTotalPages(typeof data.total_pages === 'number' ? data.total_pages : 1)
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return
      console.error('[TokenTrail] usage page: records request failed', err)
      setRecordsError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!signal.aborted) setRecordsLoading(false)
    }
  }, [beginRecordsRequest, timeRange, selectedSources, selectedModels, page, recordKind])

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

  /** 一组模型（家族的全部变体）整体加入 / 移出筛选：已全部选中则移出，否则补齐。 */
  const toggleModels = (models: string[]) => {
    const allSelected = models.every((m) => selectedModels.includes(m))
    const next = allSelected
      ? selectedModels.filter((m) => !models.includes(m))
      : Array.from(new Set([...selectedModels, ...models]))
    setSelectedModels(next)
    setPage(1)
    updateUrlParams(timeRange, selectedSources, next)
  }

  /** 从明细 / 构成表点一行加筛选后，把视线带回顶部的筛选栏和汇总。 */
  const scrollToFilters = () => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const clearAllFilters = () => {
    setSelectedSources([])
    setSelectedModels([])
    setPage(1)
    updateUrlParams(timeRange, [], [])
  }

  const hasActiveFilters = selectedSources.length > 0 || selectedModels.length > 0
  const MODEL_PREVIEW = 8
  const modelQueryText = modelQuery.trim().toLowerCase()
  const matchedModels = availableModels.filter((model) => {
    if (!modelQueryText) return true
    return model.name.toLowerCase().includes(modelQueryText) || model.id.toLowerCase().includes(modelQueryText)
  })
  const visibleModels = (() => {
    if (modelsExpanded || modelQueryText) return matchedModels
    const head = matchedModels.slice(0, MODEL_PREVIEW)
    const headIds = new Set(head.map((model) => model.id))
    const selectedExtra = matchedModels.filter((model) => selectedModels.includes(model.id) && !headIds.has(model.id))
    return [...head, ...selectedExtra]
  })()
  const hiddenModelCount = Math.max(0, matchedModels.length - visibleModels.length)
  const chipClass = (selected: boolean) =>
    `inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40 ${
      selected
        ? 'bg-workbench-accent text-white'
        : 'border border-workbench-border/70 bg-workbench-sidebar text-workbench-text hover:bg-workbench-surface'
    }`

  // Grouping items to display
  interface GroupItem {
    key: string
    name: string
    provider: string
    tokens: number
    cost: number
    count: number
    /** 点击这一行要切换的筛选：来源 id、模型 id 列表；项目没有筛选，留空 */
    filter?: { sources?: string[]; models?: string[] }
    /** 合并变体时，这个家族包含的具体模型名 */
    variants?: string[]
  }

  const modelGroupItems = (): GroupItem[] => {
    const rows = stats?.by_model || []
    if (!mergeVariants) {
      return rows.map((m) => ({
        key: m.model,
        name: m.display_name || m.model,
        provider: 'model',
        tokens: m.total_tokens,
        cost: m.cost_usd,
        count: m.count,
        filter: { models: [m.model] },
      }))
    }
    const families = new Map<string, GroupItem>()
    for (const m of rows) {
      const family = modelFamily(m.model) || m.model
      const existing = families.get(family)
      if (existing) {
        existing.tokens += m.total_tokens
        existing.cost += m.cost_usd
        existing.count += m.count
        existing.variants!.push(m.model)
        existing.filter!.models!.push(m.model)
      } else {
        families.set(family, {
          key: `family:${family}`,
          name: family,
          provider: 'model',
          tokens: m.total_tokens,
          cost: m.cost_usd,
          count: m.count,
          variants: [m.model],
          filter: { models: [m.model] },
        })
      }
    }
    return Array.from(families.values()).sort((a, b) => b.tokens - a.tokens)
  }

  const groupItems: GroupItem[] =
    activeGroupTab === 'source'
      ? (stats?.by_source || []).map((s) => ({
          key: s.source,
          name: SOURCE_DISPLAY_NAMES[s.source] || s.source,
          provider: s.source,
          tokens: s.total_tokens,
          cost: s.cost_usd,
          count: s.count,
          filter: { sources: [s.source] },
        }))
      : activeGroupTab === 'model'
      ? modelGroupItems()
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

  /** 这一行对应的筛选当前是否已全部选中（用于高亮和 aria-pressed）。 */
  const isGroupItemSelected = (item: GroupItem) => {
    if (item.filter?.sources) return item.filter.sources.every((s) => selectedSources.includes(s))
    if (item.filter?.models) return item.filter.models.every((m) => selectedModels.includes(m))
    return false
  }

  const applyGroupItemFilter = (item: GroupItem) => {
    if (item.filter?.sources) toggleSource(item.filter.sources[0])
    else if (item.filter?.models) toggleModels(item.filter.models)
    else return
    scrollToFilters()
  }

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
      <div className="apple-glass-panel p-5 mb-8 space-y-4">
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
                    aria-pressed={isSelected}
                    onClick={() => toggleSource(source)}
                    className={chipClass(isSelected)}
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
          <div className="pt-3 border-t border-workbench-border/60 flex flex-col gap-2 sm:flex-row sm:items-start">
            <span className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider pt-2 shrink-0">
              {lang === 'zh' ? '模型' : 'Model'}
            </span>
            <div className="min-w-0 flex-1">
              {availableModels.length > MODEL_PREVIEW && (
                <input
                  type="search"
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder={lang === 'zh' ? '搜索模型' : 'Search models'}
                  className="mb-2 h-8 w-full rounded-lg border border-workbench-border bg-workbench-sidebar px-3 text-xs text-workbench-text placeholder:text-workbench-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40 sm:w-56"
                />
              )}
              <div className="flex flex-wrap gap-1.5">
                {visibleModels.map((model) => {
                  const isSelected = selectedModels.includes(model.id)
                  return (
                    <button
                      key={model.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggleModel(model.id)}
                      className={`${chipClass(isSelected)} font-mono`}
                    >
                      <span>{model.name}</span>
                      {isSelected && <span>×</span>}
                    </button>
                  )
                })}
                {hiddenModelCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setModelsExpanded(true)}
                    className="inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-medium text-workbench-accent hover:bg-workbench-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40"
                  >
                    {lang === 'zh' ? `还有 ${hiddenModelCount} 个` : `${hiddenModelCount} more`}
                  </button>
                )}
                {(modelsExpanded || modelQueryText) && availableModels.length > MODEL_PREVIEW && (
                  <button
                    type="button"
                    onClick={() => {
                      setModelsExpanded(false)
                      setModelQuery('')
                    }}
                    className="inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-medium text-workbench-text-muted hover:text-workbench-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40"
                  >
                    {lang === 'zh' ? '收起' : 'Show less'}
                  </button>
                )}
              </div>
              {modelQueryText && visibleModels.length === 0 && (
                <p className="mt-1 text-xs text-workbench-text-muted">
                  {lang === 'zh' ? '没有匹配的模型' : 'No matching models'}
                </p>
              )}
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

      {statsError && (
        <Notice
          action={
            <Button size="sm" variant="secondary" onClick={() => fetchStats()}>
              {lang === 'zh' ? '重试' : 'Retry'}
            </Button>
          }
        >
          {stats
            ? lang === 'zh'
              ? `汇总加载失败，下面显示的是上一次的结果（${statsError}）`
              : `Failed to load summary; showing previous result (${statsError})`
            : lang === 'zh'
              ? `汇总加载失败（${statsError}）`
              : `Failed to load summary (${statsError})`}
        </Notice>
      )}

      {/* Summary Strip for Filtered Data */}
      <div className={`grid grid-cols-2 sm:grid-cols-4 gap-4 p-5 apple-glass-panel ${(stats?.estimated_requests ?? 0) > 0 ? 'mb-3' : 'mb-8'} ${statsLoading && stats ? 'opacity-60' : ''}`}>
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

      {stats && stats.estimated_requests > 0 && (
        <p className="mb-8 px-1 text-xs text-workbench-text-muted">
          {lang === 'zh'
            ? `以上只统计实测数据。另有 ${formatNumber(stats.estimated_requests)} 条估算记录（约 ${formatTokens(stats.estimated_tokens)} tokens）未计入，可在下方明细切换到「估算」查看。`
            : `Totals above are measured only. ${formatNumber(stats.estimated_requests)} estimated record(s) (~${formatTokens(stats.estimated_tokens)} tokens) are excluded; switch the records table to "Estimated" to inspect them.`}
          {stats.estimated_by_model && stats.estimated_by_model.length > 0 && (
            <span className="block mt-1">
              {lang === 'zh' ? '估算按模型：' : 'Estimated by model: '}
              {stats.estimated_by_model
                .map((m) => `${m.model} ≈${formatTokens(m.total_tokens)}${m.cost_usd > 0 ? ` · ≈$${m.cost_usd.toFixed(2)}` : ''}`)
                .join(lang === 'zh' ? '；' : '; ')}
            </span>
          )}
        </p>
      )}

      {(stats?.cursor_groups && (stats.cursor_groups.named.count + stats.cursor_groups.own.count + stats.cursor_groups.grok.count) > 0) && (
        <div className="apple-glass-panel p-5 mb-8">
          <h2 className="text-sm font-bold text-workbench-text mb-3">{t('stats.cursorGroups')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              ['named', t('stats.cursorNamed'), undefined, stats.cursor_groups.named],
              ['own', t('stats.cursorOwn'), t('stats.cursorOwnHint'), stats.cursor_groups.own],
              ['grok', t('stats.cursorGrok'), t('stats.cursorGrokHint'), stats.cursor_groups.grok],
            ] as const).map(([key, label, hint, group]) => (
              <div key={key} className="rounded-lg border border-workbench-border/70 px-3 py-2" title={hint}>
                <div className="text-[11px] text-workbench-text-muted">{label}</div>
                <div className="font-mono text-lg font-semibold tabular-nums text-workbench-text">
                  {metricMode === 'tokens' ? formatTokens(group.total_tokens) : formatCost(group.cost_usd, currency, exchangeRate)}
                </div>
                <div className="text-[11px] text-workbench-text-muted font-mono">{formatNumber(group.count)}</div>
                {hint && <div className="mt-1 text-[11px] leading-snug text-workbench-text-muted/80">{hint}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 1: Grouped Breakdown Table */}
      <div className="apple-glass-panel p-5 sm:p-7 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-workbench-text tracking-tight">
              {lang === 'zh' ? '分组构成' : 'Group Breakdown'}
            </h2>
            {activeGroupTab !== 'project' && (
              <p className="text-xs text-workbench-text-muted mt-0.5">
                {lang === 'zh' ? '点一行即可按它筛选，再点一次取消' : 'Click a row to filter by it; click again to remove'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeGroupTab === 'model' && (
              <button
                type="button"
                aria-pressed={mergeVariants}
                onClick={() => setMergeVariants((v) => !v)}
                title={lang === 'zh'
                  ? '把 medium / fast / high 等变体合并成一个模型家族；大小写、provider 前缀也一并合并'
                  : 'Merge medium / fast / high variants into one model family; also merges case and provider prefixes'}
                className={chipClass(mergeVariants)}
              >
                {lang === 'zh' ? '合并变体' : 'Merge variants'}
              </button>
            )}
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
        </div>

        {statsLoading ? (
          <div className="py-12 text-center text-sm text-workbench-text-muted animate-pulse">
            {lang === 'zh' ? '加载构成数据...' : 'Loading breakdown...'}
          </div>
        ) : statsError && !stats ? (
          <div className="py-12 text-center text-sm text-workbench-text-muted">
            {lang === 'zh' ? '构成数据加载失败，请点上方「重试」' : 'Failed to load breakdown. Use Retry above.'}
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
                {activeGroupTab === 'source'
                  ? lang === 'zh' ? '来源' : 'Source'
                  : activeGroupTab === 'model'
                  ? lang === 'zh' ? '模型' : 'Model'
                  : lang === 'zh' ? '项目' : 'Project'}
              </span>
              <span className="col-span-4 sm:col-span-4 text-right pr-4">
                {metricMode === 'tokens' ? 'Tokens' : lang === 'zh' ? '估算费用' : 'Cost'}
              </span>
              <span className="hidden sm:block sm:col-span-2 text-right pr-2">{lang === 'zh' ? '请求数' : 'Calls'}</span>
              <span className="col-span-3 sm:col-span-2 text-right">{lang === 'zh' ? '占比' : 'Share'}</span>
            </div>

            {groupItems.map((item) => {
              const val = metricMode === 'tokens' ? item.tokens : item.cost
              const totalVal = metricMode === 'tokens' ? totalTokens : totalCostUsd
              const pct = totalVal > 0 ? (val / totalVal) * 100 : 0

              const clickable = Boolean(item.filter)
              const selected = clickable && isGroupItemSelected(item)
              const Row = clickable ? 'button' : 'div'

              return (
                <Row
                  key={item.key}
                  {...(clickable
                    ? {
                        type: 'button' as const,
                        'aria-pressed': selected,
                        onClick: () => applyGroupItemFilter(item),
                        title: lang === 'zh'
                          ? selected ? '点击取消这个筛选' : '点击只看这一项'
                          : selected ? 'Click to remove this filter' : 'Click to filter by this item',
                      }
                    : {})}
                  className={`surface-row grid w-full grid-cols-12 items-center py-2.5 px-2 rounded-lg text-left transition-colors ${
                    clickable ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40' : ''
                  } ${selected ? 'ring-1 ring-workbench-accent/50 bg-workbench-accent/5' : ''}`}
                >
                  <div className="col-span-5 sm:col-span-4 flex items-center gap-2.5 min-w-0 pr-2">
                    {activeGroupTab === 'source' && (
                      <ProviderBrandIcon provider={item.provider} className="size-6 shrink-0" />
                    )}
                    <span
                      className={`text-sm font-medium text-workbench-text truncate ${activeGroupTab === 'model' ? 'font-mono' : ''}`}
                      title={item.variants && item.variants.length > 1 ? item.variants.join('\n') : undefined}
                    >
                      {item.name}
                    </span>
                    {item.variants && item.variants.length > 1 && (
                      <span className="shrink-0 rounded border border-workbench-border bg-workbench-sidebar px-1.5 py-0.5 text-[10px] font-sans font-medium text-workbench-text-muted">
                        {lang === 'zh' ? `${item.variants.length} 个变体` : `${item.variants.length} variants`}
                      </span>
                    )}
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
                </Row>
              )
            })}
          </div>
        )}
      </div>

      {/* Section 2: Raw Records Table */}
      <div className="apple-glass-panel p-5 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-workbench-text tracking-tight">
              {lang === 'zh' ? '原始调用记录' : 'Raw Records'}
            </h2>
            <p className="text-xs text-workbench-text-muted mt-0.5">
              {lang === 'zh'
                ? `共 ${totalRecords} 条${recordKind === 'measured' ? '实测' : recordKind === 'estimated' ? '估算' : ''}明细记录，每页 10 条`
                : `${totalRecords} ${recordKind === 'all' ? '' : recordKind + ' '}record(s), 10 per page`}
            </p>
          </div>

          {/* Pagination buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              size="sm"
              options={[
                { value: 'measured', label: lang === 'zh' ? '实测' : 'Measured' },
                { value: 'estimated', label: lang === 'zh' ? '估算' : 'Estimated' },
                { value: 'all', label: lang === 'zh' ? '全部' : 'All' },
              ]}
              value={recordKind}
              onChange={(v) => {
                setRecordKind(v as RecordKind)
                setPage(1)
              }}
            />
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

        {recordsError && (
          <Notice
            className="mb-3"
            action={
              <Button size="sm" variant="secondary" onClick={() => fetchRawRecords()}>
                {lang === 'zh' ? '重试' : 'Retry'}
              </Button>
            }
          >
            {rawRecords.length > 0
              ? lang === 'zh'
                ? `明细加载失败，下面是上一次的结果（${recordsError}）`
                : `Failed to load records; showing previous result (${recordsError})`
              : lang === 'zh'
                ? `明细加载失败（${recordsError}）`
                : `Failed to load records (${recordsError})`}
          </Notice>
        )}

        <DataTable loading={recordsLoading}>
          <thead>
            <tr className="border-b border-workbench-border bg-workbench-sidebar text-xs font-medium text-workbench-text-muted">
              <th className="py-2.5 px-3">{lang === 'zh' ? '时间' : 'Time'}</th>
              <th className="py-2.5 px-3">{lang === 'zh' ? '来源' : 'Source'}</th>
              <th className="py-2.5 px-3">{lang === 'zh' ? '模型' : 'Model'}</th>
              <th className="hidden py-2.5 px-3 md:table-cell">{lang === 'zh' ? '项目' : 'Project'}</th>
              <th className="hidden py-2.5 px-3 text-right sm:table-cell">{lang === 'zh' ? '输入' : 'Input'}</th>
              <th className="hidden py-2.5 px-3 text-right lg:table-cell">{lang === 'zh' ? '缓存' : 'Cached'}</th>
              <th className="hidden py-2.5 px-3 text-right sm:table-cell">{lang === 'zh' ? '输出' : 'Output'}</th>
              <th className="hidden py-2.5 px-3 text-right lg:table-cell">{lang === 'zh' ? '思考' : 'Reasoning'}</th>
              <th className="hidden py-2.5 px-3 text-right sm:table-cell">Credits</th>
              <th className="py-2.5 px-3 text-right">{lang === 'zh' ? '估算费用' : 'Cost'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-workbench-border/60">
            {rawRecords.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-10 text-center text-sm text-workbench-text-muted">
                  {recordsLoading ? (lang === 'zh' ? '加载中...' : 'Loading...') : recordsError ? (lang === 'zh' ? '加载失败' : 'Failed to load') : (lang === 'zh' ? '暂无明细记录' : 'No records yet')}
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
                  <tr key={r.id} className="surface-row transition-colors text-xs font-mono">
                    <td className="py-2.5 px-3 text-workbench-text-muted whitespace-nowrap">
                      {dateStr}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => { toggleSource(r.source); scrollToFilters() }}
                        aria-pressed={selectedSources.includes(r.source)}
                        title={lang === 'zh' ? `只看来源 ${SOURCE_DISPLAY_NAMES[r.source] || r.source}` : `Filter by source ${SOURCE_DISPLAY_NAMES[r.source] || r.source}`}
                        className="flex items-center gap-1.5 rounded px-1 -mx-1 hover:bg-workbench-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40"
                      >
                        <ProviderBrandIcon provider={r.source} className="size-4 shrink-0" />
                        <span className="font-sans font-medium text-workbench-text">
                          {SOURCE_DISPLAY_NAMES[r.source] || r.source}
                        </span>
                      </button>
                    </td>
                    <td className="py-2.5 px-3 text-workbench-text font-bold whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => { toggleModel(r.model); scrollToFilters() }}
                        aria-pressed={selectedModels.includes(r.model)}
                        title={lang === 'zh' ? `只看模型 ${r.model}` : `Filter by model ${r.model}`}
                        className="rounded px-1 -mx-1 font-mono font-bold hover:bg-workbench-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40"
                      >
                        {r.model}
                      </button>
                      {(() => {
                        const tag = cursorAutoTag(r)
                        if (!tag) return null
                        return (
                          <span
                            className="ml-1.5 rounded border border-workbench-border bg-workbench-sidebar px-1.5 py-0.5 text-[10px] font-sans font-medium text-workbench-text-muted"
                            title={t(tag === 'resolved' ? 'records.autoTagTitle' : 'records.autoUnresolvedTitle')}
                          >
                            {t('records.autoTag')}
                          </span>
                        )
                      })()}
                      {r.estimated === 1 && (
                        <span
                          className="ml-1.5 rounded border border-status-warning/30 bg-status-warning/15 px-1.5 py-0.5 text-[10px] font-sans font-medium text-status-warning"
                          title={lang === 'zh' ? 'token 数为估算值，不计入汇总' : 'Estimated tokens, excluded from totals'}
                        >
                          {lang === 'zh' ? '估算' : 'Est.'}
                        </span>
                      )}
                    </td>
                    <td className="hidden py-2.5 px-3 text-workbench-text-muted whitespace-nowrap font-sans md:table-cell">
                      {projectName}
                    </td>
                    <td className="hidden py-2.5 px-3 text-right text-workbench-text tabular-nums sm:table-cell">
                      {formatNumber(r.input_tokens)}
                    </td>
                    <td className="hidden py-2.5 px-3 text-right text-workbench-text-muted tabular-nums lg:table-cell">
                      {r.cached_input_tokens > 0 ? formatNumber(r.cached_input_tokens) : '—'}
                    </td>
                    <td className="hidden py-2.5 px-3 text-right text-workbench-accent tabular-nums font-semibold sm:table-cell">
                      {/* Credit-billed sources (Kiro) never record output tokens: show unknown, not 0 */}
                      {(r.credits ?? 0) > 0 && r.output_tokens === 0 ? '—' : formatNumber(r.output_tokens)}
                    </td>
                    <td className="hidden py-2.5 px-3 text-right text-workbench-text-muted tabular-nums lg:table-cell">
                      {r.reasoning_tokens > 0 ? formatNumber(r.reasoning_tokens) : '—'}
                    </td>
                    <td className="hidden py-2.5 px-3 text-right text-workbench-text tabular-nums sm:table-cell">
                      {(r.credits ?? 0) > 0 ? formatCredits(r.credits as number) : '—'}
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
