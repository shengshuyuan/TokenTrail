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

interface LocalUsageSource {
  name: string
  dir: string
}

export interface LocalUsageSyncOptions extends SyncRunOptions {
  /** Directory names to scan. Omit to scan every local usage directory. */
  sources?: string[]
}

/** Resolve usage dirs from the current HOME so a source filter can select them. */
export function localUsageDirectories(home = process.env.HOME || '/root'): LocalUsageSource[] {
  return [
    { name: 'openclaw', dir: path.join(home, '.openclaw', 'usage') },
    { name: 'hermes', dir: path.join(home, '.hermes', 'usage') },
    { name: 'grok', dir: path.join(home, '.grok', 'usage') },
    { name: 'antigravity', dir: path.join(home, '.gemini', 'antigravity-cli', 'usage') },
    { name: 'antigravity', dir: path.join(home, '.antigravity', 'usage') },
    // 由 src/lib/zcode.js 在扫描 zcode 前从 ZCode 本地数据库增量导出
    { name: 'zcode', dir: path.join(home, '.zcode', 'usage') },
  ]
}

// Writers of these sources report OpenAI-style inclusive buckets (cached ⊆
// input, reasoning ⊆ output); normalize on ingest. Other writers (e.g.
// openclaw) already report mutually exclusive buckets — never touch them.
const INCLUSIVE_USAGE_SOURCES = new Set(['hermes', 'grok', 'zcode'])

/**
 * 扫描工具写入的本地 JSONL 用量文件。
 * 文件格式：每行一个 JSON 对象，包含 model、input_tokens、output_tokens 等字段。
 * 文件路径：~/.openclaw/usage/YYYY-MM-DD.jsonl
 */
export function syncLocalUsageFiles(options?: LocalUsageSyncOptions): SyncResult {
  const start = Date.now()
  const allow = options?.sources
  const selected = localUsageDirectories().filter(source => !allow || allow.includes(source.name))
  const distinct = [...new Set(selected.map(source => source.name))]
  const result: SyncResult = {
    source: allow && distinct.length === 1 ? distinct[0] : 'local-usage',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }

  let stopped = false
  for (const { name, dir } of selected) {
    if (stopped || budgetExceeded(options?.deadline)) {
      result.warning = 'stopped at time budget'
      break
    }
    if (!fs.existsSync(dir)) continue

    const jsonlFiles = findAllJsonl(dir)
    for (const filePath of jsonlFiles) {
      if (budgetExceeded(options?.deadline)) {
        result.warning = 'stopped at time budget'
        stopped = true
        break
      }
      if (isUnchangedSyncedFile(`local:${name}`, filePath)) {
        result.skipped_files++
        continue
      }
      try {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
        let retryFile = false
        for (const line of lines) {
          try {
            const entry = JSON.parse(line)

            // 必须有 model 和至少一个非零 token 字段
            if (!entry.model) continue
            const input = entry.input_tokens || 0
            const output = entry.output_tokens || 0
            const cached = entry.cached_input_tokens || 0
            const reasoning = entry.reasoning_tokens || 0
            if (input === 0 && output === 0 && cached === 0 && reasoning === 0) continue

            const effSource = entry.source || name
            const model = entry.model
            ensureModelPricing(model)

            // 去重哈希必须稳定：用与 insertUsageRecord 相同的归一化 source
            // 和截断 timestamp，基于原始值合成 request_id（与历史行一致），
            // 再对包含式来源做互斥化，否则每次重扫都会插入重复行。
            const timestamp = normalizeTimestamp(entry.timestamp)
            const requestId = entry.request_id || synthesizeRequestId(normalizeSource(effSource), {
              timestamp: Math.trunc(timestamp),
              model,
              input_tokens: input,
              cached_input_tokens: cached,
              output_tokens: output,
              reasoning_tokens: reasoning,
            })

            let input_tokens = input
            let cached_input_tokens = cached
            let output_tokens = output
            let reasoning_tokens = reasoning
            if (INCLUSIVE_USAGE_SOURCES.has(effSource)) {
              cached_input_tokens = Math.min(cached, input)
              reasoning_tokens = Math.min(reasoning, output)
              input_tokens = input - cached_input_tokens
              output_tokens = output - reasoning_tokens
            }

            const cost_usd = calculateCost({
              model,
              input_tokens,
              cached_input_tokens,
              output_tokens,
              reasoning_tokens,
            })

            const insertResult = insertUsageRecord({
              source: effSource,
              provider: entry.provider,
              project: entry.project,
              model,
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
        if (!retryFile) markSyncedFile(`local:${name}`, filePath)
      } catch (err) {
        recordSyncError(result, err)
      }
    }
  }

  result.duration_ms = Date.now() - start
  return result
}
