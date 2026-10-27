/**
 * Quota reads and manual refreshes share one sequence.
 * A response is applied only when its id is still the newest request that
 * started, so a late poll cannot replace a newer refresh.
 */

export interface QuotaRequestGate {
  latestId: number
  refreshLock: boolean
}

export function createQuotaRequestGate(): QuotaRequestGate {
  return { latestId: 0, refreshLock: false }
}

/** Start a GET. Returns null while a manual refresh owns the sequence. */
export function beginQuotaRead(gate: QuotaRequestGate): number | null {
  if (gate.refreshLock) return null
  gate.latestId += 1
  return gate.latestId
}

/** Start a POST refresh. A second refresh waits until this one finishes. */
export function beginQuotaRefresh(gate: QuotaRequestGate): number | null {
  if (gate.refreshLock) return null
  gate.refreshLock = true
  gate.latestId += 1
  return gate.latestId
}

export function finishQuotaRefresh(gate: QuotaRequestGate, requestId: number): void {
  if (gate.latestId === requestId) gate.refreshLock = false
}

/** True when this response is still the newest request that was started. */
export function acceptQuotaResponse(responseId: number, latestStartedId: number): boolean {
  return responseId > 0 && responseId === latestStartedId
}
