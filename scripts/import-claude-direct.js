#!/usr/bin/env node
/**
 * TokenTrail — Claude Code 历史用量直接导入 (SQLite)
 *
 * 绕过 HTTP API，直接写入 SQLite 数据库。
 * 使用事务批量插入，速度快且保证一致性。
 *
 * 用法：node scripts/import-claude-direct.js
 */

const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const CLAUDE_DIR = path.join(process.env.HOME, '.claude')
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')
const DB_PATH = path.join(__dirname, '..', 'data', 'token-trail.db')

async function main() {
  console.log('[Direct Import] Scanning Claude Code sessions...')
  console.log(`[Direct Import] DB: ${DB_PATH}`)

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.error(`[Direct Import] Projects directory not found: ${PROJECTS_DIR}`)
    process.exit(1)
  }

  const db = new Database(DB_PATH)

  // 确保 pricing 表和 dedup 索引存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_pricing (
      model_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'unknown',
      input_price_per_1m REAL NOT NULL DEFAULT 0,
      output_price_per_1m REAL NOT NULL DEFAULT 0,
      cached_price_per_1m REAL DEFAULT NULL,
      reasoning_price_per_1m REAL DEFAULT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      request_id TEXT,
      timestamp INTEGER NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_request_id
      ON usage_records(request_id) WHERE request_id IS NOT NULL;
  `)

  // 准备语句
  const insertStmt = db.prepare(`
    INSERT INTO usage_records (source, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, request_id, timestamp, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_id) WHERE request_id IS NOT NULL DO NOTHING
  `)

  const upsertPricing = db.prepare(`
    INSERT INTO model_pricing (model_id, display_name, provider)
    VALUES (?, ?, ?)
    ON CONFLICT(model_id) DO NOTHING
  `)

  // 1. 收集所有记录
  const projectDirs = fs.readdirSync(PROJECTS_DIR)
    .filter(name => {
      try { return fs.statSync(path.join(PROJECTS_DIR, name)).isDirectory() } catch { return false }
    })

  console.log(`[Direct Import] Found ${projectDirs.length} project directories`)

  const allRecords = []
  const modelSet = new Set()

  for (const projectDir of projectDirs) {
    const fullProjectPath = path.join(PROJECTS_DIR, projectDir)
    let files
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
            if (!usage.input_tokens && !usage.output_tokens) continue

            const model = entry.message.model || 'unknown'
            const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
            const msgId = entry.message.id || `${sessionId}-${entry.uuid}`

            modelSet.add(model)
            allRecords.push({
              source: 'claude-code',
              model,
              input_tokens: usage.input_tokens || 0,
              cached_input_tokens: usage.cache_read_input_tokens || 0,
              output_tokens: usage.output_tokens || 0,
              reasoning_tokens: 0,
              request_id: msgId,
              timestamp,
            })
          } catch {}
        }
      } catch {}
    }
  }

  console.log(`[Direct Import] Extracted ${allRecords.length} usage records`)

  if (allRecords.length === 0) {
    console.log('[Direct Import] No data to import.')
    db.close()
    return
  }

  // 2. 统计摘要
  const totalInput = allRecords.reduce((s, r) => s + r.input_tokens, 0)
  const totalCached = allRecords.reduce((s, r) => s + r.cached_input_tokens, 0)
  const totalOutput = allRecords.reduce((s, r) => s + r.output_tokens, 0)
  const modelStats = {}
  allRecords.forEach(r => {
    if (!modelStats[r.model]) modelStats[r.model] = { count: 0, input: 0, cached: 0, output: 0 }
    modelStats[r.model].count++
    modelStats[r.model].input += r.input_tokens
    modelStats[r.model].cached += r.cached_input_tokens
    modelStats[r.model].output += r.output_tokens
  })

  console.log('\n[Direct Import] ─── 摘要 ───')
  console.log(`  总记录数:     ${allRecords.length}`)
  console.log(`  输入 tokens:  ${totalInput.toLocaleString('en-US')}`)
  console.log(`  缓存 tokens:  ${totalCached.toLocaleString('en-US')}`)
  console.log(`  输出 tokens:  ${totalOutput.toLocaleString('en-US')}`)
  console.log(`  模型分布:`)
  Object.entries(modelStats)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([model, s]) => {
      console.log(`    ${model}: ${s.count} requests, in=${s.input.toLocaleString('en-US')}, cached=${s.cached.toLocaleString('en-US')}, out=${s.output.toLocaleString('en-US')}`)
    })

  // 3. 获取模型定价
  const pricingMap = {}
  const pricingRows = db.prepare('SELECT model_id, input_price_per_1m, output_price_per_1m, cached_input_price_per_1m FROM model_pricing').all()
  pricingRows.forEach(p => {
    pricingMap[p.model_id] = p
  })

  // 4. 注册缺失的模型
  for (const model of modelSet) {
    if (!pricingMap[model]) {
      upsertPricing.run(model, model, detectProvider(model))
      pricingMap[model] = { input_price_per_1m: 0, output_price_per_1m: 0 }
      console.log(`  Registered new model: ${model} (price=0, please update later)`)
    }
  }

  // 5. 计算费用并批量插入
  console.log('\n[Direct Import] 开始导入...')

  // 计算每条记录的费用
  function calcCost(record) {
    const p = pricingMap[record.model]
    if (!p) return 0
    const inputCost = (record.input_tokens / 1_000_000) * (p.input_price_per_1m || 0)
    const outputCost = (record.output_tokens / 1_000_000) * (p.output_price_per_1m || 0)
    const cachedCost = (record.cached_input_tokens / 1_000_000) * (p.cached_input_price_per_1m || (p.input_price_per_1m || 0) * 0.5)
    return inputCost + outputCost + cachedCost
  }

  allRecords.sort((a, b) => a.timestamp - b.timestamp)

  const insertMany = db.transaction((records) => {
    let inserted = 0
    let duplicates = 0
    for (const r of records) {
      const cost = calcCost(r)
      const result = insertStmt.run(
        r.source, r.model, r.input_tokens, r.cached_input_tokens,
        r.output_tokens, r.reasoning_tokens, r.request_id, r.timestamp, cost
      )
      if (result.changes > 0) inserted++
      else duplicates++
    }
    return { inserted, duplicates }
  })

  const { inserted, duplicates } = insertMany(allRecords)

  console.log(`\n[Direct Import] ─── 完成 ───`)
  console.log(`  新增: ${inserted}`)
  console.log(`  重复: ${duplicates} (已存在，跳过)`)

  // 6. 最终统计
  const finalStats = db.prepare('SELECT COUNT(*) as total FROM usage_records').get()
  const finalBySource = db.prepare('SELECT source, COUNT(*) as cnt FROM usage_records GROUP BY source ORDER BY cnt DESC').all()
  console.log(`\n  数据库总计: ${finalStats.total} 条记录`)
  finalBySource.forEach(s => console.log(`    ${s.source}: ${s.cnt}`))

  db.close()
}

function detectProvider(model) {
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

main().catch(err => {
  console.error('[Direct Import] Fatal error:', err)
  process.exit(1)
})
