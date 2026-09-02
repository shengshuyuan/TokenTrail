function pickString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function extractCodexModel(entry) {
  const direct = pickString(entry?.model)
  if (direct) return direct

  const payload = entry?.payload
  const payloadModel = pickString(payload?.model)
  if (payloadModel) return payloadModel

  const modeModel = pickString(payload?.collaboration_mode?.settings?.model)
  if (modeModel) return modeModel

  return pickString(payload?.settings?.model)
}

function asTokenCount(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

/**
 * Codex reports cached input within input_tokens and reasoning output within
 * output_tokens. Store mutually exclusive buckets so dashboard totals and
 * pricing do not count either category twice.
 */
function normalizeCodexTokenUsage(usage) {
  if (!usage || typeof usage !== 'object') return null

  const inputTotal = asTokenCount(usage.input_tokens)
  const cachedInput = Math.min(inputTotal, asTokenCount(usage.cached_input_tokens))
  const outputTotal = asTokenCount(usage.output_tokens)
  const reasoningOutput = Math.min(outputTotal, asTokenCount(usage.reasoning_output_tokens))

  if (inputTotal === 0 && outputTotal === 0) return null

  return {
    input_tokens: inputTotal - cachedInput,
    cached_input_tokens: cachedInput,
    output_tokens: outputTotal - reasoningOutput,
    reasoning_tokens: reasoningOutput,
  }
}

function isCodexInternalModel(model) {
  return model === 'codex-auto-review'
}

function createCodexSessionUsageParser() {
  let currentModel

  return {
    parse(entry) {
      const model = extractCodexModel(entry)
      if (model) currentModel = model

      if (entry?.type !== 'event_msg' || entry?.payload?.type !== 'token_count') return null
      const usage = normalizeCodexTokenUsage(entry.payload.info?.last_token_usage)
      if (!usage || !currentModel) return null

      return { model: currentModel, ...usage }
    },
  }
}

module.exports = {
  createCodexSessionUsageParser,
  extractCodexModel,
  isCodexInternalModel,
  normalizeCodexTokenUsage,
}
