import { NextRequest, NextResponse } from 'next/server'
import { insertUsageRecord } from '@/lib/db'
import { calculateCost } from '@/lib/pricing'
import { ensureInit } from '@/lib/init'
import { rejectUnsafeLocalMutation } from '@/lib/local-request'

export async function POST(request: NextRequest) {
  const rejected = rejectUnsafeLocalMutation(request)
  if (rejected) return rejected

  try {
    ensureInit()

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    // 验证必填字段
    if (!body.source || typeof body.source !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid field: source (string)' },
        { status: 400 }
      )
    }
    if (!body.model || typeof body.model !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid field: model (string)' },
        { status: 400 }
      )
    }

    // 验证 token 数值：必须是非负有限数，入库前向下取整为整数
    const rawInput = Number(body.input_tokens ?? 0)
    const rawOutput = Number(body.output_tokens ?? 0)
    if (!Number.isFinite(rawInput) || rawInput < 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid field: input_tokens (must be a non-negative number)' },
        { status: 400 }
      )
    }
    if (!Number.isFinite(rawOutput) || rawOutput < 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid field: output_tokens (must be a non-negative number)' },
        { status: 400 }
      )
    }

    const rawCached = Number(body.cached_input_tokens ?? 0)
    const rawReasoning = Number(body.reasoning_tokens ?? 0)
    if (!Number.isFinite(rawCached) || rawCached < 0 || !Number.isFinite(rawReasoning) || rawReasoning < 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid field: cached_input_tokens / reasoning_tokens (must be non-negative)' },
        { status: 400 }
      )
    }

    const input_tokens = Math.floor(rawInput)
    const output_tokens = Math.floor(rawOutput)
    const cachedInput = Math.floor(rawCached)
    const reasoning = Math.floor(rawReasoning)

    // 拒绝全部 token 为 0 的记录，避免污染统计数据
    if (input_tokens === 0 && output_tokens === 0 && cachedInput === 0 && reasoning === 0) {
      return NextResponse.json(
        { success: false, error: 'All token counts are zero. Report real response.usage values, not estimates. If the provider does not return usage, do not report.' },
        { status: 400 }
      )
    }

    const rawTimestamp = body.timestamp ?? Date.now()
    let timestamp: number
    if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp) && rawTimestamp >= 0) {
      // Accept unix seconds from agents that report wall-clock seconds
      timestamp = rawTimestamp < 1e12 ? Math.round(rawTimestamp * 1000) : Math.trunc(rawTimestamp)
    } else if (typeof rawTimestamp === 'string') {
      const trimmed = rawTimestamp.trim()
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        const numeric = Number(trimmed)
        timestamp = numeric < 1e12 ? Math.round(numeric * 1000) : Math.trunc(numeric)
      } else {
        const parsed = Date.parse(trimmed)
        if (!Number.isFinite(parsed) || parsed < 0) {
          return NextResponse.json(
            { success: false, error: 'Invalid field: timestamp (must be a non-negative number or ISO string)' },
            { status: 400 }
          )
        }
        timestamp = parsed
      }
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid field: timestamp (must be a non-negative number or ISO string)' },
        { status: 400 }
      )
    }

    // 校验 request_id 类型
    if (body.request_id != null && typeof body.request_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid field: request_id (must be a string if provided)' },
        { status: 400 }
      )
    }
    if (body.project != null && typeof body.project !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid field: project (must be a string if provided)' },
        { status: 400 }
      )
    }
    if (body.provider != null && typeof body.provider !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid field: provider (must be a string if provided)' },
        { status: 400 }
      )
    }

    // 计算费用
    const costUsd = calculateCost({
      model: body.model,
      input_tokens,
      cached_input_tokens: cachedInput,
      output_tokens,
      reasoning_tokens: reasoning,
    })

    const result = insertUsageRecord({
      source: body.source,
      provider: body.provider,
      project: body.project,
      model: body.model,
      input_tokens,
      cached_input_tokens: cachedInput,
      output_tokens: output_tokens,
      reasoning_tokens: reasoning,
      cost_usd: costUsd,
      request_id: body.request_id,
      timestamp,
    })

    return NextResponse.json({
      success: true,
      cost_usd: result.duplicate ? 0 : costUsd,
      id: result.id,
      duplicate: result.duplicate,
    })
  } catch (error) {
    console.error('[TokenTrail] Error processing report:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
