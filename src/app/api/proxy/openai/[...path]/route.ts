/**
 * TokenTrail Local OpenAI-compatible Proxy
 *
 * Forward OpenAI-compatible API calls to the upstream service,
 * record token usage, and return the response.
 *
 * Usage:
 *   1. Set OPENAI_API_KEY in env or ~/.tokentrail/config.json
 *   2. Point your tool's baseURL to http://localhost:3820/proxy/openai
 *   3. All calls go through the real API; usage is recorded automatically
 *   4. Set TOKENTRAIL_UPSTREAM_URL for non-OpenAI-compatible upstreams
 *
 * Streaming: usage is extracted from the final SSE chunk and recorded.
 * Non-streaming: usage is extracted from the JSON response body.
 */

import { NextRequest } from 'next/server'
import { insertUsageRecord } from '@/lib/db'
import { calculateCost } from '@/lib/pricing'
import { ensureInit } from '@/lib/init'
import { getConfig } from '@/lib/db'

const DEFAULT_UPSTREAM = 'https://api.openai.com/v1'

function getUpstreamUrl(): string {
  return process.env.TOKENTRAIL_UPSTREAM_URL
    || DEFAULT_UPSTREAM
}

function getApiKey(request: NextRequest): string | undefined {
  // 1. Caller's Authorization header
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  // 2. Environment variable
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY
  }
  // 3. TokenTrail config
  return getConfig('openai_api_key')
}

function extractSource(request: NextRequest): string {
  return request.headers.get('x-tokentrail-source') || 'proxy'
}

function extractProject(request: NextRequest): string | undefined {
  return request.headers.get('x-tokentrail-project') || undefined
}

/**
 * Extract usage from a final SSE chunk (streaming mode).
 * The chunk may contain multiple "data: {...}" lines;
 * we look for the one with a "usage" field.
 */
function extractUsageFromSSEChunk(chunk: string): {
  model: string
  id?: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
} | null {
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
    try {
      const obj = JSON.parse(line.slice(6))
      if (obj.usage && obj.model) {
        return { model: obj.model, id: obj.id, usage: obj.usage }
      }
    } catch {}
  }
  return null
}

function recordUsage(opts: {
  source: string
  project?: string
  model: string
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  reasoning_tokens: number
  request_id?: string
}) {
  const cost_usd = calculateCost({
    model: opts.model,
    input_tokens: opts.input_tokens,
    cached_input_tokens: opts.cached_input_tokens,
    output_tokens: opts.output_tokens,
    reasoning_tokens: opts.reasoning_tokens,
  })

  insertUsageRecord({
    source: opts.source,
    project: opts.project,
    model: opts.model,
    input_tokens: opts.input_tokens,
    cached_input_tokens: opts.cached_input_tokens,
    output_tokens: opts.output_tokens,
    reasoning_tokens: opts.reasoning_tokens,
    cost_usd,
    request_id: opts.request_id,
    timestamp: Date.now(),
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, await params)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, await params)
}

async function handleRequest(
  request: NextRequest,
  { path }: { path: string[] }
) {
  const upstream = getUpstreamUrl()
  const targetPath = path.join('/')
  const targetUrl = `${upstream}/${targetPath}${request.nextUrl.search}`

  const apiKey = getApiKey(request)
  const source = extractSource(request)
  const project = extractProject(request)

  // Build upstream headers
  const headers = new Headers()
  if (apiKey) {
    headers.set('Authorization', `Bearer ${apiKey}`)
  }
  // Forward content-type and other relevant headers
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)

  // Read request body
  let body: string | undefined
  if (request.method === 'POST') {
    body = await request.text()
  }

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json(
      { error: { message: `Proxy upstream error: ${message}`, type: 'proxy_error' } },
      { status: 502 }
    )
  }

  // If upstream returned an error, pass it through
  if (!upstreamRes.ok) {
    const errBody = await upstreamRes.text()
    return new Response(errBody, {
      status: upstreamRes.status,
      headers: { 'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json' },
    })
  }

  const isStreaming = upstreamRes.headers.get('content-type')?.includes('text/event-stream')
  const source_final = source
  const project_final = project

  if (!isStreaming || !upstreamRes.body) {
    // ─── Non-streaming: buffer, record, return ───
    const responseBody = await upstreamRes.text()

    try {
      const json = JSON.parse(responseBody)
      if (json.usage && json.model) {
        ensureInit()
        recordUsage({
          source: source_final,
          project: project_final,
          model: json.model,
          input_tokens: json.usage.prompt_tokens || 0,
          output_tokens: json.usage.completion_tokens || 0,
          cached_input_tokens: json.usage.prompt_tokens_details?.cached_tokens || 0,
          reasoning_tokens: json.usage.completion_tokens_details?.reasoning_tokens || 0,
          request_id: json.id || undefined,
        })
      }
    } catch {}

    return new Response(responseBody, {
      status: upstreamRes.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ─── Streaming: forward in real-time, record usage at end ───
  const reader = upstreamRes.body.getReader()
  const decoder = new TextDecoder()
  let allData = ''

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        // Stream ended — try to extract usage from accumulated data
        try {
          ensureInit()
          const usageData = extractUsageFromSSEChunk(allData)
          if (usageData) {
            const u = usageData.usage
            recordUsage({
              source: source_final,
              project: project_final,
              model: usageData.model,
              input_tokens: u.prompt_tokens || 0,
              output_tokens: u.completion_tokens || 0,
              cached_input_tokens: u.prompt_tokens_details?.cached_tokens || 0,
              reasoning_tokens: u.completion_tokens_details?.reasoning_tokens || 0,
              request_id: usageData.id,
            })
          }
        } catch {}
        controller.close()
        return
      }
      // Accumulate data for usage extraction (not forwarded to client)
      allData += decoder.decode(value, { stream: true })
      controller.enqueue(value)
    },
  })

  return new Response(stream, {
    status: upstreamRes.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
