import { NextRequest, NextResponse } from 'next/server'
import { countUsageRecords, localDayWindow, queryUsageRecords, type UsageKind } from '@/lib/db'
import { ensureInit } from '@/lib/init'
import { InvalidQueryParameterError, parseBoundedInteger, parseFilterList } from '@/lib/api-params'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    ensureInit()

    const searchParams = request.nextUrl.searchParams
    const days = parseBoundedInteger(searchParams.get('days'), 7, 1, 365)
    const sourceParam = searchParams.get('source')
    const modelParam = searchParams.get('model')
    const requestedPage = parseBoundedInteger(searchParams.get('page'), 1, 1, Number.MAX_SAFE_INTEGER)
    const limit = 10

    const kindParam = searchParams.get('kind')
    if (kindParam != null && kindParam !== '' && kindParam !== 'all' && kindParam !== 'measured' && kindParam !== 'estimated') {
      throw new InvalidQueryParameterError('Invalid query parameter: kind')
    }
    const kind: UsageKind | undefined = kindParam === 'measured' || kindParam === 'estimated' ? kindParam : undefined

    // Same calendar-day window as /api/stats so totals and rows match.
    const { startDate, endDate } = localDayWindow(days)
    const filters = {
      startDate,
      endDate,
      sources: parseFilterList(sourceParam, 'source'),
      models: parseFilterList(modelParam, 'model'),
      kind,
    }

    const total = countUsageRecords(filters)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const page = Math.min(requestedPage, totalPages)
    const records = queryUsageRecords(filters, { limit, offset: (page - 1) * limit })

    return NextResponse.json({
      records,
      total,
      page,
      page_size: limit,
      total_pages: totalPages,
    })
  } catch (error) {
    if (error instanceof InvalidQueryParameterError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      )
    }
    console.error('[TokenTrail] Error querying usage:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
