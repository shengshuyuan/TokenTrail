'use client'

import React, { useState } from 'react'
import type { ProviderId, ProviderQuotaSnapshot, QuotasResponse } from '@/lib/quotas/types'
import { QUOTA_PROVIDER_IDS, QUOTA_PROVIDER_LABELS } from '@/lib/quotas/types'
import { useQuotas } from '@/lib/quotas/useQuotas'
import { usePreferences } from '@/lib/PreferencesContext'
import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { QuotaProviderRow, QuotaProviderRowSkeleton } from '@/components/dashboard/QuotaProviderRow'
import { QuotaManualModal } from '@/components/dashboard/QuotaManualModal'
import { useLang } from '@/lib/LanguageContext'

const PROVIDER_IDS: ProviderId[] = QUOTA_PROVIDER_IDS
const ATTENTION_STATUSES = new Set(['warning', 'critical', 'exhausted', 'auth_error', 'network_error', 'partial', 'stale', 'unsupported_version'])
const PROVIDER_REFRESH_ERROR_STATUSES = new Set(['loading', 'network_error', 'partial', 'stale'])

type RefreshResponse = Partial<QuotasResponse> & {
  throttled?: boolean
  retryAfterMs?: number
  retryAfter?: number
  nextAllowedAt?: number
  error?: string
  refresh?: RefreshSummary
  summary?: RefreshSummary
}

type RefreshSummary = {
  total?: number
  succeeded?: number
  failed?: number
  stale?: number
  skipped?: number
}

function providerRefreshed(snapshot: ProviderQuotaSnapshot): boolean {
  return !snapshot.stale && !snapshot.error && !PROVIDER_REFRESH_ERROR_STATUSES.has(snapshot.status)
}

function retryAfterText(data: RefreshResponse, lang: 'zh' | 'en'): string {
  const now = Date.now()
  const ms =
    typeof data.retryAfterMs === 'number'
      ? data.retryAfterMs
      : typeof data.retryAfter === 'number'
        ? data.retryAfter * 1000
        : typeof data.nextAllowedAt === 'number'
          ? Math.max(0, data.nextAllowedAt - now)
          : 0
  if (ms <= 0) return ''
  const seconds = Math.ceil(ms / 1000)
  return lang === 'zh' ? `，约 ${seconds} 秒后可再试` : `, try again in about ${seconds}s`
}

function refreshNotice(data: RefreshResponse, lang: 'zh' | 'en', provider?: ProviderId): string {
  if (data.throttled) {
    return lang === 'zh'
      ? `刷新过于频繁，未发起新请求，仍显示缓存${retryAfterText(data, lang)}`
      : `Refresh is rate limited; cached data shown${retryAfterText(data, lang)}`
  }

  const summary = data.refresh ?? data.summary
  const scopedProviders = (data.providers ?? []).filter((p) => !provider || p.provider === provider)
  const total = summary?.total ?? scopedProviders.length
  const stale = summary?.stale ?? scopedProviders.filter((p) => p.stale).length
  const succeeded = summary?.succeeded ?? scopedProviders.filter(providerRefreshed).length
  const failed = summary?.failed ?? Math.max(0, total - succeeded)
  const skipped = summary?.skipped ?? 0

  if (total > 0 && succeeded === 0 && failed > 0) {
    return lang === 'zh' ? '没有读取到新的额度，请查看各供应商状态' : 'No fresh quota read; check provider status'
  }
  if (failed > 0 || stale > 0 || skipped > 0) {
    return lang === 'zh'
      ? `刷新完成：${succeeded} 家成功，${failed} 家失败，${stale} 家沿用旧值${skipped ? `，${skipped} 家等待限流` : ''}`
      : `Refresh finished: ${succeeded} succeeded, ${failed} failed, ${stale} kept old values${skipped ? `, ${skipped} waiting for retry` : ''}`
  }
  return provider
    ? lang === 'zh' ? '该供应商额度已刷新' : 'Provider quota refreshed'
    : lang === 'zh' ? '额度刷新成功' : 'Quotas refreshed'
}

