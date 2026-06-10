#!/usr/bin/env node
/**
 * TokenTrail — Claude Code 历史用量导入脚本
 *
 * 扫描 ~/.claude/projects/ 下所有 JSONL 会话文件，
 * 提取 assistant 消息的 usage 数据，直接使用原始模型名称上报到 TokenTrail。
 *
 * 用法：node scripts/import-claude-history.js [--dry-run] [--host http://localhost:3820]
 */

const fs = require('fs')
const path = require('path')

const CLAUDE_DIR = path.join(process.env.HOME, '.claude')
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')

const HOST = process.argv.find(a => a.startsWith('--host='))?.split('=')[1] || 'http://localhost:3820'
const DRY_RUN = process.argv.includes('--dry-run')

// ─── 主逻辑 ──────────────────────────────────────────────────

async function main() {
  console.log(`[TokenTrail Import] Scanning ${PROJECTS_DIR}...`)
  console.log(`[TokenTrail Import] Host: ${HOST}`)
  console.log(`[TokenTrail Import] Dry run: ${DRY_RUN}`)

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.error(`[TokenTrail Import] Projects directory not found: ${PROJECTS_DIR}`)
    process.exit(1)
  }

  // 1. 收集所有项目目录
  const projectDirs = fs.readdirSync(PROJECTS_DIR)
    .filter(name => {
      const fullPath = path.join(PROJECTS_DIR, name)
      return fs.statSync(fullPath).isDirectory()
    })

  console.log(`[TokenTrail Import] Found ${projectDirs.length} project directories`)

  // 2. 扫描所有 JSONL 文件，提取 usage 数据
  const allRecords = []

  for (const projectDir of projectDirs) {
    const fullProjectPath = path.join(PROJECTS_DIR, projectDir)
    const files = fs.readdirSync(fullProjectPath).filter(f => f.endsWith('.jsonl'))

    for (const file of files) {
      const filePath = path.join(fullProjectPath, file)
      const sessionId = file.replace('.jsonl', '')

      try {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)

        for (const line of lines) {
          try {
            const entry = JSON.parse(line)

            // 只处理 assistant 消息，且有 usage 数据
            if (entry.type !== 'assistant' || !entry.message?.usage) continue
            if (!entry.message.usage.input_tokens && !entry.message.usage.output_tokens) continue

            const usage = entry.message.usage
            const model = entry.message.model || 'unknown'
            const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()

            // 生成唯一 ID（用于去重）
            const msgId = entry.message.id || `${sessionId}-${entry.uuid}`

            allRecords.push({
              source: 'claude-code',
              model: model, // 直接使用原始模型名称，不做映射
              input_tokens: usage.input_tokens || 0,
              cached_input_tokens: usage.cache_read_input_tokens || 0,
              output_tokens: usage.output_tokens || 0,
              reasoning_tokens: 0,
              request_id: msgId,
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
  }

  console.log(`[TokenTrail Import] Extracted ${allRecords.length} usage records`)

  if (allRecords.length === 0) {
    console.log('[TokenTrail Import] No usage data found. Nothing to import.')
    return
  }

  // 3. 统计摘要
  const totalInput = allRecords.reduce((sum, r) => sum + r.input_tokens, 0)
  const totalCached = allRecords.reduce((sum, r) => sum + r.cached_input_tokens, 0)
  const totalOutput = allRecords.reduce((sum, r) => sum + r.output_tokens, 0)
  const modelStats = {}
  allRecords.forEach(r => {
    if (!modelStats[r.model]) {
      modelStats[r.model] = { count: 0, input: 0, cached: 0, output: 0 }
    }
    modelStats[r.model].count++
    modelStats[r.model].input += r.input_tokens
    modelStats[r.model].cached += r.cached_input_tokens
    modelStats[r.model].output += r.output_tokens
  })

  console.log('\n[TokenTrail Import] ─── 摘要 ───')
  console.log(`  总记录数:     ${allRecords.length}`)
  console.log(`  输入 tokens:  ${formatNum(totalInput)}`)
  console.log(`  缓存 tokens:  ${formatNum(totalCached)}`)
  console.log(`  输出 tokens:  ${formatNum(totalOutput)}`)
  console.log(`  模型分布 (原始名称):`)
  Object.entries(modelStats)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([model, s]) => {
      console.log(`    ${model}: ${s.count} requests, in=${formatNum(s.input)}, cached=${formatNum(s.cached)}, out=${formatNum(s.output)}`)
    })

  // 4. 同步缺失的模型价格
  const modelNames = Object.keys(modelStats)
  console.log(`\n[TokenTrail Import] 发现 ${modelNames.length} 个模型: ${modelNames.join(', ')}`)

  if (DRY_RUN) {
    console.log('\n[TokenTrail Import] DRY RUN — 不实际上报')
    console.log('[TokenTrail Import] 运行不带 --dry-run 来正式导入')
    return
  }

  // 5. 先注册缺失的模型价格（未知模型价格设为 0，后续可手动修改）
  for (const model of modelNames) {
    try {
      await fetch(`${HOST}/api/pricing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_id: model,
          display_name: model,
          provider: detectProvider(model),
          input_price_per_1m: 0,
          output_price_per_1m: 0,
        }),
      })
    } catch {
      // 价格注册失败不阻断导入
    }
  }

  // 6. 批量上报
  console.log('\n[TokenTrail Import] 开始上报...')
  let success = 0
  let duplicates = 0
  let errors = 0

  // 按时间排序，先上报最早的
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
        if (errors <= 5) {
          console.error(`  Error: ${JSON.stringify(data)}`)
        }
      }

      // 进度显示
      if ((i + 1) % 200 === 0 || i === allRecords.length - 1) {
        process.stdout.write(`\r  Progress: ${i + 1}/${allRecords.length} (✓${success} dup${duplicates} err${errors})`)
      }
    } catch (err) {
      errors++
      if (errors <= 5) {
        console.error(`  Network error: ${err.message}`)
      }
    }
  }

  console.log(`\n\n[TokenTrail Import] ─── 完成 ───`)
  console.log(`  成功: ${success}`)
  console.log(`  重复: ${duplicates} (可安全忽略)`)
  console.log(`  失败: ${errors}`)
  console.log(`\n  提示: 如果模型价格为 0，可通过 POST /api/pricing 更新价格后重新计算费用`)
}

// ─── 辅助函数 ──────────────────────────────────────────────────

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

function formatNum(n) {
  return n.toLocaleString('en-US')
}

// ─── 执行 ──────────────────────────────────────────────────────

main().catch(err => {
  console.error('[TokenTrail Import] Fatal error:', err)
  process.exit(1)
})
