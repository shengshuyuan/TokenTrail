import { NextRequest, NextResponse } from 'next/server'
import { syncAll } from '@/lib/sync'
import { getConfig, setConfig } from '@/lib/db'
import { ensureInit } from '@/lib/init'
import fs from 'fs'
import path from 'path'
import os from 'os'

const SYNC_STATUS_FILE = path.join(os.homedir(), '.tokentrail', 'sync-status.json')

function writeSyncStatus(success: boolean, sources: Record<string, { scanned: number; inserted: number; duplicates: number; errors: number; duration_ms: number }>, vibecafeConfigured: boolean, error?: string) {
  try {
    const dir = path.dirname(SYNC_STATUS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(SYNC_STATUS_FILE, JSON.stringify({
      last_sync_at: Date.now(),
      success,
      sources,
      vibecafe_configured: vibecafeConfigured,
      error: error || null,
    }, null, 2))
  } catch {
    // Non-critical: don't fail the sync if we can't write the status file
  }
}

export async function POST(request: NextRequest) {
  try {
    ensureInit()

    // 支持 POST body 传入 vibecafe_api_key
    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    if (body && typeof body === 'object' && 'vibecafe_api_key' in body && typeof body.vibecafe_api_key === 'string') {
      setConfig('vibecafe_api_key', body.vibecafe_api_key)
    }

    const results = await syncAll()

    const totalInserted = results.reduce((s, r) => s + r.inserted, 0)
    const totalDuplicates = results.reduce((s, r) => s + r.duplicates, 0)
    const totalErrors = results.reduce((s, r) => s + r.errors, 0)
    const totalDuration = results.reduce((s, r) => s + r.duration_ms, 0)

    const vibecafeConfigured = !!getConfig('vibecafe_api_key')

    // Record sync status for the system status page
    const sourcesMap: Record<string, { scanned: number; inserted: number; duplicates: number; errors: number; duration_ms: number }> = {}
    for (const r of results) {
      sourcesMap[r.source] = {
        scanned: r.scanned,
        inserted: r.inserted,
        duplicates: r.duplicates,
        errors: r.errors,
        duration_ms: r.duration_ms,
      }
    }
    writeSyncStatus(totalErrors === 0, sourcesMap, vibecafeConfigured)

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total_inserted: totalInserted,
        total_duplicates: totalDuplicates,
        total_errors: totalErrors,
        duration_ms: totalDuration,
      },
      vibecafe_configured: vibecafeConfigured,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Sync failed'
    writeSyncStatus(false, {}, false, errorMessage)
    console.error('[TokenTrail] Sync error:', error)
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}
