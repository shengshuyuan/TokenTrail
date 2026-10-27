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

const CLAUDE_PROJECTS_DIR = path.join(
  process.env.HOME || '/root',
  '.claude',
  'projects'
)

export function syncClaudeCode(_options?: SyncRunOptions): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'claude-code',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    result.duration_ms = Date.now() - start
    return result
  }

  const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR).filter(name => {
    try { return fs.statSync(path.join(CLAUDE_PROJECTS_DIR, name)).isDirectory() } catch { return false }
  })

  for (const projectDir of projectDirs) {
    if (budgetExceeded(_options?.deadline)) {
      result.warning = 'stopped at time budget'
      break
    }
    const fullProjectPath = path.join(CLAUDE_PROJECTS_DIR, projectDir)
    let files: string[]
    try { files = fs.readdirSync(fullProjectPath).filter(f => f.endsWith('.jsonl')) } catch { continue }

    for (const file of files) {
      const filePath = path.join(fullProjectPath, file)
      if (isUnchangedSyncedFile('claude-code', filePath)) {
        result.skipped_files++
        continue
      }

      try {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
        let retryFile = false

        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            if (entry.type !== 'assistant' || !entry.message?.usage) continue
            const usage = entry.message.usage
            if (!usage.input_tokens && !usage.output_tokens && !usage.cache_read_input_tokens && !usage.cache_creation_input_tokens) continue

            const model = entry.message.model || 'unknown'
            const rawTs = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
            const timestamp = Number.isFinite(rawTs) ? rawTs : Date.now()
            // Prefer stable ids; when neither is present fall back to empty so
            // db.ts synthesizes a content-hash id (avoiding a shared "<session>-"
            // id that would dedupe away every turn in the session).
            const msgId = entry.message.id || entry.uuid || ''

            // 自动注册未知模型
            ensureModelPricing(model)

            // Anthropic usage: input_tokens 不含 cache；cache 写入按输入价计，cache 读取单独计
            const input_tokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
            const cached_input_tokens = usage.cache_read_input_tokens || 0
            const output_tokens = usage.output_tokens || 0
            const reasoning_tokens = 0

            const cost_usd = calculateCost({ model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens })

            const insertResult = insertUsageRecord({
              source: 'claude-code',
              project: normalizeClaudeProjectName(projectDir),
              model,
              input_tokens,
              cached_input_tokens,
              output_tokens,
              reasoning_tokens,
              cost_usd,
              request_id: msgId || undefined,
              timestamp,
            })

            result.scanned++
            if (insertResult.duplicate) result.duplicates++
            else result.inserted++
          } catch (err) {
            if (recordLineError(result, err).retryFile) retryFile = true
          }
        }
        if (!retryFile) markSyncedFile('claude-code', filePath)
      } catch (err) {
        recordSyncError(result, err)
      }
    }
  }

  result.duration_ms = Date.now() - start
  return result
}
