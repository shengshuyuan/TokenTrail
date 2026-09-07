'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLang } from '@/lib/LanguageContext'

interface NavItem {
  href: string
  labelZh: string
  labelEn: string
  icon: (active: boolean) => React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    labelZh: '总览',
    labelEn: 'Overview',
    icon: (active) => (
      <svg
        className={`w-5 h-5 transition-colors ${active ? 'text-workbench-accent' : 'text-workbench-text-muted'}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" />
        <path d="M9 21V12h6v9" />
      </svg>
    ),
  },
  {
    href: '/usage',
    labelZh: '用量分析',
    labelEn: 'Usage',
    icon: (active) => (
      <svg
        className={`w-5 h-5 transition-colors ${active ? 'text-workbench-accent' : 'text-workbench-text-muted'}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    href: '/quotas',
    labelZh: '账号额度',
    labelEn: 'Quotas',
    icon: (active) => (
      <svg
        className={`w-5 h-5 transition-colors ${active ? 'text-workbench-accent' : 'text-workbench-text-muted'}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    ),
  },
  {
    href: '/connections',
    labelZh: '数据接入',
    labelEn: 'Connections',
    icon: (active) => (
      <svg
        className={`w-5 h-5 transition-colors ${active ? 'text-workbench-accent' : 'text-workbench-text-muted'}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
]

export function Sidebar({ onCloseMobile }: { onCloseMobile?: () => void }) {
  const pathname = usePathname()
  const { lang } = useLang()
  const [serviceHealthy, setServiceHealthy] = useState<boolean | null>(null)

  // Check health status periodically
  useEffect(() => {
    let mounted = true
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/health')
        if (mounted) setServiceHealthy(res.ok)
      } catch {
        if (mounted) setServiceHealthy(false)
      }
    }
    checkStatus()
    const timer = setInterval(checkStatus, 30000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  return (
    <aside className="w-[216px] h-screen bg-workbench-sidebar border-r border-workbench-border flex flex-col justify-between select-none py-6 px-3 shrink-0">
      {/* Top section: Logo & Nav */}
      <div>
        {/* Brand Header */}
        <Link
          href="/"
          onClick={onCloseMobile}
          className="flex items-center gap-2.5 px-3 py-2 mb-6 group transition-opacity hover:opacity-90"
        >
          {/* Green T Icon */}
          <div className="w-8 h-8 rounded-lg bg-workbench-accent flex items-center justify-center shadow-xs">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16" />
              <path d="M12 7v13" />
              <circle cx="12" cy="20" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <span className="text-[17px] font-bold tracking-tight text-workbench-text">TokenTrail</span>
        </Link>

        {/* Navigation list */}
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-workbench-accent-light text-workbench-accent font-semibold shadow-2xs'
                    : 'text-workbench-text-muted hover:text-workbench-text hover:bg-black/[0.03]'
                }`}
              >
                {item.icon(isActive)}
                <span>{lang === 'zh' ? item.labelZh : item.labelEn}</span>
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Bottom section: Settings & System Status */}
      <div className="space-y-1 pt-4 border-t border-workbench-border/60">
        {/* Settings link */}
        <Link
          href="/settings"
          onClick={onCloseMobile}
          className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            pathname === '/settings'
              ? 'bg-workbench-accent-light text-workbench-accent font-semibold'
              : 'text-workbench-text-muted hover:text-workbench-text hover:bg-black/[0.03]'
          }`}
        >
          <svg
            className={`w-5 h-5 ${pathname === '/settings' ? 'text-workbench-accent' : 'text-workbench-text-muted'}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
          <span>{lang === 'zh' ? '设置' : 'Settings'}</span>
        </Link>

        {/* Local Service Status */}
        <Link
          href="/settings#service"
          onClick={onCloseMobile}
          className="flex items-center justify-between px-3.5 py-2 rounded-lg text-xs font-medium text-workbench-text-muted hover:text-workbench-text hover:bg-black/[0.03] transition-colors"
        >
          <div className="flex items-center gap-3">
            <svg
              className="w-4 h-4 text-workbench-text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span>{lang === 'zh' ? '本地运行' : 'Local Service'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                serviceHealthy === null
                  ? 'bg-gray-400 animate-pulse'
                  : serviceHealthy
                  ? 'bg-emerald-500'
                  : 'bg-red-500'
              }`}
            />
            <span className="text-[11px] text-workbench-text-muted">
              {serviceHealthy === null
                ? '...'
                : serviceHealthy
                ? lang === 'zh'
                  ? '正常'
                  : 'Healthy'
                : lang === 'zh'
                ? '异常'
                : 'Offline'}
            </span>
          </div>
        </Link>
      </div>
    </aside>
  )
}
