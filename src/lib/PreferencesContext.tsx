'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { Currency, Theme } from '@/types'
import { DEFAULT_THEME, normalizeTheme } from '@/lib/themes'
import { USD_CNY_EXCHANGE_RATE } from '@/lib/currency'

interface UserPreferences {
  currency: Currency
  theme: Theme
  showProjectNames: boolean
  exchangeRate: number
}

interface PreferencesContextValue extends UserPreferences {
  setCurrency: (c: Currency) => void
  setTheme: (t: Theme) => void
  setShowProjectNames: (show: boolean) => void
  setExchangeRate: (rate: number) => void
  isHydrated: boolean
  syncing: boolean
  lastSyncResult: {
    success: boolean
    message: string
    timestamp: number
    details?: { source: string; scanned: number; inserted: number; duplicates: number; errors: number }[]
  } | null
  refreshKey: number
  triggerSync: () => Promise<boolean>
}

const STORAGE_KEY = 'tokentrail-prefs'

const defaultPreferences: UserPreferences = {
  currency: 'USD',
  theme: DEFAULT_THEME,
  showProjectNames: false,
  exchangeRate: USD_CNY_EXCHANGE_RATE.rate,
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences)
  const [isHydrated, setIsHydrated] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<PreferencesContextValue['lastSyncResult']>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Hydrate preferences from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        setPreferences({
          currency: parsed.currency === 'RMB' ? 'RMB' : 'USD',
          theme: normalizeTheme(parsed.theme),
          showProjectNames: Boolean(parsed.showProjectNames),
          exchangeRate: typeof parsed.exchangeRate === 'number' && parsed.exchangeRate > 0
            ? parsed.exchangeRate
            : USD_CNY_EXCHANGE_RATE.rate,
        })
      }
    } catch {
      // Fall back to defaults
    } finally {
      setIsHydrated(true)
    }
  }, [])

  // Save changes to localStorage & update DOM
  const updatePreference = useCallback(<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPreferences(prev => {
      const next = { ...prev, [key]: value }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }, [])

  const setCurrency = useCallback((currency: Currency) => {
    updatePreference('currency', currency)
  }, [updatePreference])

  const setTheme = useCallback((theme: Theme) => {
    updatePreference('theme', theme)
    document.documentElement.dataset.theme = theme
  }, [updatePreference])

  const setShowProjectNames = useCallback((show: boolean) => {
    updatePreference('showProjectNames', show)
  }, [updatePreference])

  const setExchangeRate = useCallback((rate: number) => {
    updatePreference('exchangeRate', rate)
  }, [updatePreference])

  // Global sync trigger
  const triggerSync = useCallback(async () => {
    if (syncing) return false
    setSyncing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.success) {
        setLastSyncResult({
          success: true,
          message: `+${data.inserted} records (${data.scanned} scanned)`,
          timestamp: Date.now(),
          details: Array.isArray(data.details) ? data.details : undefined,
        })
        setRefreshKey(k => k + 1)
        return true
      } else {
        setLastSyncResult({
          success: false,
          message: data.error || 'Sync failed',
          timestamp: Date.now(),
        })
        return false
      }
    } catch (err) {
      setLastSyncResult({
        success: false,
        message: err instanceof Error ? err.message : 'Network error',
        timestamp: Date.now(),
      })
      return false
    } finally {
      setSyncing(false)
    }
  }, [syncing])

  return (
    <PreferencesContext.Provider
      value={{
        ...preferences,
        setCurrency,
        setTheme,
        setShowProjectNames,
        setExchangeRate,
        isHydrated,
        syncing,
        lastSyncResult,
        refreshKey,
        triggerSync,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  )
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider')
  return ctx
}
