'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { StatsResponse, Currency, Theme, TimeRange } from '@/types'
import { formatTokens, formatCost, formatNumber } from '@/lib/format'
import { getThemeDefinition } from '@/lib/themes'
import { LOGO_DATA_URI } from '@/lib/logo-data-uri'
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

const CARD_W = 1200
const CARD_H = 675
const PADDING = 48
const SAFE_BOTTOM = 32

// ─── Theme-aware panel path (radius + chamfer) ──────────────────

function panelPath(
  x: number, y: number, w: number, h: number,
  radius: number, chamfer: number, corners: 'tr-bl' | 'tl-br' | 'none',
): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  if (chamfer > 0 && corners !== 'none') {
    const c = Math.min(chamfer, w / 2, h / 2)
    if (corners === 'tr-bl') {
      // sharp TL + BR; cut TR + BL
      return [
        `M ${x} ${y}`,
        `L ${x + w - c} ${y}`,
        `L ${x + w} ${y + c}`,
        `L ${x + w} ${y + h}`,
        `L ${x + c} ${y + h}`,
        `L ${x} ${y + h - c}`,
        'Z',
      ].join(' ')
    }
    // tl-br: sharp TR + BL; cut TL + BR
    return [
      `M ${x + c} ${y}`,
      `L ${x + w} ${y}`,
      `L ${x + w} ${y + h - c}`,
      `L ${x + w - c} ${y + h}`,
      `L ${x} ${y + h}`,
      `L ${x} ${y + c}`,
      'Z',
    ].join(' ')
  }
  return [
    `M ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `L ${x + w} ${y + h - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `L ${x + r} ${y + h}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `L ${x} ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ')
}

const truncName = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Escape dynamic text before interpolating into SVG — prevents & < > " ' from breaking preview / PNG export / dangerouslySetInnerHTML. */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;')
   .replace(/</g, '&lt;')
   .replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;')
   .replace(/'/g, '&#39;')

function buildShareSVG(
  stats: StatsResponse,
  theme: Theme,
  lang: 'zh' | 'en',
  currency: Currency,
  generatedLabel: string,
  scopeLabel: string,
  texts: Record<string, string>
): string {
  const td = getThemeDefinition(theme)
  const {
    canvas, surface, primary, secondary, tertiary, text: textColor, muted,
    border, chart, radius, chamfer, chamferCorners, decoration, font,
  } = td.preview
  const chart0 = chart[0] ?? primary
  const fontFamily = font.replace(/"/g, "'")
  const barR = Math.min(radius / 4, 3)
  const markR = Math.min(radius, 4)
  const L = (zh: string, en: string) => (lang === 'zh' ? zh : en)
  const tagline = L('本地 AI 用量追踪器', 'AI Usage Tracker')

  // ── Data ──
  const totalTokens = stats.total_tokens ?? 0
  const totalCost = stats.total_cost_usd ?? 0
  const totalReqs = stats.total_requests ?? 0
  const dailyAvg = stats.avg_daily_tokens ?? 0
  const daily = stats.daily ?? []
  const topSources = (stats.by_source ?? []).slice(0, 3)
  const topModels = (stats.by_model ?? []).slice(0, 3)

  // ── Geometry ──
  const contentRight = CARD_W - PADDING
  const contentW = contentRight - PADDING
  const colGap = 24
  const leftW = Math.round((contentW - colGap) * 0.42)      // 454
  const rightX = PADDING + leftW + colGap                    // 526
  const rightW = contentW - leftW - colGap                   // 626
  const halfW = Math.round((contentW - colGap) / 2)          // 540
  const rightColX = PADDING + halfW + colGap                 // 612

  const mainY = 108
  const mainH = 272
  const rankY = 408
  const rankH = 176

  // ── Trend geometry ──
  const trendPad = 24
  const trendX = rightX + trendPad
  const trendW = rightW - trendPad * 2
  const trendBottom = mainY + mainH - 24
  const trendTop = mainY + 54
  const trendH = trendBottom - trendTop
  const maxToken = Math.max(1, ...daily.map(d => d.total_tokens))
  const trendPts: ReadonlyArray<readonly [number, number]> = daily.length > 1
    ? daily.map((d, i) => {
        const x = trendX + (i / (daily.length - 1)) * trendW
        const y = trendBottom - (d.total_tokens / maxToken) * trendH
        return [x, y] as const
      })
    : []
  const trendLine = trendPts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const trendArea = trendPts.length > 1
    ? `M ${trendPts[0][0].toFixed(1)} ${trendBottom} ` +
      trendPts.map(p => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') +
      ` L ${trendPts[trendPts.length - 1][0].toFixed(1)} ${trendBottom} Z`
    : ''

  let peakIndex = 0
  let peakVal = 0
  daily.forEach((d, i) => {
    if (d.total_tokens > peakVal) {
      peakVal = d.total_tokens
      peakIndex = i
    }
  })
  const peakPt = trendPts[peakIndex]
  const lastPt = trendPts[trendPts.length - 1]

  // ── Panel renderer (surface + border + decoration line, per-panel weight) ──
  const decoInset = Math.max(chamfer, radius, 6)
  const renderPanel = (
    x: number, y: number, w: number, h: number,
    opts: {
      fill?: number; stroke?: number; deco?: number | false
      r?: number; ch?: number; cc?: 'tr-bl' | 'tl-br' | 'none'
    } = {},
  ) => {
    const r = opts.r ?? radius
    const ch = opts.ch ?? chamfer
    const cc = opts.cc ?? chamferCorners
    const fillO = opts.fill ?? 1
    const strokeO = opts.stroke ?? 1
    let s = `<path d="${panelPath(x, y, w, h, r, ch, cc)}" fill="${surface}" fill-opacity="${fillO}" stroke="${border}" stroke-opacity="${strokeO}" stroke-width="1"/>`
    if (opts.deco !== false) {
      s += `<rect x="${x + decoInset}" y="${y + 1}" width="${w - decoInset * 2}" height="2" fill="url(#deco-grad)" opacity="${opts.deco ?? 0.9}"/>`
    }
    return s
  }

  // ── Ranking rows with rank pills and percentage ──
  const rankRows = (items: { name: string; tokens: number }[], x: number, w: number) => {
    const innerX = x + 20
    const valueW = 110
    const rankPillW = 22
    const barMaxW = w - 40 - valueW - rankPillW - 8
    const maxV = Math.max(1, ...items.map(it => it.tokens))
    return items.map((it, i) => {
      const ry = 462 + i * 38
      const color = chart[i % chart.length] ?? primary
      const bw = (it.tokens / maxV) * barMaxW
      const pct = totalTokens > 0 ? ((it.tokens / totalTokens) * 100).toFixed(0) : '0'
      const rankNum = `0${i + 1}`

      return `<!-- Row ${i + 1} -->` +
        `<rect x="${innerX}" y="${ry - 11}" width="${rankPillW}" height="14" rx="3.5" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-opacity="0.35" stroke-width="0.8"/>` +
        `<text x="${innerX + rankPillW / 2}" y="${ry}" fill="${color}" font-family="${fontFamily}" font-size="9" font-weight="700" text-anchor="middle">${rankNum}</text>` +
        `<text x="${innerX + rankPillW + 8}" y="${ry}" fill="${textColor}" fill-opacity="0.9" font-family="${fontFamily}" font-size="12" font-weight="600">${esc(truncName(it.name, 20))}</text>` +
        `<text x="${x + w - 20}" y="${ry}" fill="${muted}" font-family="${fontFamily}" font-size="11" font-weight="500" text-anchor="end">${esc(formatTokens(it.tokens))} <tspan fill-opacity="0.65">(${pct}%)</tspan></text>` +
        `<rect x="${innerX + rankPillW + 8}" y="${ry + 8}" width="${barMaxW}" height="5" fill="${border}" fill-opacity="0.3" rx="${barR}"/>` +
        `<rect x="${innerX + rankPillW + 8}" y="${ry + 8}" width="${Math.max(barR * 2, bw).toFixed(1)}" height="5" fill="${color}" fill-opacity="0.92" rx="${barR}"/>`
    }).join('')
  }

  // ── Mini metric cards (inside the left summary panel) ──
  const miniMetrics = [
    { label: L('总费用', 'Cost'), value: formatCost(totalCost, currency), color: secondary },
    { label: texts.requests || L('请求数', 'Requests'), value: formatNumber(totalReqs), color: textColor },
    { label: texts.dailyAvg || L('日均', 'Daily avg'), value: formatTokens(dailyAvg), color: tertiary },
  ]
  const sumInner = 24
  const cardGap = 10
  const cardW = Math.floor((leftW - sumInner * 2 - cardGap * 2) / 3)   // 128
  const cardX0 = PADDING + sumInner                                    // 72
  const cardY = mainY + 112                                            // 220
  const cardH = 68
  const cardR = Math.min(radius, 6)

  // ── Hero number: shrink font with string length so large values don't overflow the panel ──
  const heroStr = formatTokens(totalTokens)
  const heroAvailW = leftW - sumInner * 2
  const heroSize = Math.max(26, Math.min(46, Math.floor(heroAvailW / (heroStr.length * 0.62))))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <defs>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${canvas}"/>
      <stop offset="100%" stop-color="${surface}" stop-opacity="0.95"/>
    </linearGradient>
    <radialGradient id="glow-l" cx="20%" cy="25%" r="45%">
      <stop offset="0%" stop-color="${primary}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="${primary}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow-r" cx="80%" cy="30%" r="50%">
      <stop offset="0%" stop-color="${secondary}" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="${secondary}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="deco-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${decoration}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${decoration}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${decoration}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${chart0}" stop-opacity="0.3"/>
      <stop offset="60%" stop-color="${chart0}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="${chart0}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Canvas & Ambient Glows -->
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg-grad)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#glow-l)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#glow-r)"/>
  <rect x="14" y="14" width="${CARD_W - 28}" height="${CARD_H - 28}" rx="${radius + 4}" fill="none" stroke="${border}" stroke-opacity="0.35" stroke-width="1"/>

  <!-- Header -->
  <g transform="translate(${PADDING}, 46)">
    <rect x="0" y="0" width="28" height="28" rx="7" fill="${primary}" fill-opacity="0.16" stroke="${primary}" stroke-opacity="0.4" stroke-width="1.2"/>
    <circle cx="14" cy="14" r="4.5" fill="${primary}"/>
    <circle cx="14" cy="14" r="8.5" fill="none" stroke="${primary}" stroke-opacity="0.5" stroke-width="1.2" stroke-dasharray="2 2"/>
    <text x="38" y="20" fill="${textColor}" font-family="${fontFamily}" font-size="18" font-weight="700" letter-spacing="1">TokenTrail</text>
    <rect x="156" y="5" width="82" height="18" rx="9" fill="${border}" fill-opacity="0.45" stroke="${border}" stroke-opacity="0.6" stroke-width="1"/>
    <text x="197" y="17" fill="${muted}" font-family="${fontFamily}" font-size="9" font-weight="600" text-anchor="middle" letter-spacing="0.6">ANALYTICS</text>
  </g>

  <!-- Date Pill on Top Right -->
  <g transform="translate(${contentRight - 140}, 48)">
    <rect x="0" y="0" width="140" height="24" rx="12" fill="${surface}" fill-opacity="0.8" stroke="${border}" stroke-opacity="0.6" stroke-width="1"/>
    <circle cx="14" cy="12" r="3" fill="${primary}"/>
    <text x="74" y="16" fill="${muted}" font-family="${fontFamily}" font-size="11" font-weight="500" text-anchor="middle">${esc(generatedLabel)}</text>
  </g>
  <line x1="${PADDING}" y1="88" x2="${contentRight}" y2="88" stroke="${border}" stroke-opacity="0.5" stroke-width="1"/>

  <!-- Main / left summary panel -->
  ${renderPanel(PADDING, mainY, leftW, mainH, { fill: 0.5, stroke: 0.75, deco: 0.4 })}
  <circle cx="${PADDING + sumInner}" cy="${mainY + 28}" r="3" fill="${primary}"/>
  <text x="${PADDING + sumInner + 10}" y="${mainY + 32}" fill="${muted}" font-family="${fontFamily}" font-size="11" font-weight="600" letter-spacing="0.8">${esc(texts.totalTokens)}</text>
  <text x="${PADDING + sumInner}" y="${mainY + 84}" fill="${primary}" font-family="${fontFamily}" font-size="${heroSize}" font-weight="800">${esc(heroStr)}</text>
  ${miniMetrics.map((m, i) => {
    const cx = cardX0 + i * (cardW + cardGap)
    const valSize = m.value.length > 9 ? 12.5 : m.value.length > 7 ? 14 : 15.5
    return renderPanel(cx, cardY, cardW, cardH, { fill: 0.45, stroke: 0.85, deco: false, r: cardR, ch: 0, cc: 'none' }) +
      `<rect x="${cx + 8}" y="${cardY + 1}" width="${cardW - 16}" height="2.5" rx="1.25" fill="${m.color}" fill-opacity="0.85"/>` +
      `<text x="${cx + 12}" y="${cardY + 23}" fill="${muted}" font-family="${fontFamily}" font-size="9.5" font-weight="500" letter-spacing="0.5">${esc(m.label)}</text>` +
      `<text x="${cx + 12}" y="${cardY + 50}" fill="${m.color}" font-family="${fontFamily}" font-size="${valSize}" font-weight="700">${esc(m.value)}</text>`
  }).join('')}
  <rect x="${PADDING + sumInner}" y="${mainY + mainH - 44}" width="${leftW - sumInner * 2}" height="24" rx="12" fill="${surface}" fill-opacity="0.75" stroke="${border}" stroke-opacity="0.5"/>
  <circle cx="${PADDING + sumInner + 12}" cy="${mainY + mainH - 32}" r="3" fill="${primary}"/>
  <text x="${PADDING + sumInner + 22}" y="${mainY + mainH - 28}" fill="${muted}" font-family="${fontFamily}" font-size="10.5" font-weight="500">${esc(scopeLabel)}</text>

  <!-- Main / right trend panel -->
  ${renderPanel(rightX, mainY, rightW, mainH)}
  <circle cx="${rightX + 22}" cy="${mainY + 26}" r="3" fill="${chart0}"/>
  <text x="${rightX + 32}" y="${mainY + 30}" fill="${muted}" font-family="${fontFamily}" font-size="11" font-weight="600" letter-spacing="0.8">${esc(texts.trend || 'TREND')}</text>
  ${maxToken > 0 ? `
    <rect x="${rightX + rightW - 134}" y="${mainY + 16}" width="114" height="20" rx="10" fill="${chart0}" fill-opacity="0.12" stroke="${chart0}" stroke-opacity="0.28" stroke-width="1"/>
    <text x="${rightX + rightW - 77}" y="${mainY + 30}" fill="${chart0}" font-family="${fontFamily}" font-size="9.5" font-weight="600" text-anchor="middle">PEAK: ${esc(formatTokens(maxToken))}</text>
  ` : ''}
  <!-- Trend Grid Lines -->
  <line x1="${trendX}" y1="${(trendBottom - 0.75 * trendH).toFixed(1)}" x2="${trendX + trendW}" y2="${(trendBottom - 0.75 * trendH).toFixed(1)}" stroke="${border}" stroke-opacity="0.2" stroke-dasharray="4 4" stroke-width="1"/>
  <line x1="${trendX}" y1="${(trendBottom - 0.5 * trendH).toFixed(1)}" x2="${trendX + trendW}" y2="${(trendBottom - 0.5 * trendH).toFixed(1)}" stroke="${border}" stroke-opacity="0.2" stroke-dasharray="4 4" stroke-width="1"/>
  <line x1="${trendX}" y1="${(trendBottom - 0.25 * trendH).toFixed(1)}" x2="${trendX + trendW}" y2="${(trendBottom - 0.25 * trendH).toFixed(1)}" stroke="${border}" stroke-opacity="0.2" stroke-dasharray="4 4" stroke-width="1"/>
  <line x1="${trendX}" y1="${trendBottom}" x2="${trendX + trendW}" y2="${trendBottom}" stroke="${border}" stroke-width="1" stroke-opacity="0.6"/>
  ${trendArea ? `<path d="${trendArea}" fill="url(#trend-area)"/>` : ''}
  ${trendLine ? `<polyline points="${trendLine}" fill="none" stroke="${chart0}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
  ${peakPt ? `
    <circle cx="${peakPt[0].toFixed(1)}" cy="${peakPt[1].toFixed(1)}" r="4.5" fill="${chart0}" stroke="${surface}" stroke-width="2"/>
    <circle cx="${peakPt[0].toFixed(1)}" cy="${peakPt[1].toFixed(1)}" r="7" fill="none" stroke="${chart0}" stroke-opacity="0.4" stroke-width="1.2"/>
  ` : ''}
  ${lastPt && lastPt !== peakPt ? `
    <circle cx="${lastPt[0].toFixed(1)}" cy="${lastPt[1].toFixed(1)}" r="3.5" fill="${secondary}" stroke="${surface}" stroke-width="1.8"/>
  ` : ''}
  ${daily.length <= 1 ? `<text x="${rightX + rightW / 2}" y="${mainY + mainH / 2}" fill="${muted}" font-family="${fontFamily}" font-size="12" text-anchor="middle">—</text>` : ''}

  <!-- Rankings divider -->
  <line x1="${PADDING}" y1="392" x2="${contentRight}" y2="392" stroke="${border}" stroke-width="1" stroke-opacity="0.5"/>

  <!-- Top sources panel -->
  ${renderPanel(PADDING, rankY, halfW, rankH)}
  <circle cx="${PADDING + 22}" cy="${rankY + 24}" r="3" fill="${primary}"/>
  <text x="${PADDING + 32}" y="${rankY + 28}" fill="${muted}" font-family="${fontFamily}" font-size="11" font-weight="600" letter-spacing="0.6">${esc(texts.topSources)}</text>
  ${topSources.length > 0 ? rankRows(topSources.map(s => ({ name: SOURCE_DISPLAY_NAMES[s.source] ?? s.source, tokens: s.total_tokens })), PADDING, halfW) : `<text x="${PADDING + halfW / 2}" y="${rankY + rankH / 2}" fill="${muted}" font-family="${fontFamily}" font-size="12" text-anchor="middle">—</text>`}

  <!-- Top models panel -->
  ${renderPanel(rightColX, rankY, halfW, rankH)}
  <circle cx="${rightColX + 22}" cy="${rankY + 24}" r="3" fill="${secondary}"/>
  <text x="${rightColX + 32}" y="${rankY + 28}" fill="${muted}" font-family="${fontFamily}" font-size="11" font-weight="600" letter-spacing="0.6">${esc(texts.topModels)}</text>
  ${topModels.length > 0 ? rankRows(topModels.map(m => ({ name: m.display_name || m.model, tokens: m.total_tokens })), rightColX, halfW) : `<text x="${rightColX + halfW / 2}" y="${rankY + rankH / 2}" fill="${muted}" font-family="${fontFamily}" font-size="12" text-anchor="middle">—</text>`}

  <!-- Footer -->
  <line x1="${PADDING}" y1="596" x2="${contentRight}" y2="596" stroke="${border}" stroke-width="1" stroke-opacity="0.5"/>
  <circle cx="${PADDING + 4}" cy="624" r="3" fill="${primary}" fill-opacity="0.75"/>
  <text x="${PADDING + 14}" y="628" fill="${muted}" font-family="${fontFamily}" font-size="10.5">${esc(tagline)}</text>
  <image href="${LOGO_DATA_URI}" x="${contentRight - 100}" y="614" width="20" height="20" preserveAspectRatio="xMidYMid meet"/>
  <text x="${contentRight - 72}" y="628" fill="${textColor}" font-family="${fontFamily}" font-size="11.5" font-weight="700" letter-spacing="0.5">TokenTrail</text>
</svg>`
}

// ─── Component ─────────────────────────────────────────────────

export function ShareCard({ stats, timeRange, currency, theme, selectedSources, selectedModels }: ShareCardProps) {
  const { lang, t } = useLang()
  const [open, setOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'unsupported'>('idle')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const closeModal = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) return

    const dialog = dialogRef.current
    const focusable = dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    focusable?.[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal()
        return
      }
      if (event.key !== 'Tab' || !focusable?.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeModal, open])

  const hasData = !!stats && (stats.total_tokens > 0 || stats.total_requests > 0)

  const rangeLabel = timeRange === 1 ? '24H' : `${timeRange}D`
  const sourcesLabel = selectedSources.length > 0
    ? `${selectedSources.length} ${lang === 'zh' ? '来源' : 'sources'}`
    : (lang === 'zh' ? '全部来源' : 'All sources')
  const modelsLabel = selectedModels.length > 0
    ? `${selectedModels.length} ${lang === 'zh' ? '模型' : 'models'}`
    : (lang === 'zh' ? '全部模型' : 'All models')
  const scopeLabel = `${rangeLabel} · ${sourcesLabel} · ${modelsLabel}`

  const generateSVG = useCallback(() => {
    if (!stats) return ''
    const texts = {
      totalTokens: lang === 'zh' ? '总 Token' : 'Total Tokens',
      requests: t('share.requests'),
      dailyAvg: t('share.dailyAvg'),
      trend: t('share.trend'),
      topSources: t('share.topSources'),
      topModels: t('share.topModels'),
    }
    const generatedLabel = lang === 'zh'
      ? new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
      : new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return buildShareSVG(stats, theme, lang, currency, generatedLabel, scopeLabel, texts)
  }, [stats, theme, lang, currency, scopeLabel, t])

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
        ref={triggerRef}
        type="button"
        disabled
        className="control-surface min-h-10 shrink-0 cursor-not-allowed px-3 py-1.5 text-xs font-mono opacity-45 sm:min-h-[32px]"
        title={t('share.noData')}
      >
        {t('share.button')}
      </button>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="control-surface pressable min-h-10 shrink-0 px-3 py-1.5 text-xs font-mono active:scale-95 sm:min-h-[32px]"
      >
        {t('share.button')}
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
          onClick={closeModal}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
            className="relative z-10 w-full max-w-[780px] rounded-xl border border-eva-border bg-eva-bg shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-eva-border bg-eva-panel/40 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-lg border border-eva-border bg-eva-panel text-eva-purple">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                </span>
                <div>
                  <h2 id="share-dialog-title" className="theme-display text-sm font-semibold text-eva-text">
                    {t('share.title')}
                  </h2>
                  <p className="text-[11px] font-mono text-eva-text-dim">
                    {t('share.privacyNote')} · 2x Retina PNG / SVG
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label={lang === 'zh' ? '关闭分享预览' : 'Close share preview'}
                className="rounded p-1.5 text-eva-text-dim transition hover:bg-eva-panel hover:text-eva-text"
              >
                ✕
              </button>
            </div>

            {/* Preview Frame */}
            <div className="flex justify-center p-4 sm:p-6 bg-black/30">
              <div
                className="w-full max-w-[720px] overflow-hidden rounded-lg border border-eva-border/70 shadow-2xl ring-1 ring-white/10 [&_svg]:block [&_svg]:w-full [&_svg]:h-auto"
                dangerouslySetInnerHTML={{ __html: generateSVG() }}
              />
            </div>

            {/* Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-eva-border bg-eva-panel/30 px-5 py-3.5">
              <div className="flex items-center gap-2 text-xs font-mono text-eva-text-dim">
                <span className="inline-block size-2 rounded-full bg-status-success animate-pulse" />
                <span>{scopeLabel}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={generating}
                  className="pressable control-surface inline-flex min-h-[34px] items-center gap-1.5 px-3.5 py-1.5 text-xs font-mono text-eva-text hover:border-eva-green/60 disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5 text-eva-green">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {generating ? t('share.generating') : t('share.download')}
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={generating}
                  className="pressable inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-eva-purple bg-eva-purple/20 px-4 py-1.5 text-xs font-mono font-semibold text-eva-text transition hover:bg-eva-purple/30 disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5 text-eva-purple">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  {copyState === 'copied' ? t('share.copied')
                    : copyState === 'unsupported' ? t('share.copyUnsupported')
                    : generating ? t('share.generating')
                    : t('share.copy')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
