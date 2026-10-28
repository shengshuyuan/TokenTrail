import { QUOTA_PROVIDER_IDS, type ProviderId } from './types'

/**
 * Parse a `providers` filter (comma list or array) against the known ids.
 * undefined = no filter (all products); [] = every product switched off in Settings.
 */
export function parseVisibleProviders(raw: unknown): ProviderId[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const list = Array.isArray(raw) ? raw : String(raw).split(',')
  return list
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id): id is ProviderId => (QUOTA_PROVIDER_IDS as string[]).includes(id))
}
