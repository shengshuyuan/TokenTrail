// ─── 账号额度中心 · Adapter 注册 ─────────────────────────────
// 汇总五个 Provider 的真实依赖（fs/home/env/fetch/now）。
// 服务端专用：凭证只在这里出现，且只存在于内存。

const codex = require('./codex.js')
const gemini = require('./gemini.js')
const grok = require('./grok.js')
const glm = require('./glm.js')
const kimi = require('./kimi.js')

const fs = require('fs')

function defaultDeps(overrides = {}) {
  return {
    fs,
    home: process.env.HOME || process.env.USER_HOME || '/tmp',
    env: process.env,
    now: () => Date.now(),
    fetchImpl: (...args) => fetch(...args),
    timeoutMs: 5500,
    ...overrides,
  }
}

function createAdapters(overrides = {}) {
  const deps = defaultDeps(overrides)
  return {
    deps,
    adapters: {
      codex: codex.fetchQuota,
      gemini: gemini.fetchQuota,
      grok: grok.fetchQuota,
      glm: glm.fetchQuota,
      kimi: kimi.fetchQuota,
    },
  }
}

module.exports = { createAdapters, defaultDeps }
