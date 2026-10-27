'use client'

import React from 'react'
import type { ProviderQuotaSnapshot, QuotaWindow, ProviderId } from '@/lib/quotas/types'
import { useLang } from '@/lib/LanguageContext'
import { t as translate, type Lang } from '@/lib/i18n'
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
}

const DEFAULT_ACCOUNTS: Record<string, { zh: string; en: string }> = {
  codex: { zh: '个人账户', en: 'Personal Account' },
  gemini: { zh: 'Google 账号', en: 'Google Account' },
  grok: { zh: 'X Premium+', en: 'X Premium+' },
  glm: { zh: 'GLM 订阅', en: 'GLM Subscription' },
  kimi: { zh: 'Kimi 账号', en: 'Kimi Account' },
  cursor: { zh: 'Cursor 账号', en: 'Cursor Account' },
  kiro: { zh: 'Kiro 账号', en: 'Kiro Account' },
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

function formatAmount(amount: number, currency: string): string {
  if (currency === 'credits' || currency === 'credit') {
    const abs = Math.abs(amount)
    const text = abs >= 100 ? abs.toFixed(0) : abs.toFixed(2)
    return `${amount < 0 ? '-' : ''}${text} cr`
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
  const isGeminiLoggedInNoQuota = provider === 'gemini' && snapshot.status === 'unsupported' && snapshot.windows.length === 0

  const hasWindows = snapshot.windows.length > 0
  const canRetry = Boolean(onRetry && (snapshot.error || snapshot.stale || snapshot.action?.kind === 'retry'))
  const metaItems = [
    t('quota.meta.source', { source: translate(`quota.source.${snapshot.source}` as never, lang) }),
    t('quota.meta.lastSuccess', { time: formatTime(snapshot.lastSuccessAt, lang) }),
  ]
  const err = errorText(snapshot, lang)

  return (
    <div
      className="py-3.5 px-4 sm:px-6 transition-colors hover:bg-eva-panel/20"
      data-provider={snapshot.provider}
    >
      {/* 桌面端 4 列布局 */}
      <div className="grid grid-cols-1 gap-y-3 sm:grid-cols-[130px_150px_160px_1fr] sm:items-center sm:gap-x-4">
        {/* Column 1: 服务 (Service) */}
        <div className="flex items-center gap-2.5 min-w-0">
          <ProviderBrandIcon provider={provider} className="size-7 shrink-0" />
          <span className="text-sm font-semibold text-eva-text truncate">{name}</span>
        </div>

        {/* Column 2: 账号 / 产品 (Account / Product) */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="text-xs font-mono text-eva-text truncate">{accountText}</span>
          {wallet && (
            <span className="inline-flex items-center gap-1 rounded border border-eva-border/60 bg-eva-panel/60 px-1.5 py-0.5 text-[10px] font-mono text-status-success shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
              {translate(`quota.wallet.${wallet.label}` as never, lang) || '钱包'} {formatAmount(wallet.balance, wallet.currency)}
            </span>
          )}
        </div>

        {/* Column 3: 连接状态 (Connection Status) */}
        <div className="flex flex-col gap-1 min-w-0">
          {snapshot.stale ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-warning/40 bg-status-warning/10 px-2.5 py-0.5 text-xs font-mono text-status-warning hover:border-status-warning/70 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-status-warning" />
              {t('quota.status.stale')}
            </button>
          ) : snapshot.status === 'exhausted' ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-danger/40 bg-status-danger/10 px-2.5 py-0.5 text-xs font-mono text-status-danger hover:border-status-danger/70 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-status-danger" />
              {t('quota.status.exhausted')}
            </button>
          ) : snapshot.status === 'critical' ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-danger/30 bg-status-danger/10 px-2.5 py-0.5 text-xs font-mono text-status-danger hover:border-status-danger/60 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-status-danger" />
              {t('quota.status.critical')}
            </button>
          ) : snapshot.status === 'warning' ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-warning/30 bg-status-warning/10 px-2.5 py-0.5 text-xs font-mono text-status-warning hover:border-status-warning/60 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-status-warning" />
              {t('quota.status.warning')}
            </button>
          ) : isCodexLoggedInNoData ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              title="已登录 Codex · 完成一次对话后即可读取额度"
              className="inline-flex items-center gap-1.5 rounded-full border border-status-success/30 bg-status-success/10 px-2.5 py-0.5 text-[11px] font-mono text-status-success hover:border-status-success/60 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-status-success" />
              {t('quota.status.codexNoData')}
            </button>
          ) : snapshot.status === 'healthy' ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              title={t('quota.action.connectedTitle')}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-success/30 bg-status-success/10 px-2.5 py-0.5 text-xs font-mono text-status-success hover:border-status-success/60 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-status-success" />
              {t('quota.status.connected')}
            </button>
          ) : isGeminiLoggedInNoQuota ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              title={t('quota.error.gemini.unsupported')}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-success/30 bg-status-success/10 px-2.5 py-0.5 text-[11px] font-mono text-status-success hover:border-status-success/60 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-status-success" />
              {t('quota.status.geminiNoQuota')}
            </button>
          ) : isGrokCliLoggedIn ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              title={t('quota.action.grokReauthTitle')}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-success/30 bg-status-success/10 px-2.5 py-0.5 text-[11px] font-mono text-status-success hover:border-status-success/60 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-status-success" />
              {t('quota.status.grokLoggedIn')}
            </button>
          ) : isGrokUnsupported ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-warning/40 bg-status-warning/10 px-2.5 py-0.5 text-[11px] font-mono text-status-warning hover:border-status-warning/70 transition-colors w-fit"
            >
              <span className="flex size-3.5 items-center justify-center rounded-full bg-status-warning/20 text-[10px] font-bold">?</span>
              {t('quota.status.grokUnsupported')}
            </button>
          ) : snapshot.status === 'auth_error' ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-danger/30 bg-status-danger/10 px-2.5 py-0.5 text-xs font-mono text-status-danger hover:border-status-danger/60 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-status-danger" />
              {t('quota.status.auth_error')} · {t('quota.action.reauth')}
            </button>
          ) : snapshot.status === 'not_configured' ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              className="inline-flex items-center gap-1.5 rounded-full border border-eva-purple/40 bg-eva-purple/10 px-2.5 py-0.5 text-xs font-mono text-eva-purple hover:bg-eva-purple/20 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-eva-purple" />
              {t('quota.action.connect')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-warning/30 bg-status-warning/10 px-2.5 py-0.5 text-xs font-mono text-status-warning hover:border-status-warning/60 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-status-warning" />
              {t(`quota.status.${snapshot.status}` as never)}
            </button>
          )}

          {snapshot.stale && snapshot.lastSuccessAt && (
            <span className="text-[10px] font-mono text-status-warning">
              {t('quota.staleNote', { time: formatClock(snapshot.lastSuccessAt) })}
            </span>
          )}
          <span className="text-[10px] font-mono leading-snug text-eva-text-dim">
            {metaItems.join(' · ')}
          </span>
          {err && (
            <span className="text-[10px] font-mono leading-snug text-status-warning">
              {t('quota.meta.error', { error: err })}
            </span>
          )}
          {snapshot.retryAfterAt && snapshot.retryAfterAt > now && (
            <span className="text-[10px] font-mono leading-snug text-status-warning">
              {t('quota.meta.retryAt', { time: formatTime(snapshot.retryAfterAt, lang) })}
            </span>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={() => onRetry?.(provider)}
              className="inline-flex w-fit items-center gap-1 rounded border border-eva-border/70 px-2 py-1 text-[10px] font-mono text-eva-text-dim hover:border-eva-purple/60 hover:text-eva-text"
            >
              {t('quota.action.retryRefresh')}
            </button>
          )}
        </div>

        {/* Column 4: 额度使用 / 操作 (Quota Usage / Action) */}
        <div className="min-w-0">
          {hasWindows ? (
            <div className="space-y-2">
              {snapshot.windows.map((win) => {
                const percent = typeof win.usedPercent === 'number' ? win.usedPercent : undefined
                const reset = formatReset(win.resetsAt, now, lang)
                const colors = percentColor(percent)
                const clamped = typeof percent === 'number' ? Math.max(2, Math.min(100, percent)) : 0

                const displayPercent = typeof percent === 'number' ? Math.round(percent) : undefined

                return (
                  <div
                    key={win.id}
                    className="grid grid-cols-[minmax(5.5rem,7.5rem)_minmax(3rem,1fr)_4.75rem_minmax(6.5rem,8.5rem)] items-center gap-x-2 text-xs"
                  >
                    {/* 窗口名称 */}
                    <span className="truncate font-medium text-eva-text-dim" title={windowLabel(win, lang)}>
                      {windowLabel(win, lang)}
                    </span>

                    {/* 进度条 */}
                    {typeof displayPercent === 'number' ? (
                      <>
                        <div
                          role="progressbar"
                          aria-label={`${name} ${windowLabel(win, lang)}`}
                          aria-valuenow={displayPercent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          className="h-1.5 min-w-[3rem] overflow-hidden rounded-full bg-eva-border/60"
                        >
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
                            style={{ width: `${clamped}%` }}
                          />
                        </div>

                        {/* 百分比：整数、单行，避免「27.2% / 已用」折行 */}
                        <span className={`whitespace-nowrap text-right font-mono font-medium tabular-nums ${colors.text}`}>
                          {t('quota.used', { p: displayPercent })}
                        </span>
                      </>
                    ) : typeof win.used === 'number' && typeof win.limit === 'number' ? (
                      <span className="col-span-2 font-mono text-eva-text text-xs whitespace-nowrap">
                        {t('quota.rawUsage', { used: win.used, limit: win.limit })}
                      </span>
                    ) : win.unit === 'credit' && typeof win.used === 'number' ? (
                      <span className="col-span-2 font-mono text-eva-text text-xs whitespace-nowrap">
                        {t('quota.creditsUsed', { used: win.used })}
                      </span>
                    ) : (
                      <span className="col-span-2 font-mono text-eva-text-dim text-xs">{t('quota.noLimit')}</span>
                    )}

                    {/* 重置倒计时 */}
                    {reset && (
                      <span className="whitespace-nowrap text-right font-mono text-[11px] text-eva-text-dim">
                        {reset}
                      </span>
                    )}
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
                  className="pressable control-surface inline-flex items-center gap-1 px-3 py-1.5 text-xs font-mono text-eva-text hover:text-eva-text"
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
                  className="pressable control-surface inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono text-eva-purple hover:border-eva-purple/60"
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
                  className="pressable control-surface inline-flex items-center px-3 py-1.5 text-xs font-mono"
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
    <div className="py-3.5 px-4 sm:px-6" data-provider={provider}>
      <div className="grid grid-cols-1 gap-y-2 sm:grid-cols-[130px_150px_160px_1fr] sm:items-center sm:gap-x-4">
        <div className="flex items-center gap-2.5">
          <span className="size-7 shrink-0 animate-pulse rounded-lg bg-eva-border/50" />
          <span className="text-sm font-semibold text-eva-text-dim">{name}</span>
        </div>
        <div className="h-4 w-20 animate-pulse rounded bg-eva-border/40" />
        <div className="h-5 w-24 animate-pulse rounded-full bg-eva-border/30" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-eva-border/40" />
      </div>
    </div>
  )
}
