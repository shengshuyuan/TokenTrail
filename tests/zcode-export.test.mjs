import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { exportZcodeUsage, localDateKey } from '../src/lib/zcode.js'

/**
 * Tests for the ZCode usage exporter (src/lib/zcode.js).
 * Builds a throwaway ZCode-shaped SQLite DB and checks the exported
 * standard JSONL, the incremental watermark, and self-healing re-export.
 */

const T0 = 1789000000000 // arbitrary fixed ms epoch

function createZcodeDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);
    CREATE TABLE model_usage (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      model_id TEXT,
      status TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      cache_read_input_tokens INTEGER DEFAULT 0
    );
  `)
  return db
}

function insertModelUsage(db, row) {
  db.prepare(`
    INSERT INTO model_usage (id, session_id, model_id, status, started_at, completed_at,
      input_tokens, output_tokens, reasoning_tokens, cache_read_input_tokens)
    VALUES (@id, @session_id, @model_id, @status, @started_at, @completed_at,
      @input_tokens, @output_tokens, @reasoning_tokens, @cache_read_input_tokens)
  `).run({
    session_id: null,
    reasoning_tokens: 0,
    cache_read_input_tokens: 0,
    ...row,
  })
}

function readExportedLines(usageDir) {
  const files = fs.readdirSync(usageDir).filter(name => name.endsWith('.jsonl')).sort()
  return files.flatMap(file =>
    fs.readFileSync(path.join(usageDir, file), 'utf-8').split('\n').filter(Boolean)
      .map(line => JSON.parse(line))
  )
}

describe('zcode usage exporter', () => {
  let tmpDir
  let dbPath
  let usageDir
  let statePath
  let db

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokentrail-zcode-'))
    dbPath = path.join(tmpDir, 'db.sqlite')
    usageDir = path.join(tmpDir, 'usage')
    statePath = path.join(usageDir, '.export-state.json')
    db = createZcodeDb(dbPath)
    db.prepare('INSERT INTO session (id, directory) VALUES (?, ?)').run(
      'sess-1', '/Users/demo/VIbe coding/TokenTrail'
    )
    // completed + tokens → exported; cached ⊆ input (OpenAI-style inclusive)
    insertModelUsage(db, {
      id: 'usage_model_1', session_id: 'sess-1', model_id: 'GLM-5.3-Flash',
      status: 'completed', started_at: T0, completed_at: T0 + 1000,
      input_tokens: 69112, output_tokens: 2141, cache_read_input_tokens: 67776,
    })
    // unknown model, no session row → provider omitted, project omitted
    insertModelUsage(db, {
      id: 'usage_model_2', session_id: 'sess-404', model_id: 'some-future-model',
      status: 'completed', started_at: T0, completed_at: T0 + 2000,
      input_tokens: 100, output_tokens: 10,
    })
    // zero tokens → skipped
    insertModelUsage(db, {
      id: 'usage_model_zero', model_id: 'GLM-5.3-Flash',
      status: 'completed', started_at: T0, completed_at: T0 + 3000,
      input_tokens: 0, output_tokens: 0,
    })
    // running / error → skipped
    insertModelUsage(db, {
      id: 'usage_model_run', model_id: 'GLM-5.3-Flash',
      status: 'running', started_at: T0, completed_at: null,
      input_tokens: 500, output_tokens: 5,
    })
    insertModelUsage(db, {
      id: 'usage_model_err', model_id: 'GLM-5.3-Flash',
      status: 'error', started_at: T0, completed_at: T0 + 4000,
      input_tokens: 500, output_tokens: 5,
    })
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('exports completed non-zero usage as standard inclusive JSONL', () => {
    const result = exportZcodeUsage({ dbPath, usageDir, statePath })
    assert.equal(result.ok, true)
    assert.equal(result.exported, 2)

    const lines = readExportedLines(usageDir)
    assert.equal(lines.length, 2)

    const first = lines.find(line => line.request_id === 'zcode:usage_model_1')
    assert.equal(first.source, 'zcode')
    assert.equal(first.provider, 'zai')
    assert.equal(first.project, 'TokenTrail')
    assert.equal(first.model, 'GLM-5.3-Flash')
    // inclusive buckets preserved verbatim (sync.ts normalizes on ingest)
    assert.equal(first.input_tokens, 69112)
    assert.equal(first.cached_input_tokens, 67776)
    assert.equal(first.output_tokens, 2141)
    assert.equal(first.reasoning_tokens, 0)
    assert.equal(first.timestamp, T0 + 1000)

    const second = lines.find(line => line.request_id === 'zcode:usage_model_2')
    assert.equal(second.provider, undefined)
    assert.equal(second.project, undefined)

    // watermark lands on the newest exported completed_at
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    assert.equal(state.last_completed_at, T0 + 2000)
  })

  it('is incremental: re-export without new rows is a no-op', () => {
    exportZcodeUsage({ dbPath, usageDir, statePath })
    const before = readExportedLines(usageDir)

    const result = exportZcodeUsage({ dbPath, usageDir, statePath })
    assert.equal(result.exported, 0)
    assert.deepEqual(readExportedLines(usageDir), before)
  })

  it('picks up only rows completed after the watermark', () => {
    exportZcodeUsage({ dbPath, usageDir, statePath })

    insertModelUsage(db, {
      id: 'usage_model_new', session_id: 'sess-1', model_id: 'GLM-5.3',
      status: 'completed', started_at: T0 + 9000, completed_at: T0 + 9500,
      input_tokens: 43286, output_tokens: 500, cache_read_input_tokens: 26688,
    })
    // a late low completed_at below the watermark stays out (already covered range)
    insertModelUsage(db, {
      id: 'usage_model_old', model_id: 'GLM-5.3',
      status: 'completed', started_at: T0 - 9000, completed_at: T0 - 8000,
      input_tokens: 1, output_tokens: 1,
    })

    const result = exportZcodeUsage({ dbPath, usageDir, statePath })
    assert.equal(result.exported, 1)
    const lines = readExportedLines(usageDir)
    assert.equal(lines.length, 3)
    assert.ok(lines.find(line => line.request_id === 'zcode:usage_model_new'))
    assert.ok(!lines.find(line => line.request_id === 'zcode:usage_model_old'))
  })

  it('re-exports in full when usage files were wiped (self-healing)', () => {
    exportZcodeUsage({ dbPath, usageDir, statePath })
    for (const name of fs.readdirSync(usageDir)) {
      if (name.endsWith('.jsonl')) fs.rmSync(path.join(usageDir, name))
    }

    const result = exportZcodeUsage({ dbPath, usageDir, statePath })
    assert.equal(result.exported, 2)
    assert.equal(readExportedLines(usageDir).length, 2)
  })

  it('reports a missing ZCode db without throwing', () => {
    const result = exportZcodeUsage({
      dbPath: path.join(tmpDir, 'nope.sqlite'), usageDir, statePath,
    })
    assert.equal(result.ok, false)
    assert.equal(result.exported, 0)
  })

  it('groups lines into local-date files', () => {
    insertModelUsage(db, {
      id: 'usage_model_next_day', session_id: 'sess-1', model_id: 'GLM-5.3-Flash',
      status: 'completed', started_at: T0, completed_at: T0 + 26 * 3600 * 1000,
      input_tokens: 10, output_tokens: 1,
    })
    exportZcodeUsage({ dbPath, usageDir, statePath })

    const dates = new Set()
    for (const row of db.prepare("SELECT completed_at FROM model_usage WHERE status='completed' AND (input_tokens > 0 OR output_tokens > 0)").all()) {
      dates.add(localDateKey(row.completed_at))
    }
    for (const date of dates) {
      assert.ok(fs.existsSync(path.join(usageDir, `${date}.jsonl`)), `missing file for ${date}`)
    }
  })
})
