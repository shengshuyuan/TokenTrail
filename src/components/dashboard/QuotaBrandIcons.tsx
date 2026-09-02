'use client'

import React from 'react'

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

/** Google Gemini 品牌图标 */
export function GeminiBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1e293b] to-[#0f172a] border border-blue-500/20 p-1 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" className="size-full">
        <path
          d="M12 2C12 7.52285 16.4772 12 22 12C16.4772 12 12 16.4772 12 22C12 16.4772 7.52285 12 2 12C7.52285 12 12 7.52285 12 2Z"
          fill="url(#gemini-grad)"
        />
        <defs>
          <linearGradient id="gemini-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#38bdf8" />
            <stop offset="0.5" stopColor="#818cf8" />
            <stop offset="1" stopColor="#c084fc" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

/** xAI Grok 品牌图标 */
export function GrokBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#0d0f12] border border-white/10 p-1 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="size-full text-white">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <line x1="6" y1="18" x2="18" y2="6" stroke="currentColor" strokeWidth="2.4" />
      </svg>
    </div>
  )
}

/** 智谱 GLM 品牌图标 */
export function GlmBrandIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-[#141026] border border-purple-500/20 p-1 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" className="size-full">
        <path
          d="M12 3L20 7.5V16.5L12 21L4 16.5V7.5L12 3Z"
          stroke="url(#glm-grad)"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M12 12L20 7.5M12 12V21M12 12L4 7.5"
          stroke="url(#glm-grad)"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="3" fill="#a855f7" fillOpacity="0.8" />
        <defs>
          <linearGradient id="glm-grad" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6366f1" />
            <stop offset="0.5" stopColor="#a855f7" />
            <stop offset="1" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
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

/** 根据 Provider ID 渲染对应的品牌图标 */
export function ProviderBrandIcon({ provider, className = 'size-7' }: { provider: string; className?: string }) {
  switch (provider) {
    case 'codex':
      return <CodexBrandIcon className={className} />
    case 'gemini':
      return <GeminiBrandIcon className={className} />
    case 'grok':
      return <GrokBrandIcon className={className} />
    case 'glm':
      return <GlmBrandIcon className={className} />
    case 'kimi':
      return <KimiBrandIcon className={className} />
    default:
      return (
        <div className={`flex shrink-0 items-center justify-center rounded-lg bg-eva-panel border border-eva-border text-xs font-mono font-bold uppercase text-eva-text ${className}`}>
          {provider.slice(0, 2)}
        </div>
      )
  }
}
