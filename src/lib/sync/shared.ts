import path from 'path'
import fs from 'fs'
import { getDb, isJunkAutoPricingModel, upsertModelPricing } from '../db'
import type { SyncResult } from './types'

export function formatSyncError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err || 'sync failed')
  return message.replace(/\s+/g, ' ').slice(0, 240)
}

export function recordSyncError(result: SyncResult, err: unknown) {
  result.errors++
  if (!result.error) result.error = formatSyncError(err)
}

/**
 * Record a per-line failure and say whether the file must be read again.
 *
 * A line that is not valid JSON will fail the same way every time, so it is
 * counted in `bad_lines` and the file may still be checkpointed. Anything
 * else (database busy, disk full, pricing lookup) can succeed on the next run:
 * the caller must then skip markSyncedFile so the file is not skipped as
 * "unchanged" forever. Re-reading is safe because inserts are idempotent.
 */
export function recordLineError(result: SyncResult, err: unknown): { retryFile: boolean } {
  if (err instanceof SyntaxError) {
    result.bad_lines = (result.bad_lines ?? 0) + 1
    recordSyncError(result, err)
    return { retryFile: false }
  }
  recordSyncError(result, err)
  console.warn(`[TokenTrail] ${result.source}: line write failed, file will be retried next sync:`, formatSyncError(err))
  return { retryFile: true }
}

export function failedSyncResult(source: string, err: unknown): SyncResult {
  return {
    source,
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 1,
    skipped_files: 0,
    duration_ms: 0,
    error: formatSyncError(err),
  }
}

export function emptySyncResult(source: string): SyncResult {
  return {
    source,
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }
}

export function budgetExceeded(deadline?: number): boolean {
  return typeof deadline === 'number' && Date.now() > deadline
}

/**
 * Normalize timestamp to numeric milliseconds.
 * Handles ms numbers, unix-seconds numbers, numeric strings, ISO strings, and missing.
 */
export function normalizeTimestamp(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.abs(raw) < 1e12 ? Math.round(raw * 1000) : Math.round(raw)
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return Date.now()
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      return normalizeTimestamp(Number(trimmed))
    }
    const normalizedIso = trimmed.replace(/(\.\d{3})\d+/, '$1')
    const t = new Date(normalizedIso).getTime()
    if (Number.isFinite(t)) return t
  }
  return Date.now()
}

/** 递归查找所有 JSONL 文件 */
export function findAllJsonl(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findAllJsonl(fullPath))
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(fullPath)
      }
    }
  } catch {
    // 跳过无权限目录
  }
  return results.sort()
}

export function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeProjectName(project: string): string {
  try {
    return decodeURIComponent(project).trim() || 'unknown'
  } catch {
    return project.trim() || 'unknown'
  }
}

export function extractCodexProject(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== 'session_meta') return undefined
  const payload = entry.payload as Record<string, unknown> | undefined
  const cwd = pickString(payload?.cwd)
  if (!cwd) return undefined
  return normalizeProjectName(path.basename(cwd))
}

export function normalizeClaudeProjectName(projectDir: string): string {
  const decoded = normalizeProjectName(projectDir)
  if (decoded === 'unknown') return decoded

  if (decoded.startsWith('-') || decoded.includes('-Users-')) {
    const parts = decoded.split('-').map(part => part.trim()).filter(Boolean)
    return parts[parts.length - 1] || decoded
  }

  return decoded
}

/** 推测模型提供商。Cursor 自有与 cursor-grok-* 归到 cursor，避免价格表被拆成一堆 xai 行。 */
export function detectProvider(model: string): string {
  const m = model.toLowerCase()
  if (m.startsWith('cursor-') || m.startsWith('composer')) return 'cursor'
  if (m.includes('claude')) return 'anthropic'
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4') || m.includes('codex')) return 'openai'
  if (m.includes('gemini')) return 'google'
  if (m.includes('deepseek')) return 'deepseek'
  if (m.includes('glm') || m.includes('chatglm')) return 'zhipu'
  if (m.includes('minimax')) return 'minimax'
  if (m.includes('qwen')) return 'alibaba'
  if (m.includes('llama')) return 'meta'
  if (m.includes('mimo')) return 'mimo'
  if (m.includes('grok')) return 'xai'
  if (m.includes('kimi') || m.includes('moonshot') || m === 'k3' || m.startsWith('k3.') || m.startsWith('k3-')) return 'moonshot'
  return 'unknown'
}

/** 确保模型在 pricing 表中有记录（价格默认 0，需后续手动更新） */
const knownModels = new Set<string>()
export function ensureModelPricing(model: string): void {
  if (isJunkAutoPricingModel(model)) return
  if (knownModels.has(model)) return
  try {
    const db = getDb()
    const existing = db.prepare('SELECT 1 FROM model_pricing WHERE model_id = ?').get(model)
    if (!existing) {
      upsertModelPricing({
        model_id: model,
        display_name: model,
        provider: detectProvider(model),
        input_price_per_1m: 0,
        output_price_per_1m: 0,
      })
      console.warn(`[TokenTrail] Auto-registered model "${model}" with price=0. Update via POST /api/pricing`)
    }
    knownModels.add(model)
  } catch {
    // 注册失败不阻断同步
  }
}
