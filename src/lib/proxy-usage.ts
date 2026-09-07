/**
 * Shared helpers for OpenAI-compatible proxy usage extraction.
 */

export interface OpenAIUsageShape {
  prompt_tokens: number
  completion_tokens: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

export interface ExtractedStreamUsage {
  model: string
  id?: string
  usage: OpenAIUsageShape
}

/** Safety cap for the partial-line buffer (a single SSE line is never this large). */
const SSE_LINE_LIMIT = 1024 * 1024

/** Max SSE text retained by the deprecated tail-buffer helper (last N chars). */
const SSE_TAIL_LIMIT = 64 * 1024

/** Non-negative integer coercion, matching db.sanitizeTokenCount semantics. */
function toTokenCount(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

export interface NormalizedTokenBuckets {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
}

/**
 * OpenAI reports cached input within prompt_tokens and reasoning output within
 * completion_tokens. Convert to mutually exclusive buckets so dashboard totals
 * and pricing do not count either category twice (same rule as codex.js).
 */
export function normalizeOpenAIUsage(usage: Partial<OpenAIUsageShape> | undefined): NormalizedTokenBuckets {
  const prompt = toTokenCount(usage?.prompt_tokens)
  const completion = toTokenCount(usage?.completion_tokens)
  const cached = Math.min(toTokenCount(usage?.prompt_tokens_details?.cached_tokens), prompt)
  const reasoning = Math.min(toTokenCount(usage?.completion_tokens_details?.reasoning_tokens), completion)
  return {
    input_tokens: prompt - cached,
    cached_input_tokens: cached,
    output_tokens: completion - reasoning,
    reasoning_tokens: reasoning,
  }
}

/**
 * Incremental SSE usage extractor. Feed decoded chunks via push() as they
 * stream and call finalize() when the stream ends. State is O(1): the model /
 * id / last usage are captured as seen, so long streams never lose the model
 * announced in the first chunk (the failure mode of tail-only buffers).
 */
export class SseUsageTracker {
  private partialLine = ''
  private lastModel: string | undefined
  private lastId: string | undefined
  private lastUsage: ExtractedStreamUsage | null = null

  /** Feed one decoded chunk; only an incomplete trailing line is retained. */
  push(text: string): void {
    this.partialLine += text
    if (this.partialLine.length > SSE_LINE_LIMIT) {
      // Keep the tail so a pathological never-ending line cannot grow memory
      // without bound; the truncated JSON will simply fail to parse.
      this.partialLine = this.partialLine.slice(-SSE_LINE_LIMIT)
    }
    let newlineIndex = this.partialLine.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.partialLine.slice(0, newlineIndex)
      this.partialLine = this.partialLine.slice(newlineIndex + 1)
      this.consumeLine(line)
      newlineIndex = this.partialLine.indexOf('\n')
    }
  }

  /** Treat any buffered partial line as final, then return the extracted usage. */
  finalize(): ExtractedStreamUsage | null {
    if (this.partialLine) {
      const line = this.partialLine
      this.partialLine = ''
      this.consumeLine(line)
    }
    return this.lastUsage
  }

  private consumeLine(line: string): void {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) return
    try {
      const obj = JSON.parse(line.slice(6)) as {
        model?: string
        id?: string
        usage?: OpenAIUsageShape
      }
      if (typeof obj.model === 'string' && obj.model.trim()) {
        this.lastModel = obj.model.trim()
      }
      if (typeof obj.id === 'string' && obj.id.trim()) {
        this.lastId = obj.id.trim()
      }
      if (obj.usage) {
        // Falls back to the last seen model when the usage-only chunk omits
        // model (common with stream_options.include_usage).
        const model = (typeof obj.model === 'string' && obj.model.trim()) || this.lastModel
        if (!model) return
        this.lastUsage = {
          model,
          id: (typeof obj.id === 'string' && obj.id.trim()) || this.lastId,
          usage: obj.usage,
        }
      }
    } catch {
      // skip malformed SSE line
    }
  }
}

/**
 * Extract the final usage block from a complete SSE transcript.
 * Prefers the last usage event (cumulative). Thin wrapper over SseUsageTracker
 * for callers that already hold the full stream text.
 */
export function extractUsageFromSSE(chunk: string): ExtractedStreamUsage | null {
  const tracker = new SseUsageTracker()
  tracker.push(chunk)
  return tracker.finalize()
}

/**
 * Keep only the tail of an SSE buffer so long streams do not grow unboundedly.
 * @deprecated Proxy routes now parse incrementally via SseUsageTracker; kept
 * only for compatibility with existing callers.
 */
export function appendSseTail(existing: string, next: string, limit = SSE_TAIL_LIMIT): string {
  const combined = existing + next
  return combined.length > limit ? combined.slice(-limit) : combined
}
