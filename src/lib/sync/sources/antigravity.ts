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
  recordSyncError,
} from '../shared'
import type { SyncResult, SyncRunOptions } from '../types'

import { parseAntigravityTranscript, detectAntigravityProject } from '../../antigravity'

export function syncAntigravityTranscripts(_options?: SyncRunOptions): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'antigravity',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }

  const brainDirs = [
    path.join(process.env.HOME || '/root', '.gemini', 'antigravity-cli', 'brain'),
    path.join(process.env.HOME || '/root', '.antigravity', 'brain'),
  ]

  for (const brainDir of brainDirs) {
    if (!fs.existsSync(brainDir)) continue

    let convDirs: string[] = []
    try {
      convDirs = fs.readdirSync(brainDir).filter(name => {
        try {
          return fs.statSync(path.join(brainDir, name)).isDirectory()
        } catch {
          return false
        }
      })
    } catch {
      continue
    }

    for (const convId of convDirs) {
      if (budgetExceeded(_options?.deadline)) {
        result.warning = 'stopped at time budget'
        break
      }
      const logDir = path.join(brainDir, convId, '.system_generated', 'logs')
      const fullTranscriptPath = path.join(logDir, 'transcript_full.jsonl')
      const compactTranscriptPath = path.join(logDir, 'transcript.jsonl')
      const transcriptPath = fs.existsSync(fullTranscriptPath)
        ? fullTranscriptPath
        : compactTranscriptPath
      if (!fs.existsSync(transcriptPath)) continue
      if (isUnchangedSyncedFile('antigravity', transcriptPath)) {
        result.skipped_files++
        continue
      }

      try {
        const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean)
        const project = detectAntigravityProject(lines)
        // 逐事件入库：每个 entry 带自己的时间戳与当时的模型，会话跨天或
        // 中途切换模型时历史用量不再迁移。token 是字符÷3.5 的估算值。
        const events = parseAntigravityTranscript(lines)

        let failed = false
        // 先清理该会话已有记录（包括旧版整段行和逐事件行），确保重新同步时使用最新的上下文累积 token
        cleanAntigravityConversationRecords(convId)

        for (const event of events) {
          // 严格只上报实际物理用量；没有真实 Token 计量的历史条目不做虚构估算
          if (event.estimated) continue

          try {
            ensureModelPricing(event.model)
            const cached_input_tokens = event.cached_input_tokens || 0
            const cost_usd = calculateCost({
              model: event.model,
              input_tokens: event.input_tokens,
              cached_input_tokens,
              output_tokens: event.output_tokens,
              reasoning_tokens: event.reasoning_tokens || 0,
            })

            const insertResult = replaceUsageRecordByRequestId({
              source: 'antigravity',
              provider: 'google',
              project,
              model: event.model,
              input_tokens: event.input_tokens,
              cached_input_tokens,
              output_tokens: event.output_tokens,
              reasoning_tokens: event.reasoning_tokens || 0,
              cost_usd,
              request_id: `antigravity:${convId}:${event.entryIndex}`,
              timestamp: event.timestamp,
              estimated: event.estimated ?? false,
            })

            result.scanned++
            if (insertResult.duplicate) result.duplicates++
            else result.inserted++
          } catch (err) {
            failed = true
            recordSyncError(result, err)
          }
        }

        // 该会话事件全部写成功后删除可能存在的残留行
        if (events.length > 0 && !failed) {
          deleteAntigravityConversationRow(convId)
        }
        if (!failed) markSyncedFile('antigravity', transcriptPath)
      } catch (err) {
        recordSyncError(result, err)
      }
    }
  }

  result.duration_ms = Date.now() - start
  return result
}
