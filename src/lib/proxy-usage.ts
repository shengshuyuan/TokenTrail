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

/** Max SSE text retained for usage extraction (last N chars). */
const SSE_TAIL_LIMIT = 64 * 1024

/**
 * Extract the final usage block from an SSE stream transcript.
 * Prefers the last usage event (cumulative). Falls back to the last seen model
 * when the usage-only chunk omits model (common with stream_options.include_usage).
 */
export function extractUsageFromSSE(chunk: string): ExtractedStreamUsage | null {
  let lastModel: string | undefined
  let lastId: string | undefined
  let lastUsage: ExtractedStreamUsage | null = null

  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
    try {
      const obj = JSON.parse(line.slice(6)) as {
        model?: string
        id?: string
        usage?: OpenAIUsageShape
      }
      if (typeof obj.model === 'string' && obj.model.trim()) {
        lastModel = obj.model.trim()
      }
      if (typeof obj.id === 'string' && obj.id.trim()) {
        lastId = obj.id.trim()
      }
      if (obj.usage) {
        const model = (typeof obj.model === 'string' && obj.model.trim()) || lastModel
        if (!model) continue
        lastUsage = {
          model,
          id: (typeof obj.id === 'string' && obj.id.trim()) || lastId,
          usage: obj.usage,
        }
      }
    } catch {
      // skip malformed SSE line
    }
  }

  return lastUsage
}

/** Keep only the tail of the SSE buffer so long streams do not grow unboundedly. */
export function appendSseTail(existing: string, next: string, limit = SSE_TAIL_LIMIT): string {
  const combined = existing + next
  return combined.length > limit ? combined.slice(-limit) : combined
}
