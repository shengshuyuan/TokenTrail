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

const { createKimiHomeContext, parseKimiWireLine, resolveKimiWireContext } = require('../../kimi.js') as {
  createKimiHomeContext: (homeDir: string) => {
    homeDir: string
    sessionsDir: string
    sessionIndex: Map<string, string>
    legacyWorkDirs: Map<string, string>
  }
  parseKimiWireLine: (line: string) => {
    project?: string
    records: Array<{
      model: string
      input_tokens: number
      cached_input_tokens: number
      output_tokens: number
      reasoning_tokens: number
      timestamp: number
    }>
  }
  resolveKimiWireContext: (
    context: { homeDir: string; sessionsDir: string; sessionIndex: Map<string, string>; legacyWorkDirs: Map<string, string> },
    filePath: string
  ) => { relativePath: string; project: string }
}

const USER_HOME = process.env.HOME || '/root'
const KIMI_HOME_DIRS = Array.from(new Set([
  process.env.KIMI_CODE_HOME || path.join(USER_HOME, '.kimi-code'),
  process.env.KIMI_SHARE_DIR || path.join(USER_HOME, '.kimi'),
]))

/**
 * 扫描新版 ~/.kimi-code 与旧版 ~/.kimi 中的会话 wire.jsonl。
 * 新版使用 usage.record，旧版使用 StatusUpdate.token_usage。
 */
export function syncKimiCode(_options?: SyncRunOptions): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'kimi-code',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }

  for (const homeDir of KIMI_HOME_DIRS) {
    const context = createKimiHomeContext(homeDir)
    if (!fs.existsSync(context.sessionsDir)) continue

    const files = findAllJsonl(context.sessionsDir).filter(
      f => path.basename(f) === 'wire.jsonl'
    )

    for (const filePath of files) {
      if (budgetExceeded(_options?.deadline)) {
        result.warning = 'stopped at time budget'
        break
      }
      if (isUnchangedSyncedFile('kimi-code', filePath)) {
        result.skipped_files++
        continue
      }
      const wireContext = resolveKimiWireContext(context, filePath)
      let currentProject = normalizeProjectName(wireContext.project)

      let lines: string[]
      try {
        lines = fs.readFileSync(filePath, 'utf-8').split('\n')
      } catch (err) {
        recordSyncError(result, err)
        continue
      }

      let retryFile = false
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.trim()) continue
        // 快速跳过无关事件；config.update 用于精确的项目归因。
        if (!line.includes('usage.record') && !line.includes('StatusUpdate') && !line.includes('config.update')) continue
        try {
          const parsed = parseKimiWireLine(line)
          if (parsed.project) currentProject = normalizeProjectName(parsed.project)

          for (const usage of parsed.records) {
            const model = usage.model
            ensureModelPricing(model)
            const cost_usd = calculateCost({
              model,
              input_tokens: usage.input_tokens,
              cached_input_tokens: usage.cached_input_tokens,
              output_tokens: usage.output_tokens,
              reasoning_tokens: usage.reasoning_tokens,
            })

            const requestId = `kimi:${filePath}:L${i + 1}`
            const insertResult = insertUsageRecord({
              source: 'kimi-code',
              provider: 'moonshot',
              project: currentProject,
              model,
              input_tokens: usage.input_tokens,
              cached_input_tokens: usage.cached_input_tokens,
              output_tokens: usage.output_tokens,
              reasoning_tokens: usage.reasoning_tokens,
              cost_usd,
              request_id: requestId,
              timestamp: usage.timestamp,
            })

            result.scanned++
            if (insertResult.duplicate) {
              correctProjectByRequestId(requestId, currentProject)
              result.duplicates++
            } else {
              result.inserted++
            }
          }
        } catch (err) {
          if (recordLineError(result, err).retryFile) retryFile = true
        }
      }
      if (!retryFile) markSyncedFile('kimi-code', filePath)
    }
  }

  result.duration_ms = Date.now() - start
  return result
}
