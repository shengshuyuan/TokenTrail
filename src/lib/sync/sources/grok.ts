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
export function syncGrok(_options?: SyncRunOptions): SyncResult {
  const start = Date.now()
  const result: SyncResult = {
    source: 'grok',
    scanned: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    skipped_files: 0,
    duration_ms: 0,
  }

  if (!fs.existsSync(GROK_LOG_FILE)) {
    result.duration_ms = Date.now() - start
    return result
  }

  if (isUnchangedSyncedFile('grok', GROK_LOG_FILE)) {
    result.skipped_files++
    result.duration_ms = Date.now() - start
    return result
  }

  const sessionMeta = loadGrokSessionMeta()
  // workspace 级 prompt_history：按 session_id 过滤补时间线
  const workspacePromptTimelines = loadGrokWorkspacePromptTimelines()

  let content: string
  try {
    content = fs.readFileSync(GROK_LOG_FILE, 'utf-8')
  } catch (err) {
    recordSyncError(result, err)
    result.duration_ms = Date.now() - start
    return result
  }

  const lines = content.split('\n')
  // Stopping at the time budget or failing a write leaves the rest of the log
  // unread; the checkpoint must not mark it done in either case.
  let retryFile = false
  for (const line of lines) {
    if (budgetExceeded(_options?.deadline)) {
      result.warning = 'stopped at time budget'
      retryFile = true
      break
    }
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

      const prompt = Number(ctx.prompt_tokens) || 0
      const cachedPrompt = Number(ctx.cached_prompt_tokens) || 0
      const completion = Number(ctx.completion_tokens) || 0
      const reasoningRaw = Number(ctx.reasoning_tokens) || 0
      if (prompt === 0 && completion === 0 && cachedPrompt === 0 && reasoningRaw === 0) {
        continue
      }

      // xAI reports cached within prompt_tokens and reasoning within
      // completion_tokens — store mutually exclusive buckets so totals and
      // pricing do not count either category twice.
      const cached_input_tokens = Math.min(cachedPrompt, prompt)
      const input_tokens = prompt - cached_input_tokens
      const reasoning_tokens = Math.min(reasoningRaw, completion)
      const output_tokens = completion - reasoning_tokens

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
    } catch (err) {
      if (recordLineError(result, err).retryFile) retryFile = true
    }
  }

  if (!retryFile) markSyncedFile('grok', GROK_LOG_FILE)
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
