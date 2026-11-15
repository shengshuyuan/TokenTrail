'use client'

import React from 'react'
import Link from 'next/link'
import type { ProviderQuotaSnapshot, QuotaWindow } from '@/lib/quotas/types'
import { QUOTA_PROVIDER_LABELS } from '@/lib/quotas/types'
import { useQuotas } from '@/lib/quotas/useQuotas'
import { useLang } from '@/lib/LanguageContext'
import { ProviderBrandIcon } from './QuotaBrandIcons'

function formatPreviewCredits(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
  return `${amount < 0 ? '-' : ''}${text}`
}

function sourceLabel(source: string, lang: 'zh' | 'en'): string {
  if (source === 'official_api') return lang === 'zh' ? '官方接口' : 'Official API'
  if (source === 'local_session') return lang === 'zh' ? '本地会话' : 'Local session'
  if (source === 'local_cli') return lang === 'zh' ? '本地 CLI' : 'Local CLI'
  if (source === 'manual') return lang === 'zh' ? '手动录入' : 'Manual'
  return lang === 'zh' ? '未读取' : 'Unread'
}

const READ_ISSUE_ERRORS = new Set(['rate_limited', 'timeout', 'network', 'malformed'])

function hasReadIssue(provider: ProviderQuotaSnapshot): boolean {
  return (
    provider.stale ||
    provider.status === 'stale' ||
    provider.status === 'partial' ||
    provider.status === 'network_error' ||
    Boolean(provider.error && READ_ISSUE_ERRORS.has(provider.error.code))
  )
}

