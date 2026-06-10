#!/usr/bin/env node
/**
 * TokenTrail — Codex Usage Sync 脚本
 *
 * 扫描 ~/.codex/sessions/ 下所有 JSONL 文件，提取 token_count 事件中的 last_token_usage，
 * 按增量上报到 TokenTrail。
 *
 * 去重策略：文件路径 + 行号 → request_id（绝对可靠）
 * 数据字段：last_token_usage（每次 API 调用的实际增量消耗）
 *
 * 用法：node scripts/sync-codex.js [--dry-run] [--host http://localhost:3820]
 */

const fs = require('fs')
const path = require('path')

const CODEX_DIR = path.join(process.env.HOME, '.codex')
const SESSIONS_DIR = path.join(CODEX_DIR, 'sessions')

const HOST = process.argv.find(a => a.startsWith('--host='))?.split('=')[1] || 'http://localhost:3820'
const DRY_RUN = process.argv.includes('--dry-run')

// ─── 主逻辑 ──────────────────────────────────────────────────

async function main() {
  console.log(`[Codex Sync] Scanning ${SESSIONS_DIR}...`)
  console.log(`[Codex Sync] Host: ${HOST}`)
  console.log(`[Codex Sync] Dry run: ${DRY_RUN}`)

  if (!fs.existsSync(SESSIONS_DIR)) {
    console.error(`[Codex Sync] Sessions directory not found: ${SESSIONS_DIR}`)
    process.exit(1)
  }

  // 1. 递归查找所有 JSONL 文件
  const jsonlFiles = findAllJsonl(SESSIONS_DIR)
  console.log(`[Codex Sync] Found ${jsonlFiles.length} session files`)

  // 2. 逐文件逐行解析 token_count 事件
  const allRecords = []

  for (const filePath of jsonlFiles) {
    // 从文件路径提取 session ID
    const sessionId = path.basename(filePath, '.jsonl').replace('rollout-', '')

    try {
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n')

      // Codex writes the selected model into turn_context. Keep the latest
      // context model and apply it to following token_count events.
      let sessionModel = 'unknown'

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]
        if (!line.trim()) continue

        try {
          const entry = JSON.parse(line)

          // 提取 session/turn 上下文中的真实模型信息
          if (entry.type === 'turn_context') {
            const model =
              entry.payload?.model ||
              entry.payload?.collaboration_mode?.settings?.model
            if (typeof model === 'string' && model.trim()) {
              sessionModel = model.trim()
            }
          }

          // 只处理 token_count 事件
          if (entry.type !== 'event_msg') continue
          if (entry.payload?.type !== 'token_count') continue

          const info = entry.payload.info
          if (!info?.last_token_usage) continue

          const usage = info.last_token_usage

          // 跳过空用量
          if (!usage.input_tokens && !usage.output_tokens && !usage.cached_input_tokens && !usage.reasoning_output_tokens) continue

          // 去重 ID：文件路径的 hash + 行号（绝对稳定）
          const relativePath = path.relative(SESSIONS_DIR, filePath)
          const requestId = `codex:${relativePath}:L${lineIdx}`

          // 时间戳
          const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()

          const model = detectModel(entry, sessionModel)

          allRecords.push({
            source: 'codex',
            model,
            input_tokens: usage.input_tokens || 0,
            cached_input_tokens: usage.cached_input_tokens || 0,
            output_tokens: usage.output_tokens || 0,
            reasoning_tokens: usage.reasoning_output_tokens || 0,
            request_id: requestId,
            timestamp,
          })
        } catch {
          // 跳过解析失败的行
        }
      }
    } catch (err) {
      // 跳过读取失败的文件
    }
  }

  console.log(`[Codex Sync] Extracted ${allRecords.length} token_count records`)

  if (allRecords.length === 0) {
    console.log('[Codex Sync] No token usage data found.')
    return
  }

  // 3. 统计摘要
  const totalInput = allRecords.reduce((s, r) => s + r.input_tokens, 0)
  const totalCached = allRecords.reduce((s, r) => s + r.cached_input_tokens, 0)
  const totalOutput = allRecords.reduce((s, r) => s + r.output_tokens, 0)
  const totalReasoning = allRecords.reduce((s, r) => s + r.reasoning_tokens, 0)
  const modelStats = {}
  allRecords.forEach(r => {
    if (!modelStats[r.model]) modelStats[r.model] = { count: 0, input: 0, cached: 0, output: 0, reasoning: 0 }
    modelStats[r.model].count++
    modelStats[r.model].input += r.input_tokens
    modelStats[r.model].cached += r.cached_input_tokens
    modelStats[r.model].output += r.output_tokens
    modelStats[r.model].reasoning += r.reasoning_tokens
  })

  // 时间范围
  const timestamps = allRecords.map(r => r.timestamp).filter(Boolean).sort()
  const earliest = timestamps[0] ? new Date(timestamps[0]).toISOString().split('T')[0] : '?'
  const latest = timestamps[timestamps.length - 1] ? new Date(timestamps[timestamps.length - 1]).toISOString().split('T')[0] : '?'

  console.log('\n[Codex Sync] ─── 摘要 ───')
  console.log(`  总请求数:       ${allRecords.length}`)
  console.log(`  时间范围:       ${earliest} → ${latest}`)
  console.log(`  输入 tokens:    ${fmt(totalInput)}`)
  console.log(`  缓存 tokens:    ${fmt(totalCached)}`)
  console.log(`  输出 tokens:    ${fmt(totalOutput)}`)
  console.log(`  推理 tokens:    ${fmt(totalReasoning)}`)
  console.log(`  模型分布:`)
  Object.entries(modelStats)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([model, s]) => {
      console.log(`    ${model}: ${s.count} requests, in=${fmt(s.input)}, cached=${fmt(s.cached)}, out=${fmt(s.output)}, reason=${fmt(s.reasoning)}`)
    })

  if (DRY_RUN) {
    console.log('\n[Codex Sync] DRY RUN — 不实际上报')
    console.log('[Codex Sync] 运行不带 --dry-run 来正式导入')
    return
  }

  // 4. 批量上报
  console.log('\n[Codex Sync] 开始上报...')
  let success = 0, duplicates = 0, errors = 0

  allRecords.sort((a, b) => a.timestamp - b.timestamp)

  for (let i = 0; i < allRecords.length; i++) {
    const record = allRecords[i]
    try {
      const res = await fetch(`${HOST}/api/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
      const data = await res.json()

      if (data.duplicate) {
        duplicates++
      } else if (data.success) {
        success++
      } else {
        errors++
        if (errors <= 3) console.error(`  Error: ${JSON.stringify(data)}`)
      }

      if ((i + 1) % 200 === 0 || i === allRecords.length - 1) {
        process.stdout.write(`\r  Progress: ${i + 1}/${allRecords.length} (✓${success} dup${duplicates} err${errors})`)
      }
    } catch (err) {
      errors++
      if (errors <= 3) console.error(`  Network error: ${err.message}`)
    }
  }

  console.log(`\n\n[Codex Sync] ─── 完成 ───`)
  console.log(`  成功: ${success}`)
  console.log(`  重复: ${duplicates} (可安全忽略)`)
  console.log(`  失败: ${errors}`)
}

// ─── 辅助函数 ──────────────────────────────────────────────────

function findAllJsonl(dir) {
  const results = []
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

function detectModel(entry, sessionModel) {
  if (sessionModel && sessionModel !== 'unknown') {
    return sessionModel
  }

  const limitId = entry.payload?.rate_limits?.limit_id || entry.payload?.info?.rate_limits?.limit_id
  if (typeof limitId === 'string' && limitId && limitId !== 'codex') {
    return limitId
  }

  return 'unknown'
}

function fmt(n) {
  return n.toLocaleString('en-US')
}

// ─── 执行 ──────────────────────────────────────────────────────

main().catch(err => {
  console.error('[Codex Sync] Fatal error:', err)
  process.exit(1)
})
