import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ensureInit } from '@/lib/init'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_DIR = path.join(os.homedir(), '.tokentrail')
const SYNC_STATUS_FILE = path.join(CONFIG_DIR, 'sync-status.json')
const BACKUP_DIR = path.join(CONFIG_DIR, 'backups')

interface SyncStatusFile {
  last_sync_at: number
  success: boolean
  sources: Record<string, {
    scanned: number
    inserted: number
    duplicates: number
    errors: number
    duration_ms: number
  }>
  vibecafe_configured: boolean
  error?: string
}

function readSyncStatus(): SyncStatusFile | null {
  try {
    if (!fs.existsSync(SYNC_STATUS_FILE)) return null
    return JSON.parse(fs.readFileSync(SYNC_STATUS_FILE, 'utf-8'))
  } catch {
    return null
  }
}

function readBackupInfo(): { last_backup_at: string | null; count: number } {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return { last_backup_at: null, count: 0 }
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort().reverse()
    if (files.length === 0) return { last_backup_at: null, count: 0 }
    const stat = fs.statSync(path.join(BACKUP_DIR, files[0]))
    return {
      last_backup_at: stat.mtime.toISOString(),
      count: files.length,
    }
  } catch {
    return { last_backup_at: null, count: 0 }
  }
}

export async function GET() {
  try {
    ensureInit()
    const db = getDb()

    const recordCount = (db.prepare('SELECT COUNT(*) as count FROM usage_records').get() as { count: number }).count
    const latestTs = (db.prepare('SELECT MAX(CAST(timestamp AS INTEGER)) as latest FROM usage_records').get() as { latest: number | null }).latest
    const latestRecord = latestTs ? new Date(latestTs).toISOString() : null

    // Per-source health: latest record timestamp per source
    const sourceRows = db.prepare(`
      SELECT source,
             COUNT(*) as count,
             MAX(CAST(timestamp AS INTEGER)) as latest_ts
      FROM usage_records
      GROUP BY source
      ORDER BY count DESC
    `).all() as { source: string; count: number; latest_ts: number }[]

    const now = Date.now()
    const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours
    const DAILY_SOURCE_STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000 // daily aggregate + sync delay

    const sources = sourceRows.map(row => {
      const staleThreshold = row.source.toLowerCase() === 'hermes'
        ? DAILY_SOURCE_STALE_THRESHOLD_MS
        : STALE_THRESHOLD_MS

      return {
        source: row.source,
        record_count: row.count,
        latest_record: new Date(row.latest_ts).toISOString(),
        stale: now - row.latest_ts > staleThreshold,
      }
    })

    // Sync status from file
    const syncStatus = readSyncStatus()

    // Backup info
    const backup = readBackupInfo()

    // Overall health: data not updated in 4+ hours is a warning
    const WARNING_THRESHOLD_MS = 4 * 60 * 60 * 1000
    const dataStale = latestTs ? (now - latestTs > WARNING_THRESHOLD_MS) : true

    return NextResponse.json({
      status: dataStale ? 'warning' : 'ok',
      records: recordCount,
      latest_record: latestRecord,
      sources,
      last_sync: syncStatus ? {
        at: new Date(syncStatus.last_sync_at).toISOString(),
        success: syncStatus.success,
        sources: syncStatus.sources,
        vibecafe_configured: syncStatus.vibecafe_configured,
        error: syncStatus.error || null,
      } : null,
      backup: {
        last_at: backup.last_backup_at,
        count: backup.count,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { status: 'error', message: String(error) },
      { status: 500 }
    )
  }
}
