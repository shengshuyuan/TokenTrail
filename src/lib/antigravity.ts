/**
 * Antigravity transcript parsing — pure functions, no db / fs dependencies,
 * so node --test can import this module directly.
 *
 * Antigravity's brain transcripts (transcript.jsonl) carry no usage data, so
 * token counts are estimated from content length (chars / 3.5). Rows produced
 * from this parser must be stored with estimated = 1.
 */

export interface AntigravityEvent {
  /** Index of the transcript line the event came from (stable request_id key). */
  entryIndex: number
  model: string
  input_tokens: number
  output_tokens: number
  timestamp: number
}

/** 兜底模型：与历史行为一致，检测不到任何线索时使用 */
const DEFAULT_ANTIGRAVITY_MODEL = 'gemini-3.8-flash'

const MODEL_SWITCH_PATTERN = /Model Selection[^\n]*?to\s+Gemini\s+([\d.]+)\s+(Flash|Pro)/i
const ANY_GEMINI_PATTERN = /Gemini\s+([\d.]+)\s+(Flash|Pro)/i

/** content 非字符串时按 100 字符计，与历史行为一致 */
const NON_STRING_CONTENT_CHARS = 100

function contentChars(entry: { content?: unknown }): number {
  if (!entry.content) return 0
  return typeof entry.content === 'string' ? entry.content.length : NON_STRING_CONTENT_CHARS
}

function modelFromMatch(match: RegExpMatchArray): string {
  return `gemini-${match[1]}-${match[2].toLowerCase()}`
}

/** 从 Antigravity 对话日志中检测所使用的 Gemini 模型版本（整段会话级别） */
export function detectAntigravityModel(lines: string[]): string {
  let detectedModel: string | null = null

  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      if (entry.source !== 'MODEL' || entry.type === 'USER_INPUT') {
        const content = typeof entry.content === 'string' ? entry.content : ''
        const settingMatch = content.match(MODEL_SWITCH_PATTERN)
        if (settingMatch) {
          detectedModel = modelFromMatch(settingMatch)
        }
      }
    } catch {
      // Ignore invalid JSON lines
    }
  }

  if (detectedModel) return detectedModel

  // 2. 回退：在用户显式发言或系统提示词中查找显式的 Gemini X.Y Flash/Pro 声明
  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      if (entry.source !== 'MODEL' || entry.type === 'USER_INPUT') {
        const content = typeof entry.content === 'string' ? entry.content : ''
        const anyGeminiMatch = content.match(ANY_GEMINI_PATTERN)
        if (anyGeminiMatch) {
          return modelFromMatch(anyGeminiMatch)
        }
      }
    } catch {
      // Ignore invalid JSON lines
    }
  }

  // 3. 默认回退
  return DEFAULT_ANTIGRAVITY_MODEL
}

/** 从 Antigravity 对话日志中提取项目名称 */
export function detectAntigravityProject(lines: string[]): string {
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const line = lines[i]
    if (!line) continue

    // 1. 工作区路径映射: ".../path -> user/project"
    const wsMatch = line.match(/\/[^\r\n"'\\]+\s*->\s*[^\/\s\r\n"'\\]+\/([a-zA-Z0-9_.-]+)/)
    if (wsMatch) {
      const p = wsMatch[1].trim()
      if (p && p !== 'unknown' && p !== 'CorpusName') return p
    }

    // 2. 项目目录路径: "VIbe coding/Project" 或 "成长记录/Project"
    const vibeMatch = line.match(/(?:VIbe coding\/|成长记录\/VIbe coding\/|成长记录\/)([a-zA-Z0-9_.-]+)/)
    if (vibeMatch) {
      try {
        const decoded = decodeURIComponent(vibeMatch[1]).trim()
        if (decoded && decoded !== 'unknown' && decoded !== 'VIbe coding') return decoded
      } catch {
        // ignore decode failure
      }
    }

    // 3. 工具调用工作目录: "Cwd": ".../Project"
    const cwdMatch = line.match(/"Cwd":\s*"\/[^\r\n"'\\]+\/([a-zA-Z0-9_.-]+)"/)
    if (cwdMatch) {
      try {
        const decoded = decodeURIComponent(cwdMatch[1]).trim()
        if (decoded && decoded !== 'unknown' && decoded !== 'VIbe coding') return decoded
      } catch {
        // ignore decode failure
      }
    }
  }

  return 'Antigravity'
}

/**
 * Parse a transcript into per-event usage estimates.
 *
 * A model state machine attributes each entry to the model selected at that
 * point ("Model Selection … to Gemini X" messages take effect for subsequent
 * entries), so a conversation that switches models mid-way no longer migrates
 * all its tokens onto the last-used model. Timestamps come from each entry's
 * created_at, keeping usage on the day it happened.
 *
 * When no explicit switch message exists, the conversation-level
 * detectAntigravityModel heuristic applies to every event (legacy behavior).
 */
export function parseAntigravityTranscript(lines: string[]): AntigravityEvent[] {
  let currentModel = DEFAULT_ANTIGRAVITY_MODEL
  let sawExplicitSwitch = false
  let lastTimestamp = Date.now()
  const events: AntigravityEvent[] = []

  for (let entryIndex = 0; entryIndex < lines.length; entryIndex++) {
    const line = lines[entryIndex]
    if (!line) continue
    try {
      const entry = JSON.parse(line)

      if (entry.created_at) {
        const ts = new Date(entry.created_at).getTime()
        if (!isNaN(ts)) lastTimestamp = ts
      }

      // 模型切换文案出现在非 MODEL 行（或 USER_INPUT）里，对后续 entry 生效
      if (entry.source !== 'MODEL' || entry.type === 'USER_INPUT') {
        const content = typeof entry.content === 'string' ? entry.content : ''
        const switchMatch = content.match(MODEL_SWITCH_PATTERN)
        if (switchMatch) {
          currentModel = modelFromMatch(switchMatch)
          sawExplicitSwitch = true
        }
      }

      let inputChars = 0
      let outputChars = 0
      if (entry.source === 'USER_EXPLICIT') {
        inputChars = contentChars(entry)
      } else if (entry.source === 'MODEL') {
        outputChars = contentChars(entry)
      }
      if (inputChars === 0 && outputChars === 0) continue

      events.push({
        entryIndex,
        model: currentModel,
        input_tokens: Math.max(1, Math.round(inputChars / 3.5)),
        output_tokens: Math.max(1, Math.round(outputChars / 3.5)),
        timestamp: lastTimestamp,
      })
    } catch {
      // Ignore invalid JSON lines
    }
  }

  if (!sawExplicitSwitch) {
    const heuristicModel = detectAntigravityModel(lines)
    for (const event of events) {
      event.model = heuristicModel
    }
  }

  return events
}
