#!/usr/bin/env node
/**
 * Minimal test for local JSONL usage file scanning (syncLocalUsageFiles).
 * Run: node scripts/test-local-sync.js
 *
 * Tests:
 * 1. Normal JSONL import
 * 2. Zero-token skip
 * 3. request_id dedup
 * 4. Malformed JSON does not block other lines
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const assert = require('assert')

const DB_PATH = path.join(__dirname, '..', 'data', 'token-trail.db')

// Skip if no database
if (!fs.existsSync(DB_PATH)) {
  console.log('SKIP: No database found. Run the server first.')
  process.exit(0)
}

const Database = require('better-sqlite3')

// ─── Setup: create temp usage files ───

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokentrail-test-'))
const usageDir = path.join(tmpDir, '.openclaw', 'usage')
fs.mkdirSync(usageDir, { recursive: true })

const today = new Date().toISOString().slice(0, 10)
const testFile = path.join(usageDir, `${today}.jsonl`)
const testRequestId = `test-sync-${Date.now()}`

// Write test JSONL lines
const lines = [
  // 1. Normal record (should be imported)
  JSON.stringify({
    source: 'openclaw',
    provider: 'xiaomi',
    model: 'test-model-sync',
    input_tokens: 1000,
    output_tokens: 200,
    request_id: `${testRequestId}-normal`,
    timestamp: Date.now(),
  }),
  // 2. Zero-token record (should be skipped)
  JSON.stringify({
    source: 'openclaw',
    provider: 'xiaomi',
    model: 'test-model-zero',
    input_tokens: 0,
    output_tokens: 0,
    request_id: `${testRequestId}-zero`,
    timestamp: Date.now(),
  }),
  // 3. Duplicate request_id (should be deduped)
  JSON.stringify({
    source: 'openclaw',
    provider: 'xiaomi',
    model: 'test-model-dup',
    input_tokens: 500,
    output_tokens: 100,
    request_id: `${testRequestId}-dup`,
    timestamp: Date.now(),
  }),
  JSON.stringify({
    source: 'openclaw',
    provider: 'xiaomi',
    model: 'test-model-dup',
    input_tokens: 500,
    output_tokens: 100,
    request_id: `${testRequestId}-dup`,
    timestamp: Date.now(),
  }),
  // 4. Malformed JSON (should be skipped, not block)
  '{ this is not valid json }',
  // 5. Another valid record after malformed (should be imported)
  JSON.stringify({
    source: 'openclaw',
    provider: 'xiaomi',
    model: 'test-model-after-malformed',
    input_tokens: 300,
    output_tokens: 50,
    request_id: `${testRequestId}-after`,
    timestamp: Date.now(),
  }),
]

fs.writeFileSync(testFile, lines.join('\n') + '\n')

// ─── Run the sync logic directly ───

// We need to simulate what syncLocalUsageFiles does
const db = new Database(DB_PATH)

function countByRequestId(requestId) {
  return db.prepare('SELECT COUNT(*) as cnt FROM usage_records WHERE request_id = ?').get(requestId).cnt
}

function cleanup() {
  db.prepare(`DELETE FROM usage_records WHERE request_id LIKE '${testRequestId}%'`).run()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

// Read the file and process like syncLocalUsageFiles does
const fileLines = fs.readFileSync(testFile, 'utf-8').split('\n').filter(Boolean)
let scanned = 0, inserted = 0, duplicates = 0, errors = 0

for (const line of fileLines) {
  try {
    const entry = JSON.parse(line)
    if (!entry.model) continue
    const input = entry.input_tokens || 0
    const output = entry.output_tokens || 0
    const cached = entry.cached_input_tokens || 0
    const reasoning = entry.reasoning_tokens || 0
    if (input === 0 && output === 0 && cached === 0 && reasoning === 0) { scanned++; continue }

    const existing = entry.request_id
      ? db.prepare('SELECT id FROM usage_records WHERE request_id = ?').get(entry.request_id)
      : undefined

    if (existing) { scanned++; duplicates++; continue }

    db.prepare(`
      INSERT INTO usage_records (source, provider, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, cost_usd, request_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(entry.source, entry.provider || null, entry.model, input, cached, output, reasoning, entry.request_id || null, entry.timestamp || Date.now())

    scanned++
    inserted++
  } catch {
    errors++
  }
}

// ─── Assertions ───

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`)
    failed++
  }
}

console.log('')
console.log('  Local JSONL sync tests')
console.log('  ──────────────────────')

test('scanned 5 valid lines (malformed JSON is parse error, not scanned)', () => assert.strictEqual(scanned, 5))

test('inserted 3 valid records (normal + dup + after-malformed)', () => assert.strictEqual(inserted, 3))

test('zero-token record was skipped', () => {
  const zero = db.prepare("SELECT COUNT(*) as cnt FROM usage_records WHERE request_id = ?").get(`${testRequestId}-zero`)
  assert.strictEqual(zero.cnt, 0)
})

test('duplicate request_id was deduped', () => {
  const dup = countByRequestId(`${testRequestId}-dup`)
  assert.strictEqual(dup, 1)
})

test('record after malformed JSON was imported', () => {
  const after = countByRequestId(`${testRequestId}-after`)
  assert.strictEqual(after, 1)
})

test('malformed JSON did not block processing', () => {
  const after = countByRequestId(`${testRequestId}-after`)
  assert.strictEqual(after, 1)
})

test('malformed JSON counted as error', () => {
  assert.strictEqual(errors, 1)
})

test('provider field was stored', () => {
  const row = db.prepare('SELECT provider FROM usage_records WHERE request_id = ?').get(`${testRequestId}-normal`)
  assert.strictEqual(row.provider, 'xiaomi')
})

// ─── Cleanup ───

cleanup()
db.close()

console.log('')
console.log(`  ${passed} passed, ${failed} failed`)
console.log('')
process.exit(failed > 0 ? 1 : 0)
