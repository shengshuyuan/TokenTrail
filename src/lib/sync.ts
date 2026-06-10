/**
 * TokenTrail — 服务端同步模块
 *
 * 扫描 Claude Code、Codex 的本地 JSONL 文件，
 * 并从 VibeCafé API 拉取 OpenClaw/Hermes 等所有来源的用量数据。
 */

import fs from 'fs'
import path from 'path'
import { backfillProjectByRequestPrefix, getDb, insertUsageRecord, normalizeStoredProjectNames, upsertModelPricing, getConfig } from './db'
import { calculateCost } from './pricing'
import { ensureInit } from './init'

// ─── 类型 ──────────────────────────────────────────────────────

interface SyncResult {
  source: string
  scanned: number
  inserted: number
  duplicates: number
  errors: number
  duration_ms: number
}

// ─── Claude Code 同步 ─────────────────────────────────────────

const CLAUDE_PROJECTS_DIR = path.join(
  process.env.HOME || '/root',
  '.claude',
  'projects'
)

function syncClaudeCode(): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'claude-code',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
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
    const fullProjectPath = path.join(CLAUDE_PROJECTS_DIR, projectDir)
    let files: string[]
    try { files = fs.readdirSync(fullProjectPath).filter(f => f.endsWith('.jsonl')) } catch { continue }

    for (const file of files) {
      const filePath = path.join(fullProjectPath, file)
      const sessionId = file.replace('.jsonl', '')

      try {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)

        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            if (entry.type !== 'assistant' || !entry.message?.usage) continue
            const usage = entry.message.usage
            if (!usage.input_tokens && !usage.output_tokens && !usage.cache_read_input_tokens) continue

            const model = entry.message.model || 'unknown'
            const rawTs = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
            const timestamp = Number.isFinite(rawTs) ? rawTs : Date.now()
            const msgId = entry.message.id || `${sessionId}-${entry.uuid || ''}`

            // 自动注册未知模型
            ensureModelPricing(model)

            const input_tokens = usage.input_tokens || 0
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
              request_id: msgId,
              timestamp,
            })

            result.scanned++
            if (insertResult.duplicate) result.duplicates++
            else result.inserted++
          } catch {
            result.errors++
          }
        }
      } catch {
        result.errors++
      }
    }
  }

  result.duration_ms = Date.now() - start
  return result
}

// ─── Codex 同步 ───────────────────────────────────────────────

const CODEX_SESSIONS_DIR = path.join(
  process.env.HOME || '/root',
  '.codex',
  'sessions'
)

function syncCodex(): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'codex',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    duration_ms: 0,
  }

  if (!fs.existsSync(CODEX_SESSIONS_DIR)) {
    result.duration_ms = Date.now() - start
    return result
  }

  const jsonlFiles = findAllJsonl(CODEX_SESSIONS_DIR)

  for (const filePath of jsonlFiles) {
    const relativePath = path.relative(CODEX_SESSIONS_DIR, filePath)

    try {
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
      let currentModel: string | undefined
      let currentProject: string | undefined

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]
        if (!line.trim()) continue

        try {
          const entry = JSON.parse(line)

          const contextualModel = extractCodexModel(entry)
          if (contextualModel) {
            currentModel = contextualModel
          }
          const contextualProject = extractCodexProject(entry)
          if (contextualProject) {
            currentProject = contextualProject
            backfillProjectByRequestPrefix(`codex:${relativePath}:`, currentProject)
          }

          if (entry.type !== 'event_msg') continue
          if (entry.payload?.type !== 'token_count') continue

          const info = entry.payload.info
          if (!info?.last_token_usage) continue

          const usage = info.last_token_usage
          if (!usage.input_tokens && !usage.output_tokens && !usage.cached_input_tokens && !usage.reasoning_output_tokens) continue

          const requestId = `codex:${relativePath}:L${lineIdx}`
          const rawTs = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
          const timestamp = Number.isFinite(rawTs) ? rawTs : Date.now()
          const model = extractCodexModel(entry) || currentModel || 'unknown-codex'

          ensureModelPricing(model)

          const input_tokens = usage.input_tokens || 0
          const cached_input_tokens = usage.cached_input_tokens || 0
          const output_tokens = usage.output_tokens || 0
          const reasoning_tokens = usage.reasoning_output_tokens || 0

          const cost_usd = calculateCost({ model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens })

          const insertResult = insertUsageRecord({
            source: 'codex',
            project: currentProject,
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
        } catch {
          result.errors++
        }
      }
    } catch {
      result.errors++
    }
  }

  result.duration_ms = Date.now() - start
  return result
}

// ─── VibeCafé API 同步 ─────────────────────────────────────────

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
  const lower = raw.toLowerCase()
  return MODEL_ALIASES[lower] || lower
}

