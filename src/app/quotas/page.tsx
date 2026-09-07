'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { QuotasResponse, ProviderId, ProviderQuotaSnapshot } from '@/lib/quotas/types'
import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { StatusLabel } from '@/components/ui/StatusLabel'
import { QuotaProviderRow, QuotaProviderRowSkeleton } from '@/components/dashboard/QuotaProviderRow'
import { QuotaManualModal } from '@/components/dashboard/QuotaManualModal'
import { useLang } from '@/lib/LanguageContext'

const PROVIDER_IDS: ProviderId[] = ['codex', 'gemini', 'grok', 'glm', 'kimi']

export default function QuotasPage() {
  const { lang, t } = useLang()
  const [data, setData] = useState<QuotasResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [manualModalOpen, setManualModalOpen] = useState(false)
  const [manualTargetProvider, setManualTargetProvider] = useState<ProviderId>('grok')

  const fetchQuotas = useCallback(async () => {
    try {
      const res = await fetch('/api/quotas', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch {
      // keep existing snapshot
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchQuotas()
  }, [fetchQuotas])

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setNotice(null)
    try {
      const res = await fetch('/api/quotas/refresh', { method: 'POST' })
      const json = await res.json()
      if (json.throttled) {
        setNotice(lang === 'zh' ? '刷新过于频繁，已返回最新缓存' : 'Refreshed recently; cached snapshot returned')
      } else if (json.providers) {
        setData(json)
        setNotice(lang === 'zh' ? '已刷新各供应商额度' : 'Provider quotas refreshed')
      }
    } catch {
      setNotice(lang === 'zh' ? '刷新失败，请稍后重试' : 'Refresh failed, please try again')
    } finally {
      setRefreshing(false)
      setTimeout(() => setNotice(null), 4000)
    }
  }

  const openManualModal = (provider: ProviderId) => {
    setManualTargetProvider(provider)
    setManualModalOpen(true)
  }

  // Derived stats
  const providers = data?.providers || []
  const healthyCount = providers.filter((p) => p.status === 'healthy').length
  const warningCount = providers.filter((p) =>
    ['warning', 'critical', 'exhausted', 'auth_error'].includes(p.status)
  ).length

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
        note={data?.updated_at ? `更新于 ${new Date(data.updated_at).toLocaleTimeString()}` : undefined}
        actions={
          <>
            <Button
              variant="primary"
              loading={refreshing}
              onClick={handleRefresh}
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

      {/* Quotas Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
        <div className="p-5 bg-workbench-surface border border-workbench-border rounded-xl shadow-xs">
          <div className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider mb-1">
            {lang === 'zh' ? '支持的供应商' : 'Providers'}
          </div>
          <div className="text-3xl font-bold font-mono text-workbench-text">
            {PROVIDER_IDS.length}
          </div>
          <div className="text-xs text-workbench-text-muted mt-1">
            Codex · Gemini · Grok · GLM · Kimi
          </div>
        </div>

        <div className="p-5 bg-workbench-surface border border-workbench-border rounded-xl shadow-xs">
          <div className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider mb-1">
            {lang === 'zh' ? '额度正常' : 'Healthy Quotas'}
          </div>
          <div className="text-3xl font-bold font-mono text-workbench-accent">
            {healthyCount}
          </div>
          <div className="text-xs text-workbench-text-muted mt-1">
            {lang === 'zh' ? '快照新鲜且未临界' : 'Fresh and within limits'}
          </div>
        </div>

        <div className="p-5 bg-workbench-surface border border-workbench-border rounded-xl shadow-xs">
          <div className="text-xs font-semibold text-workbench-text-muted uppercase tracking-wider mb-1">
            {lang === 'zh' ? '需关注或待登录' : 'Attention Needed'}
          </div>
          <div className="text-3xl font-bold font-mono text-amber-600">
            {warningCount}
          </div>
          <div className="text-xs text-workbench-text-muted mt-1">
            {warningCount > 0
              ? lang === 'zh' ? '存在临近耗尽、已耗尽或未登录项' : 'Low balance, exhausted or unauthenticated'
              : lang === 'zh' ? '所有账户运行良好' : 'All accounts are operating smoothly'}
          </div>
        </div>
      </div>

      {/* Provider Details Card */}
      <div className="bg-workbench-surface border border-workbench-border rounded-xl overflow-hidden shadow-xs mb-8">
        <div className="py-4 px-6 border-b border-workbench-border bg-workbench-sidebar flex items-center justify-between">
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
                onRetry={fetchQuotas}
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
