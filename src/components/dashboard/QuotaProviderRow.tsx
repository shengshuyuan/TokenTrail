'use client'

import React from 'react'
import type { ProviderQuotaSnapshot, QuotaStatus, QuotaWindow, ProviderId } from '@/lib/quotas/types'
import { useLang } from '@/lib/LanguageContext'
import { t as translate, type Lang } from '@/lib/i18n'
import { ProviderBrandIcon } from './QuotaBrandIcons'

// ─── Provider 显示名 ─────────────────────────────────────────

const PROVIDER_NAMES: Record<string, { zh: string; en: string }> = {
  codex: { zh: 'Codex', en: 'Codex' },
  gemini: { zh: 'Gemini', en: 'Gemini' },
  grok: { zh: 'Grok', en: 'Grok' },
  glm: { zh: 'GLM', en: 'GLM' },
  kimi: { zh: 'Kimi', en: 'Kimi' },
}

const DEFAULT_ACCOUNTS: Record<string, { zh: string; en: string }> = {
  codex: { zh: '个人账户', en: 'Personal Account' },
  gemini: { zh: 'Pro', en: 'Pro' },
  grok: { zh: 'X Premium+', en: 'X Premium+' },
  glm: { zh: 'GLM 订阅', en: 'GLM Subscription' },
  kimi: { zh: 'Kimi 账号', en: 'Kimi Account' },
}

// ─── 时间格式化 ──────────────────────────────────────────────

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
  const weekday = lang === 'zh' ? WEEKDAYS_ZH[date.getDay()] : date.toLocaleDateString('en-US', { weekday: 'short' })
  return translate('quota.resetAt', lang, { d: weekday, time: formatClock(resetsAt) })
}

// ─── 窗口标签友好化 ──────────────────────────────────────────

function windowLabel(win: QuotaWindow, lang: Lang): string {
  const rawId = (win.id || '').toLowerCase()
  const rawLabel = (win.label || '').toLowerCase()

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
  const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : `${currency} `
  const abs = Math.abs(amount)
  const text = abs >= 100 ? abs.toFixed(0) : abs.toFixed(2)
  return `${amount < 0 ? '-' : ''}${symbol}${text}`
}

// ─── 组件 ────────────────────────────────────────────────────

interface QuotaProviderRowProps {
  snapshot: ProviderQuotaSnapshot
  onRetry?: () => void
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
              title="已连接 · 点击配置"
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
              title="已通过 Grok CLI 登录 · 点击重新授权或配置"
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
              {t('quota.status.auth_error')} · 重新授权
            </button>
          ) : snapshot.status === 'not_configured' ? (
            <button
              type="button"
              onClick={() => onManualClick && onManualClick(provider)}
              className="inline-flex items-center gap-1.5 rounded-full border border-eva-purple/40 bg-eva-purple/10 px-2.5 py-0.5 text-xs font-mono text-eva-purple hover:bg-eva-purple/20 transition-colors w-fit"
            >
              <span className="size-1.5 rounded-full bg-eva-purple" />
              发起授权 / 连接
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

                return (
                  <div key={win.id} className="flex items-center gap-3 text-xs">
                    {/* 窗口名称 */}
                    <span className="w-16 sm:w-20 shrink-0 font-medium text-eva-text-dim truncate">
                      {windowLabel(win, lang)}
                    </span>

                    {/* 进度条 */}
                    {typeof percent === 'number' ? (
                      <>
                        <div
                          role="progressbar"
                          aria-label={`${name} ${windowLabel(win, lang)}`}
                          aria-valuenow={Math.round(clamped)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          className="h-1.5 flex-1 min-w-[60px] overflow-hidden rounded-full bg-eva-border/60"
                        >
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
                            style={{ width: `${clamped}%` }}
                          />
                        </div>

                        {/* 百分比 */}
                        <span className={`w-16 shrink-0 font-mono text-right font-medium ${colors.text}`}>
                          {t('quota.used', { p: Math.round(percent * 10) / 10 })}
                        </span>
                      </>
                    ) : typeof win.used === 'number' && typeof win.limit === 'number' ? (
                      <span className="flex-1 font-mono text-eva-text text-xs">
                        {t('quota.rawUsage', { used: win.used, limit: win.limit })}
                      </span>
                    ) : (
                      <span className="flex-1 font-mono text-eva-text-dim text-xs">{t('quota.noLimit')}</span>
                    )}

                    {/* 重置倒计时 */}
                    {reset && (
                      <span className="w-28 sm:w-36 shrink-0 font-mono text-right text-[11px] text-eva-text-dim truncate">
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
                  发起授权 / 配置
                </button>
              )}
              {snapshot.action?.kind === 'retry' && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="pressable control-surface inline-flex items-center px-3 py-1.5 text-xs font-mono"
                >
                  {t('quota.action.retry')}
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
