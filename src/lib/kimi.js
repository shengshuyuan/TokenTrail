const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function asNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) < 1e12 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime()
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

function projectFromPath(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const normalized = value.replace(/[\\/]+$/, '')
  const name = path.basename(normalized)
  return name && name !== path.sep ? name : undefined
}

function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const inputOther = asNumber(raw.inputOther ?? raw.input_other)
  const cacheCreation = asNumber(raw.inputCacheCreation ?? raw.input_cache_creation)
  const cachedInput = asNumber(raw.inputCacheRead ?? raw.input_cache_read)
  const output = asNumber(raw.output ?? raw.output_tokens)
  if (inputOther === 0 && cacheCreation === 0 && cachedInput === 0 && output === 0) return null
  return {
    input_tokens: inputOther + cacheCreation,
    cached_input_tokens: cachedInput,
    output_tokens: output,
    reasoning_tokens: 0,
  }
}

function collectLegacyUsage(message, timestamp, out) {
  if (!message || typeof message !== 'object') return
  if (message.type === 'SubagentEvent') {
    collectLegacyUsage(message.payload?.event, timestamp, out)
    return
  }
  if (message.type !== 'StatusUpdate') return
  const usage = normalizeUsage(message.payload?.token_usage)
  if (!usage) return
  out.push({
    ...usage,
    model: 'kimi-code',
    timestamp: timestampMs(timestamp),
    requestHint: typeof message.payload?.message_id === 'string'
      ? message.payload.message_id
      : undefined,
  })
}

/** Parse one persisted Kimi Code wire line (current TS CLI or legacy Python CLI). */
function parseKimiWireLine(line) {
  const entry = JSON.parse(line)
  const records = []

  if (entry.type === 'usage.record' && entry.usage) {
    if (entry.usageScope && entry.usageScope !== 'turn') return { records }
    const usage = normalizeUsage(entry.usage)
    if (!usage) return { records }
    records.push({
      ...usage,
      model: typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim() : 'kimi-code',
      timestamp: timestampMs(entry.time),
    })
    return { records }
  }

  if (entry.type === 'config.update') {
    return { records, project: projectFromPath(entry.cwd) }
  }

  // Legacy ~/.kimi wire format:
  // { timestamp: <unix seconds>, message: { type: 'StatusUpdate', payload: { token_usage } } }
  collectLegacyUsage(entry.message, entry.timestamp, records)
  return { records }
}

function readCurrentSessionIndex(homeDir) {
  const bySessionId = new Map()
  const indexFile = path.join(homeDir, 'session_index.jsonl')
  if (!fs.existsSync(indexFile)) return bySessionId
  try {
    for (const line of fs.readFileSync(indexFile, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        if (typeof entry.sessionId !== 'string') continue
        if (entry.deleted === true) bySessionId.delete(entry.sessionId)
        else if (typeof entry.workDir === 'string') bySessionId.set(entry.sessionId, entry.workDir)
      } catch {}
    }
  } catch {}
  return bySessionId
}

function readLegacyWorkDirs(homeDir) {
  const byBucket = new Map()
  const metadataFile = path.join(homeDir, 'kimi.json')
  if (!fs.existsSync(metadataFile)) return byBucket
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
    for (const item of Array.isArray(metadata.work_dirs) ? metadata.work_dirs : []) {
      if (typeof item.path !== 'string') continue
      const hash = crypto.createHash('md5').update(item.path, 'utf8').digest('hex')
      const bucket = item.kaos && item.kaos !== 'local' ? `${item.kaos}_${hash}` : hash
      byBucket.set(bucket, item.path)
    }
  } catch {}
  return byBucket
}

function sessionIdFromRelativePath(relativePath) {
  const parts = relativePath.split(path.sep)
  const agentsIndex = parts.indexOf('agents')
  if (agentsIndex > 0) return parts[agentsIndex - 1]
  const subagentsIndex = parts.indexOf('subagents')
  if (subagentsIndex > 0) return parts[subagentsIndex - 1]
  return parts.length > 1 ? parts[1] : undefined
}

function fallbackProjectFromBucket(bucket) {
  const match = /^wd_(.+)_[0-9a-f]{12}$/.exec(bucket)
  return match ? match[1] : bucket
}

function createKimiHomeContext(homeDir) {
  return {
    homeDir,
    sessionsDir: path.join(homeDir, 'sessions'),
    sessionIndex: readCurrentSessionIndex(homeDir),
    legacyWorkDirs: readLegacyWorkDirs(homeDir),
  }
}

function resolveKimiWireContext(context, filePath) {
  const relativePath = path.relative(context.sessionsDir, filePath)
  const parts = relativePath.split(path.sep)
  const bucket = parts[0] || 'unknown'
  const sessionId = sessionIdFromRelativePath(relativePath)
  const workDir = (sessionId && context.sessionIndex.get(sessionId)) || context.legacyWorkDirs.get(bucket)
  return {
    relativePath,
    project: projectFromPath(workDir) || fallbackProjectFromBucket(bucket),
  }
}

module.exports = {
  createKimiHomeContext,
  parseKimiWireLine,
  resolveKimiWireContext,
}
