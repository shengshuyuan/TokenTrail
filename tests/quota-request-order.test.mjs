import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptQuotaResponse,
  beginQuotaRead,
  beginQuotaRefresh,
  createQuotaRequestGate,
  finishQuotaRefresh,
} from '../src/lib/quotas/request-order.ts'

describe('quota request order', () => {
  it('drops a poll that started before a manual refresh', () => {
    const gate = createQuotaRequestGate()
    const pollId = beginQuotaRead(gate)
    const refreshId = beginQuotaRefresh(gate)
    assert.equal(acceptQuotaResponse(pollId, gate.latestId), false)
    assert.equal(acceptQuotaResponse(refreshId, gate.latestId), true)
  })

  it('does not start a poll while a refresh is in flight', () => {
    const gate = createQuotaRequestGate()
    const refreshId = beginQuotaRefresh(gate)
    assert.equal(beginQuotaRead(gate), null)
    assert.equal(gate.latestId, refreshId)
    finishQuotaRefresh(gate, refreshId)
    assert.equal(beginQuotaRead(gate), refreshId + 1)
  })

  it('ignores a second refresh until the first finishes', () => {
    const gate = createQuotaRequestGate()
    const first = beginQuotaRefresh(gate)
    assert.equal(beginQuotaRefresh(gate), null)
    finishQuotaRefresh(gate, first)
    assert.equal(typeof beginQuotaRefresh(gate), 'number')
  })
})
