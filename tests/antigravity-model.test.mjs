import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Imports the real src/lib/antigravity.ts (zero-dependency, Node 22 strips
 * types natively) instead of mirroring its logic.
 */
import { detectAntigravityModel, parseAntigravityTranscript } from '../src/lib/antigravity.ts'

function userExplicit(content, createdAt) {
  return JSON.stringify({ source: 'USER_EXPLICIT', type: 'USER_INPUT', content, created_at: createdAt })
}

function modelResponse(content, createdAt) {
  return JSON.stringify({ source: 'MODEL', type: 'PLANNER_RESPONSE', content, created_at: createdAt })
}

function settingsChange(from, to) {
  return `<USER_SETTINGS_CHANGE>\nThe user changed setting \`Model Selection\` from ${from} to ${to}.\n</USER_SETTINGS_CHANGE>`
}

describe('Antigravity model detection', () => {
  it('detects Gemini 3.8 Flash from USER_SETTINGS_CHANGE', () => {
    const lines = [
      userExplicit(`<USER_REQUEST>\nfix styling\n</USER_REQUEST>\n${settingsChange('None', 'Gemini 3.8 Flash (High)')}`),
      modelResponse('Analyzing...'),
    ]
    assert.equal(detectAntigravityModel(lines), 'gemini-3.8-flash')
  })

  it('detects Gemini 3.7 Flash from USER_SETTINGS_CHANGE', () => {
    assert.equal(
      detectAntigravityModel([userExplicit(settingsChange('None', 'Gemini 3.7 Flash (Medium)'))]),
      'gemini-3.7-flash'
    )
  })

  it('picks the latest model when setting changes mid-conversation', () => {
    const lines = [
      userExplicit(settingsChange('None', 'Gemini 3.7 Flash (Medium)')),
      userExplicit(settingsChange('Gemini 3.7 Flash (Medium)', 'Gemini 3.8 Flash (High)')),
    ]
    assert.equal(detectAntigravityModel(lines), 'gemini-3.8-flash')
  })

  it('detects Gemini 3.6 Flash from historical settings', () => {
    assert.equal(
      detectAntigravityModel([userExplicit(settingsChange('None', 'Gemini 3.6 Flash (High)'))]),
      'gemini-3.6-flash'
    )
  })

  it('falls back to transcript model mentions if settings change tag is absent', () => {
    assert.equal(
      detectAntigravityModel([userExplicit('You are Gemini 3.7 Flash built by Google')]),
      'gemini-3.7-flash'
    )
  })

  it('defaults to gemini-3.8-flash when no model is found in transcript', () => {
    assert.equal(detectAntigravityModel([userExplicit('Hello world')]), 'gemini-3.8-flash')
  })
})

describe('parseAntigravityTranscript (per-event attribution)', () => {
  it('splits a conversation into per-entry events with their own timestamps', () => {
    const lines = [
      userExplicit('hello', '2026-09-01T10:00:00Z'),
      modelResponse('hi there', '2026-09-01T10:00:05Z'),
      userExplicit('bye', '2026-09-03T09:00:00Z'),
    ]
    const events = parseAntigravityTranscript(lines)
    assert.equal(events.length, 3)
    assert.deepEqual(
      events.map(e => new Date(e.timestamp).toISOString()),
      ['2026-09-01T10:00:00.000Z', '2026-09-01T10:00:05.000Z', '2026-09-03T09:00:00.000Z']
    )
    // char counts: 5 → 5/3.5 = 1.43 → 1; 8 → 2.29 → 2; 3 → 0.86 → max(1) = 1
    assert.equal(events[0].input_tokens, 1)
    assert.equal(events[1].output_tokens, 2)
    assert.equal(events[2].input_tokens, 1)
  })

  it('attributes entries to the model selected at that point', () => {
    const lines = [
      userExplicit('first question', '2026-09-01T10:00:00Z'),
      userExplicit(settingsChange('Gemini 3.7 Flash (Medium)', 'Gemini 3.8 Flash (High)'), '2026-09-01T11:00:00Z'),
      modelResponse('answer after switch', '2026-09-01T11:00:10Z'),
    ]
    const events = parseAntigravityTranscript(lines)
    // 切换文案本身也是 USER_EXPLICIT，会产生输入事件（与旧口径一致）
    assert.equal(events.length, 3)
    // 切换文案声明的是"切换到"的模型；此前的 entry 只能用默认模型兜底
    assert.equal(events[0].model, 'gemini-3.8-flash')
    assert.equal(events[1].model, 'gemini-3.8-flash')
    assert.equal(events[2].model, 'gemini-3.8-flash')
  })

  it('keeps pre-switch entries on the earlier model across multiple switches', () => {
    const lines = [
      userExplicit(settingsChange('None', 'Gemini 3.6 Flash (High)'), '2026-09-01T10:00:00Z'),
      modelResponse('old model answer', '2026-09-01T10:00:10Z'),
      userExplicit(settingsChange('Gemini 3.6 Flash (High)', 'Gemini 3.8 Pro'), '2026-09-02T10:00:00Z'),
      modelResponse('new model answer', '2026-09-02T10:00:10Z'),
    ]
    const events = parseAntigravityTranscript(lines)
    assert.equal(events[0].model, 'gemini-3.6-flash')
    assert.equal(events[1].model, 'gemini-3.6-flash')
    assert.equal(events[2].model, 'gemini-3.8-pro')
    assert.equal(events[3].model, 'gemini-3.8-pro')
  })

  it('applies the conversation heuristic when no switch message exists', () => {
    const lines = [
      userExplicit('You are Gemini 3.7 Flash built by Google', '2026-09-01T10:00:00Z'),
      modelResponse('ok', '2026-09-01T10:00:10Z'),
    ]
    const events = parseAntigravityTranscript(lines)
    assert.ok(events.length >= 1)
    for (const event of events) {
      assert.equal(event.model, 'gemini-3.7-flash')
    }
  })

  it('counts non-string content as 100 chars and skips empty entries', () => {
    const lines = [
      JSON.stringify({ source: 'USER_EXPLICIT', content: { nested: true }, created_at: '2026-09-01T10:00:00Z' }),
      JSON.stringify({ source: 'MODEL', content: '', created_at: '2026-09-01T10:00:01Z' }),
      modelResponse('real answer', '2026-09-01T10:00:02Z'),
    ]
    const events = parseAntigravityTranscript(lines)
    assert.equal(events.length, 2)
    assert.equal(events[0].input_tokens, Math.max(1, Math.round(100 / 3.5)))
    assert.equal(events[1].output_tokens, Math.max(1, Math.round(11 / 3.5)))
  })

  it('carries the previous timestamp for entries without created_at', () => {
    const lines = [
      userExplicit('with time', '2026-09-01T10:00:00Z'),
      JSON.stringify({ source: 'MODEL', content: 'no time here' }),
    ]
    const events = parseAntigravityTranscript(lines)
    assert.equal(events[1].timestamp, events[0].timestamp)
  })

  it('returns an empty list for a transcript without usage-bearing entries', () => {
    const lines = [JSON.stringify({ source: 'TOOL', content: 'tool output' })]
    assert.deepEqual(parseAntigravityTranscript(lines), [])
  })
})
