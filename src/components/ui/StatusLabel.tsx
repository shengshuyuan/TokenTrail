'use client'

import React from 'react'

export type StatusTone = 'healthy' | 'warning' | 'danger' | 'neutral' | 'info'

interface StatusLabelProps {
  status: StatusTone | string
  label: React.ReactNode
  showDot?: boolean
  className?: string
  size?: 'sm' | 'md'
}

export function StatusLabel({
  status,
  label,
  showDot = true,
  className = '',
  size = 'md',
}: StatusLabelProps) {
  const normalizedTone: StatusTone =
    status === 'healthy' || status === 'success'
      ? 'healthy'
      : status === 'warning' || status === 'near_limit' || status === 'stale'
      ? 'warning'
      : status === 'danger' || status === 'error' || status === 'exhausted' || status === 'auth_error'
      ? 'danger'
      : status === 'info'
      ? 'info'
      : 'neutral'

  const toneClasses = {
    healthy: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    danger: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
    info: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
    neutral: 'bg-workbench-sidebar text-workbench-text-muted border-workbench-border',
  }[normalizedTone]

  const dotClasses = {
    healthy: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    info: 'bg-blue-500',
    neutral: 'bg-workbench-text-muted',
  }[normalizedTone]

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-xs gap-1.5',
    md: 'px-2 py-0.5 text-xs font-medium gap-1.5',
  }[size]

  return (
    <span
      className={`inline-flex items-center rounded-md border ${toneClasses} ${sizeClasses} ${className}`}
    >
      {showDot && <span className={`h-1.5 w-1.5 rounded-full ${dotClasses}`} aria-hidden="true" />}
      <span>{label}</span>
    </span>
  )
}
