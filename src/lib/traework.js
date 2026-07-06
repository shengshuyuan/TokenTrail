const fs = require('fs')
const path = require('path')
const os = require('os')

function stripHtmlTags(input) {
  if (!input) return ''
  return String(input)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function estimateTextTokens(text) {
  const normalized = stripHtmlTags(text)
  if (!normalized) return 0

  let score = 0
  for (const char of normalized) {
    if (/[\u4e00-\u9fff]/.test(char)) {
      score += 1.2
    } else if (/\s/.test(char)) {
      score += 0.15
    } else if (/[A-Za-z0-9]/.test(char)) {
      score += 0.28
    } else {
      score += 0.45
    }
  }

  return Math.max(1, Math.ceil(score))
}

function normalizeTimestamp(raw, fallback) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = new Date(raw).getTime()
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function buildRequestId(filePath, chatId, turn, turnIndex) {
  const sessionId = turn?.sessionId || 'no-session'
  return `traework:${chatId}:${turnIndex}:${sessionId}:${path.basename(filePath)}`
}

function parseTraeHistoryFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const chats = JSON.parse(raw)
  const records = []

  for (const chat of Array.isArray(chats) ? chats : []) {
    const chatTimestamp = normalizeTimestamp(chat?.timestamp, Date.now())
    const turns = Array.isArray(chat?.turns) ? chat.turns : []

    turns.forEach((turn, turnIndex) => {
      const model = turn?.selectedModel
      const userText = stripHtmlTags(turn?.userContent || turn?.query || '')
      const systemText = stripHtmlTags(turn?.systemContent || '')
      const reasoningText = stripHtmlTags(turn?.reasoningContent || '')

      if (!model) return
      if (!userText && !systemText && !reasoningText) return

      const inputTokens = estimateTextTokens(userText)
      const outputTokens = estimateTextTokens([systemText, reasoningText].filter(Boolean).join('\n'))

      if (inputTokens + outputTokens === 0) return

      records.push({
        source: 'traework',
        provider: 'trae',
        project: 'trae-chat',
        model,
        input_tokens: inputTokens,
        cached_input_tokens: 0,
        output_tokens: outputTokens,
        reasoning_tokens: 0,
        request_id: buildRequestId(filePath, chat?.chatId || 'unknown-chat', turn, turnIndex),
        timestamp: chatTimestamp + turnIndex,
      })
    })
  }

  return records
}

function findTraeHistoryFiles(baseDir = path.join(os.homedir(), '.trae', 'chat')) {
  if (!fs.existsSync(baseDir)) return []

  const results = []
  const stack = [baseDir]

  while (stack.length > 0) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.isFile() && entry.name === 'chat_histories.json') {
        results.push(fullPath)
      }
    }
  }

  return results
}

module.exports = {
  stripHtmlTags,
  estimateTextTokens,
  parseTraeHistoryFile,
  findTraeHistoryFiles,
}
