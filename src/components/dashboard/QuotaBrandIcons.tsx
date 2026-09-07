'use client'

import React, { useId } from 'react'

/** 账号额度头部计量表 / 仪表盘图标 */
export function QuotaGaugeIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 12l4-4" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.4" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  )
}

/** OpenAI / Codex 品牌图标 */
export function CodexBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#0d0f12] border border-white/10 p-1 ${className}`}>
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-full text-white">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1683a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4947zm-9.66-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1402-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1683a.0757.0757 0 0 1-.071 0l-4.8303-2.7866A4.4992 4.4992 0 0 1 2.3408 7.872zm16.597 3.8558L13.1038 8.3829l2.0153-1.1635a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.6863zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1635a.0804.0804 0 0 1-.038-.0567V6.0748a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.4598a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
      </svg>
    </div>
  )
}

/** Google Antigravity 官方品牌图标 (antigravity.google) */
export function AntigravityBrandIcon({ className = 'size-6' }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const maskId = `ag-mask-${uid}`
  const f1 = `ag-f1-${uid}`
  const f2 = `ag-f2-${uid}`
  const f3 = `ag-f3-${uid}`
  const f6 = `ag-f6-${uid}`
  const f7 = `ag-f7-${uid}`
  const f8 = `ag-f8-${uid}`
  const f10 = `ag-f10-${uid}`

  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#0b0f19] border border-blue-500/25 p-1 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" className="size-full">
        <mask id={maskId} maskUnits="userSpaceOnUse" width="24" height="23" x="0" y="1">
          <path
            d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"
            fill="#fff"
          />
        </mask>
        <g mask={`url(#${maskId})`}>
          <g filter={`url(#${f1})`}>
            <path d="M-1.018-3.992c-.408 3.591 2.686 6.89 6.91 7.37 4.225.48 7.98-2.043 8.387-5.633.408-3.59-2.686-6.89-6.91-7.37-4.225-.479-7.98 2.043-8.387 5.633z" fill="#FFE432" />
          </g>
          <g filter={`url(#${f2})`}>
            <path d="M15.269 7.747c1.058 4.557 5.691 7.374 10.348 6.293 4.657-1.082 7.575-5.653 6.516-10.21-1.058-4.556-5.691-7.374-10.348-6.292-4.657 1.082-7.575 5.653-6.516 10.21z" fill="#FC413D" />
          </g>
          <g filter={`url(#${f3})`}>
            <path d="M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z" fill="#00B95C" />
          </g>
          <g filter={`url(#${f6})`}>
            <path d="M9.932 27.617c1.04 4.482 5.384 7.303 9.7 6.3 4.316-1.002 6.971-5.448 5.93-9.93-1.04-4.483-5.384-7.304-9.7-6.301-4.316 1.002-6.971 5.448-5.93 9.93z" fill="#3186FF" />
          </g>
          <g filter={`url(#${f7})`}>
            <path d="M2.572-8.185C.392-3.329 2.778 2.472 7.9 4.771c5.122 2.3 11.042.227 13.222-4.63 2.18-4.855-.205-10.656-5.327-12.955-5.122-2.3-11.042-.227-13.222 4.63z" fill="#FBBC04" />
          </g>
          <g filter={`url(#${f8})`}>
            <path d="M-3.267 38.686c-5.277-2.072 3.742-19.117 5.984-24.83 2.243-5.712 8.34-8.664 13.616-6.592 5.278 2.071 11.533 13.482 9.29 19.195-2.242 5.713-23.613 14.298-28.89 12.227z" fill="#3186FF" />
          </g>
          <g filter={`url(#${f10})`}>
            <path d="M18.163 9.077c5.81 3.93 12.502 4.19 14.946.577 2.443-3.612-.287-9.727-6.098-13.658-5.81-3.931-12.502-4.19-14.946-.577-2.443 3.612.287 9.727 6.098 13.658z" fill="#FC413D" />
          </g>
        </g>
        <defs>
          <filter id={f1} colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="1.12" /></filter>
          <filter id={f2} colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="5.4" /></filter>
          <filter id={f3} colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="4.6" /></filter>
          <filter id={f6} colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="4.36" /></filter>
          <filter id={f7} colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="3.95" /></filter>
          <filter id={f8} colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="3.53" /></filter>
          <filter id={f10} colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="2.67" /></filter>
        </defs>
      </svg>
    </div>
  )
}

/** 兼容旧引用 */
export const GeminiBrandIcon = AntigravityBrandIcon

