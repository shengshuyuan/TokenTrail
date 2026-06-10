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
}

type ComparisonMode = 'source' | 'model'

const COLORS = [
  'var(--eva-green)',
  'var(--eva-purple)',
  'var(--eva-orange)',
  '#0ea5e9',
  '#eab308',
  '#db2777',
]

function compactLabel(label: string) {
  return label.length > 18 ? `${label.slice(0, 17)}...` : label
}

function topWithOther<T extends { tokens: number; cost: number }>(items: T[], max = 7, otherLabel = 'Other'): T[] {
  if (items.length <= max) return items
  const head = items.slice(0, max)
  const rest = items.slice(max)
  const other = rest.reduce(
    (acc, item) => ({
      ...acc,
      tokens: acc.tokens + item.tokens,
      cost: acc.cost + item.cost,
    }),
    { ...rest[0], name: otherLabel, tokens: 0, cost: 0, fill: 'var(--eva-text-dim)' } as T
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
}: ComparisonChartProps) {
  const [mode, setMode] = useState<ComparisonMode>('source')
  const { t } = useLang()

  if (loading && bySource.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="text-terminal text-sm animate-pulse">LOADING...</div>
      </div>
    )
  }

  const sourceData = bySource.map((s, i) => ({
    name: sourceDisplayNames[s.source] || s.source,
    fullName: sourceDisplayNames[s.source] || s.source,
    tokens: s.total_tokens,
    cost: s.cost_usd,
    fill: COLORS[i % COLORS.length],
  }))

  const modelData = byModel.map((m, i) => ({
    name: m.display_name,
    fullName: m.display_name,
    tokens: m.total_tokens,
    cost: m.cost_usd,
    fill: COLORS[i % COLORS.length],
  }))

  const data = topWithOther(mode === 'source' ? sourceData : modelData, 7, t('comparison.other'))

  return (
    <div>
      {/* Mode Toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode('source')}
          className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all border ${
            mode === 'source'
              ? 'border-eva-green/50 bg-eva-green/10 text-eva-green'
              : 'border-eva-border text-eva-text-dim hover:text-eva-text'
          }`}
        >
          {t('comparison.bySource')}
        </button>
        <button
          onClick={() => setMode('model')}
          className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all border ${
            mode === 'model'
              ? 'border-eva-green/50 bg-eva-green/10 text-eva-green'
              : 'border-eva-border text-eva-text-dim hover:text-eva-text'
          }`}
        >
          {t('comparison.byModel')}
        </button>
      </div>

      {data.length === 0 ? (
        <div className="h-72 flex items-center justify-center">
          <div className="text-xs font-mono text-eva-text-dim">NO DATA</div>
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={data} margin={{ top: 6, right: 18, left: 12, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 6" stroke="var(--eva-border)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: 'var(--eva-text-dim)', fontSize: 10, fontFamily: 'JetBrains Mono, Fira Code, monospace' }}
                axisLine={{ stroke: 'var(--eva-border)' }}
                tickLine={{ stroke: 'var(--eva-border)' }}
                tickFormatter={(v: number) => formatTokens(v)}
              />
              <YAxis
                dataKey="name"
                type="category"
                width={116}
                tick={{ fill: 'var(--eva-text-dim)', fontSize: 10, fontFamily: 'JetBrains Mono, Fira Code, monospace' }}
                axisLine={{ stroke: 'var(--eva-border)' }}
                tickLine={{ stroke: 'var(--eva-border)' }}
                tickFormatter={(v: string) => compactLabel(v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--eva-panel)',
                  border: '1px solid var(--eva-border)',
                  borderRadius: '8px',
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                  fontSize: '12px',
                  color: 'var(--eva-text)',
                }}
                labelStyle={{ color: 'var(--eva-text)' }}
                itemStyle={{ color: 'var(--eva-green)' }}
                formatter={(value: number, name: string) => {
                  if (name === 'cost') return [formatCost(value, currency, exchangeRate), t('comparison.cost')]
                  return [formatTokens(value), t('comparison.tokens')]
                }}
              />
              <Bar dataKey="tokens" radius={[0, 4, 4, 0]} barSize={18}>
                {data.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
