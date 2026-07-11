/**
 * TokenTrail — 服务端同步模块
 *
 * 扫描 Claude Code、Codex、Grok 的本地日志/JSONL，
 * 以及 OpenClaw/Hermes 用量文件，并从 VibeCafé API 拉取云端汇总。
 */

import fs from 'fs'
import path from 'path'
import { backfillProjectByRequestPrefix, correctProjectByRequestId, getDb, insertUsageRecord, normalizeStoredProjectNames, upsertModelPricing, getConfig } from './db'
import { calculateCost } from './pricing'
import { ensureInit } from './init'
const { findTraeHistoryFiles, parseTraeHistoryFile } = require('./traework.js') as {
  findTraeHistoryFiles: () => string[]
  parseTraeHistoryFile: (filePath: string) => Array<{
    source: string
    provider?: string
    project?: string
    model: string
    input_tokens: number
    cached_input_tokens?: number
    output_tokens: number
    reasoning_tokens?: number
    request_id?: string
    timestamp?: number
  }>
}

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

// ─── 本地 JSONL 用量文件扫描（OpenClaw、Hermes 等）────────────

interface LocalUsageSource {
  name: string
  dir: string
}

const LOCAL_USAGE_SOURCES: LocalUsageSource[] = [
  { name: 'openclaw', dir: path.join(process.env.HOME || '/root', '.openclaw', 'usage') },
  { name: 'hermes', dir: path.join(process.env.HOME || '/root', '.hermes', 'usage') },
  { name: 'grok', dir: path.join(process.env.HOME || '/root', '.grok', 'usage') },
]

/**
 * 扫描工具写入的本地 JSONL 用量文件。
 * 文件格式：每行一个 JSON 对象，包含 model、input_tokens、output_tokens 等字段。
 * 文件路径：~/.openclaw/usage/YYYY-MM-DD.jsonl
 */
