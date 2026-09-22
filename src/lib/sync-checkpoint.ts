import fs from 'fs'
import { getDb } from './db'

/**
 * Bump when a scanner's parse or attribution rules change. Checkpoints from
 * an older epoch are ignored, so the next sync rereads every file once.
 */
export const SYNC_SCAN_EPOCH = 1

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

function fileStat(filePath: string): { size: number; mtimeMs: number } | null {
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
  const stat = fileStat(filePath)
  if (!stat) return false

  const row = getDb().prepare(
    'SELECT size, mtime_ms, epoch FROM sync_file_checkpoints WHERE source = ? AND path = ?'
  ).get(source, filePath) as { size: number; mtime_ms: number; epoch: number } | undefined

  return !!row
    && row.epoch === SYNC_SCAN_EPOCH
    && row.size === stat.size
    && row.mtime_ms === stat.mtimeMs
}

/** Record a file only after its contents were read. A later append changes size or mtime. */
export function markSyncedFile(source: string, filePath: string): void {
  ensureSyncCheckpointTable()
  const stat = fileStat(filePath)
  if (!stat) return

  getDb().prepare(`
    INSERT INTO sync_file_checkpoints (source, path, size, mtime_ms, epoch)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source, path) DO UPDATE SET
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      epoch = excluded.epoch
  `).run(source, filePath, stat.size, stat.mtimeMs, SYNC_SCAN_EPOCH)
}
