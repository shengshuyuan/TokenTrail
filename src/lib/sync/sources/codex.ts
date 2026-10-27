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

const CODEX_SESSIONS_DIR = path.join(
  process.env.HOME || '/root',
  '.codex',
  'sessions'
)

const { createCodexSessionUsageParser, isCodexInternalModel } = require('../../codex.js') as {
  createCodexSessionUsageParser: () => { parse: (entry: Record<string, unknown>) => {
    model: string
    input_tokens: number
    cached_input_tokens: number
    output_tokens: number
    reasoning_tokens: number
  } | null }
  isCodexInternalModel: (model: string) => boolean
}

export function syncCodex(_options?: SyncRunOptions): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'codex',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }

  if (!fs.existsSync(CODEX_SESSIONS_DIR)) {
    result.duration_ms = Date.now() - start
    return result
  }

  const jsonlFiles = findAllJsonl(CODEX_SESSIONS_DIR)

  for (const filePath of jsonlFiles) {
    if (budgetExceeded(_options?.deadline)) {
      result.warning = 'stopped at time budget'
      break
    }
    const relativePath = path.relative(CODEX_SESSIONS_DIR, filePath)
    if (isUnchangedSyncedFile('codex', filePath)) {
      result.skipped_files++
      continue
    }

    try {
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
      let currentProject: string | undefined
      const parser = createCodexSessionUsageParser()
      let retryFile = false

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]
        if (!line.trim()) continue

        try {
          const entry = JSON.parse(line)

          const contextualProject = extractCodexProject(entry)
          if (contextualProject) {
            currentProject = contextualProject
            backfillProjectByRequestPrefix(`codex:${relativePath}:`, currentProject)
          }

          const usage = parser.parse(entry)
          if (!usage) continue

          const requestId = `codex:${relativePath}:L${lineIdx}`
          const rawTs = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
          const timestamp = Number.isFinite(rawTs) ? rawTs : Date.now()
          const model = usage.model

          ensureModelPricing(model)

          const input_tokens = usage.input_tokens
          const cached_input_tokens = usage.cached_input_tokens
          const output_tokens = usage.output_tokens
          const reasoning_tokens = usage.reasoning_tokens

          const cost_usd = calculateCost({ model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens })

          const insertResult = replaceUsageRecordByRequestId({
            source: 'codex',
            project: currentProject,
            model,
            is_internal: isCodexInternalModel(model),
            input_tokens,
            cached_input_tokens,
            output_tokens,
            reasoning_tokens,
            cost_usd,
            request_id: requestId,
            timestamp,
          })

          result.scanned++
          if (insertResult.duplicate) result.duplicates++
          else result.inserted++
        } catch (err) {
          if (recordLineError(result, err).retryFile) retryFile = true
        }
      }
      if (!retryFile) markSyncedFile('codex', filePath)
    } catch (err) {
      recordSyncError(result, err)
    }
  }

  // Versions before v0.2.5 persisted pre-context inherited history as
  // "unknown-codex". Valid records above update in place; the remainder has
  // no reliable model attribution and must not appear in model statistics.
  removeUnknownCodexUsageRecords()

  result.duration_ms = Date.now() - start
  return result
}
