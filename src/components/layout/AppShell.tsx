'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Sidebar } from './Sidebar'
import { usePreferences } from '@/lib/PreferencesContext'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { lastSyncResult } = usePreferences()

  return (
    <div className="flex min-h-screen bg-workbench-bg text-workbench-text selection:bg-workbench-accent/15 selection:text-workbench-accent">
      {/* Desktop Sidebar (hidden on small screens) */}
      <div className="hidden md:block shrink-0 sticky top-0 h-screen z-30">
        <Sidebar />
      </div>

      {/* Mobile Header (<768px) */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-workbench-sidebar border-b border-workbench-border flex items-center justify-between px-4 z-40">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-workbench-accent flex items-center justify-center">
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16" />
              <path d="M12 7v13" />
              <circle cx="12" cy="20" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <span className="font-bold text-base text-workbench-text">TokenTrail</span>
        </Link>

        <button
          type="button"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          aria-label="Toggle menu"
          className="p-1.5 rounded-lg text-workbench-text-muted hover:text-workbench-text hover:bg-black/5"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {mobileNavOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileNavOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-50 backdrop-blur-xs transition-opacity"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="w-[240px] h-full bg-workbench-sidebar shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar onCloseMobile={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 w-full min-w-0 md:pt-0 pt-14 flex flex-col justify-between">
        <div className="w-full max-w-[1240px] mx-auto px-4 sm:px-8 lg:px-10 py-6 sm:py-9">
          {/* Sync notification banner if recently triggered */}
          {lastSyncResult && Date.now() - lastSyncResult.timestamp < 6000 && (
            <div
              role="alert"
              className={`mb-6 p-3 rounded-lg border text-sm flex items-center justify-between transition-all ${
                lastSyncResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{lastSyncResult.success ? '✓' : '✗'}</span>
                <span>{lastSyncResult.message}</span>
              </div>
            </div>
          )}

          {children}
        </div>

        {/* Global Footer Note */}
        <footer className="w-full max-w-[1240px] mx-auto px-4 sm:px-8 lg:px-10 py-6 border-t border-workbench-border/60 text-xs text-workbench-text-muted flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>ⓘ 费用按模型价格估算，不代表实际账单。</span>
          <span className="text-[11px] text-workbench-text-muted/80">TokenTrail · Personal AI Usage Workbench</span>
        </footer>
      </main>
    </div>
  )
}
