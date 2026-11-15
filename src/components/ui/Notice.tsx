'use client'

import React from 'react'

type NoticeTone = 'warning' | 'info' | 'neutral'

interface NoticeProps {
  tone?: NoticeTone
  children: React.ReactNode
  action?: React.ReactNode
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
}

const TONE_CLASS: Record<NoticeTone, string> = {
  warning: 'border-status-warning/35 bg-status-warning/10 text-workbench-text',
  info: 'border-workbench-accent/30 bg-workbench-accent/10 text-workbench-text',
  neutral: 'border-workbench-border bg-workbench-sidebar/80 text-workbench-text-muted',
}

/** 页内提示条。颜色走主题变量，浅色和深色都能读。 */
export function Notice({
  tone = 'warning',
  children,
  action,
  onDismiss,
  dismissLabel = '关闭',
  className = '',
}: NoticeProps) {
  return (
    <div
      role="status"
      className={`mb-6 flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm ${TONE_CLASS[tone]} ${className}`}
    >
      <div className="min-w-0 leading-relaxed">{children}</div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel}
            className="inline-flex size-8 items-center justify-center rounded-lg text-base leading-none text-workbench-text-muted hover:bg-black/5 hover:text-workbench-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-accent/40 dark:hover:bg-white/10"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
