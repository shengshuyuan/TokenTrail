'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProviderId, QuotasResponse } from './types'
import { usePreferences } from '@/lib/PreferencesContext'
import {
  acceptQuotaResponse,
  beginQuotaRead,
  beginQuotaRefresh,
  createQuotaRequestGate,
  finishQuotaRefresh,
  type QuotaRequestGate,
} from './request-order'

/** Poll while the server is still refreshing. Ten tries cover adapter timeouts. */
export const BACKGROUND_POLL_MS = 3000
export const MAX_BACKGROUND_POLLS = 10

export interface QuotaRefreshOutcome {
  ok: boolean
  json: QuotasResponse
}

/**
 * Shared quota snapshot for the overview preview and the quotas page.
 * Polls while `refreshing` is set, keeps the previous snapshot on failure,
 * and drops a late GET that would overwrite a newer manual refresh.
 */
export function useQuotas() {
  const { quotaVisibleProviders, isHydrated } = usePreferences()
  // null = every product shown; otherwise only these are queried (Settings → 账号额度设置).
  const visibleKey = quotaVisibleProviders === null ? null : quotaVisibleProviders.join(',')
  const [data, setData] = useState<QuotasResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const gateRef = useRef<QuotaRequestGate>(createQuotaRequestGate())
  const pollCountRef = useRef(0)

  const fetchQuotas = useCallback(async () => {
    // Wait for saved preferences, otherwise the first read would query hidden products.
    if (!isHydrated) return
    const requestId = beginQuotaRead(gateRef.current)
    if (requestId == null) return
    try {
      const query = visibleKey === null ? '' : `?providers=${encodeURIComponent(visibleKey)}`
      const res = await fetch(`/api/quotas${query}`, { cache: 'no-store' })
      if (!acceptQuotaResponse(requestId, gateRef.current.latestId)) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: QuotasResponse = await res.json()
      if (!acceptQuotaResponse(requestId, gateRef.current.latestId)) return
      setData(json)
      setLoadError(null)
    } catch (err) {
      if (!acceptQuotaResponse(requestId, gateRef.current.latestId)) return
      console.error('[TokenTrail] quotas: load failed', err)
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      if (acceptQuotaResponse(requestId, gateRef.current.latestId)) setLoading(false)
    }
  }, [isHydrated, visibleKey])

  const refresh = useCallback(async (provider?: ProviderId): Promise<QuotaRefreshOutcome | null> => {
    const requestId = beginQuotaRefresh(gateRef.current)
    if (requestId == null) return null
    setRefreshing(true)
    try {
      const body: { provider?: ProviderId; providers?: string[] } = {}
      if (provider) body.provider = provider
      if (visibleKey !== null) body.providers = visibleKey ? visibleKey.split(',') : []
      const hasBody = Object.keys(body).length > 0
      const res = await fetch('/api/quotas/refresh', {
        method: 'POST',
        headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(body) : undefined,
      })
      const json = await res.json().catch(() => ({
        status: 'network_error',
        attention_count: 0,
        providers: [],
        updated_at: null,
        refreshing: false,
      })) as QuotasResponse
      if (!acceptQuotaResponse(requestId, gateRef.current.latestId)) return null
      if (res.ok && Array.isArray(json.providers)) {
        setData(json)
        setLoadError(null)
      }
      return { ok: res.ok, json }
    } catch (err) {
      if (!acceptQuotaResponse(requestId, gateRef.current.latestId)) return null
      console.error('[TokenTrail] quotas: refresh failed', err)
      return {
        ok: false,
        json: {
          status: 'network_error',
          attention_count: 0,
          providers: [],
          updated_at: null,
          refreshing: false,
          error: err instanceof Error ? err.message : String(err),
        },
      }
    } finally {
      finishQuotaRefresh(gateRef.current, requestId)
      if (acceptQuotaResponse(requestId, gateRef.current.latestId)) setRefreshing(false)
    }
  }, [visibleKey])

  useEffect(() => {
    fetchQuotas()
  }, [fetchQuotas])

  const backgroundRefreshing = Boolean(data?.refreshing) && !refreshing
  useEffect(() => {
    if (!backgroundRefreshing) {
      pollCountRef.current = 0
      return
    }
    if (pollCountRef.current >= MAX_BACKGROUND_POLLS) return
    const timer = setTimeout(() => {
      pollCountRef.current += 1
      fetchQuotas()
    }, BACKGROUND_POLL_MS)
    return () => clearTimeout(timer)
  }, [backgroundRefreshing, data, fetchQuotas])

  return { data, loading, loadError, refreshing, fetchQuotas, refresh, backgroundRefreshing }
}
