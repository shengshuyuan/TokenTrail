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
    healthy: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-red-50 text-red-800 border-red-200',
    info: 'bg-blue-50 text-blue-800 border-blue-200',
    neutral: 'bg-gray-100 text-gray-700 border-gray-200',
  }[normalizedTone]

  const dotClasses = {
    healthy: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    info: 'bg-blue-500',
    neutral: 'bg-gray-400',
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
