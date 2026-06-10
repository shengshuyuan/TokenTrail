'use client'

import type { TimeRange } from '@/types'
import { useLang } from '@/lib/LanguageContext'

interface FilterBarProps {
  timeRange: TimeRange
  onTimeRangeChange: (range: TimeRange) => void
  availableSources: string[]
  selectedSources: string[]
  onToggleSource: (source: string) => void
  onClearSources: () => void
  availableModels: { id: string; name: string }[]
  selectedModels: string[]
  onToggleModel: (model: string) => void
  onClearModels: () => void
  sourceDisplayNames: Record<string, string>
}

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: 1, label: '24H' },
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
]

export function FilterBar({
  timeRange,
  onTimeRangeChange,
  availableSources,
  selectedSources,
  onToggleSource,
  onClearSources,
  availableModels,
  selectedModels,
  onToggleModel,
  onClearModels,
  sourceDisplayNames,
}: FilterBarProps) {
  const { t } = useLang()
  const totalActive = selectedSources.length + selectedModels.length

  return (
    <div className="eva-panel px-4 py-3">
      {/* Time Range */}
      <div className="grid grid-cols-1 lg:grid-cols-[84px_1fr] gap-3">
        <div className="control-label pt-1.5">{t('filter.window')}</div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => onTimeRangeChange(range.value)}
                className={`min-h-[32px] rounded-md border px-3 py-1.5 text-xs font-mono transition-all ${
                  timeRange === range.value
                    ? 'border-eva-green/50 bg-eva-green/10 text-eva-green shadow-eva-green'
                    : 'border-eva-border bg-eva-bg/50 text-eva-text-dim hover:border-eva-green/20 hover:text-eva-text'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
          {totalActive > 0 && (
            <button
              onClick={() => {
                onClearSources()
                onClearModels()
              }}
              className="hidden sm:inline-flex text-[10px] font-mono text-eva-text-dim hover:text-eva-orange transition-colors"
            >
              {t('filter.clearAll', { n: totalActive })}
            </button>
          )}
        </div>

      {/* Source Filter */}
      {availableSources.length > 0 && (
        <>
          <div className="control-label pt-1.5">{t('filter.source')}</div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1.5">
            {availableSources.map((source) => (
              <button
                key={source}
                onClick={() => onToggleSource(source)}
                className={`eva-badge ${selectedSources.includes(source) ? 'eva-badge-active' : ''}`}
              >
                {sourceDisplayNames[source] || source}
              </button>
            ))}
            {selectedSources.length > 0 && (
              <button
                onClick={onClearSources}
                className="ml-1 min-h-[30px] whitespace-nowrap rounded border border-transparent px-2 text-[10px] font-mono text-eva-text-dim transition-colors hover:border-eva-orange/30 hover:text-eva-orange"
              >
                x {t('filter.clear')}
              </button>
            )}
          </div>
        </>
      )}

      {/* Model Filter */}
      {availableModels.length > 0 && (
        <>
          <div className="control-label pt-1.5">{t('filter.model')}</div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1.5">
            {availableModels.map((model) => (
              <button
                key={model.id}
                onClick={() => onToggleModel(model.id)}
                className={`eva-badge ${selectedModels.includes(model.id) ? 'eva-badge-active' : ''}`}
              >
                {model.name}
              </button>
            ))}
            {selectedModels.length > 0 && (
              <button
                onClick={onClearModels}
                className="ml-1 min-h-[30px] whitespace-nowrap rounded border border-transparent px-2 text-[10px] font-mono text-eva-text-dim transition-colors hover:border-eva-orange/30 hover:text-eva-orange"
              >
                x {t('filter.clear')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
    </div>
  )
}