export default function QuotasPage() {
  const { lang } = useLang()
  const { quotaVisibleProviders } = usePreferences()
  const { data, loading, loadError, refreshing, fetchQuotas, refresh, backgroundRefreshing } = useQuotas()
  const [notice, setNotice] = useState<string | null>(null)
  const [manualModalOpen, setManualModalOpen] = useState(false)
  const [manualTargetProvider, setManualTargetProvider] = useState<ProviderId>('grok')

  const handleRefresh = async (provider?: ProviderId) => {
    if (refreshing) return
    setNotice(null)
    const outcome = await refresh(provider)
    if (!outcome) return
    const json = outcome.json as RefreshResponse
    if (!outcome.ok) {
      setNotice(json.error || (lang === 'zh' ? '刷新失败，保留原有数据' : 'Refresh failed, previous data kept'))
    } else if (json.providers) {
      setNotice(refreshNotice(json, lang, provider))
    }
    setTimeout(() => setNotice(null), 4000)
  }

  const openManualModal = (provider: ProviderId) => {
    setManualTargetProvider(provider)
    setManualModalOpen(true)
  }

  // Derived stats
  // 账号额度显示开关：未设置(null)=全部显示；否则只保留勾选的 provider。
  const isProviderVisible = (id: string) =>
    quotaVisibleProviders === null || quotaVisibleProviders.includes(id)
  const visibleProviderIds = PROVIDER_IDS.filter(isProviderVisible)
  const providers = (data?.providers || []).filter((p) => isProviderVisible(p.provider))
  const healthyCount = providers.filter((p) => !p.stale && !p.error && p.status === 'healthy').length
  const warningCount = providers.filter((p) => p.stale || p.error || ATTENTION_STATUSES.has(p.status) || p.status === 'not_configured').length
  const staleCount = providers.filter((p) => p.stale).length
  const lastSuccessAt = providers.reduce((acc, p) => Math.max(acc, p.lastSuccessAt ?? 0), 0)
  const pageNote = lastSuccessAt
    ? `${lang === 'zh' ? '上次成功读取于' : 'Last successful read'} ${new Date(lastSuccessAt).toLocaleTimeString()}`
    : data?.updated_at
      ? `${lang === 'zh' ? '最近尝试于' : 'Last attempt'} ${new Date(data.updated_at).toLocaleTimeString()}`
      : undefined

  return (
    <AppShell>
      {/* Page Header */}
      <PageHeader
        title={lang === 'zh' ? '账号额度' : 'Account Quotas'}
        subtitle={
          lang === 'zh'
            ? '监控各供应商订阅窗口、API 钱包与实时限额状态'
            : 'Monitor subscription windows, API wallets, and real-time quotas'
        }
        note={pageNote}
        actions={
          <>
            <Button
              variant="primary"
              loading={refreshing}
              onClick={() => handleRefresh()}
              icon={
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              }
            >
              {refreshing
                ? lang === 'zh' ? '正在刷新额度...' : 'Refreshing...'
                : lang === 'zh' ? '刷新额度' : 'Refresh Quotas'}
            </Button>

            <Button
              variant="secondary"
              onClick={() => openManualModal('grok')}
              icon={
                <svg className="w-4 h-4 text-workbench-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              }
            >
              {lang === 'zh' ? '手动录入 / 提取' : 'Manual Entry'}
            </Button>
          </>
        }
      />

      {/* Notice Banner if any */}
      {notice && (
        <div className="mb-6 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-blue-600 font-bold">×</button>
        </div>
      )}

      {loadError && (
        <div className="mb-6 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center justify-between gap-3">
          <span>
            {data
              ? lang === 'zh' ? `读取额度失败，下面是上一次的数据（${loadError}）` : `Failed to load quotas; showing previous data (${loadError})`
              : lang === 'zh' ? `读取额度失败（${loadError}）` : `Failed to load quotas (${loadError})`}
          </span>
          <Button size="sm" variant="secondary" onClick={() => fetchQuotas()}>
            {lang === 'zh' ? '重试' : 'Retry'}
          </Button>
        </div>
      )}

      {backgroundRefreshing && !refreshing && (
        <div className="mb-6 p-3 rounded-lg bg-workbench-sidebar border border-workbench-border/80 text-workbench-text-muted text-sm">
          {lang === 'zh' ? '正在后台读取最新额度，完成后会自动更新…' : 'Fetching latest quotas in the background; this page will update automatically…'}
        </div>
      )}

      {/* Quotas Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
        <div className="p-5 apple-glass-metric">
          <div className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider mb-1">
            {lang === 'zh' ? '支持的供应商' : 'Providers'}
          </div>
          <div className="text-3xl font-bold font-mono text-workbench-text">
            {visibleProviderIds.length}
          </div>
          <div className="text-xs text-workbench-text-muted mt-1">
            {visibleProviderIds
              .map((id) => QUOTA_PROVIDER_LABELS[id] ?? id)
              .join(' · ')}
          </div>
        </div>

        <div className="p-5 apple-glass-metric">
          <div className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider mb-1">
            {lang === 'zh' ? '额度正常' : 'Healthy Quotas'}
          </div>
          <div className="text-3xl font-bold font-mono text-workbench-accent">
            {healthyCount}
          </div>
          <div className="text-xs text-workbench-text-muted mt-1">
            {lang === 'zh' ? '新鲜且没有读取错误' : 'Fresh and readable'}
          </div>
        </div>

        <div className="p-5 apple-glass-metric">
          <div className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider mb-1">
            {lang === 'zh' ? '需关注或待登录' : 'Attention Needed'}
          </div>
          <div className="text-3xl font-bold font-mono text-amber-600">
            {warningCount}
          </div>
          <div className="text-xs text-workbench-text-muted mt-1">
            {warningCount > 0
              ? staleCount > 0
                ? lang === 'zh' ? `${staleCount} 家沿用旧值或需要处理` : `${staleCount} kept old values or need action`
                : lang === 'zh' ? '存在需要处理的供应商' : 'Some providers need action'
              : lang === 'zh' ? '所有账户运行良好' : 'All accounts are operating smoothly'}
          </div>
        </div>
      </div>

      {/* Provider Details Card */}
      <div className="apple-glass-panel overflow-hidden mb-8">
        <div className="py-4 px-6 border-b border-workbench-border/50 bg-workbench-surface/40 flex items-center justify-between">
          <span className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider">
            {lang === 'zh' ? '各供应商额度详情' : 'Provider Quota Details'}
          </span>
          <span className="text-xs text-workbench-text-muted">
            {lang === 'zh' ? '点击状态按钮可进行登录或手动录入' : 'Click status pills to configure or login'}
          </span>
        </div>

        <div className="divide-y divide-workbench-border/60">
          {loading && !data ? (
            <>
              <QuotaProviderRowSkeleton provider="codex" />
              <QuotaProviderRowSkeleton provider="gemini" />
              <QuotaProviderRowSkeleton provider="grok" />
            </>
          ) : providers.length === 0 ? (
            <div className="py-12 text-center text-sm text-workbench-text-muted">
              暂无供应商快照
            </div>
          ) : (
            providers.map((snap) => (
              <QuotaProviderRow
                key={snap.provider}
                snapshot={snap}
                onRetry={() => handleRefresh(snap.provider)}
                onManualClick={openManualModal}
              />
            ))
          )}
        </div>
      </div>

      {/* Privacy and Auth Policy Footnote */}
      <div className="p-4 rounded-xl bg-workbench-sidebar border border-workbench-border/80 text-xs text-workbench-text-muted leading-relaxed flex items-start gap-3">
        <span className="text-base shrink-0">🛡️</span>
        <div>
          <strong className="text-workbench-text font-semibold">
            {lang === 'zh' ? '本地隐私与安全边界' : 'Local Security & Privacy Boundary'}：
          </strong>
          {lang === 'zh'
            ? 'TokenTrail 的额度采集优先扫描本地 CLI 已有认证状态或调用官方用量 API，从不主动向任何模型发送补全请求。API Key 和 OAuth 凭证安全存储在本地 keychain 或受保护配置中，额度快照绝不记录密码、密钥或邮箱等敏感隐私。'
            : 'TokenTrail scans existing CLI login sessions or queries official usage endpoints. It never initiates completion requests to AI models. Keys are stored locally in the OS Keychain and never logged in snapshots.'}
        </div>
      </div>

      {/* Manual Input / Extractor Modal */}
      {manualModalOpen && (
        <QuotaManualModal
          isOpen={manualModalOpen}
          initialProvider={manualTargetProvider}
          onClose={() => setManualModalOpen(false)}
          onSuccess={() => {
            setManualModalOpen(false)
            fetchQuotas()
          }}
        />
      )}
    </AppShell>
  )
}
