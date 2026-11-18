import { getDb, insertUsageRecord, shouldZeroUsageCost, replaceUsageRecordByRequestId } from '../../db'
import { calculateCost } from '../../pricing'
import { invalidateStatsCache } from '../../stats-cache'
import { ensureModelPricing, recordSyncError } from '../shared'
import type { SyncResult, SyncRunOptions } from '../types'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

interface OfficialCursorRow {
  id: number
  request_id: string
  model: string
  provider: string | null
  project: string | null
  timestamp: number
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cost_usd: number
  is_internal: number
}

type CursorChatMap = Map<string, { models: Map<string, number>; updatedAtMs?: number; cwd?: string }>

const {
  collectCursorUsageRecords,
  collectCursorLocalModelRecords,
  conversationIdFromOfficialRequestId,
  isCursorAutoRequestId,
  isCursorAutoDerivedRequestId,
  planCursorAutoResolution,
  readCursorChatModels,
  CURSOR_GROK_BOT_SOURCE,
} = require('../../cursor.js') as {
  CURSOR_GROK_BOT_SOURCE: string
  isCursorAutoRequestId: (requestId: string) => boolean
  isCursorAutoDerivedRequestId: (requestId: string) => boolean
  readCursorChatModels: () => CursorChatMap
  planCursorAutoResolution: (
    rows: OfficialCursorRow[],
    chats: CursorChatMap,
  ) => {
    updates: Array<{ id: number; model: string; provider: string; is_internal: boolean }>
    derived: Array<{
      source: string
      provider: string
      project?: string
      model: string
      input_tokens: number
      cached_input_tokens: number
      output_tokens: number
      reasoning_tokens: number
      cost_usd: number
      estimated: boolean
      request_id: string
      timestamp: number
    }>
  }
  collectCursorLocalModelRecords: (options?: {
    coveredConversationIds?: Set<string>
    chats?: Map<string, { models: Map<string, number>; updatedAtMs?: number; cwd?: string }>
  }) => Array<{
    source: string
    provider: string
    project?: string
    model: string
    input_tokens: number
    cached_input_tokens: number
    output_tokens: number
    reasoning_tokens: number
    cost_usd: number | null
    estimated: boolean
    request_id: string
    timestamp: number
  }>
  conversationIdFromOfficialRequestId: (requestId: string) => string
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
  // grok-bot 记录单独放在 cursor-grok-bot 来源，但同样来自官方接口，一起参与增量起点
  const latest = getDb()
    // estimated=0：本机补全的估算记录时间戳不能当作官方接口的增量起点
    .prepare('SELECT MAX(timestamp) AS latest FROM usage_records WHERE source IN (?, ?) AND is_aggregate = 0 AND estimated = 0')
    .get('cursor', CURSOR_GROK_BOT_SOURCE) as { latest: number | null } | undefined
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

  // 同一次同步只扫一遍 ~/.cursor/chats，Auto 还原和本机估算补全都复用
  const chats: CursorChatMap = readCursorChatModels()
  resolveAutoModelsFromLocalChats(result, chats)
  supplementFromLocalModels(result, chats)

  result.duration_ms = Date.now() - start
  return result
}

/**
 * 官方把 Auto 模式记成 "auto"，但本机对话存储里有底层真实模型。把能对上号的 Auto 记录改成真实模型；
 * 一个对话里 Auto 切换过多个模型时，原记录隐藏（is_internal=1，留作去重锚点）、按输出占比拆成派生记录。
 * 每次同步整体重算：能对上本机对话的派生记录按新计划增改；本机暂时读不到的对话（目录被清、store 锁住）sticky 保留上次归因，绝不回退成 auto 再删派生行。
 */
