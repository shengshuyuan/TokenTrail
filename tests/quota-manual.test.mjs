import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getDb, saveQuotaSnapshotRows, loadQuotaSnapshotRows, setConfig, getConfig } from '../src/lib/db.ts'

describe('Quota Manual & Config Database Store', () => {
  beforeEach(() => {
    const db = getDb()
    db.prepare("DELETE FROM quota_snapshots WHERE provider = 'grok'").run()
    db.prepare("DELETE FROM app_config WHERE key LIKE 'XAI_%' OR key LIKE 'GLM_%' OR key LIKE 'MOONSHOT_%'").run()
  })

  afterEach(() => {
    const db = getDb()
    db.prepare("DELETE FROM app_config WHERE key LIKE 'XAI_%' OR key LIKE 'GLM_%' OR key LIKE 'MOONSHOT_%'").run()
    db.prepare("DELETE FROM quota_snapshots WHERE provider = 'grok' AND snapshot_json LIKE '%xai-test-key%'").run()
  })

  it('saves and loads manual snapshot correctly for a provider', async () => {
    const now = Date.now()
    const snapshot = {
      provider: 'grok',
      product: 'subscription',
      accountLabel: 'X Premium+',
      status: 'healthy',
      windows: [
        { id: '5h', label: '5h', unit: 'request', usedPercent: 12, windowMinutes: 300 },
        { id: 'week', label: 'week', unit: 'request', usedPercent: 45, windowMinutes: 10080 }
      ],
      wallets: [],
      source: 'manual',
      fetchedAt: now,
      lastSuccessAt: now,
      stale: false,
    }

    saveQuotaSnapshotRows([{
      provider: 'grok',
      snapshot_json: JSON.stringify(snapshot),
      fetched_at: now,
      last_success_at: now,
      last_error_code: null,
    }])

    const rows = loadQuotaSnapshotRows()
    const grokRow = rows.find((r) => r.provider === 'grok')
    assert.ok(grokRow)
    assert.equal(grokRow.provider, 'grok')
    
    const parsed = JSON.parse(grokRow.snapshot_json)
    assert.equal(parsed.accountLabel, 'X Premium+')
    assert.equal(parsed.windows.length, 2)
    assert.equal(parsed.windows[0].usedPercent, 12)
    assert.equal(parsed.source, 'manual')
  })

  it('stores and retrieves app_config provider credentials correctly', () => {
    setConfig('XAI_MANAGEMENT_KEY', 'xai-test-key-999')
    setConfig('XAI_TEAM_ID', 'team-888')
    setConfig('GLM_API_KEY', 'zhipu-test-key')

    assert.equal(getConfig('XAI_MANAGEMENT_KEY'), 'xai-test-key-999')
    assert.equal(getConfig('XAI_TEAM_ID'), 'team-888')
    assert.equal(getConfig('GLM_API_KEY'), 'zhipu-test-key')
    assert.equal(getConfig('MOONSHOT_API_KEY'), undefined)
  })
})
