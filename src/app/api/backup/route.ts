import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ensureInit } from '@/lib/init'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_DIR = path.join(os.homedir(), '.tokentrail')
const BACKUP_DIR = path.join(CONFIG_DIR, 'backups')
const DB_PATH = process.env.TOKENTRAIL_DB_PATH || path.join(process.cwd(), 'data', 'token-trail.db')

export async function POST() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json(
        { success: false, error: 'Database file not found' },
        { status: 404 }
      )
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(BACKUP_DIR, `token-trail-${timestamp}.db`)

    ensureInit()
    const db = getDb()
    await db.backup(backupPath)

    const sizeBytes = fs.statSync(backupPath).size

    // Clean up old backups - keep only the most recent 20
    const allBackups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .sort()
    const MAX_BACKUPS = 20
    if (allBackups.length > MAX_BACKUPS) {
      const toDelete = allBackups.slice(0, allBackups.length - MAX_BACKUPS)
      for (const file of toDelete) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, file)) } catch {}
      }
    }

    return NextResponse.json({
      success: true,
      path: backupPath,
      size_bytes: sizeBytes,
      remaining_backups: Math.min(allBackups.length, MAX_BACKUPS),
    })
  } catch (error) {
    console.error('[TokenTrail] Backup error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Backup failed' },
      { status: 500 }
    )
  }
}
