import { NextRequest, NextResponse } from 'next/server'
import { getDb, getAggregatedStats, localDayWindow } from '@/lib/db'
import { ensureInit } from '@/lib/init'
import { InvalidQueryParameterError, parseBoundedInteger, parseFilterList } from '@/lib/api-params'
import { readStatsCache, writeStatsCache } from '@/lib/stats-cache'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    ensureInit()

    const searchParams = request.nextUrl.searchParams
    const days = parseBoundedInteger(searchParams.get('days'), 7, 1, 365)
    const sourceParam = searchParams.get('source')
    const modelParam = searchParams.get('model')

    // "今天" = since local midnight; "N 天" = today plus the previous N-1 local days.
    const { startDate, endDate: now } = localDayWindow(days)

    // startDate in the key: after midnight the window moves, so old entries must miss.
    const cacheKey = `${startDate}|${request.nextUrl.searchParams.toString()}`
    const cached = readStatsCache(cacheKey)
    if (cached) return NextResponse.json(cached)

    const stats = getAggregatedStats({
      startDate,
      endDate: now,
      sources: parseFilterList(sourceParam, 'source'),
      models: parseFilterList(modelParam, 'model'),
    })

    // 返回可用的筛选选项（与当前时间范围一致，避免显示无数据的选项）
    const db = getDb()
    const availableSources = db.prepare(
      'SELECT DISTINCT source FROM usage_records WHERE timestamp >= ? AND timestamp <= ? AND is_internal = 0 ORDER BY source'
    ).all(startDate, now) as { source: string }[]
    const availableModels = db.prepare(
      `SELECT DISTINCT u.model, COALESCE(mp.display_name, u.model) as display_name
       FROM usage_records u LEFT JOIN model_pricing mp ON u.model = mp.model_id
       WHERE u.timestamp >= ? AND u.timestamp <= ? AND u.is_internal = 0
       ORDER BY u.model`
    ).all(startDate, now) as { model: string; display_name: string }[]

    const body = {
      ...stats,
      available_sources: availableSources.map(s => s.source),
      available_models: availableModels.map(m => ({ id: m.model, name: m.display_name })),
    }
    writeStatsCache(cacheKey, body)
    return NextResponse.json(body)
  } catch (error) {
    if (error instanceof InvalidQueryParameterError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      )
    }
    console.error('[TokenTrail] Error getting stats:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
