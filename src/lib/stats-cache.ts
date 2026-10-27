/**
 * Short-lived memory cache for GET /api/stats.
 * Every usage write (sync, /api/report, proxy) invalidates it through
 * insertUsageRecord / replaceUsageRecordByRequestId. TTL is intentionally a
 * few minutes: the dashboard re-reads the same window often, and a full-table
 * aggregation is the expensive part.
 */

const DEFAULT_TTL_MS = 2 * 60 * 1000

interface Entry {
  at: number
  body: unknown
}

// Next can bundle this module separately per route; keep one map per process
// so a write in /api/report clears what /api/stats serves.
const globalStore = globalThis as typeof globalThis & { __tokentrailStatsCache?: Map<string, Entry> }
const entries: Map<string, Entry> = globalStore.__tokentrailStatsCache ??= new Map<string, Entry>()

export function statsCacheTtlMs(): number {
  const raw = process.env.TOKENTRAIL_STATS_CACHE_MS
  const parsed = raw ? Number(raw) : DEFAULT_TTL_MS
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TTL_MS
  return parsed
}

export function readStatsCache(key: string): unknown | undefined {
  const ttl = statsCacheTtlMs()
  if (ttl === 0) return undefined
  const hit = entries.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > ttl) {
    entries.delete(key)
    return undefined
  }
  return hit.body
}

export function writeStatsCache(key: string, body: unknown): void {
  if (statsCacheTtlMs() === 0) return
  entries.set(key, { at: Date.now(), body })
}

export function invalidateStatsCache(): void {
  entries.clear()
}
