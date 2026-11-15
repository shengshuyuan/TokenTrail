'use client'

import React from 'react'
import type { ProviderQuotaSnapshot, QuotaWindow, ProviderId } from '@/lib/quotas/types'
import { useLang } from '@/lib/LanguageContext'
import { t as translate, type Lang } from '@/lib/i18n'
import { Button } from '@/components/ui/Button'
import { ProviderBrandIcon } from './QuotaBrandIcons'

// ─── Provider 显示名 ─────────────────────────────────────────

const PROVIDER_NAMES: Record<string, { zh: string; en: string }> = {
  codex: { zh: 'Codex', en: 'Codex' },
  gemini: { zh: 'Antigravity', en: 'Antigravity' },
  grok: { zh: 'Grok', en: 'Grok' },
  glm: { zh: 'GLM', en: 'GLM' },
  kimi: { zh: 'Kimi', en: 'Kimi' },
  cursor: { zh: 'Cursor', en: 'Cursor' },
  kiro: { zh: 'Kiro CLI', en: 'Kiro CLI' },
  workbuddy: { zh: 'WorkBuddy', en: 'WorkBuddy' },
}

const DEFAULT_ACCOUNTS: Record<string, { zh: string; en: string }> = {
  codex: { zh: '个人账户', en: 'Personal Account' },
  gemini: { zh: 'Google 账号', en: 'Google Account' },
  grok: { zh: 'X Premium+', en: 'X Premium+' },
  glm: { zh: 'GLM 订阅', en: 'GLM Subscription' },
  kimi: { zh: 'Kimi 账号', en: 'Kimi Account' },
  cursor: { zh: 'Cursor 账号', en: 'Cursor Account' },
  kiro: { zh: 'Kiro 账号', en: 'Kiro Account' },
  workbuddy: { zh: 'WorkBuddy 账号', en: 'WorkBuddy Account' },
}

