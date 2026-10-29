import fs from 'fs'
import { getDb } from './db'

/**
 * Bump when a scanner's parse or attribution rules change. Checkpoints from
 * an older epoch are ignored, so the next sync rereads every file once.
 */
export const SYNC_SCAN_EPOCH = 3

/**
 * Per-source epoch overrides. Bump one source here when only that scanner's
 * parse rules change, so other sources' checkpoints stay valid.
 */
export const SOURCE_SCAN_EPOCH: Record<string, number> = {
  // kiro: keep credits and costs measured without inferred context tokens
  kiro: 4,
}

function scanEpochFor(source: string): number {
  return SOURCE_SCAN_EPOCH[source] ?? SYNC_SCAN_EPOCH
}

export function ensureSyncCheckpointTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS sync_file_checkpoints (
      source TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      epoch INTEGER NOT NULL,
      PRIMARY KEY (source, path)
    );
  `)
}

export function getSyncFileStat(filePath: string): { size: number; mtimeMs: number } | null {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return null
    return { size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) }
  } catch {
    return null
  }
}

/** True when this exact file was fully read under the current scanner epoch. */
export function isUnchangedSyncedFile(source: string, filePath: string): boolean {
  ensureSyncCheckpointTable()
  const stat = getSyncFileStat(filePath)
  if (!stat) return false

  const row = getDb().prepare(
    'SELECT size, mtime_ms, epoch FROM sync_file_checkpoints WHERE source = ? AND path = ?'
  ).get(source, filePath) as { size: number; mtime_ms: number; epoch: number } | undefined

  return !!row
    && row.epoch === scanEpochFor(source)
    && row.size === stat.size
    && row.mtime_ms === stat.mtimeMs
}

/** Commit only the fingerprint captured before reading, if the file stayed unchanged. */
export function markSyncedFile(
  source: string,
  filePath: string,
  beforeRead: ReturnType<typeof getSyncFileStat>,
): void {
  ensureSyncCheckpointTable()
  const stat = getSyncFileStat(filePath)
  if (!beforeRead || !stat || stat.size !== beforeRead.size || stat.mtimeMs !== beforeRead.mtimeMs) return

  getDb().prepare(`
    INSERT INTO sync_file_checkpoints (source, path, size, mtime_ms, epoch)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source, path) DO UPDATE SET
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      epoch = excluded.epoch
  `).run(source, filePath, stat.size, stat.mtimeMs, scanEpochFor(source))
}
