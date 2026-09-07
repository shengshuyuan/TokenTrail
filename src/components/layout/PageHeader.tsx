'use client'

import React from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  note?: string
  className?: string
}

export function PageHeader({
  title,
  subtitle,
  actions,
  note,
  className = '',
}: PageHeaderProps) {
  return (
    <header className={`mb-8 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Title and Subtitle */}
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold text-workbench-text tracking-tight leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-workbench-text-muted mt-1 leading-normal">
              {subtitle}
            </p>
          )}
        </div>

        {/* Right Actions Slot */}
        {actions && (
          <div className="flex items-center flex-wrap gap-2.5 shrink-0">
            {actions}
          </div>
        )}
      </div>

      {/* Optional metadata note */}
      {note && (
        <div className="flex justify-end mt-1 text-xs text-workbench-text-muted">
          <span>{note}</span>
        </div>
      )}
    </header>
  )
}
