'use client'

import React from 'react'

export interface SegmentOption<T extends string | number> {
  value: T
  label: React.ReactNode
}

interface SegmentedControlProps<T extends string | number> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
}: SegmentedControlProps<T>) {
  const sizeClasses = {
    sm: 'p-1 text-xs',
    md: 'p-1 text-sm',
  }[size]

  const itemSizeClasses = {
    sm: 'px-3 py-1 rounded-lg',
    md: 'px-3.5 py-1.5 rounded-lg',
  }[size]

  return (
    <div
      role="radiogroup"
      className={`inline-flex items-center rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.05] dark:border-white/[0.08] backdrop-blur-md shadow-inner ${sizeClasses} ${className}`}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(opt.value)}
            className={`font-medium transition-all duration-200 select-none ${itemSizeClasses} ${
              isSelected
                ? 'bg-workbench-surface text-workbench-text font-semibold shadow-xs border border-black/[0.06] dark:border-white/[0.1] active:scale-[0.98]'
                : 'text-workbench-text-muted hover:text-workbench-text hover:bg-black/[0.02] dark:hover:bg-white/[0.04]'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
