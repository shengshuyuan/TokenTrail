import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseTraeHistoryFile, stripHtmlTags, estimateTextTokens } from '../src/lib/traework.js'

function makeTempFile(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokentrail-trae-'))
  const filePath = path.join(dir, 'chat_histories.json')
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8')
  return { dir, filePath }
}

describe('traework history parser', () => {
  it('strips html tags from Trae rich text content', () => {
    assert.equal(
      stripHtmlTags("<span class='command'>/test</span><span class='text'> hello</span>"),
      '/test hello'
    )
  })

  it('estimates tokens for mixed Chinese and code text', () => {
    const text = '帮我给这个函数写测试 function sum(a, b) { return a + b }'
    assert.ok(estimateTextTokens(text) > 0)
  })

  it('parses chat history turns into traework usage records', () => {
    const payload = [
      {
        chatId: 'chat-1',
        timestamp: 1718000000000,
        turns: [
          {
            sessionId: 'session-1',
            userContent: "<span class='text'>帮我修复这个 bug</span>",
            systemContent: '我已经定位问题并给出修复建议。',
            reasoningContent: '先检查输入，再处理边界条件。',
            selectedModel: 'seed_m8',
            status: 'success',
          },
        ],
      },
    ]

    const { dir, filePath } = makeTempFile(payload)
    try {
      const records = parseTraeHistoryFile(filePath)
      assert.equal(records.length, 1)
      assert.equal(records[0].source, 'traework')
      assert.equal(records[0].model, 'seed_m8')
      assert.equal(records[0].project, 'trae-chat')
      assert.ok(records[0].input_tokens > 0)
      assert.ok(records[0].output_tokens > 0)
      assert.match(records[0].request_id, /^traework:/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips turns without model or without useful content', () => {
    const payload = [
      {
        chatId: 'chat-2',
        timestamp: 1718000000000,
        turns: [
          {
            sessionId: 'session-empty',
            userContent: '',
            systemContent: '',
            selectedModel: 'seed_m8',
          },
          {
            sessionId: 'session-no-model',
            userContent: 'hello',
            systemContent: 'world',
          },
        ],
      },
    ]

    const { dir, filePath } = makeTempFile(payload)
    try {
      const records = parseTraeHistoryFile(filePath)
      assert.equal(records.length, 0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
