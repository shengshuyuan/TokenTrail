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
  shouldZeroUsageCost,
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
  recordSyncError,
} from '../shared'
import type { SyncResult, SyncRunOptions } from '../types'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const { collectCursorUsageRecords } = require('../../cursor.js') as {
  collectCursorUsageRecords: (options?: { latestSyncedAt?: number; deadline?: number }) => Promise<
    | {
        ok: true
        events: number
        truncated?: boolean
        total?: number | null
        records: Array<{
          source: string
          provider: string
          project?: string
          model: string
          input_tokens: number
          cached_input_tokens: number
          output_tokens: number
          reasoning_tokens: number
          cost_usd: number | null
          request_id: string
          timestamp: number
        }>
      }
    | { ok: false; reason: string; message?: string }
  >
}

const CURSOR_SILENT_SKIP_REASONS = new Set(['not_installed', 'not_logged_in'])

export async function syncCursor(_options?: SyncRunOptions): Promise<SyncResult | null> {
  const start = Date.now()
  const result: SyncResult = {
    source: 'cursor',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }

  // VibeCafé 也会写入 source='cursor' 的按天汇总（is_aggregate=1），不能作为增量起点
  const latest = getDb()
    .prepare("SELECT MAX(timestamp) AS latest FROM usage_records WHERE source = 'cursor' AND is_aggregate = 0")
    .get() as { latest: number | null } | undefined
  const collected = await collectCursorUsageRecords({
    latestSyncedAt: latest?.latest ?? undefined,
    deadline: _options?.deadline,
  })

  if (!collected.ok) {
    if (CURSOR_SILENT_SKIP_REASONS.has(collected.reason)) return null
    recordSyncError(result, collected.message || collected.reason)
    result.duration_ms = Date.now() - start
    return result
  }

  if (collected.truncated) {
    const total = collected.total
    result.warning = total
      ? `history may be incomplete: fetched ${collected.events} of ${total} events`
      : 'history may be incomplete: pagination stopped before the full window'
  }

  for (const record of collected.records) {
    try {
      ensureModelPricing(record.model)
      const cost_usd = shouldZeroUsageCost(record.model)
        ? 0
        : (record.cost_usd ?? calculateCost({
            model: record.model,
            input_tokens: record.input_tokens,
            cached_input_tokens: record.cached_input_tokens,
            output_tokens: record.output_tokens,
            reasoning_tokens: record.reasoning_tokens,
          }))
      const insertResult = insertUsageRecord({ ...record, cost_usd })
      result.scanned++
      if (insertResult.duplicate) result.duplicates++
      else result.inserted++
    } catch (err) {
      recordSyncError(result, err)
    }
  }

  result.duration_ms = Date.now() - start
  return result
}
