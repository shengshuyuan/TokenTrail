'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { StatsResponse, Currency, Theme, TimeRange } from '@/types'
import { formatTokens, formatCost, formatNumber } from '@/lib/format'
import { getThemeDefinition } from '@/lib/themes'
import { useLang } from '@/lib/LanguageContext'
import { SOURCE_DISPLAY_NAMES } from '@/types'

// ─── Types ─────────────────────────────────────────────────────

interface ShareCardProps {
  stats: StatsResponse | null
  timeRange: TimeRange
  currency: Currency
  theme: Theme
  selectedSources: string[]
  selectedModels: string[]
}

// ─── SVG share card ────────────────────────────────────────────

const CARD_W = 680
const CARD_H = 420
const PADDING = 32

function buildShareSVG(
  stats: StatsResponse,
  theme: Theme,
  lang: 'zh' | 'en',
  currency: Currency,
  timeRange: TimeRange,
  filterLabel: string,
  texts: Record<string, string>
): string {
  const td = getThemeDefinition(theme)
  const { canvas, surface, primary, secondary, text: textColor, font } = td.preview

  const totalTokens = stats.total_tokens ?? 0
  const totalCost = stats.total_cost_usd ?? 0
  const totalReqs = stats.total_requests ?? 0
  const dailyAvg = stats.avg_daily_tokens ?? 0

  // Trend polyline
  const daily = stats.daily ?? []
  const maxToken = Math.max(1, ...daily.map(d => d.total_tokens))
  const trendW = 300
  const trendH = 56
  const trendY = 232
  const trendX = PADDING + 280
  const points = daily.length > 1
    ? daily.map((d, i) => {
        const x = trendX + (i / (daily.length - 1)) * trendW
        const y = trendY + trendH - (d.total_tokens / maxToken) * trendH
        return `${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')
    : ''

  // Top sources (max 3)
  const topSources = (stats.by_source ?? []).slice(0, 3)
  const maxSrcTokens = Math.max(1, ...topSources.map(s => s.total_tokens))

  // Top models (max 3)
  const topModels = (stats.by_model ?? []).slice(0, 3)
  const maxMdlTokens = Math.max(1, ...topModels.map(m => m.total_tokens))

  const rangeLabel = timeRange === 1 ? '24H' : `${timeRange}D`

  // Bar dimensions
  const barX = PADDING + 120
  const barMaxW = 140
  const barH = 14
  const rowGap = 28
  const srcStartY = 300
  const mdlStartY = srcStartY + topSources.length * rowGap + 16

  // Font family for SVG text
  const fontFamily = font.replace(/"/g, "'")

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <defs>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${canvas}"/>
      <stop offset="100%" stop-color="${surface}"/>
    </linearGradient>
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg-grad)" rx="12"/>
  <rect x="0.5" y="0.5" width="${CARD_W - 1}" height="${CARD_H - 1}" fill="none" stroke="${primary}" stroke-opacity="0.15" rx="12"/>

  <!-- Header -->
  <text x="${PADDING}" y="${PADDING + 18}" fill="${primary}" font-family="${fontFamily}" font-size="13" font-weight="600" letter-spacing="3">TOKENTRAIL</text>
  <text x="${CARD_W - PADDING}" y="${PADDING + 18}" fill="${textColor}" fill-opacity="0.5" font-family="${fontFamily}" font-size="11" text-anchor="end">${rangeLabel} · ${filterLabel}</text>

  <!-- Divider -->
  <line x1="${PADDING}" y1="${PADDING + 30}" x2="${CARD_W - PADDING}" y2="${PADDING + 30}" stroke="${textColor}" stroke-opacity="0.1"/>

  <!-- Main number: Total Tokens -->
  <text x="${PADDING}" y="${PADDING + 80}" fill="${textColor}" fill-opacity="0.5" font-family="${fontFamily}" font-size="12" letter-spacing="1">${texts.totalTokens}</text>
  <text x="${PADDING}" y="${PADDING + 120}" fill="${primary}" font-family="${fontFamily}" font-size="44" font-weight="700">${formatTokens(totalTokens)}</text>

  <!-- Cost & Requests -->
  <text x="${PADDING}" y="${PADDING + 160}" fill="${secondary}" font-family="${fontFamily}" font-size="18" font-weight="600">${formatCost(totalCost, currency)}</text>
  <text x="${PADDING}" y="${PADDING + 182}" fill="${textColor}" fill-opacity="0.4" font-family="${fontFamily}" font-size="11">${formatNumber(totalReqs)} ${texts.requests} · ${texts.dailyAvg} ${formatTokens(dailyAvg)}</text>

  <!-- Trend -->
  <text x="${trendX}" y="${trendY - 8}" fill="${textColor}" fill-opacity="0.5" font-family="${fontFamily}" font-size="11">${texts.trend}</text>
  ${points ? `<polyline points="${points}" fill="none" stroke="${primary}" stroke-width="1.5" stroke-opacity="0.7" stroke-linejoin="round"/>` : ''}
  <line x1="${trendX}" y1="${trendY + trendH}" x2="${trendX + trendW}" y2="${trendY + trendH}" stroke="${textColor}" stroke-opacity="0.08"/>

  <!-- Top Sources -->
  <text x="${PADDING}" y="${srcStartY - 6}" fill="${textColor}" fill-opacity="0.5" font-family="${fontFamily}" font-size="11">${texts.topSources}</text>
  ${topSources.map((s, i) => {
    const y = srcStartY + i * rowGap
    const name = SOURCE_DISPLAY_NAMES[s.source] ?? s.source
    const barW = (s.total_tokens / maxSrcTokens) * barMaxW
    return `<text x="${PADDING}" y="${y + 11}" fill="${textColor}" fill-opacity="0.8" font-family="${fontFamily}" font-size="11">${name}</text>
    <rect x="${barX}" y="${y}" width="${barW}" height="${barH}" fill="${primary}" fill-opacity="0.2" rx="2"/>
    <text x="${barX + barW + 6}" y="${y + 11}" fill="${textColor}" fill-opacity="0.6" font-family="${fontFamily}" font-size="10">${formatTokens(s.total_tokens)}</text>`
  }).join('')}

  <!-- Top Models -->
  <text x="${PADDING}" y="${mdlStartY - 6}" fill="${textColor}" fill-opacity="0.5" font-family="${fontFamily}" font-size="11">${texts.topModels}</text>
  ${topModels.map((m, i) => {
    const y = mdlStartY + i * rowGap
    const name = m.display_name || m.model
    const barW = (m.total_tokens / maxMdlTokens) * barMaxW
    return `<text x="${PADDING}" y="${y + 11}" fill="${textColor}" fill-opacity="0.8" font-family="${fontFamily}" font-size="11">${name}</text>
    <rect x="${barX}" y="${y}" width="${barW}" height="${barH}" fill="${secondary}" fill-opacity="0.2" rx="2"/>
    <text x="${barX + barW + 6}" y="${y + 11}" fill="${textColor}" fill-opacity="0.6" font-family="${fontFamily}" font-size="10">${formatTokens(m.total_tokens)}</text>`
  }).join('')}

  <!-- Footer -->
  <line x1="${PADDING}" y1="${CARD_H - 28}" x2="${CARD_W - PADDING}" y2="${CARD_H - 28}" stroke="${textColor}" stroke-opacity="0.08"/>
  <text x="${PADDING}" y="${CARD_H - 12}" fill="${textColor}" fill-opacity="0.35" font-family="${fontFamily}" font-size="10">🔒 ${texts.privacyNote}</text>
  <text x="${CARD_W - PADDING}" y="${CARD_H - 12}" fill="${textColor}" fill-opacity="0.35" font-family="${fontFamily}" font-size="10" text-anchor="end">TokenTrail</text>
</svg>`
}

// ─── Component ─────────────────────────────────────────────────

export function ShareCard({ stats, timeRange, currency, theme, selectedSources, selectedModels }: ShareCardProps) {
  const { lang, t } = useLang()
  const [open, setOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'unsupported'>('idle')
  const svgRef = useRef<string>('')

  const hasData = !!stats && (stats.total_tokens > 0 || stats.total_requests > 0)

  const filterLabel = selectedSources.length > 0 || selectedModels.length > 0
    ? `${selectedSources.length + selectedModels.length} ${lang === 'zh' ? '项筛选' : 'filters'}`
    : (lang === 'zh' ? '全部' : 'All')

  const texts = {
    totalTokens: lang === 'zh' ? '总 Token' : 'Total Tokens',
    requests: t('share.requests'),
    dailyAvg: t('share.dailyAvg'),
    trend: t('share.trend'),
    topSources: t('share.topSources'),
    topModels: t('share.topModels'),
    privacyNote: t('share.privacyNote'),
  }

  const generateSVG = useCallback(() => {
    if (!stats) return ''
    return buildShareSVG(stats, theme, lang, currency, timeRange, filterLabel, texts)
  }, [stats, theme, lang, currency, timeRange, filterLabel])

  const handleDownload = useCallback(async () => {
    if (!hasData) return
    setGenerating(true)
    try {
      const svgStr = generateSVG()
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image load failed'))
        img.src = url
      })
      const canvas = document.createElement('canvas')
      const scale = 2
      canvas.width = CARD_W * scale
      canvas.height = CARD_H * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no ctx')
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return
        const pngUrl = URL.createObjectURL(pngBlob)
        const a = document.createElement('a')
        a.href = pngUrl
        a.download = `tokentrail-${timeRange}d-${Date.now()}.png`
        a.click()
        URL.revokeObjectURL(pngUrl)
      }, 'image/png')
    } catch {
      // fallback: download SVG directly
      const svgStr = generateSVG()
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tokentrail-${timeRange}d-${Date.now()}.svg`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setGenerating(false)
    }
  }, [hasData, generateSVG, timeRange])

  const handleCopy = useCallback(async () => {
    if (!hasData) return
    setGenerating(true)
    try {
      const svgStr = generateSVG()
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image load failed'))
        img.src = url
      })
      const canvas = document.createElement('canvas')
      const scale = 2
      canvas.width = CARD_W * scale
      canvas.height = CARD_H * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no ctx')
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)

      canvas.toBlob(async (pngBlob) => {
        if (!pngBlob) return
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': pngBlob }),
          ])
          setCopyState('copied')
          setTimeout(() => setCopyState('idle'), 2000)
        } catch {
          setCopyState('unsupported')
          setTimeout(() => setCopyState('idle'), 3000)
        }
      }, 'image/png')
    } catch {
      setCopyState('unsupported')
      setTimeout(() => setCopyState('idle'), 3000)
    } finally {
      setGenerating(false)
    }
  }, [hasData, generateSVG])

  if (!hasData) {
    return (
      <button
        type="button"
        disabled
        className="min-h-[32px] rounded-md border border-eva-border bg-eva-bg/30 px-3 py-1.5 text-xs font-mono text-eva-text-dim/40 cursor-not-allowed"
        title={t('share.noData')}
      >
        {t('share.button')}
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[32px] rounded-md border border-eva-border bg-eva-bg/50 px-3 py-1.5 text-xs font-mono text-eva-text-dim transition-[transform,border-color,background-color,color,box-shadow] duration-200 hover:border-eva-purple/30 hover:text-eva-purple active:scale-95"
      >
        {t('share.button')}
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative z-10 mx-4 w-full max-w-[760px] rounded-xl border border-eva-border bg-eva-bg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-eva-border px-5 py-3">
              <h2 className="theme-display text-sm font-semibold tracking-[0.12em]">
                {t('share.title')}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-eva-text-dim hover:text-eva-text"
              >
                ✕
              </button>
            </div>

            {/* Preview */}
            <div className="flex justify-center p-5">
              <div
                className="w-full max-w-[680px] overflow-hidden rounded-lg border border-eva-border/50"
                dangerouslySetInnerHTML={{ __html: generateSVG() }}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-eva-border px-5 py-3">
              <button
                type="button"
                onClick={handleDownload}
                disabled={generating}
                className="min-h-[32px] rounded-md border border-eva-green/30 bg-eva-green/10 px-4 py-1.5 text-xs font-mono text-eva-green transition hover:bg-eva-green/20 disabled:opacity-50"
              >
                {generating ? t('share.generating') : t('share.download')}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={generating}
                className="min-h-[32px] rounded-md border border-eva-purple/30 bg-eva-purple/10 px-4 py-1.5 text-xs font-mono text-eva-purple transition hover:bg-eva-purple/20 disabled:opacity-50"
              >
                {copyState === 'copied' ? t('share.copied')
                  : copyState === 'unsupported' ? t('share.copyUnsupported')
                  : generating ? t('share.generating')
                  : t('share.copy')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
