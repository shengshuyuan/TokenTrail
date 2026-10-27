import fs from 'fs'
import path from 'path'
import {
  backfillProjectByRequestPrefix,
  cleanAntigravityConversationRecords,
  correctProjectByRequestId,
  deleteAntigravityConversationRow,
  getConfig,
  getDb,
  hasRawUsageOnLocalDay,
  insertUsageRecord,
  normalizeSource,
  removeUnknownCodexUsageRecords,
  replaceUsageRecordByRequestId,
  synthesizeRequestId,
} from '../../db'
import { calculateCost } from '../../pricing'
import { isUnchangedSyncedFile, markSyncedFile } from '../../sync-checkpoint'
import {
  budgetExceeded,
  emptySyncResult,
  ensureModelPricing,
  extractCodexProject,
  findAllJsonl,
  normalizeClaudeProjectName,
  normalizeProjectName,
  normalizeTimestamp,
  recordLineError,
  recordSyncError,
} from '../shared'
import type { SyncResult, SyncRunOptions } from '../types'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const { findTraeHistoryFiles, parseTraeHistoryFile } = require('../../traework.js') as {
  findTraeHistoryFiles: () => string[]
  parseTraeHistoryFile: (filePath: string) => Array<{
    source: string
    provider?: string
    project?: string
    model: string
    input_tokens: number
    cached_input_tokens?: number
    output_tokens: number
    reasoning_tokens?: number
    request_id?: string
    timestamp?: number
  }>
}

export function syncTraeWork(_options?: SyncRunOptions): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'traework',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }

  let files: string[] = []
  try {
    files = findTraeHistoryFiles()
  } catch (err) {
    recordSyncError(result, err)
    result.duration_ms = Date.now() - start
    return result
  }

  for (const filePath of files) {
    if (budgetExceeded(_options?.deadline)) {
      result.warning = 'stopped at time budget'
      break
    }
    if (isUnchangedSyncedFile('traework', filePath)) {
      result.skipped_files++
      continue
    }
    try {
      const records = parseTraeHistoryFile(filePath)
      let retryFile = false
      for (const record of records) {
        try {
          ensureModelPricing(record.model)
          const input_tokens = record.input_tokens || 0
          const cached_input_tokens = record.cached_input_tokens || 0
          const output_tokens = record.output_tokens || 0
          const reasoning_tokens = record.reasoning_tokens || 0

          const cost_usd = calculateCost({
            model: record.model,
            input_tokens,
            cached_input_tokens,
            output_tokens,
            reasoning_tokens,
          })

          const insertResult = insertUsageRecord({
            source: 'traework',
            provider: record.provider,
            project: record.project,
            model: record.model,
            input_tokens,
            cached_input_tokens,
            output_tokens,
            reasoning_tokens,
            cost_usd,
            request_id: record.request_id,
            timestamp: normalizeTimestamp(record.timestamp),
            estimated: true,
          })

          result.scanned++
          if (insertResult.duplicate) result.duplicates++
          else result.inserted++
        } catch (err) {
          if (recordLineError(result, err).retryFile) retryFile = true
        }
      }
      if (!retryFile) markSyncedFile('traework', filePath)
    } catch (err) {
      recordSyncError(result, err)
    }
  }

  result.duration_ms = Date.now() - start
  return result
}
