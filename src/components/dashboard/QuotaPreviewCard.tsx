'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import type { QuotasResponse, ProviderQuotaSnapshot, QuotaWindow } from '@/lib/quotas/types'
import { ProviderBrandIcon } from './QuotaBrandIcons'

const PROVIDER_NAMES: Record<string, string> = {
  codex: 'Codex',
  gemini: 'Antigravity',
  grok: 'Grok',
  glm: 'GLM',
  kimi: 'Kimi Code',
}

export function QuotaPreviewCard({ className = '' }: { className?: string }) {
  const [data, setData] = useState<QuotasResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    const fetchQuotas = async () => {
      try {
        const res = await fetch('/api/quotas', { cache: 'no-store' })
        if (res.ok && mounted) {
          const json: QuotasResponse = await res.json()
          setData(json)
        }
      } catch {
        // silent fail - keep previous snapshot
      } finally {
        if (mounted) setLoading(false)
      }
    }
    fetchQuotas()
    return () => {
      mounted = false
    }
  }, [])

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
            const windowTag = windowName.includes('5') || windowName.includes('300')
              ? '5小时窗口'
              : windowName.includes('week') || windowName.includes('10080')
              ? '周窗口'
              : p.wallets?.length
              ? '钱包余额'
              : '额度窗口'

            // Status label & color
            let statusBadge = null
            if (p.status === 'not_configured') {
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
              statusBadge = <span className="text-xs text-emerald-700 font-medium">已连接</span>
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
                    <div>{statusBadge}</div>
                  </div>
                </div>

                {/* Right: Progress bar & Window Tag */}
                <div className="flex flex-col items-end gap-1.5 w-36 shrink-0">
                  <span className="text-[11px] text-workbench-text-muted">{windowTag}</span>
                  {remainingPercent !== null ? (
                    <div className="w-full h-1.5 bg-workbench-border/80 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          remainingPercent <= 10
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
    </div>
  )
}
