'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { ModelPricing, Theme, Currency } from '@/types'
import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusLabel } from '@/components/ui/StatusLabel'
import { DataTable } from '@/components/ui/DataTable'
import { THEME_DEFINITIONS } from '@/lib/themes'
import { APP_VERSION } from '@/lib/version'
import { usePreferences } from '@/lib/PreferencesContext'
import { useLang } from '@/lib/LanguageContext'

const PRICING_PAGE_SIZE = 20

function pricingPageItems(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const items: Array<number | 'ellipsis'> = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) items.push('ellipsis')
  for (let page = start; page <= end; page += 1) items.push(page)
  if (end < total - 1) items.push('ellipsis')
  items.push(total)
  return items
}

export default function SettingsPage() {
  const { lang, setLang, t } = useLang()
  const {
    currency,
    setCurrency,
    exchangeRate,
    setExchangeRate,
    showProjectNames,
    setShowProjectNames,
    theme,
    setTheme,
  } = usePreferences()

  // Pricing state
  const [pricingModels, setPricingModels] = useState<ModelPricing[]>([])
  const [pricingLoading, setPricingLoading] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelPricing | null>(null)
  const [editForm, setEditForm] = useState({
    input: '',
    cached: '',
    output: '',
    reasoning: '',
  })
  const [savingPrice, setSavingPrice] = useState(false)
  const [pricingPage, setPricingPage] = useState(1)
  const [pricingQuery, setPricingQuery] = useState('')
  const [pricingProvider, setPricingProvider] = useState('all')

  // Backup state
  const [backingUp, setBackingUp] = useState(false)
  const [backupResult, setBackupResult] = useState<string | null>(null)

  // Service details state
  const [serviceInfo, setServiceInfo] = useState<{
    records: number
    status: string
  } | null>(null)

  // Fetch pricing
  const fetchPricing = useCallback(async () => {
    try {
      setPricingLoading(true)
      const res = await fetch('/api/pricing')
      if (res.ok) {
        const data = await res.json()
        setPricingModels(Array.isArray(data.models) ? data.models : [])
      }
    } finally {
      setPricingLoading(false)
    }
  }, [])

  const pricingProviders = useMemo(() => {
    const names = new Set(pricingModels.map((model) => model.provider).filter(Boolean))
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [pricingModels])

  const filteredPricing = useMemo(() => {
    const query = pricingQuery.trim().toLowerCase()
    return pricingModels.filter((model) => {
      if (pricingProvider !== 'all' && model.provider !== pricingProvider) return false
      if (!query) return true
      return (
        (model.display_name || '').toLowerCase().includes(query) ||
        model.model_id.toLowerCase().includes(query) ||
        model.provider.toLowerCase().includes(query)
      )
    })
  }, [pricingModels, pricingQuery, pricingProvider])

  const pricingTotalPages = Math.max(1, Math.ceil(filteredPricing.length / PRICING_PAGE_SIZE))
  const pricingSafePage = Math.min(pricingPage, pricingTotalPages)
  const pricingPageModels = filteredPricing.slice(
    (pricingSafePage - 1) * PRICING_PAGE_SIZE,
    pricingSafePage * PRICING_PAGE_SIZE,
  )
  const pricingFrom = filteredPricing.length === 0 ? 0 : (pricingSafePage - 1) * PRICING_PAGE_SIZE + 1
  const pricingTo = Math.min(pricingSafePage * PRICING_PAGE_SIZE, filteredPricing.length)

  useEffect(() => {
    if (pricingPage !== pricingSafePage) setPricingPage(pricingSafePage)
  }, [pricingPage, pricingSafePage])

  // Fetch service status
  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => {
        setServiceInfo({
          records: data.records || 0,
          status: data.status || 'healthy',
        })
      })
      .catch(() => {})
    fetchPricing()
  }, [fetchPricing])

  // Handle backup creation
  const handleBackup = async () => {
    if (backingUp) return
    setBackingUp(true)
    setBackupResult(null)
    try {
      const res = await fetch('/api/backup', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.success) {
        setBackupResult(
          lang === 'zh'
            ? `已成功创建备份文件：${data.filename} (${(data.size_bytes / 1024).toFixed(1)} KB)`
            : `Backup created: ${data.filename} (${(data.size_bytes / 1024).toFixed(1)} KB)`
        )
      } else {
        setBackupResult(data.error || 'Backup failed')
      }
    } catch (err) {
      setBackupResult(err instanceof Error ? err.message : 'Backup error')
    } finally {
      setBackingUp(false)
    }
  }

  // Open price editor
  const handleEditPricing = (m: ModelPricing) => {
    setEditingModel(m)
    setEditForm({
      input: String(m.input_price_per_1m),
      cached: String(m.cached_input_price_per_1m),
      output: String(m.output_price_per_1m),
      reasoning: String(m.reasoning_price_per_1m),
    })
  }

  // Save pricing
  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingModel) return
    setSavingPrice(true)
    try {
      const res = await fetch('/api/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_id: editingModel.model_id,
          display_name: editingModel.display_name,
          provider: editingModel.provider,
          input_price_per_1m: parseFloat(editForm.input) || 0,
          cached_input_price_per_1m: parseFloat(editForm.cached) || 0,
          output_price_per_1m: parseFloat(editForm.output) || 0,
          reasoning_price_per_1m: parseFloat(editForm.reasoning) || 0,
        }),
      })
      if (res.ok) {
        setEditingModel(null)
        fetchPricing()
      }
    } finally {
      setSavingPrice(false)
    }
  }

  return (
    <AppShell>
      {/* Page Header */}
      <PageHeader
        title={lang === 'zh' ? '设置' : 'Settings'}
        subtitle={
          lang === 'zh'
            ? '管理个人偏好、数据备份与本地服务配置'
            : 'Manage personal preferences, data backups, and local server configuration'
        }
      />

      <div className="space-y-10 max-w-4xl">
        {/* 1. General Preferences Section */}
        <section className="apple-glass-panel p-6">
          <h2 className="text-base font-bold text-workbench-text tracking-tight mb-5 pb-3 border-b border-workbench-border/60">
            {lang === 'zh' ? '通用偏好' : 'General Preferences'}
          </h2>

          <div className="space-y-6">
            {/* Language */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-workbench-text">
                  {lang === 'zh' ? '界面语言' : 'Language'}
                </div>
                <div className="text-xs text-workbench-text-muted mt-0.5">
                  {lang === 'zh' ? '选择界面文字的显示语言' : 'Select interface display language'}
                </div>
              </div>
              <SegmentedControl
                size="sm"
                options={[
                  { value: 'zh', label: '中文 (简体)' },
                  { value: 'en', label: 'English' },
                ]}
                value={lang}
                onChange={(v) => setLang(v as 'zh' | 'en')}
              />
            </div>

            {/* Currency */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-4 border-t border-workbench-border/60">
              <div>
                <div className="text-sm font-semibold text-workbench-text">
                  {lang === 'zh' ? '结算货币与汇率' : 'Settlement Currency'}
                </div>
                <div className="text-xs text-workbench-text-muted mt-0.5">
                  {lang === 'zh'
                    ? `当前汇率参考：$1 ≈ ¥${exchangeRate.toFixed(2)}`
                    : `Exchange rate: $1 ≈ ¥${exchangeRate.toFixed(2)}`}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <SegmentedControl
                  size="sm"
                  options={[
                    { value: 'USD', label: 'USD ($)' },
                    { value: 'RMB', label: 'CNY (¥)' },
                  ]}
                  value={currency}
                  onChange={(v) => setCurrency(v as Currency)}
                />
              </div>
            </div>

            {/* Privacy Mode */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-4 border-t border-workbench-border/60">
              <div>
                <div className="text-sm font-semibold text-workbench-text">
                  {lang === 'zh' ? '隐私保护模式' : 'Privacy Protection'}
                </div>
                <div className="text-xs text-workbench-text-muted mt-0.5">
                  {lang === 'zh'
                    ? '在界面和分享卡片中隐藏本地具体的项目名称或目录'
                    : 'Mask project and directory names in dashboard and share cards'}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!showProjectNames}
                onClick={() => setShowProjectNames(!showProjectNames)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  !showProjectNames ? 'bg-workbench-accent' : 'bg-workbench-border'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    !showProjectNames ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Theme Picker */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-workbench-border/60">
              <div>
                <div className="text-sm font-semibold text-workbench-text">
                  {lang === 'zh' ? '外观风格' : 'Theme'}
                </div>
                <div className="text-xs text-workbench-text-muted mt-0.5">
                  {lang === 'zh'
                    ? '提供三种视觉特征分明的风格：经典浅色、极客深色与护眼暖纸'
                    : 'Three distinct styles: Classic Light, Dark Mecha, and Warm Paper'}
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {THEME_DEFINITIONS.map((def) => {
                  const isSelected = def.id === theme
                  return (
                    <button
                      key={def.id}
                      type="button"
                      onClick={() => setTheme(def.id)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-2 ${
                        isSelected
                          ? 'bg-workbench-accent text-white border-transparent shadow-xs font-semibold'
                          : 'bg-workbench-sidebar text-workbench-text border-workbench-border hover:bg-workbench-surface'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full border border-black/10 shrink-0 shadow-xs flex items-center justify-center"
                        style={{ backgroundColor: def.preview.canvas }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: def.preview.primary }}
                        />
                      </span>
                      {def.name[lang]}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* 2. Model Pricing Management */}
        <section className="apple-glass-panel p-6">
          <div className="flex flex-col gap-3 mb-4 pb-3 border-b border-workbench-border/60">
            <div>
              <h2 className="text-base font-bold text-workbench-text tracking-tight">
                {t('settings.pricing.title')}
              </h2>
              <p className="text-xs text-workbench-text-muted mt-0.5">
                {t('settings.pricing.subtitle', { n: pricingModels.length })}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="search"
                value={pricingQuery}
                onChange={(e) => {
                  setPricingQuery(e.target.value)
                  setPricingPage(1)
                }}
                placeholder={t('settings.pricing.search')}
                className="h-9 flex-1 min-w-0 px-3 rounded-lg border border-workbench-border bg-workbench-sidebar text-workbench-text text-xs focus:outline-none focus:border-workbench-accent"
              />
              <select
                value={pricingProvider}
                onChange={(e) => {
                  setPricingProvider(e.target.value)
                  setPricingPage(1)
                }}
                className="h-9 px-3 rounded-lg border border-workbench-border bg-workbench-sidebar text-workbench-text text-xs focus:outline-none focus:border-workbench-accent"
              >
                <option value="all">{t('settings.pricing.allProviders')}</option>
                {pricingProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <DataTable loading={pricingLoading}>
            <thead>
              <tr className="border-b border-workbench-border bg-workbench-sidebar text-xs font-medium text-workbench-text-muted">
                <th className="py-2.5 px-3">{t('settings.pricing.col.model')}</th>
                <th className="py-2.5 px-3">{t('settings.pricing.col.provider')}</th>
                <th className="py-2.5 px-3 text-right">{t('settings.pricing.col.input')}</th>
                <th className="py-2.5 px-3 text-right">{t('settings.pricing.col.cached')}</th>
                <th className="py-2.5 px-3 text-right">{t('settings.pricing.col.output')}</th>
                <th className="py-2.5 px-3 text-right">{t('settings.pricing.col.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-workbench-border/60">
              {pricingPageModels.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 px-3 text-center text-xs text-workbench-text-muted">
                    {t('settings.pricing.empty')}
                  </td>
                </tr>
              ) : (
                pricingPageModels.map((m) => (
                  <tr key={m.model_id} className="text-xs font-mono hover:bg-black/[0.02]">
                    <td className="py-2.5 px-3 font-bold text-workbench-text font-sans">
                      {m.display_name || m.model_id}
                    </td>
                    <td className="py-2.5 px-3 text-workbench-text-muted font-sans">
                      {m.provider}
                    </td>
                    <td className="py-2.5 px-3 text-right text-workbench-text tabular-nums">
                      ${m.input_price_per_1m.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-workbench-text-muted tabular-nums">
                      ${m.cached_input_price_per_1m.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-workbench-accent font-semibold tabular-nums">
                      ${m.output_price_per_1m.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleEditPricing(m)}
                        className="text-workbench-accent hover:underline font-sans font-medium"
                      >
                        {t('settings.pricing.edit')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>

          {filteredPricing.length > 0 && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <p className="text-xs text-workbench-text-muted">
                {t('settings.pricing.range', { from: pricingFrom, to: pricingTo })}
                {' · '}
                {t('settings.pricing.page', { page: pricingSafePage, pages: pricingTotalPages })}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={pricingSafePage <= 1}
                  onClick={() => setPricingPage((page) => Math.max(1, page - 1))}
                >
                  {t('settings.pricing.prev')}
                </Button>
                {pricingPageItems(pricingSafePage, pricingTotalPages).map((item, index) =>
                  item === 'ellipsis' ? (
                    <span key={`e-${index}`} className="px-1.5 text-xs text-workbench-text-muted">
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPricingPage(item)}
                      className={`h-8 min-w-8 px-2 rounded-lg text-xs font-medium border transition-colors ${
                        item === pricingSafePage
                          ? 'bg-workbench-accent text-white border-transparent'
                          : 'bg-workbench-surface text-workbench-text border-workbench-border hover:bg-workbench-sidebar'
                      }`}
                    >
                      {item}
                    </button>
                  ),
                )}
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={pricingSafePage >= pricingTotalPages}
                  onClick={() => setPricingPage((page) => Math.min(pricingTotalPages, page + 1))}
                >
                  {t('settings.pricing.next')}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* 3. Data Backup Section */}
        <section className="apple-glass-panel p-6">
          <h2 className="text-base font-bold text-workbench-text tracking-tight mb-2">
            {lang === 'zh' ? '数据备份与快照' : 'Data Backup & Snapshot'}
          </h2>
          <p className="text-xs text-workbench-text-muted mb-4 leading-relaxed">
            {lang === 'zh'
              ? 'TokenTrail 的所有统计与明细存储在本地 SQLite 数据库中。你可以一键创建离线数据库副本，备份文件存放在 ~/.tokentrail/backups/ 目录下。'
              : 'All usage records are kept in a local SQLite file. Backups are stored in ~/.tokentrail/backups/.'}
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Button
              variant="secondary"
              loading={backingUp}
              onClick={handleBackup}
              icon={
                <svg className="w-4 h-4 text-workbench-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
              }
            >
              {backingUp ? '正在生成备份...' : '立即创建本地备份'}
            </Button>
            {backupResult && (
              <span className="text-xs font-mono text-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                {backupResult}
              </span>
            )}
          </div>
        </section>

        {/* 4. Local Service & Environment Section */}
        <section id="service" className="apple-glass-panel p-6 scroll-mt-20">
          <h2 className="text-base font-bold text-workbench-text tracking-tight mb-2">
            {lang === 'zh' ? '本地运行状态与环境' : 'Local Service Status'}
          </h2>
          <p className="text-xs text-workbench-text-muted mb-4">
            {lang === 'zh'
              ? 'TokenTrail 遵循纯本地安全设计，服务默认绑定 127.0.0.1，拒绝跨站与局域网未授权请求。'
              : 'TokenTrail binds to 127.0.0.1 and rejects cross-site mutations.'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-3 bg-workbench-surface/60 rounded-xl border border-workbench-border/60 flex items-center justify-between">
              <span className="text-workbench-text-muted font-sans">服务状态</span>
              <StatusLabel status="healthy" label="运行中 (Healthy)" size="sm" />
            </div>

            <div className="p-3 bg-workbench-surface/60 rounded-xl border border-workbench-border/60 flex items-center justify-between">
              <span className="text-workbench-text-muted font-sans">监听端口</span>
              <span className="font-bold text-workbench-text">127.0.0.1:3820</span>
            </div>

            <div className="p-3 bg-workbench-surface/60 rounded-xl border border-workbench-border/60 flex items-center justify-between">
              <span className="text-workbench-text-muted font-sans">已存记录总数</span>
              <span className="font-bold text-workbench-text">{serviceInfo?.records ?? '—'} 条</span>
            </div>

            <div className="p-3 bg-workbench-surface/60 rounded-xl border border-workbench-border/60 flex items-center justify-between">
              <span className="text-workbench-text-muted font-sans">版本号</span>
              <span className="text-workbench-text">v{APP_VERSION}</span>
            </div>
          </div>
        </section>
      </div>

      {/* Pricing Edit Modal */}
      {editingModel && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleSavePricing}
            className="w-full max-w-md apple-glass-panel text-workbench-text rounded-2xl p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-workbench-border/60">
              <h3 className="font-bold text-base text-workbench-text">
                编辑模型价格: {editingModel.display_name || editingModel.model_id}
              </h3>
              <button
                type="button"
                onClick={() => setEditingModel(null)}
                className="text-workbench-text-muted hover:text-workbench-text font-bold"
              >
                ×
              </button>
            </div>

            <div className="space-y-3 text-xs font-medium">
              <div>
                <label className="block text-workbench-text-muted mb-1">输入价格 ($ / 1M Tokens)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.input}
                  onChange={(e) => setEditForm({ ...editForm, input: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-workbench-border bg-workbench-sidebar text-workbench-text font-mono text-sm focus:outline-none focus:border-workbench-accent"
                />
              </div>

              <div>
                <label className="block text-workbench-text-muted mb-1">缓存输入价格 ($ / 1M Tokens)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.cached}
                  onChange={(e) => setEditForm({ ...editForm, cached: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-workbench-border bg-workbench-sidebar text-workbench-text font-mono text-sm focus:outline-none focus:border-workbench-accent"
                />
              </div>

              <div>
                <label className="block text-workbench-text-muted mb-1">输出价格 ($ / 1M Tokens)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.output}
                  onChange={(e) => setEditForm({ ...editForm, output: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-workbench-border bg-workbench-sidebar text-workbench-text font-mono text-sm focus:outline-none focus:border-workbench-accent"
                />
              </div>

              <div>
                <label className="block text-workbench-text-muted mb-1">思考/推理价格 ($ / 1M Tokens)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.reasoning}
                  onChange={(e) => setEditForm({ ...editForm, reasoning: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-workbench-border bg-workbench-sidebar text-workbench-text font-mono text-sm focus:outline-none focus:border-workbench-accent"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-workbench-border">
              <Button size="sm" variant="ghost" type="button" onClick={() => setEditingModel(null)}>
                取消
              </Button>
              <Button size="sm" variant="primary" type="submit" loading={savingPrice}>
                保存设置
              </Button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  )
}
