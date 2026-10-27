/**
 * TokenTrail — ZCode 本地用量导出器
 *
 * ZCode 把每次模型调用的真实 usage 记在自己的 SQLite 里
 * (~/.zcode/cli/db/db.sqlite 的 model_usage 表)。本模块把其中已完成的
 * 调用增量导出为 TokenTrail 的标准用量 JSONL
 * (~/.zcode/usage/YYYY-MM-DD.jsonl),再由 syncLocalUsageFiles 统一扫描入库。
 *
 * 设计约束:
 * - 只读打开 ZCode 数据库,绝不写入
 * - 口径:ZCode 的 token 桶是 OpenAI 式包含口径(cached ⊆ input,
 *   reasoning ⊆ output),JSONL 原样保留包含值,由 sync.ts 的
 *   INCLUSIVE_USAGE_SOURCES 统一转成互斥桶
 * - 幂等:watermark 存 ~/.zcode/usage/.export-state.json;即使重放,
 *   request_id(zcode:<model_usage.id>)也会被唯一索引去重
 * - 用量文件被删时自动全量重导,自愈不丢数据
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3')

function homeDir() {
  return process.env.HOME || os.homedir()
}

function defaultZcodeDbPath() {
  return path.join(homeDir(), '.zcode', 'cli', 'db', 'db.sqlite')
}

function defaultUsageDir() {
  return path.join(homeDir(), '.zcode', 'usage')
}

/**
 * 从模型名推测 provider。GLM 系列按本机既有数据惯例归为 zai。
 */
function detectZcodeProvider(model) {
  const m = String(model || '').toLowerCase()
  if (!m) return undefined
  if (m.includes('glm')) return 'zai'
  if (m.includes('claude')) return 'anthropic'
  if (m.includes('gpt') || m.includes('codex') || /^o[134]\b/.test(m)) return 'openai'
  if (m.includes('gemini')) return 'google'
  if (m.includes('kimi') || m.includes('moonshot')) return 'moonshot'
  if (m.includes('deepseek')) return 'deepseek'
  if (m.includes('grok')) return 'xai'
  if (m.includes('qwen')) return 'alibaba'
  return undefined
}

/** 会话工作目录 → 项目名(取真实存在的最后一段,与 codex/claude-code 口径一致) */
function projectFromDirectory(directory) {
  const raw = String(directory || '').trim()
  if (!raw) return undefined
  let base = path.basename(raw)
  try {
    base = path.basename(decodeURIComponent(raw))
  } catch {
    // 路径里含裸 % 等非法编码时退回原始 basename
  }
  base = base.trim()
  return base || undefined
}

function localDateKey(ms) {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

function readWatermark(statePath) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    const last = Number(state.last_completed_at)
    return Number.isFinite(last) && last > 0 ? last : 0
  } catch {
    return 0
  }
}

function buildUsageLine(row) {
  const record = {
    source: 'zcode',
    model: row.model_id,
    input_tokens: row.input_tokens || 0,
    cached_input_tokens: row.cache_read_input_tokens || 0,
    output_tokens: row.output_tokens || 0,
    reasoning_tokens: row.reasoning_tokens || 0,
    request_id: `zcode:${row.id}`,
    timestamp: row.completed_at,
  }
  const provider = detectZcodeProvider(row.model_id)
  if (provider) record.provider = provider
  const project = projectFromDirectory(row.directory)
  if (project) record.project = project
  return JSON.stringify(record)
}

/**
 * 增量导出 ZCode 的模型调用 usage 为标准 JSONL。
 * 返回 { ok, exported, files, reason? }。
 */
function exportZcodeUsage(options = {}) {
  const dbPath = options.dbPath || defaultZcodeDbPath()
  const usageDir = options.usageDir || defaultUsageDir()
  const statePath = options.statePath || path.join(usageDir, '.export-state.json')

  if (!fs.existsSync(dbPath)) {
    return { ok: false, exported: 0, files: [], reason: 'zcode db not found' }
  }

  let db
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch (err) {
    return { ok: false, exported: 0, files: [], reason: `open failed: ${err.message}` }
  }

  try {
    // 用量目录被清空时重置 watermark,全量重导(request_id 去重兜底)
    let lastCompletedAt = readWatermark(statePath)
    const hasUsageFiles = fs.existsSync(usageDir) &&
      fs.readdirSync(usageDir).some(name => name.endsWith('.jsonl'))
    if (lastCompletedAt > 0 && !hasUsageFiles) lastCompletedAt = 0

    const rows = db.prepare(`
      SELECT m.id,
             m.model_id,
             m.input_tokens,
             m.output_tokens,
             m.reasoning_tokens,
             m.cache_read_input_tokens,
             m.completed_at,
             s.directory AS directory
      FROM model_usage m
      LEFT JOIN session s ON s.id = m.session_id
      WHERE m.status = 'completed'
        AND m.completed_at IS NOT NULL
        AND m.completed_at > ?
        AND (m.input_tokens > 0 OR m.output_tokens > 0)
      ORDER BY m.completed_at ASC
    `).all(lastCompletedAt)

    if (!rows.length) {
      return { ok: true, exported: 0, files: [] }
    }

    const linesByDate = new Map()
    let maxCompletedAt = 0
    for (const row of rows) {
      const dateKey = localDateKey(row.completed_at)
      if (!linesByDate.has(dateKey)) linesByDate.set(dateKey, [])
      linesByDate.get(dateKey).push(buildUsageLine(row))
      if (row.completed_at > maxCompletedAt) maxCompletedAt = row.completed_at
    }

    fs.mkdirSync(usageDir, { recursive: true })
    const files = []
    for (const [dateKey, lines] of linesByDate) {
      const filePath = path.join(usageDir, `${dateKey}.jsonl`)
      fs.appendFileSync(filePath, lines.join('\n') + '\n')
      files.push(filePath)
    }

    // 先写文件后写 watermark:中途崩溃只会重放,由 request_id 去重兜底
    fs.writeFileSync(statePath, JSON.stringify({
      last_completed_at: maxCompletedAt,
      exported_rows: rows.length,
      updated_at: new Date().toISOString(),
    }, null, 2))

    return { ok: true, exported: rows.length, files }
  } finally {
    db.close()
  }
}

module.exports = { exportZcodeUsage, buildUsageLine, detectZcodeProvider, projectFromDirectory, localDateKey }

if (require.main === module) {
  const result = exportZcodeUsage()
  if (!result.ok) {
    console.log(`  ✗ ZCode 用量导出跳过: ${result.reason}`)
    process.exit(0)
  }
  if (result.exported === 0) {
    console.log('  ✓ ZCode 用量已是最新,无新增记录')
  } else {
    console.log(`  ✓ 已导出 ${result.exported} 条 ZCode 用量记录`)
    for (const file of result.files) console.log(`    ${file}`)
  }
}