// ─── 时间格式化 ──────────────────────────────────────────────

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatTime(ts: number | undefined, lang: Lang): string {
  if (!ts) return translate('quota.time.none', lang)
  const d = new Date(ts)
  const date = lang === 'zh'
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${date} ${formatClock(ts)}`
}

function formatReset(resetsAt: number | undefined, now: number, lang: Lang): string | null {
  if (!resetsAt) return null
  const diff = resetsAt - now
  if (diff <= 0) return translate('quota.resetDone', lang)
  if (diff < 48 * 3600_000) {
    const hours = Math.floor(diff / 3600_000)
    const minutes = Math.floor((diff % 3600_000) / 60_000)
    const d =
      hours > 0
        ? lang === 'zh'
          ? `${hours} 小时 ${minutes} 分`
          : `${hours}h ${minutes}m`
        : lang === 'zh'
          ? `${minutes} 分钟`
          : `${minutes}m`
    return translate('quota.resetIn', lang, { d })
  }
  const date = new Date(resetsAt)
  // 超过一周（如 Cursor 的月度计费周期）只写星期几会有歧义，改为具体日期
  const day = diff >= 7 * 86400_000
    ? lang === 'zh'
      ? `${date.getMonth() + 1}/${date.getDate()}`
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : lang === 'zh'
      ? WEEKDAYS_ZH[date.getDay()]
      : date.toLocaleDateString('en-US', { weekday: 'short' })
  return translate('quota.resetAt', lang, { d: day, time: formatClock(resetsAt) })
}

// ─── 窗口标签友好化 ──────────────────────────────────────────

function windowLabel(win: QuotaWindow, lang: Lang): string {
  const rawId = (win.id || '').toLowerCase()
  const rawLabel = (win.label || '').toLowerCase()

  // Kiro CLI credits 窗口
  if (rawId === 'kiro-credit') return lang === 'zh' ? '本期 Credits' : 'Credits'
  if (rawId.startsWith('kiro-credit-trial')) return lang === 'zh' ? '新手赠送' : 'Welcome bonus'
  if (rawId.startsWith('kiro-credit-bonus')) return win.label || (lang === 'zh' ? '赠送额度' : 'Bonus')
  if (rawId === 'kiro-today') return lang === 'zh' ? '今日消耗' : 'Today'

  // WorkBuddy：只有已消耗（官方余额在网页里，本地读不到）
  if (rawId === 'workbuddy-today') return lang === 'zh' ? '今日消耗' : 'Today'
  if (rawId === 'workbuddy-week') return lang === 'zh' ? '近 7 天' : 'Last 7 days'
  if (rawId === 'workbuddy-month') return lang === 'zh' ? '本月消耗' : 'This month'

  // Cursor 月度计费周期
  if (rawId === 'cursor-api') return translate('quota.window.cursorApi', lang)
  if (rawId === 'cursor-auto') return translate('quota.window.cursorAuto', lang)
  if (rawId === 'cursor-total') return translate('quota.window.cursorTotal', lang)
  if (rawId === 'cursor-on-demand') return translate('quota.window.cursorOnDemand', lang)

  // Antigravity (Gemini Models & Claude/GPT Models)
  if (rawId.startsWith('gemini-models-') || rawLabel.startsWith('gemini models')) {
    if (win.windowMinutes === 300 || rawId.includes('5h') || rawLabel.includes('5h')) {
      return lang === 'zh' ? 'Gemini · 5h' : 'Gemini · 5h'
    }
    if (win.windowMinutes === 10080 || rawId.includes('week') || rawLabel.includes('week')) {
      return lang === 'zh' ? 'Gemini · 周' : 'Gemini · Week'
    }
    return `Gemini · ${win.label || 'Quota'}`
  }

  if (rawId.startsWith('claude-and-gpt-models-') || rawId.startsWith('claude-gpt-') || rawLabel.startsWith('claude and gpt')) {
    if (win.windowMinutes === 300 || rawId.includes('5h') || rawLabel.includes('5h')) {
      return lang === 'zh' ? 'Claude/GPT · 5h' : 'Claude/GPT · 5h'
    }
    if (win.windowMinutes === 10080 || rawId.includes('week') || rawLabel.includes('week')) {
      return lang === 'zh' ? 'Claude/GPT · 周' : 'Claude/GPT · Week'
    }
    return `Claude/GPT · ${win.label || 'Quota'}`
  }

  if (rawId.includes('pro') || rawLabel.includes('pro')) {
    return translate('quota.window.pro', lang)
  }
  if (rawId.includes('flash') || rawLabel.includes('flash')) {
    return translate('quota.window.flash', lang)
  }
  if (win.windowMinutes === 300 || rawId === '5h' || rawLabel === '5h' || rawId.includes('300')) {
    return translate('quota.window.5h', lang)
  }
  if (win.windowMinutes === 10080 || rawId === 'week' || rawLabel === 'week' || rawId.includes('10080')) {
    return translate('quota.window.week', lang)
  }
  if (win.windowMinutes === 1440 || rawId === 'day' || rawLabel === 'day') {
    return translate('quota.window.day', lang)
  }
  if (typeof win.windowMinutes === 'number' && win.windowMinutes > 0) {
    if (win.windowMinutes % 60 === 0) return lang === 'zh' ? `${win.windowMinutes / 60} 小时` : `${win.windowMinutes / 60}h`
    return lang === 'zh' ? `${win.windowMinutes} 分钟` : `${win.windowMinutes}m`
  }
  return win.label || '额度'
}

function percentColor(percent: number | undefined): { bar: string; text: string } {
  if (typeof percent !== 'number') return { bar: 'bg-status-success', text: 'text-eva-text' }
  if (percent >= 95) return { bar: 'bg-status-danger', text: 'text-status-danger' }
  if (percent >= 80) return { bar: 'bg-status-warning', text: 'text-status-warning' }
  return { bar: 'bg-status-success', text: 'text-eva-text' }
}

function formatCreditNumber(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
  return `${amount < 0 ? '-' : ''}${text}`
}

/** 已消耗积分不是官方额度窗口：近 7 天滚动统计，今天和本月到点重新计。 */
function spendHint(win: QuotaWindow, now: number, lang: Lang): string {
  if (win.id === 'workbuddy-week') return translate('quota.spend.rolling7', lang)
  if (!win.resetsAt || win.resetsAt <= now) return translate('quota.spend.recounted', lang)
  const diff = win.resetsAt - now
  if (diff < 48 * 3600_000) {
    const hours = Math.floor(diff / 3600_000)
    const minutes = Math.floor((diff % 3600_000) / 60_000)
    const d = hours > 0
      ? lang === 'zh' ? `${hours} 小时 ${minutes} 分` : `${hours}h ${minutes}m`
      : lang === 'zh' ? `${minutes} 分钟` : `${minutes}m`
    return translate('quota.spend.recountIn', lang, { d })
  }
  const date = new Date(win.resetsAt)
  const day = diff >= 7 * 86400_000
    ? lang === 'zh'
      ? `${date.getMonth() + 1}/${date.getDate()}`
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : lang === 'zh'
      ? WEEKDAYS_ZH[date.getDay()]
      : date.toLocaleDateString('en-US', { weekday: 'short' })
  return translate('quota.spend.recountAt', lang, { d: day, time: formatClock(win.resetsAt) })
}

function formatAmount(amount: number, currency: string): string {
  if (currency === 'credits' || currency === 'credit') {
    return `${formatCreditNumber(amount)} cr`
  }
  const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : `${currency} `
  const abs = Math.abs(amount)
  const text = abs >= 100 ? abs.toFixed(0) : abs.toFixed(2)
  return `${amount < 0 ? '-' : ''}${symbol}${text}`
}

function errorText(snapshot: ProviderQuotaSnapshot, lang: Lang): string | null {
  const code = snapshot.error?.code
  if (!code) return null
  return translate(`quota.error.${code}` as never, lang)
}

// ─── 组件 ────────────────────────────────────────────────────

interface QuotaProviderRowProps {
  snapshot: ProviderQuotaSnapshot
  onRetry?: (provider: ProviderId) => void
  onManualClick?: (provider: ProviderId) => void
}

export function QuotaProviderRow({ snapshot, onRetry, onManualClick }: QuotaProviderRowProps) {
  const { lang, t } = useLang()
  const now = Date.now()
  const provider = snapshot.provider
  const name = PROVIDER_NAMES[provider]?.[lang] ?? provider

  // 账号 / 产品标签
  const accountText =
    snapshot.planLabel ||
    snapshot.accountLabel ||
    DEFAULT_ACCOUNTS[provider]?.[lang] ||
    t(`quota.product.${snapshot.product}` as never)

  // 钱包余额（如 Kimi 加油包）
  const wallet = snapshot.wallets?.[0]

  // 连接状态
  const isConnected =
    ['healthy', 'warning', 'critical', 'exhausted'].includes(snapshot.status) ||
    (snapshot.windows.length > 0 && snapshot.status !== 'auth_error' && snapshot.status !== 'not_configured')

  const isGrokUnsupported = provider === 'grok' && snapshot.status === 'unsupported' && snapshot.windows.length === 0
  const isGrokCliLoggedIn = isGrokUnsupported && snapshot.source === 'local_cli'
  const isCodexLoggedInNoData = provider === 'codex' && snapshot.error?.code === 'no_data' && snapshot.windows.length === 0
  const isWorkbuddyNoData = provider === 'workbuddy' && snapshot.error?.code === 'no_data' && snapshot.windows.length === 0
  const isGeminiLoggedInNoQuota = provider === 'gemini' && snapshot.status === 'unsupported' && snapshot.windows.length === 0

  const hasWindows = snapshot.windows.length > 0
  const canRetry = Boolean(onRetry && (snapshot.error || snapshot.stale || snapshot.action?.kind === 'retry'))
  const metaItems = [
    t('quota.meta.source', { source: translate(`quota.source.${snapshot.source}` as never, lang) }),
    t('quota.meta.lastSuccess', { time: formatTime(snapshot.lastSuccessAt, lang) }),
  ]
  const err = errorText(snapshot, lang)

  const calmStatus =
    snapshot.status === 'healthy' || isCodexLoggedInNoData || isWorkbuddyNoData || isGeminiLoggedInNoQuota || isGrokCliLoggedIn
  // 完全没读到窗口时，优先显示「去连接」，不要再叠一条「数据过期」。
  const staleWithData = Boolean(snapshot.stale && hasWindows)
  const statusTone = staleWithData
    ? 'warn'
    : snapshot.status === 'exhausted' || snapshot.status === 'critical' || snapshot.status === 'auth_error'
    ? 'bad'
    : snapshot.status === 'not_configured'
    ? 'neutral'
    : calmStatus
    ? 'ok'
    : 'warn'
  const statusLabel = staleWithData
    ? t('quota.status.stale')
    : isCodexLoggedInNoData
    ? t('quota.status.codexNoData')
    : isWorkbuddyNoData
    ? t('quota.error.no_data')
    : isGeminiLoggedInNoQuota
    ? t('quota.status.geminiNoQuota')
    : isGrokCliLoggedIn
    ? t('quota.status.grokLoggedIn')
    : isGrokUnsupported
    ? t('quota.status.grokUnsupported')
    : snapshot.status === 'healthy'
    ? t('quota.status.connected')
    : snapshot.status === 'auth_error'
    ? `${t('quota.status.auth_error')} · ${t('quota.action.reauth')}`
    : snapshot.status === 'not_configured'
    ? t('quota.action.connect')
    : t(`quota.status.${snapshot.status}` as never)
  const statusClass = {
    ok: 'border-status-success/35 bg-status-success/10 text-status-success',
    warn: 'border-status-warning/40 bg-status-warning/10 text-status-warning',
    bad: 'border-status-danger/40 bg-status-danger/10 text-status-danger',
    neutral: 'border-workbench-border bg-workbench-sidebar text-workbench-text-muted',
  }[statusTone]

  return (
    <div
      className="surface-row px-4 py-4 transition-colors sm:px-6"
      data-provider={snapshot.provider}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
        <div className="min-w-0 lg:w-56 lg:shrink-0">
          <div className="flex items-start gap-2.5">
            <ProviderBrandIcon provider={provider} className="size-8 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-workbench-text">{name}</span>
                <button
                  type="button"
                  onClick={() => onManualClick?.(provider)}
                  title={statusLabel}
                  className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40 ${statusClass}`}
                >
                  <span className={`size-1.5 shrink-0 rounded-full ${statusTone === 'neutral' ? 'bg-workbench-text-muted' : 'bg-current'}`} />
                  <span className="truncate">{statusLabel}</span>
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-workbench-text-muted">
                <span className="truncate">{accountText}</span>
                {wallet && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-workbench-border/70 bg-workbench-sidebar px-1.5 py-0.5 font-mono text-[11px] text-status-success">
                    {translate(`quota.wallet.${wallet.label}` as never, lang) || (lang === 'zh' ? '钱包' : 'Wallet')} {formatAmount(wallet.balance, wallet.currency)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-workbench-text-muted">
            {metaItems.join(' · ')}
            {staleWithData && snapshot.lastSuccessAt ? ` · ${t('quota.staleNote', { time: formatClock(snapshot.lastSuccessAt) })}` : ''}
          </p>
          {err && snapshot.error?.code !== snapshot.status && (
            <p className="mt-1 text-[11px] leading-relaxed text-status-warning">
              {t('quota.meta.error', { error: err })}
            </p>
          )}
          {snapshot.retryAfterAt && snapshot.retryAfterAt > now && (
            <p className="mt-1 text-[11px] text-status-warning">
              {t('quota.meta.retryAt', { time: formatTime(snapshot.retryAfterAt, lang) })}
            </p>
          )}
          {canRetry && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => onRetry?.(provider)}>
              {t('quota.action.retryRefresh')}
            </Button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {snapshot.provider === 'workbuddy' && hasWindows ? (
            <div>
              <div className="grid grid-cols-3 gap-2">
                {snapshot.windows.map((win) => {
                  const label = windowLabel(win, lang)
                  const used = typeof win.used === 'number' ? formatCreditNumber(win.used) : '—'
                  const hint = spendHint(win, now, lang)
                  return (
                    <div key={win.id} className="min-w-0 rounded-lg border border-workbench-border/70 px-3 py-2">
                      <div className="truncate text-[11px] text-workbench-text-muted" title={label}>{label}</div>
                      <div className="mt-1 flex items-baseline gap-1">
                        <span className="truncate font-mono text-sm font-medium tabular-nums text-workbench-text">{used}</span>
                        <span className="shrink-0 text-[11px] text-workbench-text-muted">{t('quota.spend.credits')}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] leading-tight text-workbench-text-muted" title={hint}>{hint}</div>
                    </div>
                  )
                })}
              </div>
              {snapshot.action?.url && (
                <a
                  href={snapshot.action.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-flex min-h-7 items-center text-[11px] font-medium text-workbench-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40"
                >
                  {t('quota.action.workbuddyCredits')}
                </a>
              )}
            </div>
          ) : hasWindows ? (
            <div className="space-y-2.5">
              {snapshot.windows.map((win) => {
                const percent = typeof win.usedPercent === 'number' ? win.usedPercent : undefined
                const reset = formatReset(win.resetsAt, now, lang)
                const colors = percentColor(percent)
                const clamped = typeof percent === 'number'
                  ? percent <= 0 ? 0 : Math.max(2, Math.min(100, percent))
                  : 0
                const displayPercent = typeof percent === 'number' ? Math.round(percent) : undefined
                const label = windowLabel(win, lang)
                const valueText = typeof displayPercent === 'number'
                  ? t('quota.used', { p: displayPercent })
                  : typeof win.used === 'number' && typeof win.limit === 'number'
                  ? t('quota.rawUsage', { used: win.used, limit: win.limit })
                  : win.unit === 'credit' && typeof win.used === 'number'
                  ? t('quota.creditsUsed', { used: win.used })
                  : typeof win.limit === 'number'
                  ? t('quota.rawUsage', { used: '—', limit: win.limit })
                  : typeof win.used === 'number'
                  ? t('quota.rawUsed', { used: win.used })
                  : t('quota.noLimit')

                return (
                  <div key={win.id} className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-workbench-text" title={label}>
                        {label}
                      </div>
                      {reset && (
                        <div className="mt-0.5 truncate text-[11px] leading-tight text-workbench-text-muted" title={reset}>
                          {reset}
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 items-center gap-3">
                      {typeof displayPercent === 'number' && (
                        <div
                          role="progressbar"
                          aria-label={`${name} ${label}`}
                          aria-valuenow={displayPercent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-eva-text/20"
                        >
                          <div
                            className={`h-full rounded-full ${colors.bar}`}
                            style={{ width: `${clamped}%` }}
                          />
                        </div>
                      )}
                      <div className={`shrink-0 text-right font-mono text-xs tabular-nums whitespace-nowrap ${typeof displayPercent === 'number' ? `font-medium ${colors.text}` : 'text-workbench-text-muted'}`}>
                        {valueText}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
              {snapshot.action?.kind === 'open_url' && snapshot.action.url && (
                <a
                  href={snapshot.action.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-workbench-border px-3 text-xs font-medium text-workbench-text hover:bg-workbench-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40"
                >
                  {t('quota.action.openUrl')}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                  </svg>
                </a>
              )}
              {onManualClick && (
                <button
                  type="button"
                  onClick={() => onManualClick(provider)}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-workbench-accent/40 px-3 text-xs font-medium text-workbench-accent hover:bg-workbench-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  {t('quota.action.configure')}
                </button>
              )}
              {snapshot.action?.kind === 'retry' && onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(provider)}
                  className="inline-flex min-h-8 items-center rounded-lg border border-workbench-border px-3 text-xs font-medium text-workbench-text hover:bg-workbench-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40"
                >
                  {t('quota.action.retryRefresh')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 骨架屏 */
export function QuotaProviderRowSkeleton({ provider }: { provider: string }) {
  const { lang } = useLang()
  const name = PROVIDER_NAMES[provider]?.[lang] ?? provider
  return (
    <div className="px-4 py-4 sm:px-6" data-provider={provider}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2.5 lg:w-56">
          <span className="size-8 shrink-0 animate-pulse rounded-lg bg-workbench-border/70" />
          <span className="text-sm font-semibold text-workbench-text-muted">{name}</span>
        </div>
        <div className="h-2 flex-1 animate-pulse rounded-full bg-workbench-border/60" />
      </div>
    </div>
  )
}
