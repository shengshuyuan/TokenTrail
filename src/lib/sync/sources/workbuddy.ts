import { insertUsageRecord, normalizeSource, raiseUsageRecordCredits } from '../../db'
import { calculateCost } from '../../pricing'
import { getSyncFileStat, isUnchangedSyncedFile, markSyncedFile } from '../../sync-checkpoint'
import {
  budgetExceeded,
  ensureModelPricing,
  emptySyncResult,
  normalizeProjectName,
  recordLineError,
  recordSyncError,
} from '../shared'
import type { SyncResult, SyncRunOptions } from '../types'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const {
  resolveRoot,
  listTraceFiles,
  parseTraceFile,
  collectCredits,
  indexSessions,
  indexLivePids,
  resolveTraceProject,
} = require('../../workbuddy.js') as {
  resolveRoot: (override?: string) => string
  listTraceFiles: (root: string) => Array<{ file: string; pid: string }>
  parseTraceFile: (filePath: string) => Array<{
    model: string
    request_id: string
    timestamp: number
    input_tokens: number
    cached_input_tokens: number
    output_tokens: number
    reasoning_tokens: number
  }>
  collectCredits: (root: string, sessions: Map<string, unknown>) => Array<{
    request_id: string
    credits: number
    timestamp: number
    model: string
    project: string
  }>
  indexSessions: (root: string) => Map<string, unknown>
  indexLivePids: (root: string) => Map<string, { sessionId: string; cwd: string }>
  resolveTraceProject: (input: {
    pid: string
    timestamp: number
    sessions: Map<string, unknown>
    livePids: Map<string, { sessionId: string; cwd: string }>
  }) => string
}

const SOURCE = 'workbuddy'

/**
 * WorkBuddy 用量同步。
 *
 * 两条管道分开写库，互不推算：
 * - trace 里的 generation span → 每条模型调用一行，token 是官方 usage 实测值；
 * - workbuddy.db 的 credit_json → 每条用户请求一行，只有积分没有 token。
 *   积分保留期很短（服务端会滚动清理），所以同步频率就是账本精度。
 */
export function syncWorkBuddy(options?: SyncRunOptions): SyncResult {
  const start = Date.now()
  const result = emptySyncResult(SOURCE)

  const root = resolveRoot()
  let files: Array<{ file: string; pid: string }> = []
  let sessions = new Map<string, unknown>()
  let livePids = new Map<string, { sessionId: string; cwd: string }>()
  try {
    files = listTraceFiles(root)
    sessions = indexSessions(root)
    livePids = indexLivePids(root)
  } catch (err) {
    recordSyncError(result, err)
    result.duration_ms = Date.now() - start
    return result
  }

  for (const { file, pid } of files) {
    if (budgetExceeded(options?.deadline)) {
      result.warning = 'stopped at time budget'
      break
    }
    if (isUnchangedSyncedFile(SOURCE, file)) {
      result.skipped_files++
      continue
    }
    try {
      const fileStat = getSyncFileStat(file)
      const calls = parseTraceFile(file)
      const project = calls.length > 0
        ? resolveTraceProject({ pid, timestamp: calls[0].timestamp, sessions, livePids })
        : 'workbuddy'
      let retryFile = false

      for (const call of calls) {
        try {
          const model = call.model || 'unknown'
          ensureModelPricing(model)
          const cost_usd = calculateCost({
            model,
            input_tokens: call.input_tokens,
            cached_input_tokens: call.cached_input_tokens,
            output_tokens: call.output_tokens,
            reasoning_tokens: call.reasoning_tokens,
          })

          const insert = insertUsageRecord({
            source: normalizeSource(SOURCE),
            provider: 'workbuddy',
            project: normalizeProjectName(project),
            model,
            input_tokens: call.input_tokens,
            cached_input_tokens: call.cached_input_tokens,
            output_tokens: call.output_tokens,
            reasoning_tokens: call.reasoning_tokens,
            cost_usd,
            request_id: `${SOURCE}:${call.request_id}`,
            timestamp: call.timestamp,
            estimated: false,
          })

          result.scanned++
          if (insert.duplicate) result.duplicates++
          else result.inserted++
        } catch (err) {
          if (recordLineError(result, err).retryFile) retryFile = true
        }
      }

      if (!retryFile) markSyncedFile(SOURCE, file, fileStat)
    } catch (err) {
      recordSyncError(result, err)
    }
  }

  // 积分：不在 trace 的 checkpoint 体系里，每轮都重算，靠 request_id 幂等去重。
  // credit_json 里同一 conversationRequestId 的值是该回合的**累计**扣费，会随 agent 循环增长；
  // 所以遇到更大的值要抬高已入库的行，而不是当成重复丢掉。
  try {
    for (const credit of collectCredits(root, sessions)) {
      try {
        const model = credit.model || 'unknown'
        ensureModelPricing(model)
        const insert = insertUsageRecord({
          source: normalizeSource(SOURCE),
          provider: 'workbuddy',
          project: normalizeProjectName(credit.project),
          model,
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_tokens: 0,
          credits: credit.credits,
          cost_usd: 0,
          request_id: credit.request_id,
          timestamp: credit.timestamp,
          estimated: false,
        })
        result.scanned++
        if (!insert.duplicate) {
          result.inserted++
          continue
        }
        result.duplicates++
        // 已入库的累计值偏小 → 抬高到最新官方值
        if (raiseUsageRecordCredits(credit.request_id, credit.credits)) {
          result.raised = (result.raised ?? 0) + 1
        }
      } catch (err) {
        recordLineError(result, err)
      }
    }
  } catch (err) {
    recordSyncError(result, err)
  }

  result.duration_ms = Date.now() - start
  return result
}
