import { NextRequest, NextResponse } from 'next/server'
import { countUsageRecords, queryUsageRecords } from '@/lib/db'
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
    const rawPage = parseInt(searchParams.get('page') || '1')
    const page = Math.max(1, Number.isNaN(rawPage) ? 1 : rawPage)
    const limit = 10

    const now = Date.now()
    const startDate = now - days * 24 * 60 * 60 * 1000
    const filters = {
      startDate,
      endDate: now,
      sources: sourceParam ? sourceParam.split(',').filter(Boolean) : undefined,
      models: modelParam ? modelParam.split(',').filter(Boolean) : undefined,
    }

    const records = queryUsageRecords(filters, { limit, offset: (page - 1) * limit })
    const total = countUsageRecords(filters)

    return NextResponse.json({
      records,
      total,
      page,
      page_size: limit,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    })
  } catch (error) {
    console.error('[TokenTrail] Error querying usage:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
