import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// syncKiro reads HOME at module load, so point it at a throwaway home first.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-kiro-sync-'))
process.env.HOME = home

const { syncKiro } = await import('../src/lib/sync/sources/kiro.ts')
const { getDb } = await import('../src/lib/db.ts')
const { isUnchangedSyncedFile, markSyncedFile, SYNC_SCAN_EPOCH, SOURCE_SCAN_EPOCH } = await import('../src/lib/sync-checkpoint.ts')
const { parseVisibleProviders } = await import('../src/lib/quotas/visibility.ts')

const sessionDir = path.join(home, '.kiro', 'sessions', 'h', 'sess_a')
const transcript = path.join(sessionDir, 'messages.jsonl')
const logDir = path.join(home, '.kiro', 'logs', 'run1')

function line(payload, ts = '2026-10-27T03:00:00.000Z') {
  return JSON.stringify({ id: Math.random().toString(36).slice(2), timestamp: ts, payload }) + '\n'
}
function turn(turnId, credits, pct, ts) {
  return (
    line({ type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: pct }, executionId: turnId }) +
    line({ type: 'usage_summary', promptTurnSummaries: [{ unit: 'credit', usage: credits }], turnId, executionId: turnId, requestIds: ['r'] }, ts)
  )
}
function logEntry(turnId, model) {
  return JSON.stringify({ level: 'info', message: `q.create_response.request {"model":"${model}"}`, turnId }) + '\n'
}
function row(turnId) {
  return getDb().prepare('SELECT * FROM usage_records WHERE request_id = ?').get(`kiro:${turnId}`)
}
function touchLater(file, seconds) {
  const t = new Date(Date.now() + seconds * 1000)
  fs.utimesSync(file, t, t)
}

describe('syncKiro end to end', () => {
  it('writes a measured row with the logged model, context tokens, credits and credit cost', () => {
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.mkdirSync(logDir, { recursive: true })
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({ workspacePaths: ['/work/Proj'], modelId: 'auto' }))
    fs.writeFileSync(transcript, turn('t1', 10, 5, '2026-10-27T03:00:01.000Z'))
    fs.writeFileSync(path.join(logDir, 'kiro.log'), logEntry('t1', 'claude-opus-5.5'))

    const result = syncKiro()
    assert.equal(result.errors, 0)
    const r = row('t1')
    assert.equal(r.model, 'claude-opus-5.5')
    assert.equal(r.input_tokens, 50_000) // 5% of the 1M context window
    assert.equal(r.output_tokens, 0)
    assert.equal(r.credits, 10)
    assert.equal(r.cost_usd, 0.4)
    assert.equal(r.estimated, 0)
    assert.equal(r.project, 'Proj')
  })

  it('keeps a stored model when the request log for that turn is gone', () => {
    fs.rmSync(path.join(home, '.kiro', 'logs'), { recursive: true, force: true })
    fs.appendFileSync(transcript, turn('t2', 2, 1, '2026-10-27T03:05:00.000Z'))
    touchLater(transcript, 5)

    syncKiro()
    assert.equal(row('t1').model, 'claude-opus-5.5') // not downgraded to the session's "auto"
    assert.equal(row('t1').input_tokens, 50_000)
    assert.equal(row('t2').model, 'kiro-auto') // new turn, nothing better known
  })

  it('does not reread an unchanged transcript', () => {
    const result = syncKiro()
    assert.equal(result.skipped_files, 1)
    assert.equal(result.scanned, 0)
  })
})

describe('per-source scan epoch', () => {
  it('bumping kiro does not invalidate other sources', () => {
    assert.notEqual(SOURCE_SCAN_EPOCH.kiro, SYNC_SCAN_EPOCH)
    const other = path.join(home, 'codex.jsonl')
    fs.writeFileSync(other, '{}\n')
    markSyncedFile('codex', other)
    assert.equal(isUnchangedSyncedFile('codex', other), true)
    const epoch = getDb().prepare("SELECT epoch FROM sync_file_checkpoints WHERE source = 'codex' AND path = ?").get(other).epoch
    assert.equal(epoch, SYNC_SCAN_EPOCH)
  })
})

describe('parseVisibleProviders', () => {
  it('distinguishes "no filter" from "everything switched off"', () => {
    assert.equal(parseVisibleProviders(undefined), undefined)
    assert.deepEqual(parseVisibleProviders(''), [])
    assert.deepEqual(parseVisibleProviders([]), [])
  })

  it('keeps only known provider ids', () => {
    assert.deepEqual(parseVisibleProviders('codex, kiro,bogus'), ['codex', 'kiro'])
    assert.deepEqual(parseVisibleProviders(['kiro', 42, 'glm']), ['kiro', 'glm'])
  })
})
