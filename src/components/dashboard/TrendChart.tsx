'use client'

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
import { formatCost, formatTokens, formatShortDate } from '@/lib/format'
import { useLang } from '@/lib/LanguageContext'

interface TrendChartProps {
  data: DailyStat[]
  loading: boolean
  currency: Currency
  exchangeRate: number
}

interface TooltipPayloadEntry {
  payload: DailyStat
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  currency: Currency
  exchangeRate: number
}

function CustomTooltip({ active, payload, currency, exchangeRate }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null

  const data = payload[0].payload
  return (
    <div className="bg-eva-panel border border-eva-border rounded-lg p-3 shadow-lg">
      <p className="text-xs font-mono text-eva-text-dim mb-2">{data.date}</p>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-eva-green" />
          <span className="text-xs font-mono text-eva-text">
            {formatTokens(data.total_tokens)} tokens
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-eva-purple" />
          <span className="text-xs font-mono text-eva-text">
            {formatCost(data.cost_usd, currency, exchangeRate)}
          </span>
        </div>
        <div className="text-xs font-mono text-eva-text-dim">
          {data.count} requests
        </div>
      </div>
    </div>
  )
}

export function TrendChart({ data, loading, currency, exchangeRate }: TrendChartProps) {
  const { t } = useLang()

  if (loading && data.length === 0) {
    return (
      <div className="h-[320px] flex items-center justify-center">
        <div className="text-terminal text-sm animate-pulse">LOADING DATA...</div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="h-[320px] flex items-center justify-center">
        <div className="text-center">
          <div className="text-terminal text-sm mb-2">NO DATA</div>
          <div className="text-xs font-mono text-eva-text-dim">
            {t('trend.noDataHint')}
          </div>
        </div>
      </div>
    )
  }

const chartData = data.map(d => ({
    ...d,
    shortDate: formatShortDate(d.date),
    costDisplay: d.cost_usd, // 始终保持原始 USD 值，由 formatCost 统一处理汇率转换
  }))
  const peak = chartData.reduce((max, d) => d.total_tokens > max.total_tokens ? d : max, chartData[0])

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-mono text-eva-text-dim">
        <span className="inline-flex items-center gap-1.5 rounded border border-eva-border bg-eva-bg/50 px-2 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-eva-green" />
          TOKEN VOLUME
        </span>
        <span className="inline-flex items-center gap-1.5 rounded border border-eva-border bg-eva-bg/50 px-2 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-eva-purple" />
          COST CURVE
        </span>
        {peak && (
          <span className="ml-auto hidden sm:inline text-eva-text-dim/70">
            PEAK {peak.shortDate} / {formatTokens(peak.total_tokens)}
          </span>
        )}
      </div>
      <div className="h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--eva-green)" stopOpacity={0.28} />
              <stop offset="95%" stopColor="var(--eva-green)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--eva-purple)" stopOpacity={0.28} />
              <stop offset="95%" stopColor="var(--eva-purple)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 6" stroke="var(--eva-border)" vertical={false} />
          <XAxis
            dataKey="shortDate"
            tick={{ fill: 'var(--eva-text-dim)', fontSize: 10, fontFamily: 'JetBrains Mono, Fira Code, monospace' }}
            axisLine={{ stroke: 'var(--eva-border)' }}
            tickLine={{ stroke: 'var(--eva-border)' }}
            minTickGap={26}
          />
          <YAxis
            yAxisId="tokens"
            tick={{ fill: 'var(--eva-text-dim)', fontSize: 10, fontFamily: 'JetBrains Mono, Fira Code, monospace' }}
            axisLine={{ stroke: 'var(--eva-border)' }}
            tickLine={{ stroke: 'var(--eva-border)' }}
            tickFormatter={(v: number) => formatTokens(v)}
          />
          <YAxis
            yAxisId="cost"
            orientation="right"
            tick={{ fill: 'var(--eva-text-dim)', fontSize: 10, fontFamily: 'JetBrains Mono, Fira Code, monospace' }}
            axisLine={{ stroke: 'var(--eva-border)' }}
            tickLine={{ stroke: 'var(--eva-border)' }}
            tickFormatter={(v: number) => formatCost(v, currency, exchangeRate)}
          />
          <Tooltip content={<CustomTooltip currency={currency} exchangeRate={exchangeRate} />} />
          <Area
            yAxisId="tokens"
            type="monotone"
            dataKey="total_tokens"
            stroke="var(--eva-green)"
            strokeWidth={2.4}
            fill="url(#tokenGradient)"
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--eva-bg)', strokeWidth: 2 }}
          />
          <Area
            yAxisId="cost"
            type="monotone"
            dataKey="costDisplay"
            stroke="var(--eva-purple)"
            strokeWidth={2.2}
            fill="url(#costGradient)"
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--eva-bg)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      </div>
    </div>
  )
}
