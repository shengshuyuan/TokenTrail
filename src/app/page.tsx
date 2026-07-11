'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { StatsResponse, Currency, TimeRange, Theme, UsageRecord, ProjectStat } from '@/types'
import { SOURCE_DISPLAY_NAMES } from '@/types'
import { formatCost, formatNumber, formatTokens } from '@/lib/format'
import { USD_CNY_EXCHANGE_RATE } from '@/lib/currency'
import { StatsCards } from '@/components/dashboard/StatsCards'
import { FilterBar } from '@/components/dashboard/FilterBar'
import { TrendChart } from '@/components/dashboard/TrendChart'
import { ComparisonChart } from '@/components/dashboard/ComparisonChart'
import { ProportionChart } from '@/components/dashboard/ProportionChart'
import { IntegrationGuide } from '@/components/dashboard/IntegrationGuide'
import { ShareCard } from '@/components/dashboard/ShareCard'
import { APP_VERSION } from '@/lib/version'
import { SystemStatus } from '@/components/dashboard/SystemStatus'
import { ThemePicker } from '@/components/ThemePicker'
import { DEFAULT_THEME, getThemeDefinition, normalizeTheme } from '@/lib/themes'
import { useLang } from '@/lib/LanguageContext'
import { MotionGroup, MotionItem } from '@/components/Motion'

export default function DashboardPage() {
  return <DashboardInner />
}