export function QuotaPreviewCard({ className = '' }: { className?: string }) {
  const { lang } = useLang()
  const { data, loading, loadError, fetchQuotas, backgroundRefreshing } = useQuotas()

  // Providers list: Codex, Kimi, Gemini, Grok, GLM
  const providers = data?.providers || []

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-workbench-text tracking-tight">
          {lang === 'zh' ? '账号额度' : 'Quotas'}
        </h2>
        <Link
          href="/quotas"
          className="text-xs font-medium text-workbench-accent hover:underline flex items-center gap-1"
        >
          <span>{lang === 'zh' ? '查看全部' : 'See all'}</span>
          <span>→</span>
        </Link>
      </div>

      {backgroundRefreshing && (
        <p className="mb-3 text-xs text-workbench-text-muted">
          {lang === 'zh' ? '正在后台更新额度…' : 'Updating quotas in the background…'}
        </p>
      )}

      {loading && !data ? (
        <div className="space-y-3 animate-pulse py-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-lg bg-workbench-border/70" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-28 bg-workbench-border/70 rounded" />
                <div className="h-2 w-full bg-workbench-border/50 rounded-full" />
              </div>
              <div className="w-16 h-3.5 bg-workbench-border/70 rounded" />
            </div>
          ))}
        </div>
      ) : loadError && !data ? (
        <div className="py-6 text-center text-sm text-amber-700">
          <p>{lang === 'zh' ? `读取额度失败（${loadError}）` : `Failed to load quotas (${loadError})`}</p>
          <button type="button" onClick={() => fetchQuotas()} className="mt-2 text-xs font-medium text-workbench-accent hover:underline">
            {lang === 'zh' ? '重试' : 'Retry'}
          </button>
        </div>
      ) : providers.length === 0 ? (
        <div className="py-8 text-center text-sm text-workbench-text-muted">
          {lang === 'zh' ? '暂无账号额度信息，前往' : 'No quota data yet. Open'}{' '}
          <Link href="/quotas" className="text-workbench-accent hover:underline font-medium">
            {lang === 'zh' ? '账号额度' : 'Quotas'}
          </Link>
          {lang === 'zh' ? '配置' : ' to configure'}
        </div>
      ) : (
        <div className="space-y-3">
          {providers.slice(0, 4).map((p: ProviderQuotaSnapshot) => {
            const primaryWin: QuotaWindow | undefined = p.windows?.[0]
            const hasUsedPercent =
              typeof primaryWin?.usedPercent === 'number' && Number.isFinite(primaryWin.usedPercent)
            const remainingPercent = hasUsedPercent
              ? Math.max(0, Math.min(100, Math.round(100 - (primaryWin!.usedPercent as number))))
              : null

            // Window label
            const windowName = primaryWin?.label || primaryWin?.id || ''
            const readIssue = hasReadIssue(p)
            const windowTag = windowName.includes('5') || windowName.includes('300')
              ? (lang === 'zh' ? '5 小时窗口' : '5h window')
              : windowName.includes('week') || windowName.includes('10080')
              ? (lang === 'zh' ? '周窗口' : 'Weekly window')
              : primaryWin?.id?.startsWith('workbuddy')
              ? (lang === 'zh' ? '已消耗积分' : 'Credits spent')
              : p.wallets?.length
              ? (lang === 'zh' ? '钱包余额' : 'Wallet')
              : (lang === 'zh' ? '额度窗口' : 'Quota window')

            const remainTone =
              remainingPercent === null
                ? 'text-workbench-text-muted'
                : remainingPercent <= 10
                ? 'text-status-danger'
                : remainingPercent <= 30
                ? 'text-status-warning'
                : 'text-workbench-accent'
            const barTone =
              remainingPercent === null
                ? 'bg-workbench-border'
                : remainingPercent <= 10
                ? 'bg-status-danger'
                : remainingPercent <= 30
                ? 'bg-status-warning'
                : 'bg-workbench-accent'

            let statusBadge = null
            if (p.status === 'not_configured') {
              statusBadge = <span className="text-xs text-workbench-text-muted font-medium">{lang === 'zh' ? '待登录' : 'Sign in'}</span>
            } else if (p.status === 'auth_error') {
              statusBadge = <span className="text-xs text-status-danger font-medium">{lang === 'zh' ? '授权失效' : 'Auth expired'}</span>
            } else if (p.status === 'network_error') {
              statusBadge = <span className="text-xs text-status-warning font-medium">{lang === 'zh' ? '读取失败' : 'Read failed'}</span>
            } else if (p.status === 'stale') {
              statusBadge = <span className="text-xs text-status-warning font-medium">{lang === 'zh' ? '数据过期' : 'Stale'}</span>
            } else if (p.status === 'partial') {
              statusBadge = <span className="text-xs text-status-warning font-medium">{lang === 'zh' ? '部分可读' : 'Partial'}</span>
            } else if (p.status === 'exhausted' || remainingPercent === 0) {
              statusBadge = <span className="text-xs font-semibold text-status-danger font-mono">{lang === 'zh' ? '已用完' : 'Used up'}</span>
            } else if (remainingPercent !== null) {
              statusBadge = (
                <span className={`text-xs font-semibold ${remainTone} font-mono`}>
                  {lang === 'zh' ? `剩余 ${remainingPercent}%` : `${remainingPercent}% left`}
                </span>
              )
            } else {
              statusBadge = <span className="text-xs text-workbench-text-muted font-medium">{sourceLabel(p.source, lang)}</span>
            }

            return (
              <Link
                key={p.provider}
                href="/quotas"
                className="surface-row flex items-center justify-between py-2 px-2 -mx-2 rounded-lg transition-colors group cursor-pointer"
                title={QUOTA_PROVIDER_LABELS[p.provider as keyof typeof QUOTA_PROVIDER_LABELS] || p.provider}
              >
                {/* Left: Brand icon + Name + Status */}
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <ProviderBrandIcon provider={p.provider} className="size-7 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-workbench-text truncate group-hover:text-workbench-accent transition-colors">
                      {QUOTA_PROVIDER_LABELS[p.provider as keyof typeof QUOTA_PROVIDER_LABELS] || p.provider}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      {readIssue && (
                        <span className="text-[11px] font-medium text-status-warning">{lang === 'zh' ? '旧值' : 'Cached'}</span>
                      )}
                      {statusBadge}
                      {!readIssue && (p.source === 'manual' || p.error) && (
                        <span className="text-[11px] text-workbench-text-muted">
                          {p.error ? (lang === 'zh' ? '读取失败' : 'Read failed') : sourceLabel(p.source, lang)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Progress bar & Window Tag */}
                <div className="flex flex-col items-end gap-1.5 w-36 shrink-0">
                  <span className="text-[11px] text-workbench-text-muted">{windowTag}</span>
                  {remainingPercent !== null ? (
                    <div className="w-full h-2 bg-workbench-border/70 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barTone}`}
                        style={{ width: `${remainingPercent}%` }}
                      />
                    </div>
                  ) : p.wallets?.[0] ? (
                    <span className="font-mono text-xs tabular-nums text-workbench-text">
                      {lang === 'zh'
                        ? `剩余 ${formatPreviewCredits(p.wallets[0].balance)}`
                        : `${formatPreviewCredits(p.wallets[0].balance)} left`}
                    </span>
                  ) : (
                    <div className="w-full h-2 bg-workbench-border/50 rounded-full" />
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
      {loadError && data && (
        <p className="mt-3 text-xs text-amber-700">
          {lang === 'zh' ? `读取失败，显示的是上一次的数据（${loadError}）` : `Failed to refresh; showing the previous snapshot (${loadError})`}
        </p>
      )}
    </div>
  )
}
