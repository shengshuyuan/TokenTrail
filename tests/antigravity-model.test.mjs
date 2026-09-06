import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

function detectAntigravityModel(lines) {
  let detectedModel = null

  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      // Only check user messages or system messages, ignore tool output
      if (entry.source !== 'MODEL' || entry.type === 'USER_INPUT') {
        const content = typeof entry.content === 'string' ? entry.content : ''
        const settingMatch = content.match(/Model Selection[^\n]*?to\s+Gemini\s+([\d.]+)\s+(Flash|Pro)/i)
        if (settingMatch) {
          detectedModel = `gemini-${settingMatch[1]}-${settingMatch[2].toLowerCase()}`
        }
      }
    } catch {}
  }

  if (detectedModel) return detectedModel

  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      if (entry.source !== 'MODEL' || entry.type === 'USER_INPUT') {
        const content = typeof entry.content === 'string' ? entry.content : ''
        const anyGeminiMatch = content.match(/Gemini\s+([\d.]+)\s+(Flash|Pro)/i)
        if (anyGeminiMatch) {
          return `gemini-${anyGeminiMatch[1]}-${anyGeminiMatch[2].toLowerCase()}`
        }
      }
    } catch {}
  }

  return 'gemini-3.8-flash'
}

function normalizeModelName(raw) {
  const lower = raw.toLowerCase().trim()
  const geminiMatch = lower.match(/^gemini[\s-]+([\d.]+)\s+(flash|pro)(?:\s*\([^)]*\))?$/)
  if (geminiMatch) {
    return `gemini-${geminiMatch[1]}-${geminiMatch[2]}`
  }
  return lower
}

describe('Antigravity model detection and reporting', () => {
  it('detects Gemini 3.8 Flash from USER_SETTINGS_CHANGE', () => {
    const lines = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        content: '<USER_REQUEST>\nfix styling\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.8 Flash (High).\n</USER_SETTINGS_CHANGE>',
      }),
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        content: 'Analyzing...',
      }),
    ]
    assert.equal(detectAntigravityModel(lines), 'gemini-3.8-flash')
  })

  it('detects Gemini 3.7 Flash from USER_SETTINGS_CHANGE', () => {
    const lines = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        content: '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.7 Flash (Medium).\n</USER_SETTINGS_CHANGE>',
      }),
    ]
    assert.equal(detectAntigravityModel(lines), 'gemini-3.7-flash')
  })

  it('picks the latest model when setting changes mid-conversation', () => {
    const lines = [
      JSON.stringify({
        step_index: 0,
        content: '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.7 Flash (Medium).\n</USER_SETTINGS_CHANGE>',
      }),
      JSON.stringify({
        step_index: 50,
        content: '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from Gemini 3.7 Flash (Medium) to Gemini 3.8 Flash (High).\n</USER_SETTINGS_CHANGE>',
      }),
    ]
    assert.equal(detectAntigravityModel(lines), 'gemini-3.8-flash')
  })

  it('detects Gemini 3.6 Flash from historical settings', () => {
    const lines = [
      JSON.stringify({
        step_index: 0,
        content: '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.6 Flash (High).\n</USER_SETTINGS_CHANGE>',
      }),
    ]
    assert.equal(detectAntigravityModel(lines), 'gemini-3.6-flash')
  })

  it('falls back to transcript model mentions if settings change tag is absent', () => {
    const lines = [
      JSON.stringify({
        step_index: 0,
        content: 'You are Gemini 3.7 Flash built by Google',
      }),
    ]
    assert.equal(detectAntigravityModel(lines), 'gemini-3.7-flash')
  })

  it('defaults to gemini-3.8-flash when no model is found in transcript', () => {
    const lines = [
      JSON.stringify({
        step_index: 0,
        content: 'Hello world',
      }),
    ]
    assert.equal(detectAntigravityModel(lines), 'gemini-3.8-flash')
  })

  it('normalizes various Gemini 3.7 and 3.8 flash naming formats', () => {
    assert.equal(normalizeModelName('Gemini 3.8 Flash (High)'), 'gemini-3.8-flash')
    assert.equal(normalizeModelName('gemini 3.8 flash'), 'gemini-3.8-flash')
    assert.equal(normalizeModelName('gemini-3.8-flash'), 'gemini-3.8-flash')
    assert.equal(normalizeModelName('Gemini 3.7 Flash (Medium)'), 'gemini-3.7-flash')
    assert.equal(normalizeModelName('gemini 3.7 flash (low)'), 'gemini-3.7-flash')
    assert.equal(normalizeModelName('gemini-3.7-flash'), 'gemini-3.7-flash')
    assert.equal(normalizeModelName('Gemini 3.8 Pro'), 'gemini-3.8-pro')
    assert.equal(normalizeModelName('Gemini 3.7 Pro'), 'gemini-3.7-pro')
  })
})
