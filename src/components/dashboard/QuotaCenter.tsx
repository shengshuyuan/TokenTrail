'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { QuotasResponse, QuotaStatus, ProviderId } from '@/lib/quotas/types'
import { useLang } from '@/lib/LanguageContext'
import { QuotaProviderRow, QuotaProviderRowSkeleton } from './QuotaProviderRow'
import { QuotaGaugeIcon } from './QuotaBrandIcons'
import { QuotaManualModal } from './QuotaManualModal'

// ─── 常量 ────────────────────────────────────────────────────

const PROVIDER_IDS = ['codex', 'gemini', 'grok', 'glm', 'kimi'] as const
const POLL_INTERVAL_MS = 10 * 60 * 1000 // 页面可见时每 10 分钟检查一次
const LOADING_RETRY_MS = 2000 // 弹窗打开且有 loading 时快速轮询
const LOADING_RETRY_MAX = 15

const DOT_CLASS: Record<string, string> = {
  red: 'bg-status-danger',
  yellow: 'bg-status-warning',
  green: 'bg-status-success',
  grey: 'bg-eva-text-dim/50',
}

function statusColor(status: QuotaStatus | undefined): string {
  if (!status) return 'grey'
  if (['critical', 'exhausted', 'auth_error'].includes(status)) return 'red'
  if (['warning', 'partial', 'stale', 'network_error', 'unsupported_version'].includes(status)) return 'yellow'
  if (status === 'healthy') return 'green'
  return 'grey'
}

// ─── 组件 ────────────────────────────────────────────────────

