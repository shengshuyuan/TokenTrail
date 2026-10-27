'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Keeps only the newest request of one kind alive.
 *
 * `begin()` aborts the previous request and returns a signal for the new one.
 * After every await, check `signal.aborted` before touching state: a slow
 * response for an old filter (e.g. 7 days) must never overwrite the result
 * for the current one (e.g. 90 days).
 */
export function useLatestRequest() {
  const controllerRef = useRef<AbortController | null>(null)

  const begin = useCallback((): AbortSignal => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    return controller.signal
  }, [])

  useEffect(() => () => controllerRef.current?.abort(), [])

  return begin
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
