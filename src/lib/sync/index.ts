/**
 * syncAll orchestration.
 *
 * Local scanners share one SQLite connection and run one after another.
 * Cursor and VibeCafé start first so their HTTP waits overlap that work.
 * Pass `only` to sync a single source. Each source stops taking new files
 * once its time budget is spent.
 */

import {
  getConfig,
  normalizeStoredProjectNames,
  removeOverlappingAggregateUsageRecords,
  setConfig,
} from '../db'
import { ensureInit } from '../init'
import { invalidateStatsCache } from '../stats-cache'
import { SyncInProgressError } from './errors'
import { failedSyncResult, formatSyncError, normalizeClaudeProjectName } from './shared'
import { exportZcodeUsage } from './zcode-export'
import { AGGREGATE_OVERLAP_SOURCES, localUsageScanPlan } from './local-plan'
import type { SyncResult, SyncRunOptions } from './types'
import type { LocalUsageSyncOptions } from './sources/local-usage'
import { syncClaudeCode } from './sources/claude'
import { syncCodex } from './sources/codex'
import { syncKimiCode } from './sources/kimi'
import { syncKiro } from './sources/kiro'
import { syncAntigravityTranscripts } from './sources/antigravity'
import { syncLocalUsageFiles } from './sources/local-usage'
import { syncGrok } from './sources/grok'
import { syncCursor } from './sources/cursor'
import { syncTraeWork } from './sources/traework'
import { syncVibeCafe } from './sources/vibecafe'

export type { SyncResult, SyncRunOptions } from './types'
export { SyncInProgressError } from './errors'
export { localUsageScanPlan, type LocalUsageScanPlan } from './local-plan'

const LOCAL_BUDGET_MS = 90_000
const NETWORK_BUDGET_MS = 45_000

let syncing = false

export interface SyncAllOptions {
  /** Run only these source ids. Omit to run every source. */
  only?: string[]
}

function wanted(only: string[] | undefined, name: string): boolean {
  return !only || only.length === 0 || only.includes(name)
}

function meaningful(result: SyncResult): boolean {
  return result.scanned > 0 || result.errors > 0 || result.skipped_files > 0 || !!result.warning
}

async function runNetwork(
  name: string,
  budgetMs: number,
  fn: (options: SyncRunOptions) => Promise<SyncResult | null>,
): Promise<SyncResult | null> {
  const controller = new AbortController()
  const deadline = Date.now() + budgetMs
  const timer = setTimeout(() => controller.abort(), budgetMs)
  try {
    return await fn({ deadline, signal: controller.signal })
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')
    if (aborted) {
      const timedOut = failedSyncResult(name, new Error(`stopped at ${budgetMs}ms budget`))
      timedOut.errors = 0
      timedOut.error = undefined
      timedOut.warning = `stopped at ${budgetMs}ms budget`
      return timedOut
    }
    return failedSyncResult(name, err)
  } finally {
    clearTimeout(timer)
  }
}

function runLocal(name: string, fn: (options: SyncRunOptions) => SyncResult, extra?: Omit<LocalUsageSyncOptions, 'deadline' | 'signal'>): SyncResult {
  try {
    return fn({ deadline: Date.now() + LOCAL_BUDGET_MS, ...extra })
  } catch (err) {
    return failedSyncResult(name, err)
  }
}

export async function syncAll(options: SyncAllOptions = {}): Promise<SyncResult[]> {
  if (syncing) throw new SyncInProgressError()
  syncing = true
  try {
    ensureInit()
    if (getConfig('project_names_normalized') !== '1') {
      normalizeStoredProjectNames(normalizeClaudeProjectName)
      setConfig('project_names_normalized', '1')
    }

    const only = options.only
    const results: SyncResult[] = []
    const network: Promise<SyncResult | null>[] = []

    if (wanted(only, 'cursor')) {
      network.push(runNetwork('cursor', NETWORK_BUDGET_MS, syncCursor))
    }
    if (wanted(only, 'vibecafe')) {
      network.push(runNetwork('vibecafe', NETWORK_BUDGET_MS, syncVibeCafe))
    }

    const localJobs: Array<[string, () => SyncResult, boolean]> = [
      ['claude-code', () => runLocal('claude-code', syncClaudeCode), false],
      ['codex', () => runLocal('codex', syncCodex), false],
      ['kimi-code', () => runLocal('kimi-code', syncKimiCode), false],
      ['kiro', () => runLocal('kiro', syncKiro), false],
      ['antigravity', () => runLocal('antigravity', syncAntigravityTranscripts), false],
      ['grok', () => runLocal('grok', syncGrok), false],
      ['traework', () => runLocal('traework', syncTraeWork), true],
    ]

    for (const [name, fn, quiet] of localJobs) {
      if (!wanted(only, name)) continue
      const result = fn()
      if (!quiet || meaningful(result)) results.push(result)
    }

    const localPlan = localUsageScanPlan(only)
    if (localPlan) {
      if (localPlan.exportZcode) {
        try {
          exportZcodeUsage()
        } catch (err) {
          console.warn('[TokenTrail] zcode usage export skipped:', formatSyncError(err))
        }
      }
      const localResult = runLocal(
        localPlan.sourceId,
        (opts) => syncLocalUsageFiles({ ...opts, sources: localPlan.sources }),
      )
      if (meaningful(localResult)) results.push(localResult)
    }

    for (const item of await Promise.all(network)) {
      if (item) results.push(item)
    }

    if (!only || only.some(name => AGGREGATE_OVERLAP_SOURCES.includes(name))) {
      removeOverlappingAggregateUsageRecords()
    }

    invalidateStatsCache()
    return results
  } finally {
    syncing = false
  }
}
