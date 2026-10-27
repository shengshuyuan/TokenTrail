import { createDbQuotaStore } from '@/lib/quotas/db-store'

const { createAdapters } = require('../../lib/quotas/providers/index.js') as {
  createAdapters: (overrides?: Record<string, unknown>) => {
    deps: Record<string, unknown>
    adapters: Record<string, unknown>
  }
}
const refreshModule = require('../../lib/quotas/refresh.js') as {
  getQuotas: (deps: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>
  refreshAll: (deps: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>
  canManualRefresh: (lastManualAt: number | undefined, now: number) => boolean
  markManualRefresh: (now: number, provider?: string) => void
  markManualRefreshResult: (requestedProvider: string | undefined, succeededProviders: string[], now?: number) => void
  getLastManualRefreshAt: (provider?: string) => number
}
import { deleteConfig, getConfig } from '@/lib/db'
import { getQuotaSecret, QUOTA_SECRET_KEYS, setQuotaSecret } from '@/lib/quotas/secret-store'
import { QUOTA_PROVIDER_IDS, type ProviderId } from '@/lib/quotas/types'

const DB_CONFIG_KEYS = [
  'XAI_TEAM_ID',
  'ANTHROPIC_BASE_URL',
  'GOOGLE_CLOUD_PROJECT',
]

let legacySecretsMigrated = false

function migrateLegacySecrets(): void {
  if (legacySecretsMigrated) return
  legacySecretsMigrated = true
  for (const key of QUOTA_SECRET_KEYS) {
    const legacy = getConfig(key)
    if (!legacy) continue
    try {
      if (!getQuotaSecret(key)) setQuotaSecret(key, legacy)
      deleteConfig(key)
    } catch {
      // Keep the legacy value if Keychain is unavailable; never risk losing a credential.
    }
  }
}

function getMergedEnv(): Record<string, string | undefined> {
  migrateLegacySecrets()
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of QUOTA_SECRET_KEYS) {
    env[key] ||= getQuotaSecret(key) || getConfig(key)
  }
  for (const key of DB_CONFIG_KEYS) {
    const val = getConfig(key)
    if (val && !env[key]) {
      env[key] = val
    }
  }
  return env
}

function buildQuotaDeps(visibleProviders?: string[]): Record<string, unknown> {
  const mergedEnv = getMergedEnv()
  const { deps, adapters } = createAdapters({ env: mergedEnv })
  // Products switched off in Settings are neither queried nor returned.
  const scoped = visibleProviders
    ? Object.fromEntries(Object.entries(adapters).filter(([id]) => visibleProviders.includes(id)))
    : adapters
  return { ...deps, adapters: scoped, store: createDbQuotaStore() }
}

/**
 * Parse a `providers` filter (comma list or array) against the known ids.
 * undefined = no filter (all products); [] = every product switched off.
 */
export function parseVisibleProviders(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const list = Array.isArray(raw) ? raw : String(raw).split(',')
  return list
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id): id is ProviderId => (QUOTA_PROVIDER_IDS as string[]).includes(id))
}

/** GET /api/quotas：立即返回缓存；过期则后台去重刷新。 */
export function getQuotasForServer(options?: Record<string, unknown>, visibleProviders?: string[]): Promise<unknown> {
  return refreshModule.getQuotas(buildQuotaDeps(visibleProviders), options)
}

/** POST /api/quotas/refresh：强制刷新一轮（内部并发合并），返回带全局聚合。 */
export async function refreshQuotasForServer(providers?: string[], visibleProviders?: string[]): Promise<Record<string, unknown>> {
  const result = (await refreshModule.refreshAll(
    buildQuotaDeps(visibleProviders),
    providers ? { providers } : undefined
  )) as {
    providers?: unknown[]
    updated_at?: number | null
    duration_ms?: number
  }
  const current = (await getQuotasForServer({ backgroundRefresh: false }, visibleProviders)) as Record<string, unknown>
  return {
    ...current,
    refresh: (result as Record<string, unknown>).refresh,
    duration_ms: result.duration_ms,
    deduped: (result as Record<string, unknown>).deduped,
    refreshing: false,
  }
}

/** 手动刷新 30s 节流。 */
export function manualRefreshThrottled(provider = 'all', now = Date.now()): boolean {
  return !refreshModule.canManualRefresh(refreshModule.getLastManualRefreshAt(provider), now)
}

export function markManualRefresh(provider = 'all', now = Date.now()): void {
  refreshModule.markManualRefresh(now, provider)
}

/** See refresh.js markManualRefreshResult: single-provider retries never throttle "refresh all". */
export function markManualRefreshResult(requestedProvider: string | undefined, succeededProviders: string[], now = Date.now()): void {
  refreshModule.markManualRefreshResult(requestedProvider, succeededProviders, now)
}

export function manualRefreshRetry(provider = 'all', now = Date.now()): { retryAfterMs: number; nextAllowedAt: number } {
  const nextAllowedAt = refreshModule.getLastManualRefreshAt(provider) + 30_000
  return {
    retryAfterMs: Math.max(0, nextAllowedAt - now),
    nextAllowedAt,
  }
}
