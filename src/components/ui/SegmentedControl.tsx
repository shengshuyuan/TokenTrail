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
    sm: 'p-0.5 text-xs',
    md: 'p-1 text-sm',
  }[size]

  const itemSizeClasses = {
    sm: 'px-2.5 py-1',
    md: 'px-3 py-1.5',
  }[size]

  return (
    <div
      role="radiogroup"
      className={`inline-flex items-center rounded-lg bg-workbench-sidebar border border-workbench-border/80 ${sizeClasses} ${className}`}
    >
      {options.map(opt => {
        const isSelected = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(opt.value)}
            className={`font-medium rounded-md transition-all duration-150 select-none ${itemSizeClasses} ${
              isSelected
                ? 'bg-workbench-accent text-white shadow-xs'
                : 'text-workbench-text-muted hover:text-workbench-text hover:bg-white/60'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