async function syncVibeCafe(): Promise<SyncResult> {
  const start = Date.now()
  const result: SyncResult = {
    source: 'vibecafe',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
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
    })

    if (!res.ok) {
      result.errors++
      result.duration_ms = Date.now() - start
      return result
    }

    const data = await res.json() as { buckets: VibeCafeBucket[] }
    const buckets = data.buckets || []

    for (const bucket of buckets) {
      try {
        const model = normalizeModelName(bucket.model)
        const source = bucket.source || 'unknown'
        const rawBucketTs = new Date(bucket.bucketStart).getTime()
        const timestamp = Number.isFinite(rawBucketTs) ? rawBucketTs : Date.now()

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
      } catch {
        result.errors++
      }
    }
  } catch {
    result.errors++
  }

  result.duration_ms = Date.now() - start
  return result
}

// ─── 统一入口 ─────────────────────────────────────────────────

let _syncing = false

export async function syncAll(): Promise<SyncResult[]> {
  // 防止并发 sync（双击 SYNC 按钮或多 tab 同时触发）
  if (_syncing) {
    return [{ source: 'sync', scanned: 0, inserted: 0, duplicates: 0, errors: 0, duration_ms: 0 }]
  }
  _syncing = true
  try {
    ensureInit()
    normalizeStoredProjectNames(normalizeClaudeProjectName)

    const results: SyncResult[] = []

    // Claude Code
    try {
      results.push(syncClaudeCode())
    } catch {
      results.push({ source: 'claude-code', scanned: 0, inserted: 0, duplicates: 0, errors: 1, duration_ms: 0 })
    }

    // Codex
    try {
      results.push(syncCodex())
    } catch {
      results.push({ source: 'codex', scanned: 0, inserted: 0, duplicates: 0, errors: 1, duration_ms: 0 })
    }

    // VibeCafé (OpenClaw, Hermes, etc.)
    try {
      results.push(await syncVibeCafe())
    } catch {
      results.push({ source: 'vibecafe', scanned: 0, inserted: 0, duplicates: 0, errors: 1, duration_ms: 0 })
    }

    return results
  } finally {
    _syncing = false
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────

/** 递归查找所有 JSONL 文件 */
function findAllJsonl(dir: string): string[] {
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

/** 从 Codex session entry 读取真实模型名，避免用 reasoning tokens 猜成 o4-mini/gpt-4.1。 */
function extractCodexModel(entry: Record<string, unknown>): string | undefined {
  const direct = pickString(entry.model)
  if (direct) return direct

  const payload = entry.payload as Record<string, unknown> | undefined
  const payloadModel = pickString(payload?.model)
  if (payloadModel) return payloadModel

  const collaborationMode = payload?.collaboration_mode as Record<string, unknown> | undefined
  const modeSettings = collaborationMode?.settings as Record<string, unknown> | undefined
  const modeModel = pickString(modeSettings?.model)
  if (modeModel) return modeModel

  const settings = payload?.settings as Record<string, unknown> | undefined
  return pickString(settings?.model)
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function extractCodexProject(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== 'session_meta') return undefined
  const payload = entry.payload as Record<string, unknown> | undefined
  const cwd = pickString(payload?.cwd)
  if (!cwd) return undefined
  return normalizeProjectName(path.basename(cwd))
}

function normalizeProjectName(project: string): string {
  try {
    return decodeURIComponent(project).trim() || 'unknown'
  } catch {
    return project.trim() || 'unknown'
  }
}

function normalizeClaudeProjectName(projectDir: string): string {
  const decoded = normalizeProjectName(projectDir)
  if (decoded === 'unknown') return decoded

  if (decoded.startsWith('-') || decoded.includes('-Users-')) {
    const parts = decoded.split('-').map(part => part.trim()).filter(Boolean)
    return parts[parts.length - 1] || decoded
  }

  return decoded
}

/** 确保模型在 pricing 表中有记录（价格默认 0，需后续手动更新） */
const _knownModels = new Set<string>()
function ensureModelPricing(model: string): void {
  if (_knownModels.has(model)) return
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
    _knownModels.add(model)
  } catch {
    // 注册失败不阻断同步
  }
}

/** 推测模型提供商 */
function detectProvider(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('claude')) return 'anthropic'
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4') || m.includes('codex')) return 'openai'
  if (m.includes('gemini')) return 'google'
  if (m.includes('deepseek')) return 'deepseek'
  if (m.includes('glm') || m.includes('chatglm')) return 'zhipu'
  if (m.includes('minimax')) return 'minimax'
  if (m.includes('qwen')) return 'alibaba'
  if (m.includes('llama')) return 'meta'
  if (m.includes('mimo')) return 'mimo'
  return 'unknown'
}
