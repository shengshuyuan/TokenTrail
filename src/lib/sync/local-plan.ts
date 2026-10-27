/** Directory names scanned by syncLocalUsageFiles. */
export const LOCAL_JSONL_SOURCE_NAMES = ['openclaw', 'hermes', 'grok', 'antigravity', 'zcode'] as const

export interface LocalUsageScanPlan {
  /**
   * Names to scan. Undefined means every local JSONL directory.
   * A full sync and an explicit `local-usage` request both leave this unset.
   */
  sources?: string[]
  exportZcode: boolean
  /** SyncResult.source written for this run. */
  sourceId: string
}

/**
 * Decide which local JSONL directories a `syncAll({ only })` call may touch.
 * Returns null when this sync should skip the local-usage scanner entirely.
 */
export function localUsageScanPlan(only?: string[]): LocalUsageScanPlan | null {
  if (!only || only.length === 0 || only.includes('local-usage')) {
    return { sources: undefined, exportZcode: true, sourceId: 'local-usage' }
  }
  const names = LOCAL_JSONL_SOURCE_NAMES.filter(name => only.includes(name))
  if (names.length === 0) return null
  return {
    sources: names,
    exportZcode: names.includes('zcode'),
    sourceId: names.length === 1 ? names[0] : 'local-usage',
  }
}

/** Sources whose raw rows can overlap a VibeCafé daily aggregate. */
export const AGGREGATE_OVERLAP_SOURCES = [
  'vibecafe',
  'local-usage',
  ...LOCAL_JSONL_SOURCE_NAMES,
]
