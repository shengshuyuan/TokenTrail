import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TOKENTRAIL_DB_PATH = path.join(os.tmpdir(), `tt-checkpoint-test-${process.pid}.db`)

const { getSyncFileStat, isUnchangedSyncedFile, markSyncedFile } = await import('../src/lib/sync-checkpoint.ts')

describe('sync file checkpoints', () => {
  let filePath

  before(() => {
    filePath = path.join(os.tmpdir(), `tt-checkpoint-file-${process.pid}.jsonl`)
    fs.writeFileSync(filePath, '{"model":"gpt-5.4"}\n')
  })

  it('rereads a file until it has been marked', () => {
    assert.equal(isUnchangedSyncedFile('codex', filePath), false)
  })

  it('skips a file whose size and mtime are unchanged', () => {
    markSyncedFile('codex', filePath, getSyncFileStat(filePath))
    assert.equal(isUnchangedSyncedFile('codex', filePath), true)
  })

  it('rereads after the file grows', () => {
    const later = new Date(Date.now() + 2000)
    fs.appendFileSync(filePath, '{"model":"gpt-5.4"}\n')
    fs.utimesSync(filePath, later, later)
    assert.equal(isUnchangedSyncedFile('codex', filePath), false)
  })
})

it('does not checkpoint bytes appended after the read began', () => {
  const file = path.join(os.tmpdir(), `tt-checkpoint-append-${process.pid}.jsonl`)
  try {
    fs.writeFileSync(file, '{"id":1}\n')
    const stat = fs.statSync(file)
    const beforeRead = { size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) }
    fs.readFileSync(file, 'utf8')
    fs.appendFileSync(file, '{"id":2}\n')
    markSyncedFile('claude-code', file, beforeRead)
    assert.equal(isUnchangedSyncedFile('claude-code', file), false)
  } finally {
    fs.rmSync(file, { force: true })
  }
})

it('rescans and imports a Claude record appended while reading', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-checkpoint-claude-'))
  const originalHome = process.env.HOME
  process.env.HOME = home
  try {
    const dir = path.join(home, '.claude', 'projects', '-tmp-review')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'session.jsonl')
    const line = id => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id, model: 'checkpoint-model', usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n'
    fs.writeFileSync(file, line('checkpoint-first'))
    const { syncClaudeCode } = await import('../src/lib/sync/sources/claude.ts')
    const originalRead = fs.readFileSync
    const readMock = t.mock.method(fs, 'readFileSync', function (target, ...args) {
      const text = originalRead.call(this, target, ...args)
      if (target === file) fs.appendFileSync(file, line('checkpoint-appended'))
      return text
    })
    const first = syncClaudeCode()
    readMock.mock.restore()
    assert.equal(first.inserted, 1)
    const second = syncClaudeCode()
    assert.equal(second.skipped_files, 0)
    assert.equal(second.inserted, 1)
    assert.equal(syncClaudeCode().skipped_files, 1)
  } finally {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})
