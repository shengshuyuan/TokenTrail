import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-source-filter-'))
process.env.HOME = home

const { localUsageScanPlan } = await import('../src/lib/sync/local-plan.ts')
const { syncAll } = await import('../src/lib/sync/index.ts')
const { getDb } = await import('../src/lib/db.ts')

function writeUsage(source, requestId, tokens = 100) {
  const dir = path.join(home, `.${source}`, 'usage')
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(
    path.join(dir, '2026-06-10.jsonl'),
    JSON.stringify({
      source,
      model: 'gpt-4.1',
      input_tokens: tokens,
      output_tokens: 20,
      request_id: requestId,
      timestamp: 1718000000000,
    }) + '\n',
  )
}

function countSource(source) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM usage_records WHERE source = ?').get(source).n
}

describe('single-source local usage scan', () => {
  it('plans OpenClaw, Hermes, and ZCode separately', () => {
    assert.equal(localUsageScanPlan(undefined)?.exportZcode, true)
    assert.equal(localUsageScanPlan(undefined)?.sources, undefined)
    assert.equal(localUsageScanPlan(['claude-code']), null)
    assert.deepEqual(localUsageScanPlan(['openclaw']), {
      sources: ['openclaw'],
      exportZcode: false,
      sourceId: 'openclaw',
    })
    assert.equal(localUsageScanPlan(['hermes'])?.exportZcode, false)
    assert.deepEqual(localUsageScanPlan(['hermes'])?.sources, ['hermes'])
    assert.deepEqual(localUsageScanPlan(['zcode']), {
      sources: ['zcode'],
      exportZcode: true,
      sourceId: 'zcode',
    })
    const both = localUsageScanPlan(['openclaw', 'zcode'])
    assert.deepEqual(both?.sources, ['openclaw', 'zcode'])
    assert.equal(both?.exportZcode, true)
    assert.equal(both?.sourceId, 'local-usage')
  })

  it('scans only the requested usage directory', async () => {
    writeUsage('openclaw', 'filter-openclaw')
    writeUsage('hermes', 'filter-hermes')
    writeUsage('zcode', 'filter-zcode')

    const openclaw = await syncAll({ only: ['openclaw'] })
    assert.equal(openclaw.some(result => result.source === 'openclaw'), true)
    assert.equal(openclaw.some(result => result.source === 'hermes' || result.source === 'zcode'), false)
    assert.equal(countSource('openclaw'), 1)
    assert.equal(countSource('hermes'), 0)
    assert.equal(countSource('zcode'), 0)

    const hermes = await syncAll({ only: ['hermes'] })
    assert.equal(hermes.some(result => result.source === 'hermes'), true)
    assert.equal(countSource('hermes'), 1)
    assert.equal(countSource('zcode'), 0)

    const zcode = await syncAll({ only: ['zcode'] })
    assert.equal(zcode.some(result => result.source === 'zcode'), true)
    assert.equal(countSource('zcode'), 1)
    assert.equal(countSource('hermes'), 1)
    assert.equal(countSource('openclaw'), 1)
  })
})
