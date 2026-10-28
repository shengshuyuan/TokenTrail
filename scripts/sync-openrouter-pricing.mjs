/**
 * TokenTrail — 按 OpenRouter API 价格更新本地模型价目表
 *
 * 用法:
 *   node scripts/sync-openrouter-pricing.mjs           # 只预览差异，不写库
 *   node scripts/sync-openrouter-pricing.mjs --apply   # 备份数据库 → 清理假模型 → 更新/补充价格 → 重算历史费用
 *
 * 取价规则:
 * - OpenRouter 列表页的价格是「所有服务商里最便宜的一家」，开源模型常被小服务商拉低，
 *   所以逐个读取 /models/<id>/endpoints，优先取模型原厂（OpenAI、Z.AI、Moonshot…）的标准档；
 *   没有原厂报价时取各服务商标准档的中位数。fast / priority / flex / batch 档位不参与。
 * - 思考 token 单价：OpenRouter 有 internal_reasoning 就用它，否则按输出价。
 * - OpenRouter 没给缓存价时保留本地原值（不超过新的输入价）。
 *
 * 假模型与非模型过滤:
 * - auto、test、verify-model、seed_m8、unknown-codex 等明显不是模型名称的记录一律不参与计价，
 *   若历史有计费则将其费用置 0。
 *
 * 重算范围: 所有能匹配到价格的合法记录，但 Cursor 逐次账单（source='cursor' 且非汇总）
 * 除 auto 等非模型置 0 外，其余保留 Cursor 官方扣费金额。
 */

import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.TOKENTRAIL_DB_PATH || path.join(__dirname, '..', 'data', 'token-trail.db')
const BACKUP_DIR = path.join(os.homedir(), '.tokentrail', 'backups')
const OPENROUTER_API = 'https://openrouter.ai/api/v1'
const APPLY = process.argv.includes('--apply')
const CONCURRENCY = 6

/** 明显不是合法模型名称的黑名单（路由开关、测试桩、内部假名等） */
const JUNK_MODELS = new Set([
  'auto',
  'seed_m8',
  'stealth/ox-alpha',
  'test',
  'test-jsonl-model',
  'test-model',
  'verify-model',
  'unknown-codex',
])

function isJunkModel(id) {
  const s = String(id || '').trim().toLowerCase()
  if (!s) return true
  if (JUNK_MODELS.has(s)) return true
  return s === 'test' || s.startsWith('test-') || s.startsWith('test_') || s.startsWith('verify-') || s.startsWith('verify_')
}

/** 本地模型名 → OpenRouter 模型 ID（名字对不上、但确定是同一个模型的情况）。 */
const ALIASES = {
  'claude-opus-5-low': 'anthropic/claude-opus-5',
  'claude-sonnet-5-5-high': 'anthropic/claude-sonnet-5.5',
  'claude-opus-5-5-medium': 'anthropic/claude-opus-5.5',
  'claude-opus-5-5-high-fast': 'anthropic/claude-opus-5.5',
  'claude-opus-4-7-thinking-high': 'anthropic/claude-opus-4.7',
  'cursor-grok-4.5-high': 'x-ai/grok-4.5',
  'cursor-grok-4.5-high-fast': 'x-ai/grok-4.5',
  'cursor-grok-4.6-high-fast': 'x-ai/grok-4.6',
  'grok-4.7-build-fast': 'x-ai/grok-4.7',
  'grok-4.6-build': 'x-ai/grok-4.6',
  'grok-4.5-build': 'x-ai/grok-4.5',
  'deepseek-flash': 'deepseek/deepseek-v4-flash',
  'minimax-m2.7-highspeed': 'minimax/minimax-m2.7',
  'MiniMax-M2.7-highspeed': 'minimax/minimax-m2.7',
  'GLM-5.3': 'z-ai/glm-5.3',
  'GLM-5.3-Flash': 'z-ai/glm-5.3-flash',
  'glm-5.3': 'z-ai/glm-5.3',
  'glm-5.3-flash': 'z-ai/glm-5.3-flash',
  'anthropic/claude-sonnet-4': 'anthropic/claude-sonnet-4.5',
  'qwen3.6-plus': 'qwen/qwen3.6-plus',
  'qwen3.7-max': 'qwen/qwen3.7-max',
  'qwen3.7-plus': 'qwen/qwen3.7-plus',
  'qwen3.7-flash': 'qwen/qwen3.7-flash',
  'kimi-code/k3': 'moonshotai/kimi-k3',
  k3: 'moonshotai/kimi-k3',
  'kimi-code/k3.1': 'moonshotai/kimi-k3.1-pro',
  'kimi-code/k3.1-pro': 'moonshotai/kimi-k3.1-pro',
  'kimi-k3.1': 'moonshotai/kimi-k3.1-pro',
  'k3.1': 'moonshotai/kimi-k3.1-pro',
  'k3.1-pro': 'moonshotai/kimi-k3.1-pro',
  'kimi-code/kimi-for-coding': 'moonshotai/kimi-k2.7-code',
  'kimi-for-coding': 'moonshotai/kimi-k2.7-code',
}

