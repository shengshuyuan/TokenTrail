'use client'

import React, { useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import type { DailyStat, Currency } from '@/types'
import { formatCost, formatTokens, formatShortDate, formatNumber } from '@/lib/format'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

interface SingleMetricTrendChartProps {
  data: DailyStat[]
  loading?: boolean
  currency: Currency
  exchangeRate: number
  className?: string
}

type MetricMode = 'tokens' | 'cost'

export function SingleMetricTrendChart({
  data,
  loading = false,
  currency,
  exchangeRate,
  className = '',
}: SingleMetricTrendChartProps) {
  const [metric, setMetric] = useState<MetricMode>('tokens')

  const chartData = data.map((d) => ({
    ...d,
    shortDate: formatShortDate(d.date),
    costDisplay: d.cost_usd,
  }))

  return (
    <div className={`w-full ${className}`}>
      {/* Section Header with Segmented Switcher */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-workbench-text tracking-tight">用量趋势</h2>
        <SegmentedControl
          size="sm"
          options={[
            { value: 'tokens', label: 'Tokens' },
            { value: 'cost', label: '估算费用' },
          ]}
          value={metric}
          onChange={(v) => setMetric(v as MetricMode)}
        />
      </div>

      {/* Chart container */}
      <div className="h-[280px] sm:h-[320px] w-full">
        {loading && data.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-workbench-text-muted">
              <svg className="animate-spin h-4 w-4 text-workbench-accent" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>加载趋势数据...</span>
            </div>
          </div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center">
            <div className="text-sm text-workbench-text-muted">
              暂无趋势数据，同步或上报日志后将在此展示。
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 12, right: 12, left: -10, bottom: 4 }}>
              <defs>
                <linearGradient id="workbenchGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#157F68" stopOpacity={0.16} />
                  <stop offset="95%" stopColor="#157F68" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 4" stroke="#E5E8EB" vertical={false} />
              <XAxis
                dataKey="shortDate"
                tick={{ fill: '#626B73', fontSize: 12, fontFamily: 'var(--theme-font-numeric)' }}
                axisLine={{ stroke: '#E5E8EB' }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: '#626B73', fontSize: 11, fontFamily: 'var(--theme-font-numeric)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) =>
                  metric === 'tokens' ? formatTokens(v) : formatCost(v, currency, exchangeRate)
                }
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null
                  const item = payload[0].payload as DailyStat & { shortDate: string }
                  return (
                    <div className="bg-white border border-workbench-border shadow-md rounded-lg p-3 text-xs min-w-[140px]">
                      <div className="font-semibold text-workbench-text mb-1.5">{item.date}</div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-workbench-text-muted">
                            {metric === 'tokens' ? 'Tokens' : '估算费用'}
                          </span>
                          <span className="font-mono font-bold text-workbench-accent">
                            {metric === 'tokens'
                              ? formatTokens(item.total_tokens)
                              : formatCost(item.cost_usd, currency, exchangeRate)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-workbench-text-muted">请求数</span>
                          <span className="font-mono text-workbench-text">
                            {formatNumber(item.count)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey={metric === 'tokens' ? 'total_tokens' : 'costDisplay'}
                stroke="#157F68"
                strokeWidth={2.5}
                fill="url(#workbenchGradient)"
                dot={{ r: 3.5, stroke: '#157F68', strokeWidth: 2, fill: '#FFFFFF' }}
                activeDot={{ r: 5, stroke: '#157F68', strokeWidth: 2, fill: '#157F68' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
