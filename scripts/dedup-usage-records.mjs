#!/usr/bin/env node
// 一次性维护脚本：清理未带 request_id 的历史重复用量记录。
//
// 背景：OpenClaw / Hermes 等 JSONL 不带 request_id，旧版 insertUsageRecord 在
// request_id 为空时不去重，导致每次 sync / 每次 /api/report 都把同一事件再插一遍
// （单条最多重复 27 次）。新版 db.ts 会在 request_id 为空时合成确定性 fallback，
// 本脚本用于把存量数据收敛到「每个事件一行」，并回填合成 request_id，使未来导入命中去重。
//
// 安全性：
// - 只动 request_id 为 NULL/空的行；codex/claude-code/grok 等带真实 request_id 的行原样保留。
// - 全程在单事务内，先 DELETE 再 UPDATE，避免唯一索引冲突。
// - 处理两种顺序：若新代码已先部署、已有合成 K 行存在，则 NULL 重复行直接删除（K 行作为幸存者）。
//
// 用法：TOKENTRAIL_DB_PATH=/path/to/token-trail.db node scripts/dedup-usage-records.mjs [--dry-run]

import Database from 'better-sqlite3'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'

// ⚠️ 必须与 src/lib/db.ts 的 synthesizeRequestId 保持一致
function synthesizeRequestId(source, rec) {
  const raw = [source, rec.timestamp, rec.model, rec.input_tokens, rec.cached_input_tokens, rec.output_tokens, rec.reasoning_tokens].join('|')
  return `${source}:${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}`
}

const DB_PATH = process.env.TOKENTRAIL_DB_PATH || path.join(process.cwd(), 'data', 'token-trail.db')
const DRY = process.argv.includes('--dry-run')

if (!fs.existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`)
  process.exit(1)
}

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

const nullRowsStmt = db.prepare(`
  SELECT id, source, timestamp, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, request_id
  FROM usage_records
  WHERE request_id IS NULL OR request_id = ''
  ORDER BY id ASC
`)
const existingKeyStmt = db.prepare(`SELECT 1 FROM usage_records WHERE request_id = ? AND id != ? LIMIT 1`)
const delStmt = db.prepare(`DELETE FROM usage_records WHERE id = ?`)
const updStmt = db.prepare(`UPDATE usage_records SET request_id = ? WHERE id = ?`)

let deleted = 0      // 删除的重复行
let backfilled = 0   // 回填了 request_id 的幸存行
let kept = 0         // 保留的（事件）数
let totalBefore = 0

// 全程在单事务里读+判+写：持有写锁，在线服务的并发 INSERT 会被阻塞到事务结束，
// 因此 existingKeyStmt 的判断对事务内是权威的，不存在 read/write 之间的竞态。
const run = db.transaction(() => {
  const nullRows = nullRowsStmt.all()
  totalBefore = nullRows.length
  const seen = new Map() // K -> keeperId

  for (const r of nullRows) {
    const key = synthesizeRequestId(r.source, r)
    // pass 1：该 event 的 K 已存在（非本行的真实 request_id）→ 本 NULL 行冗余，删除
    if (existingKeyStmt.get(key, r.id)) {
      delStmt.run(r.id)
      deleted++
      continue
    }
    // pass 2：同 event 的 NULL 行按 K 分组，保留最早一条
    if (!seen.has(key)) {
      seen.set(key, r.id)
      kept++
    } else {
      delStmt.run(r.id)
      deleted++
    }
  }

  // 回填幸存行的 request_id（事务内再校验一次 K 未被占用，绝对避免唯一索引冲突）
  for (const r of nullRows) {
    const key = synthesizeRequestId(r.source, r)
    if (seen.get(key) === r.id && (!r.request_id || !String(r.request_id).trim())) {
      if (existingKeyStmt.get(key, r.id)) {
        // 极小概率：事务内已被占用 → 删除幸存行，正本以那条为准
        delStmt.run(r.id)
        deleted++
        kept--
      } else {
        updStmt.run(key, r.id)
        backfilled++
      }
    }
  }
})

if (DRY) {
  // dry-run：复算同样的统计，但不写
  const nullRows = nullRowsStmt.all()
  totalBefore = nullRows.length
  const seen = new Set()
  const existing = new Set(db.prepare(`SELECT DISTINCT request_id FROM usage_records WHERE request_id IS NOT NULL AND request_id != ''`).all().map(r => r.request_id))
  for (const r of nullRows) {
    const key = synthesizeRequestId(r.source, r)
    if (existing.has(key) || seen.has(key)) {
      deleted++
    } else {
      seen.add(key)
      kept++
      if (!r.request_id || !String(r.request_id).trim()) backfilled++
    }
  }
} else {
  run()
}

console.log(`DB: ${DB_PATH}`)
console.log(`NULL/空 request_id 行（处理前）: ${totalBefore}`)
console.log(`  删除重复行: ${deleted}`)
console.log(`  回填幸存行 request_id: ${backfilled}`)
console.log(`  保留事件数（NULL 集合内）: ${kept}`)
console.log(DRY ? '（dry-run，未实际改动）' : '已完成。')
