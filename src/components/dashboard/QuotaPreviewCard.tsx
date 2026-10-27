'use client'

import React from 'react'
import Link from 'next/link'
import type { ProviderQuotaSnapshot, QuotaWindow } from '@/lib/quotas/types'
import { useQuotas } from '@/lib/quotas/useQuotas'
import { useLang } from '@/lib/LanguageContext'
import { ProviderBrandIcon } from './QuotaBrandIcons'

const PROVIDER_NAMES: Record<string, string> = {
  codex: 'Codex',
  gemini: 'Antigravity',
  grok: 'Grok',
  glm: 'GLM',
  kimi: 'Kimi Code',
  cursor: 'Cursor',
}

function sourceLabel(source: string): string {
  if (source === 'official_api') return '官方接口'
  if (source === 'local_session') return '本地会话'
  if (source === 'local_cli') return '本地 CLI'
  if (source === 'manual') return '手动录入'
  return '未读取'
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
        <h2 className="text-lg font-bold text-workbench-text tracking-tight">账号额度（预览）</h2>
        <Link
          href="/quotas"
          className="text-xs font-medium text-workbench-accent hover:underline flex items-center gap-1"
        >
          <span>查看全部</span>
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
              <div className="w-8 h-8 rounded-lg bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-28 bg-gray-200 rounded" />
                <div className="h-2 w-full bg-gray-100 rounded-full" />
              </div>
              <div className="w-16 h-3.5 bg-gray-200 rounded" />
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
          暂无账号额度信息，前往{' '}
          <Link href="/quotas" className="text-workbench-accent hover:underline font-medium">
            账号额度
          </Link>{' '}
          配置
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
            const windowTag = readIssue && remainingPercent !== null
              ? '上次成功'
              : windowName.includes('5') || windowName.includes('300')
              ? '5小时窗口'
              : windowName.includes('week') || windowName.includes('10080')
              ? '周窗口'
              : p.wallets?.length
              ? '钱包余额'
              : '额度窗口'

            // Status label & color
            let statusBadge = null
            if (readIssue && remainingPercent !== null) {
              statusBadge = (
                <span className="text-xs font-semibold text-amber-600 font-mono">
                  旧值 · 剩余 {remainingPercent}%
                </span>
              )
            } else if (p.stale || p.status === 'stale') {
              statusBadge = <span className="text-xs text-amber-600 font-medium">沿用旧值</span>
            } else if (p.status === 'partial') {
              statusBadge = <span className="text-xs text-amber-600 font-medium">部分可读</span>
            } else if (p.status === 'not_configured') {
              statusBadge = <span className="text-xs text-gray-500 font-medium">待登录</span>
            } else if (p.status === 'auth_error') {
              statusBadge = <span className="text-xs text-red-600 font-medium">授权失效</span>
            } else if (p.status === 'network_error') {
              statusBadge = <span className="text-xs text-amber-600 font-medium">网络异常</span>
            } else if (p.status === 'exhausted') {
              statusBadge = <span className="text-xs text-red-600 font-medium">已耗尽 (剩余 0%)</span>
            } else if (remainingPercent !== null) {
              const tone =
                remainingPercent <= 10
                  ? 'text-red-600'
                  : remainingPercent <= 30
                  ? 'text-amber-600'
                  : 'text-workbench-accent'
              statusBadge = (
                <span className={`text-xs font-semibold ${tone} font-mono`}>
                  剩余 {remainingPercent}%
                </span>
              )
            } else {
              statusBadge = <span className="text-xs text-gray-500 font-medium">{sourceLabel(p.source)}</span>
            }

            return (
              <Link
                key={p.provider}
                href="/quotas"
                className="flex items-center justify-between py-2 px-2 -mx-2 rounded-lg hover:bg-black/[0.03] transition-colors group cursor-pointer"
                title={`查看 ${PROVIDER_NAMES[p.provider] || p.provider} 额度详情`}
              >
                {/* Left: Brand icon + Name + Status */}
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <ProviderBrandIcon provider={p.provider} className="size-7 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-workbench-text truncate group-hover:text-workbench-accent transition-colors">
                      {PROVIDER_NAMES[p.provider] || p.provider}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      {statusBadge}
                      {!readIssue && (p.source === 'manual' || p.error) && (
                        <span className="text-[11px] text-workbench-text-muted">{p.error ? '读取失败' : sourceLabel(p.source)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Progress bar & Window Tag */}
                <div className="flex flex-col items-end gap-1.5 w-36 shrink-0">
                  <span className="text-[11px] text-workbench-text-muted">{windowTag}</span>
                  {remainingPercent !== null ? (
                    <div className="w-full h-1.5 bg-workbench-border/80 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          readIssue
                            ? 'bg-amber-500'
                            : remainingPercent <= 10
                            ? 'bg-red-500'
                            : remainingPercent <= 30
                            ? 'bg-amber-500'
                            : 'bg-workbench-accent'
                        }`}
                        style={{ width: `${remainingPercent}%` }}
                      />
                    </div>
                  ) : (
                    <div className="w-full h-1.5 bg-gray-100 rounded-full" />
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
