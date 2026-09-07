'use client'

import React from 'react'
import Link from 'next/link'
import type { SourceStat, TimeRange } from '@/types'
import { SOURCE_DISPLAY_NAMES } from '@/types'
import { formatTokens } from '@/lib/format'
import { ProviderBrandIcon } from './QuotaBrandIcons'

interface TopSourcesListProps {
  sources: SourceStat[]
  totalTokens: number
  timeRange: TimeRange
  loading?: boolean
  className?: string
}

export function TopSourcesList({
  sources,
  totalTokens,
  timeRange,
  loading = false,
  className = '',
}: TopSourcesListProps) {
  // Sort descending by tokens and take top 5
  const topSources = [...sources]
    .sort((a, b) => b.total_tokens - a.total_tokens)
    .slice(0, 5)

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-workbench-text tracking-tight">来源分布</h2>
        <Link
          href={`/usage?days=${timeRange}`}
          className="text-xs font-medium text-workbench-accent hover:underline flex items-center gap-1"
        >
          <span>查看明细</span>
          <span>→</span>
        </Link>
      </div>

      {loading && sources.length === 0 ? (
        <div className="space-y-3 animate-pulse py-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-lg bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-24 bg-gray-200 rounded" />
                <div className="h-2 w-full bg-gray-100 rounded-full" />
              </div>
              <div className="w-12 h-3.5 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : topSources.length === 0 ? (
        <div className="py-8 text-center text-sm text-workbench-text-muted">
          暂无来源数据
        </div>
      ) : (
        <div className="space-y-3">
          {/* Column sub-headers */}
          <div className="grid grid-cols-12 text-xs font-medium text-workbench-text-muted pb-1 border-b border-workbench-border/60">
            <span className="col-span-5">来源</span>
            <span className="col-span-4 text-right pr-2">Tokens</span>
            <span className="col-span-3 text-right">占比</span>
          </div>

          {/* Rows */}
          {topSources.map((item) => {
            const pct = totalTokens > 0 ? (item.total_tokens / totalTokens) * 100 : 0
            const displayName = SOURCE_DISPLAY_NAMES[item.source] || item.source

            return (
              <Link
                key={item.source}
                href={`/usage?source=${encodeURIComponent(item.source)}&days=${timeRange}`}
                className="grid grid-cols-12 items-center py-2 px-2 -mx-2 rounded-lg hover:bg-black/[0.03] transition-colors group cursor-pointer"
                title={`查看 ${displayName} 用量分析`}
              >
                {/* Source Column: Icon + Name */}
                <div className="col-span-5 flex items-center gap-2.5 min-w-0 pr-2">
                  <ProviderBrandIcon provider={item.source} className="size-6 shrink-0" />
                  <span className="text-sm font-medium text-workbench-text truncate group-hover:text-workbench-accent transition-colors">
                    {displayName}
                  </span>
                </div>

                {/* Progress bar and formatted value */}
                <div className="col-span-4 flex items-center gap-3 justify-end pr-2">
                  <div className="hidden sm:block flex-1 h-1.5 bg-workbench-border/80 rounded-full overflow-hidden max-w-[90px]">
                    <div
                      className="h-full bg-workbench-accent rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono text-workbench-text tabular-nums text-right">
                    {formatTokens(item.total_tokens)}
                  </span>
                </div>

                {/* Percentage */}
                <div className="col-span-3 text-right">
                  <span className="text-sm font-mono text-workbench-text-muted tabular-nums">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