function DashboardInner() {
  const { lang, setLang, t } = useLang()
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 初始化用服务端安全的默认值，避免 hydration 不匹配
  const [timeRange, setTimeRange] = useState<TimeRange>(7)
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [currency, setCurrency] = useState<Currency>('USD')
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME)
  const [preferencesHydrated, setPreferencesHydrated] = useState(false)
  const [showProjectNames, setShowProjectNames] = useState(false)
  const [showRawRecords, setShowRawRecords] = useState(true)
  const [rawRecords, setRawRecords] = useState<UsageRecord[]>([])
  const [rawRecordsTotal, setRawRecordsTotal] = useState(0)
  const [rawRecordsPage, setRawRecordsPage] = useState(1)
  const [rawRecordsLoading, setRawRecordsLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [syncDetails, setSyncDetails] = useState<{ source: string; scanned: number; inserted: number; duplicates: number; errors: number }[] | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  // Available filter options (populated from data)
  const [availableSources, setAvailableSources] = useState<string[]>([])
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([])

  const isFirstLoad = useRef(true)
  const fetchDataRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const statsRequestId = useRef(0)
  const rawRecordsRequestId = useRef(0)

  const fetchData = useCallback(async (isAutoRefresh = false) => {
    const requestId = ++statsRequestId.current
    try {
      if (isFirstLoad.current) {
        setInitialLoading(true)
      } else if (isAutoRefresh) {
        setRefreshing(true)
      } else {
        setInitialLoading(true)
      }
      setError(null)

      const params = new URLSearchParams()
      params.set('days', timeRange.toString())
      if (selectedSources.length > 0) {
        params.set('source', selectedSources.join(','))
      }
      if (selectedModels.length > 0) {
        params.set('model', selectedModels.join(','))
      }

      const res = await fetch(`/api/stats?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch stats')

      const data = await res.json()

      // Extract available filters from response
      if (requestId === statsRequestId.current) {
        if (data.available_sources) {
          setAvailableSources(data.available_sources)
        }
        if (data.available_models) {
          setAvailableModels(data.available_models)
        }

        // Remove filter metadata from stats
        const { available_sources, available_models, ...statsData } = data as Record<string, unknown>
        setStats(statsData as unknown as StatsResponse)
        setLastUpdated(Date.now())
      }
      return true
    } catch (err) {
      if (requestId === statsRequestId.current) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
      return false
    } finally {
      if (requestId === statsRequestId.current) {
        setInitialLoading(false)
        setRefreshing(false)
        isFirstLoad.current = false
      }
    }
  }, [timeRange, selectedSources, selectedModels])

  const fetchRawRecords = useCallback(async () => {
    if (!showRawRecords) return
    const requestId = ++rawRecordsRequestId.current
    try {
      setRawRecordsLoading(true)
      const params = new URLSearchParams()
      params.set('days', timeRange.toString())
      params.set('page', rawRecordsPage.toString())
      if (selectedSources.length > 0) {
        params.set('source', selectedSources.join(','))
      }
      if (selectedModels.length > 0) {
        params.set('model', selectedModels.join(','))
      }

      const res = await fetch(`/api/usage?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch raw records')
      const data = await res.json()
      if (requestId === rawRecordsRequestId.current) {
        setRawRecords(data.records || [])
        setRawRecordsTotal(data.total || 0)
      }
    } catch {
      if (requestId === rawRecordsRequestId.current) {
        setRawRecords([])
        setRawRecordsTotal(0)
      }
    } finally {
      if (requestId === rawRecordsRequestId.current) {
        setRawRecordsLoading(false)
      }
    }
  }, [rawRecordsPage, selectedModels, selectedSources, showRawRecords, timeRange])

  // Keep ref pointing to latest fetchData
  useEffect(() => {
    fetchDataRef.current = () => fetchData(true)
  })

  // Fetch on filter change
  useEffect(() => {
    fetchData(false)
  }, [fetchData])

  useEffect(() => {
    setRawRecordsPage(1)
  }, [timeRange, selectedSources, selectedModels])

  useEffect(() => {
    fetchRawRecords()
  }, [fetchRawRecords])

  // Auto-refresh every 60 seconds (uses ref to avoid recreating interval on filter change)
  useEffect(() => {
    let retryTimeout: ReturnType<typeof setTimeout> | null = null
    let interval: ReturnType<typeof setInterval> | null = null
    let paused = false

    const tick = () => {
      if (paused) return
      fetchDataRef.current().then(success => {
        if (!success) {
          // On error, retry in 10s instead of waiting full 60s
          retryTimeout = setTimeout(tick, 10_000)
        }
      })
    }

    interval = setInterval(tick, 60_000)

    // Pause when tab is hidden to save resources
    const handleVisibility = () => {
      paused = document.hidden
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (interval) clearInterval(interval)
      if (retryTimeout) clearTimeout(retryTimeout)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // Persist user preferences (lang is handled by LanguageContext)
  useEffect(() => {
    if (!preferencesHydrated) return
    try {
      const saved = localStorage.getItem('tokentrail-prefs')
      const prefs = saved ? JSON.parse(saved) : {}
      localStorage.setItem('tokentrail-prefs', JSON.stringify({
        ...prefs,
        timeRange,
        currency,
        theme,
        lang,
        showProjectNames,
        showRawRecords,
      }))
    } catch {}
  }, [timeRange, currency, theme, lang, showProjectNames, showRawRecords, preferencesHydrated])

  useEffect(() => {
    if (!preferencesHydrated) return
    document.documentElement.dataset.theme = theme
  }, [theme, preferencesHydrated])

  // 挂载后从 localStorage 恢复偏好（避免 hydration 不匹配）
  useEffect(() => {
    let savedTheme: unknown
    try {
      const saved = localStorage.getItem('tokentrail-prefs')
      if (saved) {
        const p = JSON.parse(saved)
        if (p.timeRange) setTimeRange(p.timeRange)
        if (p.currency) setCurrency(p.currency)
        savedTheme = p.theme
        if (typeof p.showProjectNames === 'boolean') setShowProjectNames(p.showProjectNames)
        if (typeof p.showRawRecords === 'boolean') setShowRawRecords(p.showRawRecords)
      }
    } catch {}

    const params = new URLSearchParams(window.location.search)
    const themeCandidate = params.has('theme') ? params.get('theme') : savedTheme
    const restoredTheme = normalizeTheme(themeCandidate)
    setTheme(restoredTheme)
    document.documentElement.dataset.theme = restoredTheme
    setPreferencesHydrated(true)
  }, [])

  const toggleSource = (source: string) => {
    setSelectedSources(prev =>
      prev.includes(source) ? prev.filter(s => s !== source) : [...prev, source]
    )
  }

  const toggleModel = (model: string) => {
    setSelectedModels(prev =>
      prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]
    )
  }

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncResult(null)
    setSyncDetails(null)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || t('sync.failed'))
      }
      if (data.success) {
        const { total_inserted, total_duplicates, total_errors, duration_ms } = data.summary
        const parts: string[] = []
        if (total_inserted > 0) parts.push(`+${total_inserted}`)
        if (total_duplicates > 0) parts.push(`${total_duplicates} dup`)
        if (total_errors > 0) parts.push(`${total_errors} err`)
        setSyncResult(parts.length > 0 ? `${parts.join(' · ')} (${(duration_ms / 1000).toFixed(1)}s)` : t('sync.updated'))
        setSyncDetails(data.results || null)
        // 自动刷新数据，使用 isAutoRefresh=true 显示刷新指示器
        await fetchData(true)
        await fetchRawRecords()
      } else {
        setSyncResult(t('sync.failed'))
      }
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : t('sync.networkError'))
    } finally {
      setSyncing(false)
      // 8 秒后清除结果（给用户更多时间看到详情）
      setTimeout(() => { setSyncResult(null); setSyncDetails(null) }, 8000)
    }
  }

  const loading = initialLoading
  const hasData = stats && stats.total_requests > 0
  const selectedWindow = timeRange === 1 ? t('scope.window.24h') : t('scope.window.days', { n: timeRange })
  const activeScope = [
    selectedSources.length
      ? t('scope.sources', { n: selectedSources.length, s: selectedSources.length > 1 ? 's' : '' })
      : t('scope.allSources'),
    selectedModels.length
      ? t('scope.models', { n: selectedModels.length, s: selectedModels.length > 1 ? 's' : '' })
      : t('scope.allModels'),
  ].join(' / ')
  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })
    : '--:--'
  const activeTheme = getThemeDefinition(theme)

  return (
    <div className="dashboard-shell min-h-screen">
      {/* Header */}
      <header className="glass-header z-40 border-b border-eva-border backdrop-blur-xl sm:sticky sm:top-0">
        <div className="mx-auto max-w-[1520px] px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-16 flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 shrink-0">
                <img
                  src="/logo-app.png"
                  alt="TokenTrail logo"
                  className="brand-logo h-full w-full rounded-lg"
                />
                <span
                  className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-eva-bg ${
                    refreshing ? 'bg-status-warning animate-pulse' : 'bg-status-success shadow-[0_0_12px_rgba(var(--status-success-rgb),0.38)]'
                  }`}
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="theme-display text-xl font-semibold">
                    TOKENTRAIL
                  </h1>
                  <span className="rounded border border-eva-purple/30 bg-eva-purple/10 px-1.5 py-0.5 text-[10px] font-mono text-eva-purple">
                    v{APP_VERSION}
                  </span>
                </div>
                <div className="mt-1 text-xs font-mono uppercase text-eva-text-dim">
                  {selectedWindow} / {activeScope} / {t('status.updatedAt', { time: lastUpdatedLabel })}
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="header-actions -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:w-auto lg:justify-end lg:overflow-visible lg:px-0 lg:pb-0">
              {/* Language Toggle */}
              <div className="control-cluster">
                <button
                  type="button"
                  onClick={() => setLang('zh')}
                  aria-pressed={lang === 'zh'}
                  className={`control-button ${
                    lang === 'zh'
                      ? 'control-button-active'
                      : 'control-button-idle'
                  }`}
                >
                  中
                </button>
                <button
                  type="button"
                  onClick={() => setLang('en')}
                  aria-pressed={lang === 'en'}
                  className={`control-button ${
                    lang === 'en'
                      ? 'control-button-active'
                      : 'control-button-idle'
                  }`}
                >
                  EN
                </button>
              </div>

              <ThemePicker theme={theme} onThemeChange={setTheme} />

              <div className="control-cluster">
                <button
                  type="button"
                  onClick={() => setCurrency('USD')}
                  aria-pressed={currency === 'USD'}
                  className={`control-button ${
                    currency === 'USD'
                      ? 'control-button-active'
                      : 'control-button-idle'
                  }`}
                >
                  USD
                </button>
                <button
                  type="button"
                  onClick={() => setCurrency('RMB')}
                  aria-pressed={currency === 'RMB'}
                  className={`control-button ${
                    currency === 'RMB'
                      ? 'control-button-active'
                      : 'control-button-idle'
                  }`}
                >
                  RMB
                </button>
              </div>

              {/* Sync Button */}
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                aria-live="polite"
                className={`min-h-10 shrink-0 rounded-md border px-3 py-1.5 text-xs font-mono transition-[transform,border-color,background-color,color,box-shadow] duration-200 sm:min-h-[32px] ${
                  syncing
                    ? 'border-status-warning/50 bg-status-warning/10 text-status-warning animate-pulse'
                    : syncResult
                      ? 'border-status-success/50 bg-status-success/10 text-status-success'
                      : 'border-eva-border bg-eva-bg/50 text-eva-text-dim hover:border-eva-green/30 hover:text-eva-green'
                }`}
              >
                {syncing ? t('sync.syncing') : syncResult || t('sync.button')}
              </button>

              {/* Integration Guide */}
              <IntegrationGuide />

              {/* Share */}
              <ShareCard
                stats={stats}
                timeRange={timeRange}
                currency={currency}
                theme={theme}
                selectedSources={selectedSources}
                selectedModels={selectedModels}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 mx-auto max-w-[1520px] space-y-4 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8">
        {/* Filter Bar */}
        <MotionGroup>
          <MotionItem>
            <FilterBar
              timeRange={timeRange}
              onTimeRangeChange={setTimeRange}
              availableSources={availableSources}
              selectedSources={selectedSources}
              onToggleSource={toggleSource}
              onClearSources={() => setSelectedSources([])}
              availableModels={availableModels}
              selectedModels={selectedModels}
              onToggleModel={toggleModel}
              onClearModels={() => setSelectedModels([])}
              sourceDisplayNames={SOURCE_DISPLAY_NAMES}
            />
          </MotionItem>
        </MotionGroup>

        {/* System Status */}
        <MotionGroup>
          <MotionItem>
            <SystemStatus />
          </MotionItem>
        </MotionGroup>

        {/* Sync Details (shown after SYNC button click) */}
        {syncDetails && (
          <MotionGroup>
            <MotionItem>
              <div className="eva-panel p-4">
                <div className="section-title mb-2">
                  {lang === 'zh' ? '同步结果详情' : 'SYNC RESULTS'}
                </div>
                <div className="overflow-x-auto rounded border border-eva-border bg-eva-bg/20">
                  <table className="w-full text-left text-[13px] font-mono">
                <thead>
                  <tr className="border-b border-eva-border text-eva-text-dim">
                    <th className="px-3 py-2 font-normal">{lang === 'zh' ? '来源' : 'Source'}</th>
                    <th className="px-3 py-2 font-normal text-right">{lang === 'zh' ? '扫描' : 'Scanned'}</th>
                    <th className="px-3 py-2 font-normal text-right">{lang === 'zh' ? '新增' : 'New'}</th>
                    <th className="px-3 py-2 font-normal text-right">{lang === 'zh' ? '重复' : 'Dup'}</th>
                    <th className="px-3 py-2 font-normal text-right">{lang === 'zh' ? '错误' : 'Err'}</th>
                  </tr>
                </thead>
                <tbody>
                  {syncDetails.map(r => (
                    <tr key={r.source} className="border-b border-eva-border/50 last:border-0">
                      <td className="px-3 py-2 text-eva-text">{SOURCE_DISPLAY_NAMES[r.source] || r.source}</td>
                      <td className="px-3 py-2 text-right text-eva-text-dim">{r.scanned.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-status-success">{r.inserted > 0 ? `+${r.inserted}` : '0'}</td>
                      <td className="px-3 py-2 text-right text-eva-text-dim">{r.duplicates.toLocaleString()}</td>
                      <td className={`px-3 py-2 text-right ${r.errors > 0 ? 'text-status-warning' : 'text-eva-text-dim'}`}>
                        {r.errors > 0 ? r.errors : '0'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                  </table>
                </div>
              </div>
            </MotionItem>
          </MotionGroup>
        )}

        <MotionGroup>
          <MotionItem>
            <section className="eva-panel p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="section-title mb-1">SETTINGS</div>
                  <p className="text-sm leading-6 text-eva-text-dim/90">
                    控制项目名称隐私和原始记录列表展示。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <TogglePill
                    label="显示项目名称"
                    enabled={showProjectNames}
                    onClick={() => setShowProjectNames(value => !value)}
                  />
                  <TogglePill
                    label="显示原始明细"
                    enabled={showRawRecords}
                    onClick={() => setShowRawRecords(value => !value)}
                  />
                </div>
              </div>
            </section>
          </MotionItem>
        </MotionGroup>

        {/* Stats Cards */}
        <StatsCards
          stats={stats}
          loading={loading}
          currency={currency}
          exchangeRate={USD_CNY_EXCHANGE_RATE.rate}
        />

        {/* Empty State */}
        {!loading && !hasData && (
          <div className="eva-panel p-8 text-center">
            <div className="text-terminal text-lg mb-3">{t('empty.noSignal')}</div>
            <div className="text-xs font-mono text-eva-text-dim max-w-md mx-auto space-y-2">
              <p>{t('empty.waiting')}</p>
              <div className="bg-eva-bg border border-eva-border rounded p-3 text-left mt-4">
                <p className="text-eva-green/70 mb-1">{t('empty.testHint')}</p>
                <p className="text-eva-text break-all">curl -X POST http://localhost:3820/api/report \</p>
                <p className="text-eva-text break-all pl-4">-H &apos;Content-Type: application/json&apos; \</p>
                <p className="text-eva-text break-all pl-4">-d &apos;&#123;"source":"claude-code","model":"claude-sonnet-4-20250514","input_tokens":50000,"output_tokens":5000&#125;&apos;</p>
              </div>
              <p className="text-eva-text-dim/50 mt-2">{t('empty.docHint')}</p>
            </div>
          </div>
        )}

        {/* Charts Grid */}
        {(hasData || loading) && (
          <MotionGroup className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Trend Chart */}
            <MotionItem className="lg:col-span-2" index={0}>
              <div className="eva-panel eva-panel-hover p-5">
                <div className="section-title flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-eva-green" />
                    {t('trend.title')}
                  </span>
                  <span className="hidden text-[13px] text-eva-text-dim/80 sm:inline">
                    {t('trend.dataPoints', { n: stats?.daily.length || 0 })}
                  </span>
                </div>
                <TrendChart
                  data={stats?.daily || []}
                  loading={loading}
                  currency={currency}
                  exchangeRate={USD_CNY_EXCHANGE_RATE.rate}
                />
              </div>
            </MotionItem>

            {/* Comparison Chart */}
            <MotionItem index={1}>
              <div className="eva-panel eva-panel-hover p-5 h-full">
                <div className="section-title flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-eva-purple" />
                    {t('comparison.title')}
                  </span>
                  <span className="hidden text-[13px] text-eva-text-dim/80 sm:inline">{t('comparison.topBreakdown')}</span>
                </div>
                <ComparisonChart
                  bySource={stats?.by_source || []}
                  byModel={stats?.by_model || []}
                  loading={loading}
                  currency={currency}
                  exchangeRate={USD_CNY_EXCHANGE_RATE.rate}
                  sourceDisplayNames={SOURCE_DISPLAY_NAMES}
                />
              </div>
            </MotionItem>

            {/* Proportion Chart */}
            <MotionItem index={2}>
              <div className="eva-panel eva-panel-hover p-5 h-full overflow-visible">
                <div className="section-title flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-eva-orange" />
                    {t('proportion.title')}
                  </span>
                  <span className="hidden text-[13px] text-eva-text-dim/80 sm:inline">{t('proportion.sourceMix')}</span>
                </div>
                <ProportionChart
                  bySource={stats?.by_source || []}
                  loading={loading}
                  sourceDisplayNames={SOURCE_DISPLAY_NAMES}
                />
              </div>
            </MotionItem>

            <MotionItem className="lg:col-span-2" index={3}>
              <ProjectStatsPanel
                stats={stats}
                loading={loading}
                currency={currency}
                exchangeRate={USD_CNY_EXCHANGE_RATE.rate}
                showProjectNames={showProjectNames}
              />
            </MotionItem>
          </MotionGroup>
        )}

        {showRawRecords && (hasData || rawRecordsLoading) && (
          <MotionGroup>
            <MotionItem>
              <RawRecordsPanel
                records={rawRecords}
                total={rawRecordsTotal}
                page={rawRecordsPage}
                loading={rawRecordsLoading}
                currency={currency}
                exchangeRate={USD_CNY_EXCHANGE_RATE.rate}
                showProjectNames={showProjectNames}
                onPrev={() => setRawRecordsPage(page => Math.max(1, page - 1))}
                onNext={() => setRawRecordsPage(page => page + 1)}
              />
            </MotionItem>
          </MotionGroup>
        )}

        {/* Error */}
        {error && (
          <div className="eva-panel border-status-danger/30 p-4 text-status-danger font-mono text-sm">
            <span className="text-status-danger">{t('error.label')}:</span> {error}
          </div>
        )}

        {/* Footer */}
        <footer className="text-center py-4 border-t border-eva-border">
          <p className="text-sm font-mono text-eva-text-dim">
            TOKENTRAIL // {t('footer.desc')} //{' '}
            <span className="text-eva-green">
              {t('footer.theme', { name: activeTheme.name[lang] })}
            </span>
          </p>
        </footer>
      </main>
    </div>
  )
}

function TogglePill({
  label,
  enabled,
  onClick,
}: {
  label: string
  enabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={enabled}
      className={`inline-flex min-h-11 items-center gap-2.5 rounded-md border px-3.5 py-2 text-sm font-mono transition-[transform,border-color,background-color,color,box-shadow] duration-200 sm:min-h-[38px] ${
        enabled
          ? 'border-eva-green/40 bg-eva-green/10 text-eva-green'
          : 'border-eva-border bg-eva-bg/60 text-eva-text-dim hover:border-eva-green/30 hover:text-eva-text'
      }`}
    >
      <span
        className={`relative h-4 w-7 rounded-full border transition-[border-color,background-color,box-shadow] duration-200 ${
          enabled ? 'border-eva-green/40 bg-eva-green/20' : 'border-eva-border-light/60 bg-eva-bg'
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-[left,background-color,box-shadow] duration-200 ${
            enabled ? 'left-[13px] bg-eva-green' : 'left-1 bg-eva-text-dim'
          }`}
        />
      </span>
      <span>{label}</span>
    </button>
  )
}

function displayProjectName(project: string | null | undefined, showProjectNames: boolean) {
  if (!showProjectNames) return 'unknow'
  return project?.trim() || 'unknow'
}

function ProjectStatsPanel({
  stats,
  loading,
  currency,
  exchangeRate,
  showProjectNames,
}: {
  stats: StatsResponse | null
  loading: boolean
  currency: Currency
  exchangeRate: number
  showProjectNames: boolean
}) {
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens')
  const rows = stats?.by_project || []
  const distribution = buildProjectDistribution(rows, metric)
  const totalValue = distribution.reduce((sum, row) => sum + row.value, 0)
  const featured = distribution[0]
  const gradient = buildConicGradient(distribution)

  return (
    <div className="eva-panel eva-panel-hover p-5">
      <div className="section-title flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-eva-green" />
          项目分布
        </span>
        <div className="flex items-center gap-1 rounded-full border border-eva-border bg-eva-bg/70 p-0.5">
          <button
            type="button"
            onClick={() => setMetric('tokens')}
            className={`rounded-full px-3 py-1 text-[11px] font-mono transition-[transform,border-color,background-color,color,box-shadow] duration-200 ${
              metric === 'tokens' ? 'bg-eva-text/15 text-eva-text' : 'text-eva-text-dim hover:text-eva-text'
            }`}
          >
            Token
          </button>
          <button
            type="button"
            onClick={() => setMetric('cost')}
            className={`rounded-full px-3 py-1 text-[11px] font-mono transition-[transform,border-color,background-color,color,box-shadow] duration-200 ${
              metric === 'cost' ? 'bg-eva-text/15 text-eva-text' : 'text-eva-text-dim hover:text-eva-text'
            }`}
          >
            费用
          </button>
        </div>
      </div>
      {loading && rows.length === 0 ? (
        <div className="py-8 text-center font-mono text-sm text-eva-text-dim">LOADING...</div>
      ) : distribution.length === 0 ? (
        <div className="py-8 text-center font-mono text-sm text-eva-text-dim">NO PROJECT DATA</div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <div className="flex items-center justify-center">
            <div className="relative flex h-40 w-40 items-center justify-center rounded-full shadow-[0_16px_45px_rgba(0,0,0,0.16)]" style={{ background: gradient }}>
              <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full border border-eva-border bg-eva-panel text-center shadow-[inset_0_0_28px_rgba(0,0,0,0.28)]">
                <div className="text-[13px] font-mono text-eva-text-dim">{metric === 'tokens' ? 'Tokens' : 'Cost'}</div>
                <div className="mt-1 text-lg font-mono font-semibold text-eva-text">
                  {metric === 'tokens'
                    ? formatTokens(featured?.value || 0)
                    : formatCost(featured?.value || 0, currency, exchangeRate)}
                </div>
                <div className="mt-1 max-w-[7rem] truncate text-xs font-mono text-eva-text-dim">
                  {featured ? displayProjectName(featured.project, showProjectNames) : '--'}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {distribution.map(row => {
              const percentage = totalValue > 0 ? (row.value / totalValue) * 100 : 0
              return (
                <div key={row.project} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md px-2.5 py-2 font-mono text-sm transition-colors hover:bg-eva-bg/45">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                      <span className="truncate text-eva-text">{displayProjectName(row.project, showProjectNames)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-eva-bg">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(percentage, 1)}%`, backgroundColor: row.color }} />
                    </div>
                  </div>
                  <div className="text-right text-eva-text-dim">
                    {metric === 'tokens' ? formatTokens(row.value) : formatCost(row.value, currency, exchangeRate)}
                  </div>
                  <div className="w-12 text-right text-eva-text-dim">{percentage.toFixed(1)}%</div>
                </div>
              )
            })}
            <div className="pt-2 text-[13px] font-mono text-eva-text-dim/80">
              {formatNumber(rows.length)} projects / {formatNumber(stats?.total_requests || 0)} requests
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type ProjectDistributionRow = {
  project: string
  total_tokens: number
  cost_usd: number
  count: number
  value: number
  color: string
}

