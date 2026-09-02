'use client'

// ─── 额度进度条 ───────────────────────────────────────────────
// - 有官方 usedPercent 才绘制进度条，并提供 aria-valuenow
// - 没有明确上限时绝不构造 0%/100%，只显示原始计量值

interface QuotaProgressProps {
  percent?: number
  label: string
  tone: 'success' | 'warning' | 'danger'
}

const TONE_CLASS: Record<QuotaProgressProps['tone'], string> = {
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-danger',
}

export function QuotaProgress({ percent, label, tone }: QuotaProgressProps) {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null

  // 进度条宽度夹在 [2, 100]，0% 也保留可见的最小刻度
  const clamped = Math.max(0, Math.min(100, percent))
  const width = Math.max(2, clamped)

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={`${Math.round(clamped)}%`}
      className="h-1.5 w-full min-w-[64px] overflow-hidden rounded-full bg-eva-border/60"
    >
      <div
        className={`h-full rounded-full ${TONE_CLASS[tone]}`}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}
