import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ensureInit } from '@/lib/init'

/**
 * GET /api/health
 *
 * 健康检查端点，供 CLI 工具和监控使用。
 * 返回服务器状态、数据统计、配置信息。
 */
export async function GET() {
  try {
    ensureInit()
    const db = getDb()

    const recordCount = (db.prepare('SELECT COUNT(*) as count FROM usage_records').get() as { count: number }).count
    const sourceCount = (db.prepare('SELECT COUNT(DISTINCT source) as count FROM usage_records').get() as { count: number }).count
    const modelCount = (db.prepare('SELECT COUNT(DISTINCT model) as count FROM usage_records').get() as { count: number }).count

    const dateRange = db.prepare(
      'SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM usage_records'
    ).get() as { earliest: number | null; latest: number | null }

    const vibecafeConfigured = !!(
      db.prepare("SELECT value FROM app_config WHERE key = 'vibecafe_api_key'").get()
    )

    return NextResponse.json({
      status: 'ok',
      version: '1.0.0',
      records: recordCount,
      sources: sourceCount,
      models: modelCount,
      date_range: {
        earliest: dateRange.earliest ? new Date(dateRange.earliest).toISOString() : null,
        latest: dateRange.latest ? new Date(dateRange.latest).toISOString() : null,
      },
      config: {
        vibecafe_api_key: vibecafeConfigured,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { status: 'error', message: String(error) },
      { status: 500 }
    )
  }
}
