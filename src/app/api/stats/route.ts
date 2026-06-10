import { NextRequest, NextResponse } from 'next/server'
import { getDb, getAggregatedStats } from '@/lib/db'
import { ensureInit } from '@/lib/init'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    ensureInit()

    const searchParams = request.nextUrl.searchParams
    const rawDays = parseInt(searchParams.get('days') || '7')
    const days = Math.min(365, Math.max(1, Number.isNaN(rawDays) ? 7 : rawDays))
    const sourceParam = searchParams.get('source')
    const modelParam = searchParams.get('model')

    const now = Date.now()
    const startDate = now - days * 24 * 60 * 60 * 1000

    const stats = getAggregatedStats({
      startDate,
      endDate: now,
      sources: sourceParam ? sourceParam.split(',').filter(Boolean) : undefined,
      models: modelParam ? modelParam.split(',').filter(Boolean) : undefined,
    })

    // 返回可用的筛选选项（与当前时间范围一致，避免显示无数据的选项）
    const db = getDb()
    const availableSources = db.prepare(
      'SELECT DISTINCT source FROM usage_records WHERE timestamp >= ? AND timestamp <= ? ORDER BY source'
    ).all(startDate, now) as { source: string }[]
    const availableModels = db.prepare(
      `SELECT DISTINCT u.model, COALESCE(mp.display_name, u.model) as display_name
       FROM usage_records u LEFT JOIN model_pricing mp ON u.model = mp.model_id
       WHERE u.timestamp >= ? AND u.timestamp <= ?
       ORDER BY u.model`
    ).all(startDate, now) as { model: string; display_name: string }[]

    return NextResponse.json({
      ...stats,
      available_sources: availableSources.map(s => s.source),
      available_models: availableModels.map(m => ({ id: m.model, name: m.display_name })),
    })
  } catch (error) {
    console.error('[TokenTrail] Error getting stats:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
