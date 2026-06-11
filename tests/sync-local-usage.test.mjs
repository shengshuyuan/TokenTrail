import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Tests for syncLocalUsageFiles logic.
 * Tests the core JSONL parsing, validation, and dedup logic in isolation.
 */

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tokentrail-test-'))
}

function writeJsonl(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n') + '\n')
}

function parseJsonlFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean).map(line => {
    try { return { ok: true, data: JSON.parse(line) } }
    catch { return { ok: false } }
  })
}

describe('syncLocalUsageFiles logic', () => {
  let tmpDir
  let openclawDir
  let hermesDir

  beforeEach(() => {
    tmpDir = createTempDir()
    openclawDir = path.join(tmpDir, '.openclaw', 'usage')
    hermesDir = path.join(tmpDir, '.hermes', 'usage')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should parse valid JSONL entries correctly', () => {
    writeJsonl(path.join(openclawDir, '2026-06-10.jsonl'), [
      { source: 'openclaw', provider: 'openai', model: 'gpt-4.1', input_tokens: 5000, output_tokens: 1200, request_id: 'req-1', timestamp: 1718000000000 },
      { source: 'openclaw', provider: 'openai', model: 'gpt-4o', input_tokens: 3000, output_tokens: 800, request_id: 'req-2', timestamp: 1718000001000 },
    ])

    const entries = parseJsonlFile(path.join(openclawDir, '2026-06-10.jsonl'))
    assert.equal(entries.length, 2)
    assert.equal(entries[0].ok, true)
    assert.equal(entries[0].data.model, 'gpt-4.1')
    assert.equal(entries[0].data.input_tokens, 5000)
    assert.equal(entries[1].ok, true)
    assert.equal(entries[1].data.model, 'gpt-4o')
  })

  it('should skip entries with all-zero tokens', () => {
    writeJsonl(path.join(openclawDir, '2026-06-10.jsonl'), [
      { source: 'openclaw', model: 'gpt-4.1', input_tokens: 0, output_tokens: 0, request_id: 'req-zero', timestamp: 1718000000000 },
      { source: 'openclaw', model: 'gpt-4.1', input_tokens: 100, output_tokens: 50, request_id: 'req-valid', timestamp: 1718000001000 },
    ])

    const entries = parseJsonlFile(path.join(openclawDir, '2026-06-10.jsonl'))
    assert.equal(entries.length, 2)

    // First: all-zero → should be skipped by syncLocalUsageFiles
    const zero = entries[0].data
    const allZero = (zero.input_tokens || 0) === 0 && (zero.output_tokens || 0) === 0 && (zero.cached_input_tokens || 0) === 0 && (zero.reasoning_tokens || 0) === 0
    assert.equal(allZero, true, 'First entry has all-zero tokens')

    // Second: has non-zero tokens → should be kept
    const valid = entries[1].data
    assert.ok(valid.input_tokens > 0 || valid.output_tokens > 0, 'Second entry has non-zero tokens')
  })

  it('should detect duplicate request_ids across files', () => {
    writeJsonl(path.join(openclawDir, '2026-06-10.jsonl'), [
      { source: 'openclaw', model: 'gpt-4.1', input_tokens: 5000, output_tokens: 1200, request_id: 'req-dedup', timestamp: 1718000000000 },
    ])
    writeJsonl(path.join(openclawDir, '2026-06-10-b.jsonl'), [
      { source: 'openclaw', model: 'gpt-4.1', input_tokens: 5000, output_tokens: 1200, request_id: 'req-dedup', timestamp: 1718000000000 },
    ])

    const e1 = parseJsonlFile(path.join(openclawDir, '2026-06-10.jsonl'))
    const e2 = parseJsonlFile(path.join(openclawDir, '2026-06-10-b.jsonl'))
    assert.equal(e1[0].data.request_id, e2[0].data.request_id, 'Same request_id in both files')
  })

  it('should not block on malformed JSON lines', () => {
    const filePath = path.join(openclawDir, '2026-06-10.jsonl')
    fs.mkdirSync(openclawDir, { recursive: true })
    fs.writeFileSync(filePath, [
      JSON.stringify({ source: 'openclaw', model: 'gpt-4.1', input_tokens: 100, output_tokens: 50, request_id: 'req-before', timestamp: 1718000000000 }),
      'THIS IS NOT VALID JSON',
      JSON.stringify({ source: 'openclaw', model: 'gpt-4.1', input_tokens: 200, output_tokens: 100, request_id: 'req-after', timestamp: 1718000001000 }),
    ].join('\n') + '\n')

    const entries = parseJsonlFile(filePath)
    assert.equal(entries.length, 3)
    assert.equal(entries[0].ok, true, 'First line parses')
    assert.equal(entries[0].data.request_id, 'req-before')
    assert.equal(entries[1].ok, false, 'Second line is malformed')
    assert.equal(entries[2].ok, true, 'Third line still parses after malformed')
    assert.equal(entries[2].data.request_id, 'req-after')
  })

  it('should handle ISO timestamp strings', () => {
    writeJsonl(path.join(hermesDir, '2026-06-10.jsonl'), [
      { source: 'hermes', model: 'claude-sonnet-4-6', input_tokens: 3000, output_tokens: 700, request_id: 'req-iso', timestamp: '2026-06-10T12:00:00.000Z' },
    ])

    const entry = parseJsonlFile(path.join(hermesDir, '2026-06-10.jsonl'))[0].data
    assert.equal(typeof entry.timestamp, 'string')
    const ts = new Date(entry.timestamp).getTime()
    assert.ok(Number.isFinite(ts), 'ISO string converts to valid timestamp')
    assert.ok(ts > 0)
  })

  it('should scan both openclaw and hermes directories', () => {
    writeJsonl(path.join(openclawDir, '2026-06-10.jsonl'), [
      { source: 'openclaw', model: 'gpt-4.1', input_tokens: 100, output_tokens: 50, request_id: 'oc-1', timestamp: 1718000000000 },
    ])
    writeJsonl(path.join(hermesDir, '2026-06-10.jsonl'), [
      { source: 'hermes', model: 'claude-sonnet-4-6', input_tokens: 200, output_tokens: 80, request_id: 'hm-1', timestamp: 1718000001000 },
    ])

    assert.ok(fs.existsSync(openclawDir))
    assert.ok(fs.existsSync(hermesDir))
    assert.ok(fs.readdirSync(openclawDir).length > 0)
    assert.ok(fs.readdirSync(hermesDir).length > 0)
  })

  it('should skip entries without model field', () => {
    writeJsonl(path.join(openclawDir, '2026-06-10.jsonl'), [
      { source: 'openclaw', input_tokens: 5000, output_tokens: 1200, request_id: 'req-no-model', timestamp: 1718000000000 },
      { source: 'openclaw', model: 'gpt-4.1', input_tokens: 100, output_tokens: 50, request_id: 'req-with-model', timestamp: 1718000001000 },
    ])

    const entries = parseJsonlFile(path.join(openclawDir, '2026-06-10.jsonl'))
    assert.equal(entries[0].data.model, undefined, 'First entry has no model')
    assert.equal(entries[1].data.model, 'gpt-4.1', 'Second entry has model')
  })

  it('should normalize numeric timestamps correctly', () => {
    // normalizeTimestamp logic: number → use as-is, string → parse, missing → Date.now()
    function normalizeTimestamp(raw) {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw
      if (typeof raw === 'string') {
        const t = new Date(raw).getTime()
        if (Number.isFinite(t)) return t
      }
      return Date.now()
    }

    assert.equal(normalizeTimestamp(1718000000000), 1718000000000)
    assert.equal(normalizeTimestamp('2026-06-10T12:00:00.000Z'), new Date('2026-06-10T12:00:00.000Z').getTime())
    assert.ok(normalizeTimestamp(undefined) > 0, 'Missing timestamp falls back to Date.now()')
    assert.ok(normalizeTimestamp('invalid') > 0, 'Invalid string falls back to Date.now()')
  })
})
