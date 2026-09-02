import { createDbQuotaStore } from '@/lib/quotas/db-store'

const { createAdapters } = require('../../lib/quotas/providers/index.js') as {
  createAdapters: (overrides?: Record<string, unknown>) => {
    deps: Record<string, unknown>
    adapters: Record<string, unknown>
  }
}
const refreshModule = require('../../lib/quotas/refresh.js') as {
  getQuotas: (deps: Record<string, unknown>) => Promise<unknown>
  refreshAll: (deps: Record<string, unknown>) => Promise<unknown>
  canManualRefresh: (lastManualAt: number | undefined, now: number) => boolean
  markManualRefresh: (now: number) => void
  getLastManualRefreshAt: () => number
}
const { aggregateQuotaStatus } = require('../../lib/quotas/status.js') as {
  aggregateQuotaStatus: (snapshots: unknown[]) => { status: string; attention_count: number }
}

import { deleteConfig, getConfig } from '@/lib/db'
import { getQuotaSecret, QUOTA_SECRET_KEYS, setQuotaSecret } from '@/lib/quotas/secret-store'

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

function buildQuotaDeps(): Record<string, unknown> {
  const mergedEnv = getMergedEnv()
  const { deps, adapters } = createAdapters({ env: mergedEnv })
  return { ...deps, adapters, store: createDbQuotaStore() }
}

/** GET /api/quotas：立即返回缓存；过期则后台去重刷新。 */
export function getQuotasForServer(): Promise<unknown> {
  return refreshModule.getQuotas(buildQuotaDeps())
}

/** POST /api/quotas/refresh：强制刷新一轮（内部并发合并），返回带全局聚合。 */
export async function refreshQuotasForServer(): Promise<Record<string, unknown>> {
  const result = (await refreshModule.refreshAll(buildQuotaDeps())) as {
    providers?: unknown[]
    updated_at?: number | null
    duration_ms?: number
  }
  const providers = result.providers ?? []
  const aggregate = aggregateQuotaStatus(providers)
  return {
    ...result,
    status: aggregate.status,
    attention_count: aggregate.attention_count,
    refreshing: false,
  }
}

/** 手动刷新 30s 节流。 */
export function manualRefreshThrottled(now = Date.now()): boolean {
  return !refreshModule.canManualRefresh(refreshModule.getLastManualRefreshAt(), now)
}

export function markManualRefresh(now = Date.now()): void {
  refreshModule.markManualRefresh(now)
}
