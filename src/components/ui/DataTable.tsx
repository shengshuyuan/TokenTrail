'use client'

import React from 'react'

interface DataTableProps {
  children: React.ReactNode
  className?: string
  loading?: boolean
}

export function DataTable({ children, className = '', loading = false }: DataTableProps) {
  return (
    <div className={`relative w-full border border-workbench-border rounded-lg bg-workbench-surface overflow-hidden ${className}`}>
      {loading && (
        <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-10">
          <div className="flex items-center gap-2 text-sm text-workbench-text-muted">
            <svg className="animate-spin h-4 w-4 text-workbench-accent" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>加载中...</span>
          </div>
        </div>
      )}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          {children}
        </table>
      </div>
    </div>
  )
}
