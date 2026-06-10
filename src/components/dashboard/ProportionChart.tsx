'use client'

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts'
import type { SourceStat } from '@/types'
import { formatTokens } from '@/lib/format'
import { useLang } from '@/lib/LanguageContext'

interface ProportionChartProps {
  bySource: SourceStat[]
  loading: boolean
  sourceDisplayNames: Record<string, string>
}

const COLORS = ['var(--eva-green)', 'var(--eva-purple)', 'var(--eva-orange)', '#0ea5e9', '#eab308']

interface TooltipPayloadEntry {
  payload: {
    name: string
    value: number
    count: number
    color: string
  }
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  totalTokens: number
}

function CustomTooltip({ active, payload, totalTokens }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null

  const entry = payload[0].payload
  const pct = totalTokens > 0 ? ((entry.value / totalTokens) * 100).toFixed(1) : '0.0'

  return (
    <div className="pointer-events-none relative z-50 rounded-lg border border-eva-border bg-eva-panel p-3 shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
        <span className="text-xs font-mono font-semibold" style={{ color: entry.color }}>
          {entry.name}
        </span>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-mono text-eva-text">
          {pct}% / {formatTokens(entry.value)}
        </div>
        <div className="text-[10px] font-mono text-eva-text-dim">
          {entry.count} requests
        </div>
      </div>
    </div>
  )
}

export function ProportionChart({ bySource, loading, sourceDisplayNames }: ProportionChartProps) {
  const { t } = useLang()

  if (loading && bySource.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="text-terminal text-sm animate-pulse">LOADING...</div>
      </div>
    )
  }

  if (bySource.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="text-xs font-mono text-eva-text-dim">NO DATA</div>
      </div>
    )
  }

  const data = bySource.map((s, i) => ({
    name: sourceDisplayNames[s.source] || s.source,
    value: s.total_tokens,
    count: s.count,
    color: COLORS[i % COLORS.length],
  }))

  const totalTokens = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="relative z-10 grid min-h-72 grid-cols-1 gap-4 overflow-visible md:grid-cols-[1fr_220px]">
      <div className="relative z-10 h-64 overflow-visible">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={64}
              outerRadius={94}
              paddingAngle={3}
              dataKey="value"
              stroke="var(--eva-bg)"
              strokeWidth={2}
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.color} opacity={0.9} />
              ))}
            </Pie>
            <Tooltip
              content={<CustomTooltip totalTokens={totalTokens} />}
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ zIndex: 60, pointerEvents: 'none' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center text-center">
          <div className="text-[10px] font-mono tracking-[0.22em] text-eva-text-dim">{t('proportion.total')}</div>
          <div className="font-mono text-xl font-semibold text-eva-green">{formatTokens(totalTokens)}</div>
        </div>
      </div>
      <div className="flex flex-col justify-center gap-2">
        {data.map((item) => {
          const pct = totalTokens > 0 ? (item.value / totalTokens) * 100 : 0
          return (
            <div key={item.name} className="rounded border border-eva-border bg-eva-bg/45 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate text-xs font-mono text-eva-text">{item.name}</span>
                </div>
                <span className="text-xs font-mono text-eva-green">{pct.toFixed(1)}%</span>
              </div>
              <div className="mt-1 text-[10px] font-mono text-eva-text-dim">
                {formatTokens(item.value)} / {item.count} requests
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
