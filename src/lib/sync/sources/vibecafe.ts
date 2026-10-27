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
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const { isCodexInternalModel } = require('../../codex.js') as {
  isCodexInternalModel: (model: string) => boolean
}

interface VibeCafeBucket {
  source: string
  model: string
  project?: string
  hostname?: string
  bucketStart: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
  estimatedCost: number
}

/** VibeCafé 模型名 → 标准化模型名（匹配 seed-pricing 表） */
const MODEL_ALIASES: Record<string, string> = {
  'mimo-v2.5-pro': 'mimo-v2.5-pro',
  'mimo-v2.5': 'mimo-v2.5-pro',
  'minimax2.7': 'MiniMax-M2.7',
  'minimax-m2.7': 'MiniMax-M2.7',
  'gpt-5.3-codex': 'gpt-5.3-codex',
  'glm-5-turbo': 'glm-5-turbo',
  'glm-5.1': 'glm-5.1',
  'glm-4.5-air': 'glm-4.5-air',
  'glm-4.7': 'glm-4.7',
  'kimi-k2-thinking': 'kimi-k2-thinking',
  'deepseek-v4-pro': 'deepseek-v4-pro',
}

function normalizeModelName(raw: string): string {
  const lower = raw.toLowerCase().trim()
  if (MODEL_ALIASES[lower]) return MODEL_ALIASES[lower]

  // Normalize Gemini model variations like "Gemini 3.8 Flash (High)" -> "gemini-3.8-flash"
  const geminiMatch = lower.match(/^gemini[\s-]+([\d.]+)\s+(flash|pro)(?:\s*\([^)]*\))?$/)
  if (geminiMatch) {
    return `gemini-${geminiMatch[1]}-${geminiMatch[2]}`
  }

  return lower
}

export async function syncVibeCafe(_options?: SyncRunOptions): Promise<SyncResult> {
  const start = Date.now()
  const result: SyncResult = {
    source: 'vibecafe',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }

  const apiKey = getConfig('vibecafe_api_key')
  if (!apiKey) {
    result.duration_ms = Date.now() - start
    return result
  }

  try {
    const res = await fetch('https://vibecafe.ai/api/usage?days=365', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: _options?.signal,
    })

    if (!res.ok) {
      recordSyncError(result, new Error(`VibeCafé HTTP ${res.status}`))
      result.duration_ms = Date.now() - start
      return result
    }

    const data = await res.json() as { buckets: VibeCafeBucket[] }
    const buckets = data.buckets || []

    for (const bucket of buckets) {
      if (budgetExceeded(_options?.deadline)) {
        result.warning = 'stopped at time budget'
        break
      }
      try {
        const model = normalizeModelName(bucket.model)
        const source = bucket.source || 'unknown'
        const rawBucketTs = new Date(bucket.bucketStart).getTime()
        const timestamp = Number.isFinite(rawBucketTs) ? rawBucketTs : Date.now()

        if (hasRawUsageOnLocalDay(source, model, timestamp)) {
          result.scanned++
          result.duplicates++
          continue
        }

        ensureModelPricing(model)

        const input_tokens = bucket.inputTokens || 0
        const cached_input_tokens = bucket.cachedInputTokens || 0
        const output_tokens = bucket.outputTokens || 0
        const reasoning_tokens = bucket.reasoningOutputTokens || 0

        const cost_usd = calculateCost({ model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens })

        // 用 source+model+bucketStart 作为去重 ID
        const request_id = `vc:${source}:${model}:${bucket.bucketStart}`

        const insertResult = insertUsageRecord({
          source,
          project: bucket.project || bucket.hostname,
          model,
          is_internal: isCodexInternalModel(model),
          is_aggregate: true,
          input_tokens,
          cached_input_tokens,
          output_tokens,
          reasoning_tokens,
          cost_usd,
          request_id,
          timestamp,
        })

        result.scanned++
        if (insertResult.duplicate) result.duplicates++
        else result.inserted++
      } catch (err) {
        recordSyncError(result, err)
      }
    }
  } catch (err) {
    recordSyncError(result, err)
  }

  result.duration_ms = Date.now() - start
  return result
}