export function QuotaCenter() {
  const { lang, t } = useLang()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<QuotasResponse | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [manualModalOpen, setManualModalOpen] = useState(false)
  const [manualTargetProvider, setManualTargetProvider] = useState<ProviderId>('grok')

  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const fetchQuotas = useCallback(async () => {
    try {
      const res = await fetch('/api/quotas', { cache: 'no-store' })
      if (res.ok) setData(await res.json())
    } catch {
      // 静默失败：保留上一次数据，状态点维持原样
    }
  }, [])

  // 首次 + 可见性轮询（页面隐藏时暂停）
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null

    const startIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void fetchQuotas()
        interval ??= setInterval(() => void fetchQuotas(), POLL_INTERVAL_MS)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        startIfVisible()
      } else if (interval) {
        clearInterval(interval)
        interval = null
      }
    }

    startIfVisible()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (interval) clearInterval(interval)
    }
  }, [fetchQuotas])

  // dataRef：让轮询逻辑读取最新 data 而不重复触发 effect
  const dataRef = useRef<QuotasResponse | null>(null)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  // 弹窗打开：立即取一次
  useEffect(() => {
    if (!open) return
    let cancelled = false

    void fetchQuotas()
    const timer = setInterval(() => {
      if (cancelled) return
      const stillLoading = dataRef.current?.providers.some((p) => p.status === 'loading')
      if (stillLoading) void fetchQuotas()
    }, LOADING_RETRY_MS)
    const stopTimer = setTimeout(() => clearInterval(timer), LOADING_RETRY_MS * LOADING_RETRY_MAX)

    return () => {
      cancelled = true
      clearInterval(timer)
      clearTimeout(stopTimer)
    }
  }, [open, fetchQuotas])

  // 弹窗焦点管理
  const closeModal = useCallback(() => {
    if (manualModalOpen) return
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [manualModalOpen])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open || manualModalOpen) return

    const dialog = dialogRef.current
    const getFocusable = () =>
      dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? []
    getFocusable()[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = getFocusable()
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeModal, open, manualModalOpen])

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    setNotice(null)
    try {
      const res = await fetch('/api/quotas/refresh', { method: 'POST' })
      if (res.ok) {
        const json = await res.json()
        setData(json as QuotasResponse)
        if ((json as { throttled?: boolean }).throttled) setNotice(t('quota.refreshThrottled'))
      } else {
        setNotice(t('quota.refreshFailed'))
      }
    } catch {
      setNotice(t('quota.refreshFailed'))
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, t])

  const handleOpenManual = useCallback((provider: ProviderId = 'grok') => {
    setManualTargetProvider(provider)
    setManualModalOpen(true)
  }, [])

  const closeManualModal = useCallback(() => {
    setManualModalOpen(false)
  }, [])

  const globalStatus = data?.status
  const attention = data?.attention_count ?? 0

  const byProvider = new Map((data?.providers ?? []).map((p) => [p.provider, p]))
  const orderedProviders = PROVIDER_IDS.map((id) => byProvider.get(id)).filter(Boolean) as QuotasResponse['providers']
  const missing = PROVIDER_IDS.filter((id) => !byProvider.has(id))
  const updatedAt = data?.updated_at

  const updatedLabel = updatedAt
    ? Date.now() - updatedAt < 60_000
      ? t('quota.updatedJustNow')
      : t('quota.updatedAgo', { m: Math.round((Date.now() - updatedAt) / 60000) })
    : t('quota.updatedJustNow')

  return (
    <>
      {/* 顶部栏入口按钮 */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="pressable control-surface relative inline-flex min-h-10 shrink-0 items-center gap-2 px-3 py-1.5 text-xs font-mono active:scale-95 sm:min-h-[32px]"
      >
        <span aria-hidden className={`inline-block size-1.5 rounded-full ${DOT_CLASS[statusColor(globalStatus)]}`} />
        {t('quota.button')}
        {attention > 0 && (
          <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-status-warning text-[9px] font-bold text-black shadow-sm">
            {attention}
          </span>
        )}
      </button>

      {/* 账号额度模态框 */}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 flex items-end justify-center sm:items-center p-0 sm:p-4"
            style={{ zIndex: 200 }}
            onClick={closeModal}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal={!manualModalOpen}
              aria-hidden={manualModalOpen}
              aria-labelledby="quota-dialog-title"
              className="relative z-10 flex h-[92dvh] w-full flex-col rounded-t-2xl border border-eva-border bg-eva-bg shadow-2xl sm:mx-4 sm:h-auto sm:max-h-[85vh] sm:w-[940px] sm:max-w-[960px] sm:rounded-xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 弹窗头部 */}
              <div className="flex items-center justify-between gap-3 border-b border-eva-border px-5 py-3.5 bg-eva-panel/40">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-eva-border bg-eva-panel/80 text-eva-text">
                    <QuotaGaugeIcon className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 id="quota-dialog-title" className="theme-display text-base sm:text-lg font-semibold leading-tight text-eva-text">
                      {t('quota.title')}
                    </h2>
                    <p className="mt-0.5 truncate text-xs font-mono text-eva-text-dim">
                      {t('quota.services', { n: PROVIDER_IDS.length })}
                      {' · '}
                      {attention > 0 ? (
                        <span className="text-status-warning font-medium">
                          {t('quota.attentionLine', { n: attention })}
                        </span>
                      ) : (
                        <span className="text-status-success">{t('quota.allNormal')}</span>
                      )}
                      {' · '}
                      <span>{updatedLabel}</span>
                      <span className="ml-1.5 inline-block size-2 rounded-full bg-status-success align-middle" />
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenManual('grok')}
                    className="pressable control-surface hidden sm:inline-flex min-h-[32px] items-center gap-1.5 px-3 py-1 text-xs font-mono text-eva-purple hover:border-eva-purple/60"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    {t('quota.manual.button')}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleRefresh()}
                    disabled={refreshing}
                    aria-live="polite"
                    className="pressable control-surface inline-flex min-h-11 sm:min-h-[32px] items-center gap-1.5 px-3 py-1.5 text-xs font-mono disabled:opacity-50"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
                    >
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                    {refreshing ? t('quota.refreshing') : t('quota.refresh')}
                  </button>

                  <button
                    type="button"
                    onClick={closeModal}
                    aria-label={t('quota.close')}
                    className="pressable control-surface flex size-8 items-center justify-center rounded-lg text-eva-text-dim hover:text-eva-text"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* 刷新/节流提示 */}
              {notice && (
                <div className="border-b border-eva-border bg-status-warning/10 px-5 py-2 text-xs font-mono text-status-warning">
                  {notice}
                </div>
              )}

              {/* 表头（桌面端） */}
              <div className="hidden sm:grid grid-cols-[130px_150px_160px_1fr] items-center gap-x-4 border-b border-eva-border/60 bg-eva-panel/30 px-6 py-2.5 text-xs font-normal text-eva-text-dim">
                <div>{t('quota.col.service')}</div>
                <div>{t('quota.col.product')}</div>
                <div>{t('quota.col.status')}</div>
                <div>{t('quota.col.usage')}</div>
              </div>

              {/* Provider 列表 */}
              <div className="min-h-0 flex-1 divide-y divide-eva-border/40 overflow-y-auto overscroll-contain">
                {orderedProviders.map((snap) =>
                  snap.status === 'loading' ? (
                    <QuotaProviderRowSkeleton key={snap.provider} provider={snap.provider} />
                  ) : (
                    <QuotaProviderRow
                      key={snap.provider}
                      snapshot={snap}
                      onRetry={() => void handleRefresh()}
                      onManualClick={(p) => handleOpenManual(p)}
                    />
                  )
                )}
                {missing.map((id) => (
                  <QuotaProviderRowSkeleton key={id} provider={id} />
                ))}
              </div>

              {/* 弹窗底部图例 */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-eva-border px-5 py-3 bg-eva-panel/20 text-xs font-mono text-eva-text-dim">
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-status-success" />
                    {t('quota.legend.official')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-sky-400" />
                    {t('quota.legend.local')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-status-warning" />
                    {t('quota.legend.latency')}
                  </span>
                </div>

                <div className="inline-flex items-center gap-1.5 text-eva-text-dim/80">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {t('quota.legend.localOnly')}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 手动获取与配置模态框 */}
      <QuotaManualModal
        isOpen={manualModalOpen}
        onClose={closeManualModal}
        initialProvider={manualTargetProvider}
        onSuccess={() => {
          void fetchQuotas()
        }}
      />
    </>
  )
}