function resolveAutoModelsFromLocalChats(result: SyncResult, chats: CursorChatMap) {
  try {
    const db = getDb()
    const rows = db
      .prepare(`
        SELECT id, request_id, model, provider, project, timestamp,
               input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, cost_usd, is_internal
        FROM usage_records
        WHERE source = 'cursor' AND estimated = 0 AND is_aggregate = 0 AND request_id LIKE 'cursor:%'
      `)
      .all() as OfficialCursorRow[]
    const hasAuto = rows.some((row) => isCursorAutoRequestId(row.request_id))
    const existingDerived = rows.filter((row) => isCursorAutoDerivedRequestId(row.request_id))
    if (!hasAuto && existingDerived.length === 0) return

    const plan = planCursorAutoResolution(rows, chats)

    // 本机这次没读到的对话：保留其上一次的派生行（plan 也不会去改它们的锚点）
    const stickyDerived = new Set<string>()
    for (const row of existingDerived) {
      const conv = conversationIdFromOfficialRequestId(row.request_id)
      if (conv && !chats.has(conv)) stickyDerived.add(row.request_id)
    }
    const keep = new Set<string>([...plan.derived.map((r) => r.request_id), ...stickyDerived])

    for (const u of plan.updates) ensureModelPricing(u.model)
    for (const record of plan.derived) ensureModelPricing(record.model)

    const apply = db.transaction(() => {
      let changed = 0
      const update = db.prepare('UPDATE usage_records SET model = @model, provider = @provider, is_internal = @is_internal WHERE id = @id')
      for (const u of plan.updates) {
        update.run({ id: u.id, model: u.model, provider: u.provider, is_internal: u.is_internal ? 1 : 0 })
        changed++
      }
      const dropStmt = db.prepare('DELETE FROM usage_records WHERE id = ?')
      for (const row of existingDerived) {
        if (!keep.has(row.request_id)) {
          dropStmt.run(row.id)
          changed++
        }
      }
      // 派生行只是把已入库的 Auto 用量重新归到真实模型名下，不是新用量：不计入 inserted
      for (const record of plan.derived) {
        const written = replaceUsageRecordByRequestId(record)
        if (written.success && !written.duplicate) changed++
      }
      return changed
    })
    if (apply() > 0) invalidateStatsCache()
  } catch (err) {
    recordSyncError(result, err)
  }
}

/**
 * 官方接口没列出的对话（例如选了 Claude Opus / Sonnet 的对话），用 Cursor 对话存储里每段回复的
 * 真实模型补上，并标记为估算。官方接口之后若补上了同一对话，则删除本机估算，避免重复计数。
 */
function supplementFromLocalModels(result: SyncResult, chats: CursorChatMap) {
  try {
    const db = getDb()
    const covered = new Set<string>()
    // 官方 request_id 以 cursor: 开头（含被隐藏的 Auto 原记录和 grok-bot 来源），不按 source 过滤
    const officialRows = db
      .prepare("SELECT request_id FROM usage_records WHERE estimated = 0 AND request_id LIKE 'cursor:%'")
      .all() as Array<{ request_id: string }>
    for (const row of officialRows) {
      const id = conversationIdFromOfficialRequestId(row.request_id)
      if (id) covered.add(id)
    }

    const records = collectCursorLocalModelRecords({ coveredConversationIds: covered, chats })

    // 本机估算每次都是从对话存储整体重算出来的派生数据：不在这次结果里的旧行
    // （官方后来补上了该对话、模型识别被修正等）一律删掉，避免残留错误标签或重复计数。
    // 若 chats 整体读空（目录暂时不可用），不要清空已有估算行。
    if (chats.size === 0) return

    const keep = new Set(records.map((r) => r.request_id))
    const localRows = db
      .prepare("SELECT id, request_id FROM usage_records WHERE source = 'cursor' AND request_id LIKE 'cursor-local:%'")
      .all() as Array<{ id: number; request_id: string }>

    const apply = db.transaction(() => {
      const dropStmt = db.prepare('DELETE FROM usage_records WHERE id = ?')
      let dropped = 0
      for (const row of localRows) {
        if (!keep.has(row.request_id)) {
          dropStmt.run(row.id)
          dropped++
        }
      }
      for (const record of records) {
        ensureModelPricing(record.model)
        // 估算行金额由 collectCursorLocalModelRecords 统一记 $0（没把握就不报金额），这里不再按价格表折算
        const written = replaceUsageRecordByRequestId({ ...record, cost_usd: 0 })
        result.scanned++
        if (!written.duplicate) result.inserted++
      }
      return dropped
    })
    if (apply() > 0) invalidateStatsCache()
  } catch (err) {
    recordSyncError(result, err)
  }
}
