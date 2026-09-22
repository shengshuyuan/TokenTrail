import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TOKENTRAIL_DB_PATH = path.join(os.tmpdir(), `tt-checkpoint-test-${process.pid}.db`)

const { isUnchangedSyncedFile, markSyncedFile } = await import('../src/lib/sync-checkpoint.ts')

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
    markSyncedFile('codex', filePath)
    assert.equal(isUnchangedSyncedFile('codex', filePath), true)
  })

  it('rereads after the file grows', () => {
    const later = new Date(Date.now() + 2000)
    fs.appendFileSync(filePath, '{"model":"gpt-5.4"}\n')
    fs.utimesSync(filePath, later, later)
    assert.equal(isUnchangedSyncedFile('codex', filePath), false)
  })
})
