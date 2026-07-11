import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Unit tests for Grok unified.jsonl parsing used by syncGrok().
 * Keeps the request_id / field mapping stable so historical re-syncs dedupe correctly.
 */

function parseGrokInferenceLine(line) {
  if (!line || !line.includes('shell.turn.inference_done') || !line.includes('prompt_tokens')) {
    return null
  }
  const entry = JSON.parse(line)
  if (entry.msg !== 'shell.turn.inference_done' || !entry.ctx) return null

  const ctx = entry.ctx
  const input_tokens = Number(ctx.prompt_tokens) || 0
  const cached_input_tokens = Number(ctx.cached_prompt_tokens) || 0
  const output_tokens = Number(ctx.completion_tokens) || 0
  const reasoning_tokens = Number(ctx.reasoning_tokens) || 0
  if (input_tokens === 0 && output_tokens === 0 && cached_input_tokens === 0 && reasoning_tokens === 0) {
    return null
  }

  const sid = entry.sid || 'unknown'
  const loopIndex = ctx.loop_index ?? 0
  const timestamp = Date.parse(entry.ts)
  return {
    source: 'grok',
    provider: 'xai',
    model: 'grok-4.5',
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_tokens,
    request_id: `grok:${sid}:L${loopIndex}:${timestamp}`,
    timestamp,
  }
}

import * as fs from 'fs'

function resolveLongestExistingPath(raw) {
  if (!raw) return null
  let candidate = raw.trim()
  if (!candidate.startsWith('/')) return null
  while (candidate.length > 1) {
    const cleaned = candidate.replace(/[/"'`\s]+$/g, '')
    if (cleaned.startsWith('/') && fs.existsSync(cleaned)) return cleaned
    candidate = candidate.slice(0, -1)
  }
  return null
}

function projectNameFromFilesystemPath(rawPath) {
  const existing = resolveLongestExistingPath(rawPath)
  if (!existing) return null
  let current = existing
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(current) && fs.statSync(current).isDirectory()) {
      if (fs.existsSync(`${current}/package.json`) || fs.existsSync(`${current}/.git`)) {
        return current.split('/').filter(Boolean).pop()
      }
    }
    const parent = current.replace(/\/[^/]+$/, '') || '/'
    if (parent === current) break
    current = parent
  }
  return existing.split('/').filter(Boolean).pop() || null
}

function extractProjectFromPromptText(text) {
  if (!text) return null
  const startRe = /\/(?:Users|home|Volumes)\//g
  const starts = []
  let m
  while ((m = startRe.exec(text)) !== null) starts.push(m.index)
  for (let i = starts.length - 1; i >= 0; i--) {
    const start = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1] : text.length
    const slice = text.slice(start, end).split(/[\n\r]/)[0]
    const project = projectNameFromFilesystemPath(slice)
    if (project) return project
  }
  return null
}

function resolveProjectFromTimeline(timeline, timestamp, fallback) {
  if (!timeline.length) return fallback || 'unknown'
  let project = timeline[0].project || fallback || 'unknown'
  for (const point of timeline) {
    if (point.at <= timestamp) project = point.project
    else break
  }
  return project || fallback || 'unknown'
}

describe('syncGrok parsing', () => {
  it('parses inference_done usage into TokenTrail fields', () => {
    const line = JSON.stringify({
      ts: '2026-07-09T01:09:26.549Z',
      msg: 'shell.turn.inference_done',
      sid: '019f446b-cbcc-7661-afbe-966e31cb20bd',
      ctx: {
        loop_index: 1,
        prompt_tokens: 31850,
        cached_prompt_tokens: 11136,
        completion_tokens: 384,
        reasoning_tokens: 98,
      },
    })

    const rec = parseGrokInferenceLine(line)
    assert.ok(rec)
    assert.equal(rec.source, 'grok')
    assert.equal(rec.provider, 'xai')
    assert.equal(rec.input_tokens, 31850)
    assert.equal(rec.cached_input_tokens, 11136)
    assert.equal(rec.output_tokens, 384)
    assert.equal(rec.reasoning_tokens, 98)
    assert.equal(rec.request_id, `grok:019f446b-cbcc-7661-afbe-966e31cb20bd:L1:${Date.parse('2026-07-09T01:09:26.549Z')}`)
  })

  it('skips non-usage lines and all-zero tokens', () => {
    assert.equal(parseGrokInferenceLine('{"msg":"other"}'), null)
    assert.equal(
      parseGrokInferenceLine(JSON.stringify({
        ts: '2026-07-09T01:09:26.549Z',
        msg: 'shell.turn.inference_done',
        sid: 's1',
        ctx: { loop_index: 1, prompt_tokens: 0, completion_tokens: 0 },
      })),
      null
    )
  })

  it('keeps request_id stable for historical re-sync dedup', () => {
    const line = JSON.stringify({
      ts: '2026-07-11T03:59:35.796Z',
      msg: 'shell.turn.inference_done',
      sid: 'abc',
      ctx: { loop_index: 2, prompt_tokens: 100, completion_tokens: 10 },
    })
    const a = parseGrokInferenceLine(line)
    const b = parseGrokInferenceLine(line)
    assert.equal(a.request_id, b.request_id)
  })

  it('extracts concrete project folder from prompt path (SayBetter, not session cwd)', () => {
    const prompt = '/Users/shengshuyuan/Desktop/桌面 - 盛树园的MacBook Pro/成长记录/VIbe coding/SayBetter 看看这个项目，这个是具体的项目'
    assert.equal(extractProjectFromPromptText(prompt), 'SayBetter')
  })

  it('switches project along prompt timeline by timestamp', () => {
    const timeline = [
      { at: 0, project: 'TokenTrail' },
      { at: 1_000, project: 'SayBetter' },
    ]
    assert.equal(resolveProjectFromTimeline(timeline, 500, 'TokenTrail'), 'TokenTrail')
    assert.equal(resolveProjectFromTimeline(timeline, 1_500, 'TokenTrail'), 'SayBetter')
  })
})
