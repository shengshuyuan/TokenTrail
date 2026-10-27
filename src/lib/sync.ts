/**
 * Compatibility entry. Source scanners live in src/lib/sync/sources/.
 * syncAll starts network sources first, then walks local scanners.
 */
export { syncAll, SyncInProgressError } from './sync/index'
export type { SyncAllOptions, SyncResult } from './sync/index'
