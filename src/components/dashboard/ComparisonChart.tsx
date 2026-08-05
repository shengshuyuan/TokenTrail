'use client'

import { useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import type { SourceStat, ModelStat, Currency } from '@/types'
import { formatCost, formatTokens } from '@/lib/format'
import { useLang } from '@/lib/LanguageContext'

interface ComparisonChartProps {
  bySource: SourceStat[]
  byModel: ModelStat[]
  loading: boolean
  currency: Currency
  exchangeRate: number
  sourceDisplayNames: Record<string, string>
  onSelectSource?: (source: string) => void
  onSelectModel?: (modelId: string) => void
  selectedSources?: string[]
  selectedModels?: string[]
}

type ComparisonMode = 'source' | 'model'

const COLORS = [
  'var(--theme-chart-1)',
  'var(--theme-chart-2)',
  'var(--theme-chart-3)',
  'var(--theme-chart-4)',
  'var(--theme-chart-5)',
  'var(--theme-chart-6)',
]

function compactLabel(label: string) {
  return label.length > 18 ? `${label.slice(0, 17)}...` : label
}

type ChartRow = {
  name: string
  fullName: string
  id: string
  tokens: number
  cost: number
  fill: string
  isOther?: boolean
}

function topWithOther(items: ChartRow[], max = 7, otherLabel = 'Other'): ChartRow[] {
  if (items.length <= max) return items
  const head = items.slice(0, max)
  const rest = items.slice(max)
  const other = rest.reduce(
    (acc, item) => ({
      ...acc,
      tokens: acc.tokens + item.tokens,
      cost: acc.cost + item.cost,
    }),
    {
      name: otherLabel,
      fullName: otherLabel,
      id: '__other__',
      tokens: 0,
      cost: 0,
      fill: 'var(--theme-chart-7)',
      isOther: true,
    } as ChartRow
  )
  return [...head, other]
}

export function ComparisonChart({
  bySource,
  byModel,
  loading,
  currency,
  exchangeRate,
  sourceDisplayNames,
  onSelectSource,
  onSelectModel,
  selectedSources = [],
  selectedModels = [],
}: ComparisonChartProps) {
  const [mode, setMode] = useState<ComparisonMode>('source')
  const { t } = useLang()

  if (loading && bySource.length === 0) {
    return (
      <div className="flex h-72 min-h-72 items-center justify-center">
        <div className="text-terminal text-sm animate-pulse">LOADING...</div>
      </div>
    )
  }

  const sourceData: ChartRow[] = bySource.map((s, i) => ({
    name: sourceDisplayNames[s.source] || s.source,
    fullName: sourceDisplayNames[s.source] || s.source,
    id: s.source,
    tokens: s.total_tokens,
    cost: s.cost_usd,
    fill: COLORS[i % COLORS.length],
  }))

  const modelData: ChartRow[] = byModel.map((m, i) => ({
    name: m.display_name,
    fullName: m.display_name,
    id: m.model,
    tokens: m.total_tokens,
    cost: m.cost_usd,
    fill: COLORS[i % COLORS.length],
  }))

  const data = topWithOther(mode === 'source' ? sourceData : modelData, 7, t('comparison.other'))

  const handleBarClick = (row: ChartRow | undefined) => {
    if (!row || row.isOther) return
    if (mode === 'source') onSelectSource?.(row.id)
    else onSelectModel?.(row.id)
  }

  return (
    <div className="flex min-h-72 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMode('source')}
          className={`control-surface rounded-full px-3 py-1 text-[11px] font-mono ${
            mode === 'source' ? 'control-surface-active' : ''
          }`}
        >
          {t('comparison.bySource')}
        </button>
        <button
          type="button"
          onClick={() => setMode('model')}
          className={`control-surface rounded-full px-3 py-1 text-[11px] font-mono ${
            mode === 'model' ? 'control-surface-active' : ''
          }`}
        >
          {t('comparison.byModel')}
        </button>
        {(onSelectSource || onSelectModel) && (
          <span className="ml-auto text-[11px] font-mono text-eva-text-dim/70">
            {t('filter.chartHint')}
          </span>
        )}
      </div>

      {data.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-xs font-mono text-eva-text-dim">NO DATA</div>
        </div>
      ) : (
        <div className="h-72 min-h-72 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={data} margin={{ top: 6, right: 18, left: 12, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 6" stroke="var(--theme-border)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: 'var(--theme-text-muted)', fontSize: 11, fontFamily: 'var(--theme-font-mono)' }}
                axisLine={{ stroke: 'var(--theme-border)' }}
                tickLine={{ stroke: 'var(--theme-border)' }}
                tickFormatter={(v: number) => formatTokens(v)}
              />
              <YAxis
                dataKey="name"
                type="category"
                width={116}
                tick={{ fill: 'var(--theme-text-muted)', fontSize: 11, fontFamily: 'var(--theme-font-mono)' }}
                axisLine={{ stroke: 'var(--theme-border)' }}
                tickLine={{ stroke: 'var(--theme-border)' }}
                tickFormatter={(v: string) => compactLabel(v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(var(--theme-panel-rgb), 0.88)',
                  border: '1px solid rgba(var(--theme-border-strong-rgb), 0.55)',
                  borderRadius: 'calc(var(--theme-radius) - 2px)',
                  fontFamily: 'var(--theme-font-mono)',
                  fontSize: '12px',
                  color: 'var(--theme-text)',
                  backdropFilter: 'blur(16px) saturate(1.15)',
                  WebkitBackdropFilter: 'blur(16px) saturate(1.15)',
                  boxShadow: 'inset 0 1px 0 var(--theme-inset-highlight), 0 14px 40px rgba(0, 0, 0, 0.3)',
                }}
                labelStyle={{ color: 'var(--theme-text)' }}
                itemStyle={{ color: 'var(--theme-chart-1)' }}
                formatter={(value: number, name: string) => {
                  if (name === 'cost') return [formatCost(value, currency, exchangeRate), t('comparison.cost')]
                  return [formatTokens(value), t('comparison.tokens')]
                }}
              />
              <Bar
                dataKey="tokens"
                radius={[0, 4, 4, 0]}
                barSize={18}
                cursor="pointer"
                onClick={(entry: ChartRow | { payload?: ChartRow }) => {
                  // Recharts may pass the row itself or a wrapper with .payload
                  const row = (entry && 'payload' in entry && entry.payload)
                    ? entry.payload
                    : (entry as ChartRow | undefined)
                  handleBarClick(row)
                }}
              >
                {data.map((entry) => {
                  const active = mode === 'source'
                    ? selectedSources.includes(entry.id)
                    : selectedModels.includes(entry.id)
                  const dimmed = (
                    (mode === 'source' && selectedSources.length > 0) ||
                    (mode === 'model' && selectedModels.length > 0)
                  ) && !active && !entry.isOther
                  return (
                    <Cell
                      key={entry.id}
                      fill={entry.fill}
                      opacity={dimmed ? 0.35 : active ? 1 : 0.9}
                      stroke={active ? 'var(--theme-text)' : 'transparent'}
                      strokeWidth={active ? 1 : 0}
                    />
                  )
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