const PROJECT_COLORS = [
  'var(--theme-chart-1)',
  'var(--theme-chart-2)',
  'var(--theme-chart-3)',
  'var(--theme-chart-4)',
  'var(--theme-chart-5)',
  'var(--theme-chart-6)',
  'var(--theme-chart-7)',
]

function buildProjectDistribution(rows: ProjectStat[], metric: 'tokens' | 'cost'): ProjectDistributionRow[] {
  const sorted = [...rows]
    .map(row => ({ ...row, value: metric === 'tokens' ? row.total_tokens : row.cost_usd }))
    .filter(row => row.value > 0)
    .sort((a, b) => b.value - a.value)

  const topRows = sorted.slice(0, 6)
  const otherRows = sorted.slice(6)
  const groupedRows: Omit<ProjectDistributionRow, 'color'>[] = topRows

  if (otherRows.length > 0) {
    groupedRows.push({
      project: '其他',
      total_tokens: otherRows.reduce((sum, row) => sum + row.total_tokens, 0),
      cost_usd: otherRows.reduce((sum, row) => sum + row.cost_usd, 0),
      count: otherRows.reduce((sum, row) => sum + row.count, 0),
      value: otherRows.reduce((sum, row) => sum + row.value, 0),
    })
  }

  return groupedRows.map((row, index) => ({ ...row, color: PROJECT_COLORS[index % PROJECT_COLORS.length] }))
}