/** xAI Grok 官方品牌图标 (grok.com) */
export function GrokBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#000000] border border-white/10 p-1 ${className}`}>
      <svg viewBox="0 0 512 512" fill="currentColor" className="size-full text-white">
        <path d="M210.484 312.759L343.465 210.383C349.984 205.364 359.302 207.322 362.408 215.117C378.758 256.231 371.454 305.64 338.925 339.563C306.397 373.487 261.137 380.927 219.768 363.983L174.577 385.803C239.394 432.008 318.104 420.581 367.289 369.251C406.303 328.564 418.386 273.104 407.088 223.091L407.19 223.198C390.807 149.726 411.218 120.359 453.03 60.3072C454.02 58.8833 455.01 57.4595 456 56L400.978 113.382V113.204L210.45 312.794" />
        <path d="M183.042 337.641C136.519 291.294 144.54 219.567 184.236 178.203C213.59 147.59 261.683 135.096 303.666 153.464L348.755 131.75C340.632 125.627 330.221 119.042 318.275 114.414C264.277 91.2407 199.63 102.774 155.735 148.516C113.513 192.549 100.236 260.254 123.036 318.027C140.069 361.206 112.148 391.748 84.0229 422.575C74.0561 433.503 64.0553 444.431 56 456L183.007 337.677" />
      </svg>
    </div>
  )
}

/** 智谱 GLM 官方品牌图标 (zhipuai.cn / bigmodel.cn) */
export function GlmBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#0d111d] border border-blue-500/25 p-1 ${className}`}>
      <svg viewBox="0 0 30 30" fill="currentColor" className="size-full text-white">
        <path d="M15.47 7.1l-1.3 1.85c-.2.29-.54.47-.9.47H6.17V7.09H15.47z" />
        <polygon points="24.3,7.1 13.14,22.91 5.7,22.91 16.86,7.1" />
        <path d="M14.53 22.91l1.31-1.86c.2-.29.54-.47.9-.47h7.09v2.33H14.53z" />
      </svg>
    </div>
  )
}

/** Moonshot Kimi 品牌图标 */
export function KimiBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#0f172a] border border-white/10 p-1 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" className="size-full">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#0f172a" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" />
        <path
          d="M7 6V18M7 12L15 6M9.5 10L16.5 18"
          stroke="#ffffff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

export function ClaudeBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#D97757] border border-black/10 p-1 ${className}`}>
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-full text-white">
        <path d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z" />
        <path d="M18 16L18.9 19.1L22 20L18.9 20.9L18 24L17.1 20.9L14 20L17.1 19.1L18 16Z" opacity="0.8" />
        <path d="M6 16L6.9 19.1L10 20L6.9 20.9L6 24L5.1 20.9L2 20L5.1 19.1L6 16Z" opacity="0.8" />
      </svg>
    </div>
  )
}

export function OpenClawBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#E11D48] border border-black/10 p-1 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-full text-white">
        <path d="M18 11a6 6 0 0 0-12 0c0 7 6 10 6 10s6-3 6-10z" />
        <path d="M9 10a3 3 0 0 0 6 0" />
      </svg>
    </div>
  )
}

export function HermesBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#6366F1] border border-black/10 p-1 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-full text-white">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    </div>
  )
}

export function TraeBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#059669] border border-black/10 p-1 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-full text-white">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    </div>
  )
}

/** 根据 Provider ID 渲染对应的品牌图标 */
export function ProviderBrandIcon({ provider, className = 'size-7' }: { provider: string; className?: string }) {
  const normalized = provider.toLowerCase()
  switch (normalized) {
    case 'codex':
    case 'codex-review':
      return <CodexBrandIcon className={className} />
    case 'gemini':
    case 'antigravity':
      return <AntigravityBrandIcon className={className} />
    case 'grok':
      return <GrokBrandIcon className={className} />
    case 'glm':
      return <GlmBrandIcon className={className} />
    case 'kimi':
    case 'kimi-code':
      return <KimiBrandIcon className={className} />
    case 'claude':
    case 'claude-code':
      return <ClaudeBrandIcon className={className} />
    case 'openclaw':
      return <OpenClawBrandIcon className={className} />
    case 'hermes':
      return <HermesBrandIcon className={className} />
    case 'traework':
    case 'trae':
      return <TraeBrandIcon className={className} />
    default:
      return (
        <div className={`flex shrink-0 items-center justify-center rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono font-bold uppercase text-workbench-text-muted ${className}`}>
          {provider.slice(0, 2)}
        </div>
      )
  }
}
