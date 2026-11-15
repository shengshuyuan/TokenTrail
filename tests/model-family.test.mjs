import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { modelFamily } from '../src/lib/format.ts'

/**
 * 用量页「按模型 · 合并变体」用的家族归并规则（src/lib/format.ts modelFamily）。
 * 只合并力度 / 速度变体、大小写和 provider 前缀；flash / mini / pro 等档位保持独立。
 */
describe('modelFamily', () => {
  it('strips effort / speed suffixes and normalises split version numbers', () => {
    assert.equal(modelFamily('claude-opus-5-5-medium-fast'), 'claude-opus-5.5')
    assert.equal(modelFamily('claude-opus-5-5-medium'), 'claude-opus-5.5')
    assert.equal(modelFamily('claude-opus-5-5-high-fast'), 'claude-opus-5.5')
    assert.equal(modelFamily('claude-opus-5.5'), 'claude-opus-5.5')
    assert.equal(modelFamily('claude-fable-5-1-thinking-high'), 'claude-fable-5.1')
    assert.equal(modelFamily('claude-opus-4-7-thinking-high'), 'claude-opus-4.7')
    assert.equal(modelFamily('grok-4.7-high'), 'grok-4.7')
    assert.equal(modelFamily('grok-4.7-build-fast'), 'grok-4.7-build')
    assert.equal(modelFamily('cursor-grok-4.5-high-fast'), 'cursor-grok-4.5')
    assert.equal(modelFamily('minimax-m2.7-highspeed'), 'minimax-m2.7')
  })

  it('merges case and provider prefixes (known issue #12)', () => {
    assert.equal(modelFamily('GLM-5.3-Flash'), modelFamily('glm-5.3-flash'))
    assert.equal(modelFamily('MiniMax-M2.7-highspeed'), 'minimax-m2.7')
    assert.equal(modelFamily('kimi-code/k3'), 'k3')
    assert.equal(modelFamily('anthropic/claude-sonnet-4'), 'claude-sonnet-4')
  })

  it('keeps tier words that denote a different model', () => {
    assert.equal(modelFamily('glm-5.3-flash'), 'glm-5.3-flash')
    assert.equal(modelFamily('gpt-5.4-mini'), 'gpt-5.4-mini')
    assert.equal(modelFamily('deepseek-v4-pro'), 'deepseek-v4-pro')
    assert.equal(modelFamily('glm-5-turbo'), 'glm-5-turbo')
    assert.equal(modelFamily('gpt-5.6-sol'), 'gpt-5.6-sol')
    assert.equal(modelFamily('grok-bot-default'), 'grok-bot-default')
  })

  it('leaves odd names alone', () => {
    assert.equal(modelFamily('custom-local:TM ·DeepSeek-V4.1'), 'custom-local:tm ·deepseek-v4.1')
    assert.equal(modelFamily('auto'), 'auto')
    assert.equal(modelFamily(''), '')
    assert.equal(modelFamily('fast'), 'fast')
  })
})