/** OpenRouter 作者 slug → 原厂服务商 tag 前缀（默认与作者 slug 相同）。 */
const OFFICIAL_PROVIDER_TAGS = {
  'x-ai': ['xai'],
  qwen: ['alibaba'],
  google: ['google-ai-studio', 'google-vertex'],
  'z-ai': ['z-ai', 'zhipu'],
  moonshotai: ['moonshotai', 'moonshot'],
  minimax: ['minimax'],
  xiaomi: ['xiaomi'],
  deepseek: ['deepseek'],
  openai: ['openai'],
  anthropic: ['anthropic'],
}

const MAJOR_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'google',
  'x-ai',
  'deepseek',
  'z-ai',
  'moonshotai',
  'minimax',
  'qwen',
  'xiaomi',
  'tencent',
  'stepfun',
])

function providerSlugToDb(prov) {
  if (prov === 'x-ai') return 'xai'
  if (prov === 'z-ai') return 'zhipu'
  if (prov === 'moonshotai') return 'moonshot'
  if (prov === 'qwen') return 'alibaba'
  if (prov === 'xiaomi') return 'mimo'
  return prov
}

const NON_STANDARD_TIER = /(fast|priority|flex|batch|ultra)/i

const perMillion = (v) => (v === undefined || v === null || v === '' ? null : Math.round(Number(v) * 1e6 * 1e4) / 1e4)
const normalizeId = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.json()
}

function buildIndex(models) {
  const exact = new Map()
  const loose = new Map()
  for (const m of models) {
    if (m.id.includes(':')) continue // :free / :batch 等变体
    const short = m.id.split('/').slice(1).join('/').toLowerCase()
    if (!exact.has(short)) exact.set(short, m.id)
    if (!loose.has(normalizeId(short))) loose.set(normalizeId(short), m.id)
    if (!exact.has(m.id.toLowerCase())) exact.set(m.id.toLowerCase(), m.id)
    if (!loose.has(normalizeId(m.id))) loose.set(normalizeId(m.id), m.id)
  }
  return { exact, loose }
}

function resolveOpenRouterId(localId, index) {
  if (isJunkModel(localId)) return null
  const lower = localId.toLowerCase()
  if (ALIASES[localId]) return ALIASES[localId]
  if (ALIASES[lower]) return ALIASES[lower]
  const short = lower.split('/').pop()
  return index.exact.get(lower) || index.exact.get(short) || index.loose.get(normalizeId(lower)) || index.loose.get(normalizeId(short)) || null
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null
}