function syncLocalUsageFiles(): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'local-usage',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    duration_ms: 0,
  }

  for (const { name, dir } of LOCAL_USAGE_SOURCES) {
    if (!fs.existsSync(dir)) continue

    const jsonlFiles = findAllJsonl(dir)
    for (const filePath of jsonlFiles) {
      try {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
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

            const model = entry.model
            ensureModelPricing(model)

            const cost_usd = calculateCost({
              model,
              input_tokens: input,
              cached_input_tokens: cached,
              output_tokens: output,
              reasoning_tokens: reasoning,
            })

            const insertResult = insertUsageRecord({
              source: entry.source || name,
              provider: entry.provider,
              project: entry.project,
              model,
              input_tokens: input,
              cached_input_tokens: cached,
              output_tokens: output,
              reasoning_tokens: reasoning,
              cost_usd,
              request_id: entry.request_id,
              timestamp: normalizeTimestamp(entry.timestamp),
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

// ─── Grok (Grok CLI / Grok Build) 本地日志扫描 ─────────────────
//
// 主数据源：~/.grok/logs/unified.jsonl 中的 shell.turn.inference_done
// project 归属：
//   1) 默认用 session cwd 的文件夹名
//   2) 若用户在 prompt 里给出具体项目路径（如 .../SayBetter），按时间线切换
// 去重 ID：grok:{sessionId}:L{loopIndex}:{timestampMs}

const GROK_HOME = path.join(process.env.HOME || '/root', '.grok')
const GROK_LOG_FILE = path.join(GROK_HOME, 'logs', 'unified.jsonl')
const GROK_SESSIONS_DIR = path.join(GROK_HOME, 'sessions')

interface GrokSessionMeta {
  model: string
  /** session 启动目录 basename，仅作缺省值 */
  defaultProject: string
  /** 按 prompt 时间线推导的 project 切换点 */
  projectTimeline: Array<{ at: number; project: string }>
}

interface ProjectTimelinePoint {
  at: number
  project: string
}

/**
 * 在可能夹杂说明文字的字符串里，解析出最长真实存在的本地路径。
 * 支持中文/空格目录名，例如：
 *   /Users/.../VIbe coding/SayBetter 看看这个项目
 * → /Users/.../VIbe coding/SayBetter
 */
function resolveLongestExistingPath(raw: string): string | null {
  if (!raw) return null
  let candidate = raw.trim().replace(/^[("'`]|[("'`]+$/g, '')
  if (!candidate.startsWith('/')) return null

  // 从完整字符串逐步缩短，找到最长存在的路径（兼容尾部中文说明）
  while (candidate.length > 1) {
    const cleaned = candidate.replace(/[/"'`\s]+$/g, '')
    try {
      if (cleaned.startsWith('/') && fs.existsSync(cleaned)) return cleaned
    } catch {
      // ignore
    }
    candidate = candidate.slice(0, -1)
  }
  return null
}

/** 从绝对路径中识别真实项目文件夹名（优先 package.json / .git 所在目录） */
function projectNameFromFilesystemPath(rawPath: string): string | null {
  const existing = resolveLongestExistingPath(rawPath)
  if (!existing) return null

  // 只认真实项目根（package.json / .git），避免：
  // - 「设计稿」等子目录
  // - 「VIbe coding」等多项目父目录
  let current = existing
  for (let i = 0; i < 12; i++) {
    try {
      if (fs.existsSync(current) && fs.statSync(current).isDirectory()) {
        const hasPkg = fs.existsSync(path.join(current, 'package.json'))
        const hasGit = fs.existsSync(path.join(current, '.git'))
        if (hasPkg || hasGit) {
          return normalizeProjectName(path.basename(current))
        }
      }
    } catch {
      // ignore permission / race
    }
    const parent = path.dirname(current)
    if (!parent || parent === current) break
    current = parent
  }

  return null
}

/** 从一段用户文本中提取最可能的项目文件夹名 */
function extractProjectFromPromptText(text: string): string | null {
  if (!text) return null
  // 找到所有绝对路径起点（路径本身可含中文/空格，不能在正则里截断）
  const startRe = /\/(?:Users|home|Volumes)\//g
  const starts: number[] = []
  let m: RegExpExecArray | null
  while ((m = startRe.exec(text)) !== null) {
    starts.push(m.index)
  }
  // 从后往前：后出现的路径更可能是用户当前要做的项目
  for (let i = starts.length - 1; i >= 0; i--) {
    const start = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1] : text.length
    // 取到行尾或下一个路径起点
    const slice = text.slice(start, end).split(/[\n\r]/)[0]
    const project = projectNameFromFilesystemPath(slice)
    if (project && project !== 'unknown') return project
  }
  return null
}

function loadGrokProjectTimeline(sessionDir: string, sessionId: string, defaultProject: string): ProjectTimelinePoint[] {
  const timeline: ProjectTimelinePoint[] = [{ at: 0, project: defaultProject || 'unknown' }]
  const promptHistory = path.join(sessionDir, 'prompt_history.jsonl')
  // prompt_history 也可能在 workspace 根目录（与 session 同级）
  const candidates = [
    promptHistory,
    path.join(path.dirname(sessionDir), 'prompt_history.jsonl'),
  ]

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    try {
      const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as {
            timestamp?: string
            session_id?: string
            prompt?: string
            is_bash?: boolean
          }
          if (entry.is_bash) continue
          // workspace 级 history 含多会话，必须按 session_id 过滤
          if (entry.session_id && entry.session_id !== sessionId) continue
          const prompt = entry.prompt || ''
          const project = extractProjectFromPromptText(prompt)
          if (!project) continue
          const at = normalizeTimestamp(entry.timestamp)
          const last = timeline[timeline.length - 1]
          if (!last || last.project !== project) {
            timeline.push({ at, project })
          }
        } catch {
          // skip bad line
        }
      }
    } catch {
      // skip unreadable
    }
  }

  timeline.sort((a, b) => a.at - b.at)
  return timeline
}

function resolveProjectFromTimeline(timeline: ProjectTimelinePoint[], timestamp: number, fallback: string): string {
  if (!timeline.length) return fallback || 'unknown'
  let project = timeline[0].project || fallback || 'unknown'
  for (const point of timeline) {
    if (point.at <= timestamp) project = point.project
    else break
  }
  return project || fallback || 'unknown'
}

function loadGrokSessionMeta(): Map<string, GrokSessionMeta> {
  const map = new Map<string, GrokSessionMeta>()
  if (!fs.existsSync(GROK_SESSIONS_DIR)) return map

  const stack = [GROK_SESSIONS_DIR]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (entry.name !== 'summary.json') continue
      try {
        const summary = JSON.parse(fs.readFileSync(full, 'utf-8')) as {
          info?: { id?: string; cwd?: string }
          current_model_id?: string
        }
        const sessionDir = path.dirname(full)
        const sid = summary.info?.id || path.basename(sessionDir)
        const cwd = summary.info?.cwd
        const defaultProject = cwd ? normalizeProjectName(path.basename(cwd)) : 'unknown'
        const model = summary.current_model_id || 'grok-4.5'
        const projectTimeline = loadGrokProjectTimeline(sessionDir, sid, defaultProject)
        map.set(sid, { model, defaultProject, projectTimeline })
      } catch {
        // skip bad summary
      }
    }
  }
  return map
}

/**
 * 扫描 Grok CLI 本地 unified 日志，导入历史与增量用量。
 * 零配置：不要求 Grok 额外写 usage JSONL。
 * project 按「会话 cwd + prompt 中的具体项目路径时间线」归属。
 */
function syncGrok(): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'grok',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    duration_ms: 0,
  }

  if (!fs.existsSync(GROK_LOG_FILE)) {
    result.duration_ms = Date.now() - start
    return result
  }

  const sessionMeta = loadGrokSessionMeta()
  // workspace 级 prompt_history：按 session_id 过滤补时间线
  const workspacePromptTimelines = loadGrokWorkspacePromptTimelines()

  let content: string
  try {
    content = fs.readFileSync(GROK_LOG_FILE, 'utf-8')
  } catch {
    result.errors++
    result.duration_ms = Date.now() - start
    return result
  }

  const lines = content.split('\n')
  for (const line of lines) {
    if (!line || !line.includes('shell.turn.inference_done') || !line.includes('prompt_tokens')) {
      continue
    }
    try {
      const entry = JSON.parse(line) as {
        ts?: string
        sid?: string
        msg?: string
        ctx?: {
          loop_index?: number
          prompt_tokens?: number
          cached_prompt_tokens?: number
          completion_tokens?: number
          reasoning_tokens?: number
        }
      }
      if (entry.msg !== 'shell.turn.inference_done') continue
      const ctx = entry.ctx
      if (!ctx) continue

      const input_tokens = Number(ctx.prompt_tokens) || 0
      const cached_input_tokens = Number(ctx.cached_prompt_tokens) || 0
      const output_tokens = Number(ctx.completion_tokens) || 0
      const reasoning_tokens = Number(ctx.reasoning_tokens) || 0
      if (input_tokens === 0 && output_tokens === 0 && cached_input_tokens === 0 && reasoning_tokens === 0) {
        continue
      }

      const sid = entry.sid || 'unknown'
      const loopIndex = ctx.loop_index ?? 0
      const timestamp = normalizeTimestamp(entry.ts)
      const meta = sessionMeta.get(sid)
      const model = meta?.model || 'grok-4.5'
      const defaultProject = meta?.defaultProject || 'unknown'
      const timeline = mergeProjectTimelines(
        meta?.projectTimeline || [{ at: 0, project: defaultProject }],
        workspacePromptTimelines.get(sid) || []
      )
      const project = resolveProjectFromTimeline(timeline, timestamp, defaultProject)
      const requestId = `grok:${sid}:L${loopIndex}:${timestamp}`

      ensureModelPricing(model)

      const cost_usd = calculateCost({
        model,
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_tokens,
      })

      const insertResult = insertUsageRecord({
        source: 'grok',
        provider: 'xai',
        project,
        model,
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_tokens,
        cost_usd,
        request_id: requestId,
        timestamp,
      })

      // 重复记录也纠正 project（修复历史误标为 session cwd 的情况）
      if (insertResult.duplicate) {
        correctProjectByRequestId(requestId, project)
      }

      result.scanned++
      if (insertResult.duplicate) result.duplicates++
      else result.inserted++
    } catch {
      result.errors++
    }
  }

  result.duration_ms = Date.now() - start
  return result
}

/** 读取各 workspace 下的 prompt_history.jsonl，按 session_id 建时间线 */
function loadGrokWorkspacePromptTimelines(): Map<string, ProjectTimelinePoint[]> {
  const map = new Map<string, ProjectTimelinePoint[]>()
  if (!fs.existsSync(GROK_SESSIONS_DIR)) return map

  let workspaceDirs: string[] = []
  try {
    workspaceDirs = fs
      .readdirSync(GROK_SESSIONS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(GROK_SESSIONS_DIR, e.name))
  } catch {
    return map
  }

  for (const workspaceDir of workspaceDirs) {
    const file = path.join(workspaceDir, 'prompt_history.jsonl')
    if (!fs.existsSync(file)) continue
    try {
      const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as {
            timestamp?: string
            session_id?: string
            prompt?: string
            is_bash?: boolean
          }
          if (entry.is_bash || !entry.session_id) continue
          const project = extractProjectFromPromptText(entry.prompt || '')
          if (!project) continue
          const at = normalizeTimestamp(entry.timestamp)
          const list = map.get(entry.session_id) || []
          const last = list[list.length - 1]
          if (!last || last.project !== project) {
            list.push({ at, project })
            map.set(entry.session_id, list)
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }

  for (const [sid, list] of map) {
    list.sort((a, b) => a.at - b.at)
    map.set(sid, list)
  }
  return map
}

function mergeProjectTimelines(a: ProjectTimelinePoint[], b: ProjectTimelinePoint[]): ProjectTimelinePoint[] {
  const merged = [...a, ...b].sort((x, y) => x.at - y.at)
  const out: ProjectTimelinePoint[] = []
  for (const point of merged) {
    const last = out[out.length - 1]
    if (!last || last.project !== point.project) out.push(point)
  }
  return out.length ? out : [{ at: 0, project: 'unknown' }]
}

// ─── TraeWork 历史/增量同步（基于 ~/.trae/chat/**/chat_histories.json）────

function syncTraeWork(): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'traework',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    duration_ms: 0,
  }

  let files: string[] = []
  try {
    files = findTraeHistoryFiles()
  } catch {
    result.errors++
    result.duration_ms = Date.now() - start
    return result
  }

  for (const filePath of files) {
    try {
      const records = parseTraeHistoryFile(filePath)
      for (const record of records) {
        try {
          ensureModelPricing(record.model)
          const input_tokens = record.input_tokens || 0
          const cached_input_tokens = record.cached_input_tokens || 0
          const output_tokens = record.output_tokens || 0
          const reasoning_tokens = record.reasoning_tokens || 0

          const cost_usd = calculateCost({
            model: record.model,
            input_tokens,
            cached_input_tokens,
            output_tokens,
            reasoning_tokens,
          })

          const insertResult = insertUsageRecord({
            source: 'traework',
            provider: record.provider,
            project: record.project,
            model: record.model,
            input_tokens,
            cached_input_tokens,
            output_tokens,
            reasoning_tokens,
            cost_usd,
            request_id: record.request_id,
            timestamp: normalizeTimestamp(record.timestamp),
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

    // 本地 JSONL 用量文件（OpenClaw、Hermes、Grok 可选 usage 目录）
    try {
      const localResult = syncLocalUsageFiles()
      if (localResult.scanned > 0) results.push(localResult)
    } catch {
      results.push({ source: 'local-usage', scanned: 0, inserted: 0, duplicates: 0, errors: 1, duration_ms: 0 })
    }

    // Grok CLI — 直接扫描 ~/.grok/logs/unified.jsonl（历史 + 增量）
    try {
      results.push(syncGrok())
    } catch {
      results.push({ source: 'grok', scanned: 0, inserted: 0, duplicates: 0, errors: 1, duration_ms: 0 })
    }

    // TraeWork 历史/增量会话
    try {
      const traeWorkResult = syncTraeWork()
      if (traeWorkResult.scanned > 0) results.push(traeWorkResult)
    } catch {
      results.push({ source: 'traework', scanned: 0, inserted: 0, duplicates: 0, errors: 1, duration_ms: 0 })
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

/** Normalize timestamp to numeric ms. Handles number, ISO string, and missing. */
function normalizeTimestamp(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const t = new Date(raw).getTime()
    if (Number.isFinite(t)) return t
  }
  return Date.now()
}

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
  if (m.includes('grok')) return 'xai'
  return 'unknown'
}