function buildConicGradient(rows: ProjectDistributionRow[]) {
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  if (total <= 0) return 'conic-gradient(var(--theme-border), var(--theme-border))'

  let cursor = 0
  const stops = rows.map(row => {
    const start = cursor
    const end = cursor + (row.value / total) * 100
    cursor = end
    return `${row.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`
  })
  return `conic-gradient(${stops.join(', ')})`
}

function RawRecordsPanel({
  records,
  total,
  page,
  loading,
  currency,
  exchangeRate,
  showProjectNames,
  onPrev,
  onNext,
}: {
  records: UsageRecord[]
  total: number
  page: number
  loading: boolean
  currency: Currency
  exchangeRate: number
  showProjectNames: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canPrev = page > 1
  const canNext = page < totalPages

  return (
    <section className="eva-panel eva-panel-hover p-5">
      <div className="section-title flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-eva-purple" />
          RAW RECORDS
        </span>
        <span className="text-[13px] text-eva-text-dim/80">
          {formatNumber(total)} records / 10 per page
        </span>
      </div>
      <div className="table-shell">
        <table className="data-table min-w-[960px] w-full text-left font-mono text-[13px]">
          <thead className="text-eva-text-dim">
            <tr className="border-b border-eva-border">
              <th className="py-2 pr-4 font-normal">Time</th>
              <th className="py-2 pr-4 font-normal">Source</th>
              <th className="py-2 pr-4 font-normal">Project</th>
              <th className="py-2 pr-4 font-normal">Model</th>
              <th className="py-2 pr-4 font-normal">Input</th>
              <th className="py-2 pr-4 font-normal">Cached</th>
              <th className="py-2 pr-4 font-normal">Output</th>
              <th className="py-2 pr-4 font-normal">Reasoning</th>
              <th className="py-2 font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {loading && records.length === 0 ? (
              <tr>
                <td className="py-5 text-eva-text-dim" colSpan={9}>LOADING...</td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td className="py-5 text-eva-text-dim" colSpan={9}>NO RAW RECORDS</td>
              </tr>
            ) : records.map(record => (
              <tr key={record.id} className="border-b border-eva-border/60 last:border-0">
                <td className="whitespace-nowrap py-2 pr-4 text-eva-text-dim">
                  {new Date(record.timestamp).toLocaleString('zh-CN', { hour12: false })}
                </td>
                <td className="py-2 pr-4 text-eva-text">{SOURCE_DISPLAY_NAMES[record.source] || record.source}</td>
                <td className="max-w-[14rem] truncate py-2 pr-4 text-eva-text">
                  {displayProjectName(record.project, showProjectNames)}
                </td>
                <td className="max-w-[16rem] truncate py-2 pr-4 text-eva-text-dim">{record.model}</td>
                <td className="py-2 pr-4 text-eva-green">{formatNumber(record.input_tokens)}</td>
                <td className="py-2 pr-4 text-eva-green">{formatNumber(record.cached_input_tokens)}</td>
                <td className="py-2 pr-4 text-eva-green">{formatNumber(record.output_tokens)}</td>
                <td className="py-2 pr-4 text-eva-green">{formatNumber(record.reasoning_tokens)}</td>
                <td className="py-2 text-eva-orange">{formatCost(record.cost_usd, currency, exchangeRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm font-mono text-eva-text-dim">
          PAGE {page} / {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev}
            className="rounded border border-eva-border bg-eva-bg/60 px-3 py-1.5 text-sm font-mono text-eva-text-dim disabled:opacity-40 enabled:hover:border-eva-green/30 enabled:hover:text-eva-green"
          >
            PREV
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            className="rounded border border-eva-border bg-eva-bg/60 px-3 py-1.5 text-sm font-mono text-eva-text-dim disabled:opacity-40 enabled:hover:border-eva-green/30 enabled:hover:text-eva-green"
          >
            NEXT
          </button>
        </div>
      </div>
    </section>
  )
}
