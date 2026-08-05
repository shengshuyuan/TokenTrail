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
  onSelectSource?: (source: string) => void
  selectedSources?: string[]
}

const COLORS = [
  'var(--theme-chart-1)',
  'var(--theme-chart-2)',
  'var(--theme-chart-3)',
  'var(--theme-chart-4)',
  'var(--theme-chart-5)',
  'var(--theme-chart-6)',
]

interface ChartSlice {
  id: string
  name: string
  value: number
  count: number
  color: string
}

interface TooltipPayloadEntry {
  payload: ChartSlice
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
    <div className="chart-tooltip pointer-events-none relative z-50">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="chart-tooltip-dot w-2.5 h-2.5" style={{ backgroundColor: entry.color, color: entry.color }} />
        <span className="text-sm font-mono font-semibold" style={{ color: entry.color }}>
          {entry.name}
        </span>
      </div>
      <div className="space-y-1">
        <div className="text-sm font-mono text-eva-text">
          {pct}% / {formatTokens(entry.value)}
        </div>
        <div className="text-[11px] font-mono text-eva-text-dim">
          {entry.count} requests
        </div>
      </div>
    </div>
  )
}

export function ProportionChart({
  bySource,
  loading,
  sourceDisplayNames,
  onSelectSource,
  selectedSources = [],
}: ProportionChartProps) {
  const { t } = useLang()

  if (loading && bySource.length === 0) {
    return (
      <div className="flex h-72 min-h-72 items-center justify-center">
        <div className="text-terminal text-sm animate-pulse">LOADING...</div>
      </div>
    )
  }

  if (bySource.length === 0) {
    return (
      <div className="flex h-72 min-h-72 items-center justify-center">
        <div className="text-xs font-mono text-eva-text-dim">NO DATA</div>
      </div>
    )
  }

  const data: ChartSlice[] = bySource.map((s, i) => ({
    id: s.source,
    name: sourceDisplayNames[s.source] || s.source,
    value: s.total_tokens,
    count: s.count,
    color: COLORS[i % COLORS.length],
  }))

  const totalTokens = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="relative z-10 grid min-h-72 grid-cols-1 gap-4 overflow-visible md:grid-cols-[1fr_220px]">
      <div className="relative z-10 flex h-72 min-h-72 items-center justify-center overflow-visible">
        <div className="absolute inset-0">
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
                stroke="var(--theme-bg)"
                strokeWidth={2}
                cursor={onSelectSource ? 'pointer' : undefined}
                onClick={(_, index) => {
                  const slice = data[index]
                  if (slice) onSelectSource?.(slice.id)
                }}
              >
                {data.map((entry) => {
                  const active = selectedSources.includes(entry.id)
                  const dimmed = selectedSources.length > 0 && !active
                  return (
                    <Cell
                      key={entry.id}
                      fill={entry.color}
                      opacity={dimmed ? 0.32 : active ? 1 : 0.9}
                      stroke={active ? 'var(--theme-text)' : 'var(--theme-bg)'}
                      strokeWidth={active ? 2.5 : 2}
                    />
                  )
                })}
              </Pie>
              <Tooltip
                content={<CustomTooltip totalTokens={totalTokens} />}
                allowEscapeViewBox={{ x: true, y: true }}
                wrapperStyle={{ zIndex: 60, pointerEvents: 'none' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="pointer-events-none relative z-0 flex flex-col items-center justify-center text-center">
          <div className="text-[11px] font-mono text-eva-text-dim">{t('proportion.total')}</div>
          <div className="font-mono text-[1.35rem] font-semibold text-eva-green">{formatTokens(totalTokens)}</div>
        </div>
      </div>
      <div className="flex flex-col justify-center gap-2">
        {onSelectSource && (
          <div className="mb-0.5 text-[11px] font-mono text-eva-text-dim/70">
            {t('filter.chartHint')}
          </div>
        )}
        {data.map((item) => {
          const pct = totalTokens > 0 ? (item.value / totalTokens) * 100 : 0
          const active = selectedSources.includes(item.id)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSource?.(item.id)}
              className={`control-inset pressable w-full px-3 py-2 text-left transition-[border-color,box-shadow,opacity] ${
                active ? 'border-eva-green/45 shadow-[0_0_0_1px_rgba(var(--theme-primary-rgb),0.18)]' : ''
              } ${selectedSources.length > 0 && !active ? 'opacity-55' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate text-sm font-mono text-eva-text">{item.name}</span>
                </div>
                <span className="text-sm font-mono text-eva-green">{pct.toFixed(1)}%</span>
              </div>
              <div className="mt-1.5 text-[11px] font-mono text-eva-text-dim">
                {formatTokens(item.value)} / {item.count} requests
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
