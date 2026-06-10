import { NextRequest, NextResponse } from 'next/server'
import { getAllPricing, upsertModelPricing } from '@/lib/db'
import { ensureInit } from '@/lib/init'

/** 校验可选价格字段：非负有限数，缺省为 0 */
function validateOptionalPrice(val: unknown): number {
  if (val == null) return 0
  const n = Number(val)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export async function GET() {
  try {
    ensureInit()
    const models = getAllPricing()
    return NextResponse.json({ models })
  } catch (error) {
    console.error('[TokenTrail] Error getting pricing:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    ensureInit()

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    if (!body.model_id || typeof body.model_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing field: model_id (string)' },
        { status: 400 }
      )
    }
    if (!body.display_name || typeof body.display_name !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing field: display_name (string)' },
        { status: 400 }
      )
    }
    if (!body.provider || typeof body.provider !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing field: provider (string)' },
        { status: 400 }
      )
    }
    if (typeof body.input_price_per_1m !== 'number' || !Number.isFinite(body.input_price_per_1m) || body.input_price_per_1m < 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid field: input_price_per_1m (must be a non-negative number)' },
        { status: 400 }
      )
    }
    if (typeof body.output_price_per_1m !== 'number' || !Number.isFinite(body.output_price_per_1m) || body.output_price_per_1m < 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid field: output_price_per_1m (must be a non-negative number)' },
        { status: 400 }
      )
    }

    upsertModelPricing({
      model_id: body.model_id,
      display_name: body.display_name,
      provider: body.provider,
      input_price_per_1m: body.input_price_per_1m,
      cached_input_price_per_1m: validateOptionalPrice(body.cached_input_price_per_1m),
      output_price_per_1m: body.output_price_per_1m,
      reasoning_price_per_1m: validateOptionalPrice(body.reasoning_price_per_1m),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[TokenTrail] Error updating pricing:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
