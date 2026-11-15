import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const { fetchQuota } = await import('../src/lib/quotas/providers/workbuddy.js')
const { refreshSummary } = await import('../src/lib/quotas/refresh.js')

const NOW = new Date('2026-10-29T22:00:00+08:00').getTime()
const DAY = 24 * 60 * 60 * 1000

/** 造一个只有 WorkBuddy 扣费记录的临时 home。turns = [{ id, at, credits }] */
function makeHome({ turns = [], balance, sessionId = 'sess-1' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-workbuddy-quota-'))
  const root = path.join(home, '.workbuddy')
  const projectDir = path.join(root, 'projects', 'Users-me-TokenTrail')
  fs.mkdirSync(projectDir, { recursive: true })

  fs.writeFileSync(
    path.join(projectDir, `${sessionId}.jsonl`),
    turns
      .map(turn => JSON.stringify({
        type: 'message',
        timestamp: turn.at,
        cwd: '/Users/me/TokenTrail',
        providerData: { conversationRequestId: turn.id, model: 'deep-model' },
      }))
      .join('\n') + '\n',
    'utf8'
  )

  const credits = Object.fromEntries(turns.map(turn => [turn.id, turn.credits]))
  const db = new Database(path.join(root, 'workbuddy.db'))
  db.exec('CREATE TABLE session_usage (session_id TEXT PRIMARY KEY, used INTEGER, size INTEGER, updated_at INTEGER, credit_json TEXT)')
  db.prepare('INSERT INTO session_usage VALUES (?,?,?,?,?)').run(sessionId, 1000, 600000, NOW, JSON.stringify(credits))
  db.close()

  const env = { WORKBUDDY_HOME: root }
  if (balance !== undefined) env.WORKBUDDY_CREDITS_BALANCE = String(balance)
  return { home, root, env }
}

describe('WorkBuddy quota adapter', () => {
  it('aggregates official credits into today / week / month windows', async () => {
    const { home, env } = makeHome({
      turns: [
        { id: 'req-today', at: NOW - 1000, credits: 2 },
        { id: 'req-3d', at: NOW - 3 * DAY, credits: 5 },
        { id: 'req-20d', at: NOW - 20 * DAY, credits: 10 },
      ],
    })

    const snapshot = await fetchQuota({ home, env, now: () => NOW })
    assert.equal(snapshot.provider, 'workbuddy')
    assert.equal(snapshot.source, 'local_session')
    assert.deepEqual(snapshot.windows.map(w => w.id), ['workbuddy-today', 'workbuddy-week', 'workbuddy-month'])

    const byId = Object.fromEntries(snapshot.windows.map(w => [w.id, w]))
    assert.equal(byId['workbuddy-today'].used, 2)
    assert.equal(byId['workbuddy-week'].used, 7)
    assert.equal(byId['workbuddy-month'].used, 17)
    assert.equal(byId['workbuddy-today'].unit, 'credit')
    // 只有已用量，没有上限就不许编百分比
    assert.equal(byId['workbuddy-today'].usedPercent, undefined)
    const midnight = new Date(NOW)
    midnight.setHours(0, 0, 0, 0)
    assert.equal(byId['workbuddy-today'].resetsAt, midnight.getTime() + DAY, 'today recounts at the next midnight')
    assert.equal(byId['workbuddy-week'].resetsAt, undefined, 'last 7 days is a rolling window')
    const nextMonth = new Date(NOW)
    nextMonth.setHours(0, 0, 0, 0)
    nextMonth.setDate(1)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    assert.equal(byId['workbuddy-month'].resetsAt, nextMonth.getTime())
    assert.equal(snapshot.wallets.length, 0, 'no manual balance means no wallet')
  })

  it('shows the manually configured balance without inventing a limit', async () => {
    const { home, env } = makeHome({ turns: [{ id: 'req-today', at: NOW - 1000, credits: 2 }], balance: 88.5 })
    const snapshot = await fetchQuota({ home, env, now: () => NOW })
    assert.equal(snapshot.source, 'local_session')
    assert.deepEqual(snapshot.wallets, [{ label: 'workbuddy-remaining', balance: 88.5, currency: 'credits' }])
  })

  it('shows exactly the last confirmed official balance, ignoring local spend', async () => {
    const { home, env } = makeHome({ turns: [{ id: 'req-today', at: NOW - 1000, credits: 2 }], balance: 100 })
    // 即使存在快照时间、即使本地有新扣费，也只用最后确认的官方值：
    // 本地扣费样本不完整（credit_json 会被覆盖），任何减法都会虚高，与官网对不上。
    env.WORKBUDDY_CREDITS_BALANCE_AT = new Date(NOW - 3600_000).toISOString()
    const snapshot = await fetchQuota({
      home,
      env,
      now: () => NOW,
      creditSpentSince: () => 12.5,
    })
    assert.equal(snapshot.wallets[0].balance, 100, 'balance stays at the confirmed value')
  })

  it('ignores a credit that has no timestamp instead of counting it as today', async () => {
    const { home, env, root } = makeHome({ turns: [] })
    const db = new Database(path.join(root, 'workbuddy.db'))
    db.prepare('UPDATE session_usage SET credit_json = ?, updated_at = NULL').run(JSON.stringify({ orphan: 9 }))
    db.close()
    const snapshot = await fetchQuota({ home, env, now: () => NOW })
    assert.equal(snapshot.status, 'partial')
    assert.equal(snapshot.error.code, 'no_data')
    assert.equal(snapshot.windows.length, 0)
  })

  it('counts a credit-only WorkBuddy snapshot as a successful refresh', async () => {
    const { home, env } = makeHome({ turns: [{ id: 'req-today', at: NOW - 1000, credits: 2 }] })
    const snapshot = await fetchQuota({ home, env, now: () => NOW })
    const summary = refreshSummary([snapshot])
    assert.equal(summary.succeeded, 1)
    assert.deepEqual(summary.succeededProviders, ['workbuddy'])
  })

  it('reports not_configured when WorkBuddy was never used on this machine', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-workbuddy-empty-'))
    await assert.rejects(
      () => fetchQuota({ home, env: {}, now: () => NOW }),
      (err) => err.code === 'not_configured'
    )
  })
})
