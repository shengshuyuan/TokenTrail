import fs from 'fs'
import { createRequire } from 'node:module'
import { getStoredUsageModel, replaceUsageRecordByRequestId } from '../../db'
import { getSyncFileStat, isUnchangedSyncedFile, markSyncedFile } from '../../sync-checkpoint'
import { budgetExceeded, normalizeProjectName, recordLineError, recordSyncError } from '../shared'
import type { SyncResult, SyncRunOptions } from '../types'

const require = createRequire(import.meta.url)

const { kiroSessionsDir, findKiroTranscripts, readKiroTurnModels, parseKiroTranscript } = require('../../kiro.js') as {
  kiroSessionsDir: (home?: string) => string
  findKiroTranscripts: (fsMod: typeof fs, sessionsDir: string) => string[]
  readKiroTurnModels: (fsMod: typeof fs, home?: string) => Map<string, string>
  parseKiroTranscript: (
    fsMod: typeof fs,
    transcriptPath: string,
    options?: { turnModels?: Map<string, string> }
  ) => Array<{
    credits: number
    timestamp: number
    turnId?: string
    requestId: string
    project?: string
    model: string
    modelFromLog: boolean
    costUsd: number
  }>
}

const USER_HOME = process.env.HOME || '/root'

/**
 * Scan ~/.kiro/sessions for Kiro CLI usage, one record per prompt turn:
 *   - model: the concrete model the turn was sent to (request log → session context)
 *   - token counts: 0 — context occupancy is not measured input/output usage
 *   - credits / cost_usd: billed credits × official per-credit price
 * Credits and their cost are measured; unavailable token counts stay zero.
 */
export function syncKiro(_options?: SyncRunOptions): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'kiro',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }

  const sessionsDir = kiroSessionsDir(USER_HOME)
  if (!fs.existsSync(sessionsDir)) {
    result.duration_ms = Date.now() - start
    return result
  }

  const files = findKiroTranscripts(fs, sessionsDir)
  let turnModels: Map<string, string> | null = null

  for (const filePath of files) {
    if (budgetExceeded(_options?.deadline)) {
      result.warning = 'stopped at time budget'
      break
    }
    if (isUnchangedSyncedFile('kiro', filePath)) {
      result.skipped_files++
      continue
    }

    // Read the request log once per sync, only when some transcript changed.
    turnModels ??= readKiroTurnModels(fs, USER_HOME)

    const fileStat = getSyncFileStat(filePath)
    let records: ReturnType<typeof parseKiroTranscript>
    try {
      records = parseKiroTranscript(fs, filePath, { turnModels })
    } catch (err) {
      recordSyncError(result, err)
      continue
    }

    let retryFile = false
    for (const rec of records) {
      try {
        // The request log is the only per-turn source of truth. When it no
        // longer has this turn (older run logs pruned), keep the model already
        // stored instead of downgrading to a session-level guess.
        let model = rec.model
        if (!rec.modelFromLog) {
          const stored = getStoredUsageModel(rec.requestId)
          if (stored && stored !== model) {
            model = stored
          }
        }
        // Replace so a re-read corrects older rows (model / tokens / cost) in place.
        const insertResult = replaceUsageRecordByRequestId({
          source: 'kiro',
          provider: 'kiro',
          project: normalizeProjectName(rec.project || 'unknown'),
          model,
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_tokens: 0,
          credits: rec.credits,
          estimated: false,
          cost_usd: rec.costUsd,
          request_id: rec.requestId,
          timestamp: rec.timestamp,
        })

        result.scanned++
        if (insertResult.duplicate) result.duplicates++
        else result.inserted++
      } catch (err) {
        if (recordLineError(result, err).retryFile) retryFile = true
      }
    }
    if (!retryFile) markSyncedFile('kiro', filePath, fileStat)
  }

  result.duration_ms = Date.now() - start
  return result
}