/** 从某模型的全部服务商报价中选出参考价，返回 { input, cached, output, reasoning, basis }。 */
function pickPrice(orId, endpoints, listPricing) {
  const author = orId.split('/')[0]
  const officialTags = OFFICIAL_PROVIDER_TAGS[author] || [author]
  const standard = endpoints.filter((e) => !NON_STANDARD_TIER.test(e.tag || '') && Number(e.pricing?.prompt) > 0)
  const official = standard
    .filter((e) => officialTags.includes(String(e.tag || '').split('/')[0]))
    .sort((a, b) => Number(a.pricing.prompt) - Number(b.pricing.prompt))[0]

  if (official) {
    const p = official.pricing
    return {
      input: perMillion(p.prompt),
      cached: perMillion(p.input_cache_read),
      output: perMillion(p.completion),
      reasoning: perMillion(p.internal_reasoning),
      basis: `原厂 ${official.provider_name}`,
    }
  }
  if (standard.length) {
    const pick = (key) => median(standard.map((e) => perMillion(e.pricing[key])).filter((v) => v !== null))
    return {
      input: pick('prompt'),
      cached: pick('input_cache_read'),
      output: pick('completion'),
      reasoning: pick('internal_reasoning'),
      basis: `${standard.length} 家中位数`,
    }
  }
  return {
    input: perMillion(listPricing.prompt),
    cached: perMillion(listPricing.input_cache_read),
    output: perMillion(listPricing.completion),
    reasoning: perMillion(listPricing.internal_reasoning),
    basis: '列表价',
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i])
      }
    }),
  )
  return results
}

