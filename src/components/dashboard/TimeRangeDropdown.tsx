'use client'

import React, { useState, useRef, useEffect } from 'react'
import type { TimeRange } from '@/types'

interface TimeRangeDropdownProps {
  value: TimeRange
  onChange: (value: TimeRange) => void
  className?: string
}

function formatDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}.${day}`
}

function getRangeLabel(days: TimeRange): string {
  const now = new Date()
  const end = formatDate(now)
  const startD = new Date(now.getTime() - (days - 1) * 86400000)
  const start = formatDate(startD)

  if (days === 1) {
    return `今天 (${end})`
  }
  return `最近${days}天 (${start} - ${end})`
}

const RANGES: TimeRange[] = [1, 7, 30, 90]

export function TimeRangeDropdown({ value, onChange, className = '' }: TimeRangeDropdownProps) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="h-9 px-3.5 rounded-lg bg-workbench-surface border border-workbench-border text-sm font-medium text-workbench-text hover:bg-workbench-sidebar flex items-center gap-2 transition-colors shadow-2xs select-none"
      >
        <span className="text-workbench-text-muted">📅</span>
        <span>{getRangeLabel(value)}</span>
        <svg
          className={`w-4 h-4 text-workbench-text-muted transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-56 rounded-lg bg-workbench-surface text-workbench-text border border-workbench-border shadow-lg py-1.5 z-50 text-sm animate-in fade-in zoom-in-95 duration-100">
          {RANGES.map((days) => {
            const isSelected = days === value
            return (
              <button
                key={days}
                type="button"
                onClick={() => {
                  onChange(days)
                  setOpen(false)
                }}
                className={`w-full text-left px-3.5 py-2 flex items-center justify-between transition-colors ${
                  isSelected
                    ? 'bg-workbench-accent-light text-workbench-accent font-semibold'
                    : 'text-workbench-text hover:bg-workbench-sidebar'
                }`}
              >
                <span>{getRangeLabel(days)}</span>
                {isSelected && <span>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
