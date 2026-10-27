import fs from 'fs'
import { createRequire } from 'node:module'
import { replaceUsageRecordByRequestId } from '../../db'
import { isUnchangedSyncedFile, markSyncedFile } from '../../sync-checkpoint'
import {
  budgetExceeded,
  normalizeProjectName,
  recordLineError,
  recordSyncError,
} from '../shared'
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
    contextTokens: number
    costUsd: number
  }>
}

const USER_HOME = process.env.HOME || '/root'

/**
 * Scan ~/.kiro/sessions for Kiro CLI usage, one record per prompt turn:
 *   - model: the concrete model the turn was sent to (request log → session context)
 *   - input_tokens: context tokens derived from Kiro's server-reported context usage
 *   - output_tokens: 0 — Kiro does not record output token counts
 *   - credits / cost_usd: billed credits × official per-credit price
 * Rows are measured (not estimated) so they show in the raw records table and
 * by-source totals like every other agent.
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
        // Replace so a re-read corrects older rows (model / tokens / cost) in place.
        const insertResult = replaceUsageRecordByRequestId({
          source: 'kiro',
          provider: 'kiro',
          project: normalizeProjectName(rec.project || 'unknown'),
          model: rec.model,
          input_tokens: rec.contextTokens,
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
    if (!retryFile) markSyncedFile('kiro', filePath)
  }

  result.duration_ms = Date.now() - start
  return result
}