async function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`数据库不存在: ${DB_PATH}`)
  const db = new Database(DB_PATH, { readonly: !APPLY })

  console.log('读取 OpenRouter 模型列表…')
  const models = (await getJson(`${OPENROUTER_API}/models`)).data
  const byId = new Map(models.map((m) => [m.id, m]))
  const index = buildIndex(models)

  // 1. 查询并检查错误/非模型记录
  const junkUsageRows = db.prepare(`
    SELECT model, COUNT(*) as cnt, SUM(cost_usd) as total_cost
    FROM usage_records
    WHERE model IN (${[...JUNK_MODELS].map(() => '?').join(', ')})
       OR model LIKE 'test-%' OR model LIKE 'test_%' OR model LIKE 'verify-%'
    GROUP BY model
  `).all(...JUNK_MODELS)

  if (junkUsageRows.length) {
    console.log(`\n【错误/非模型检查】发现以下明显非真实模型的记录（不应计费）:`)
    for (const j of junkUsageRows) {
      console.log(`  - ${j.model.padEnd(25)} 记录数: ${String(j.cnt).padEnd(6)} 当前计费: $${(j.total_cost || 0).toFixed(4)}`)
    }
  }

  // 2. 本地已注册模型与 OpenRouter 匹配
  const local = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM usage_records u WHERE u.model = p.model_id) AS usage_count
    FROM model_pricing p
  `).all().filter((row) => !isJunkModel(row.model_id))

  const resolved = local
    .map((row) => ({ row, orId: resolveOpenRouterId(row.model_id, index) }))
    .filter((r) => r.orId && byId.has(r.orId))

  // 3. 寻找 OpenRouter 上属于主流厂商但本地尚未收录的最新模型
  const existingModelIds = new Set(local.map((r) => r.model_id.toLowerCase()))
  const newModelsToAdd = []
  for (const m of models) {
    if (m.id.includes(':') || m.id.startsWith('~')) continue
    const [prov, ...rest] = m.id.split('/')
    if (!MAJOR_PROVIDERS.has(prov)) continue
    const shortId = rest.join('/')
    if (
      !existingModelIds.has(m.id.toLowerCase()) &&
      !existingModelIds.has(shortId.toLowerCase()) &&
      !existingModelIds.has(normalizeId(shortId))
    ) {
      // 筛选重点知名新模型
      const lower = m.id.toLowerCase()
      const isNotable =
        lower.includes('kimi-k3.1') ||
        lower.includes('minimax-m3.1') ||
        lower.includes('claude-haiku-5.5') ||
        lower.includes('claude-opus-4.8') ||
        lower.includes('gemini-4-argon') ||
        lower.includes('gemini-3.1') ||
        lower.includes('gemini-nano-banana') ||
        lower.includes('deepseek-v4.1') ||
        lower.includes('deepseek-v3.2') ||
        lower.includes('qwen3.8') ||
        lower.includes('gpt-5.2') ||
        lower.includes('gpt-5.1') ||
        lower.includes('o3-pro') ||
        lower.includes('o1-pro') ||
        lower.includes('grok-build') ||
        lower.includes('hy4')
      if (isNotable) {
        newModelsToAdd.push({
          model_id: shortId,
          orId: m.id,
          display_name: m.name.replace(/^[^:]+:\s*/, ''),
          provider: providerSlugToDb(prov),
          pricing: m.pricing,
        })
      }
    }
  }

  const orIds = [...new Set([...resolved.map((r) => r.orId), ...newModelsToAdd.map((n) => n.orId)])]
  console.log(`\n本地 ${local.length} 个合法模型，匹配到 OpenRouter ${resolved.length} 个；发现 ${newModelsToAdd.length} 个最新主流模型可补充。`)
  console.log(`读取 ${orIds.length} 个模型的服务商报价…`)

  const endpointLists = await mapLimit(orIds, CONCURRENCY, async (id) => {
    try {
      return (await getJson(`${OPENROUTER_API}/models/${id}/endpoints`)).data?.endpoints || []
    } catch (err) {
      console.warn(`  ⚠ ${id} 报价读取失败，改用列表价: ${err.message}`)
      return []
    }
  })
  const priceByOrId = new Map(orIds.map((id, i) => [id, pickPrice(id, endpointLists[i], byId.get(id).pricing)]))

  const updates = []
  for (const { row, orId } of resolved) {
    const p = priceByOrId.get(orId)
    if (p.input === null || p.output === null) continue
    const cached = p.cached ?? Math.min(row.cached_input_price_per_1m, p.input)
    const next = {
      model_id: row.model_id,
      input: p.input,
      cached,
      output: p.output,
      reasoning: p.reasoning ?? p.output,
    }
    const changed =
      next.input !== row.input_price_per_1m ||
      next.cached !== row.cached_input_price_per_1m ||
      next.output !== row.output_price_per_1m ||
      next.reasoning !== row.reasoning_price_per_1m
    if (changed) updates.push({ ...next, orId, basis: p.basis, before: row, usage: row.usage_count })
  }

  updates.sort((a, b) => b.usage - a.usage)
  console.log(`\n【价格变动】需更新 ${updates.length} 个模型价格（美元/百万 token，输入 / 缓存 / 输出 / 思考）:`)
  for (const u of updates) {
    const b = u.before
    console.log(
      `  ${u.model_id.padEnd(28)} ${[b.input_price_per_1m, b.cached_input_price_per_1m, b.output_price_per_1m, b.reasoning_price_per_1m].join(' / ')}` +
        `  →  ${[u.input, u.cached, u.output, u.reasoning].join(' / ')}   [${u.orId}，${u.basis}，${u.usage} 条记录]`,
    )
  }

  console.log(`\n【最新模型收录】准备新增 ${newModelsToAdd.length} 个主流模型:`)
  const newModelRows = []
  for (const n of newModelsToAdd) {
    const p = priceByOrId.get(n.orId)
    const input = p.input ?? perMillion(n.pricing.prompt) ?? 0
    const cached = p.cached ?? (input * 0.1)
    const output = p.output ?? perMillion(n.pricing.completion) ?? 0
    const reasoning = p.reasoning ?? output
    newModelRows.push({
      model_id: n.model_id,
      display_name: n.display_name,
      provider: n.provider,
      input,
      cached,
      output,
      reasoning,
      orId: n.orId,
      basis: p.basis,
    })
    console.log(
      `  + ${n.model_id.padEnd(28)} ${[input, cached, output, reasoning].join(' / ')}  [${n.provider}，${n.orId}，${p.basis}]`,
    )
  }

  const unmatched = local.filter((row) => !resolved.some((r) => r.row.model_id === row.model_id) && row.usage_count > 0)
  if (unmatched.length) {
    console.log(
      `\nOpenRouter 上没有标准报价、保持原价的在用模型 ${unmatched.length} 个: ${unmatched.map((r) => r.model_id).join(', ')}`,
    )
  }

  if (!APPLY) {
    console.log('\n（预览模式，未写入。确认无误后加 --apply 执行）')
    return
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const backupPath = path.join(
    BACKUP_DIR,
    `token-trail-pre-openrouter-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
  )
  await db.backup(backupPath)
  console.log(`\n已备份数据库到 ${backupPath}`)

  const costSql = `
    SELECT SUM(cost_usd) AS total FROM usage_records
    WHERE NOT (source = 'cursor' AND is_aggregate = 0)`
  const before = db.prepare(costSql).get().total || 0

  const updatePrice = db.prepare(`
    UPDATE model_pricing
    SET input_price_per_1m = @input, cached_input_price_per_1m = @cached,
        output_price_per_1m = @output, reasoning_price_per_1m = @reasoning,
        updated_at = CURRENT_TIMESTAMP
    WHERE model_id = @model_id`)

  const insertPrice = db.prepare(`
    INSERT INTO model_pricing (
      model_id, display_name, provider,
      input_price_per_1m, cached_input_price_per_1m,
      output_price_per_1m, reasoning_price_per_1m
    ) VALUES (
      @model_id, @display_name, @provider,
      @input, @cached,
      @output, @reasoning
    )
    ON CONFLICT(model_id) DO UPDATE SET
      input_price_per_1m = excluded.input_price_per_1m,
      cached_input_price_per_1m = excluded.cached_input_price_per_1m,
      output_price_per_1m = excluded.output_price_per_1m,
      reasoning_price_per_1m = excluded.reasoning_price_per_1m,
      updated_at = CURRENT_TIMESTAMP
  `)

  // 删除错误模型定价
  const deleteJunkPricing = db.prepare(`
    DELETE FROM model_pricing WHERE model_id IN (${[...JUNK_MODELS].map(() => '?').join(', ')})
  `)

  // 将错误模型的记录费用全部清 0
  const zeroJunkUsage = db.prepare(`
    UPDATE usage_records
    SET cost_usd = 0
    WHERE (model IN (${[...JUNK_MODELS].map(() => '?').join(', ')}) OR model LIKE 'test-%' OR model LIKE 'test_%' OR model LIKE 'verify-%')
      AND cost_usd != 0
  `)

  // 正常模型重算费用
  // Credit-billed rows (Kiro CLI) store credits × official credit price; their
  // token counts are context totals, so token × list price would be wrong.
  const hasCreditsColumn = db.prepare('PRAGMA table_info(usage_records)').all().some((c) => c.name === 'credits')
  const recalculate = db.prepare(`
    UPDATE usage_records
    SET cost_usd = (
      SELECT ROUND(
        usage_records.input_tokens / 1e6 * p.input_price_per_1m +
        usage_records.cached_input_tokens / 1e6 * p.cached_input_price_per_1m +
        usage_records.output_tokens / 1e6 * p.output_price_per_1m +
        usage_records.reasoning_tokens / 1e6 *
          CASE WHEN p.reasoning_price_per_1m > 0 THEN p.reasoning_price_per_1m ELSE p.output_price_per_1m END
      , 6)
      FROM model_pricing p WHERE p.model_id = usage_records.model
    )
    WHERE EXISTS (SELECT 1 FROM model_pricing p WHERE p.model_id = usage_records.model)
      AND NOT (source = 'cursor' AND is_aggregate = 0)
      ${hasCreditsColumn ? 'AND credits = 0' : ''}
      AND NOT (model IN (${[...JUNK_MODELS].map(() => '?').join(', ')}) OR model LIKE 'test-%' OR model LIKE 'test_%' OR model LIKE 'verify-%')
  `)

  let recalculated = 0
  let zeroedJunk = 0
  let deletedJunk = 0
  db.transaction(() => {
    deletedJunk = deleteJunkPricing.run(...JUNK_MODELS).changes
    zeroedJunk = zeroJunkUsage.run(...JUNK_MODELS).changes
    for (const u of updates) updatePrice.run(u)
    for (const n of newModelRows) insertPrice.run(n)
    recalculated = recalculate.run(...JUNK_MODELS).changes
  })()

  const after = db.prepare(costSql).get().total || 0
  console.log(`\n✅ 执行结果:`)
  console.log(`   - 清理错误模型定价项: ${deletedJunk} 个`)
  console.log(`   - 归零错误模型费用记录: ${zeroedJunk} 条`)
  console.log(`   - 更新价格模型: ${updates.length} 个`)
  console.log(`   - 新增最新模型: ${newModelRows.length} 个`)
  console.log(`   - 重算正常记录: ${recalculated} 条`)
  console.log(`   - 重算范围内总费用: $${before.toFixed(2)} → $${after.toFixed(2)}`)
  db.close()
}

main().catch((err) => {
  console.error(`✗ 价格更新失败: ${err.message}`)
  process.exit(1)
})
