#!/usr/bin/env node

/**
 * 账号额度页面 UI 验收脚本。
 *
 * 用法：先启动服务（默认 http://127.0.0.1:3821），再运行：
 *   node scripts/ui-verify-quotas.mjs
 *
 * 所有额度接口都由 Playwright mock，不触发真实刷新。
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.QUOTA_VERIFY_URL || 'http://127.0.0.1:3821'
const OUT_DIR = path.join(process.cwd(), 'output')
fs.mkdirSync(OUT_DIR, { recursive: true })

let failures = 0
function check(name, condition, detail = '') {
  const ok = Boolean(condition)
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function win(id, label, percent, extra = {}) {
  return { id, label, unit: 'request', usedPercent: percent, ...extra }
}

function provider(id, status, overrides = {}) {
  return {
    provider: id,
    product: 'subscription',
    status,
    windows: [],
    wallets: [],
    source: 'unavailable',
    stale: false,
    ...overrides,
  }
}

function response(providers, extra = {}) {
  return {
    status: extra.status || 'healthy',
    attention_count: extra.attention_count ?? providers.filter((p) => p.stale || p.error).length,
    providers,
    updated_at: extra.updated_at ?? Date.now(),
    refreshing: false,
    ...extra,
  }
}

const OLD_SUCCESS_AT = Date.now() - 20 * 60_000

const MIXED = response([
  provider('codex', 'healthy', {
    planLabel: 'plus',
    windows: [win('primary', '5h', 23, { windowMinutes: 300, resetsAt: Date.now() + 3600_000 })],
    source: 'local_session',
    lastSuccessAt: Date.now() - 90_000,
  }),
  provider('gemini', 'stale', {
    windows: [win('pro', 'pro', 41, { windowMinutes: 300 })],
    source: 'official_api',
    stale: true,
    lastSuccessAt: OLD_SUCCESS_AT,
    error: { code: 'timeout', safeMessage: 'provider request failed' },
  }),
  provider('grok', 'partial', {
    notices: ['subscription quota cannot be read automatically'],
    source: 'local_cli',
    lastSuccessAt: Date.now() - 2 * 60_000,
    error: { code: 'unsupported', safeMessage: 'auto read unavailable' },
  }),
  provider('glm', 'not_configured', {
    error: { code: 'not_configured', safeMessage: 'not configured' },
  }),
  provider('kimi', 'healthy', {
    windows: [win('kimi-300', '5h', 12, { used: 120, limit: 1000, windowMinutes: 300 })],
    source: 'manual',
    lastSuccessAt: Date.now() - 4 * 60_000,
  }),
], { status: 'stale', attention_count: 3 })

const REFRESH_PARTIAL = response([
  MIXED.providers[0],
  provider('gemini', 'healthy', {
    windows: [win('pro', 'pro', 29, { windowMinutes: 300 })],
    source: 'official_api',
    lastSuccessAt: Date.now(),
  }),
  provider('grok', 'stale', {
    source: 'local_cli',
    stale: true,
    lastSuccessAt: OLD_SUCCESS_AT,
    error: { code: 'network', safeMessage: 'provider request failed' },
  }),
  MIXED.providers[3],
  MIXED.providers[4],
], {
  status: 'stale',
  attention_count: 2,
  refresh: { succeeded: 3, failed: 1, stale: 1, total: 5 },
})

const THROTTLED = response(MIXED.providers, {
  status: 'stale',
  attention_count: 3,
  throttled: true,
  retryAfterMs: 12_000,
})

async function routeQuotas(page) {
  let refreshCount = 0
  await page.route('**/api/quotas/refresh', (route) => {
    refreshCount += 1
    route.fulfill({ json: refreshCount === 1 ? REFRESH_PARTIAL : THROTTLED })
  })
  await page.route('**/api/quotas', (route) => route.fulfill({ json: MIXED }))
  await page.route('**/api/stats**', (route) => route.fulfill({
    json: {
      total_tokens: 1000,
      total_cost: 0.02,
      request_count: 1,
      by_source: [{ source: 'codex', total_tokens: 1000, cost_usd: 0.02, count: 1 }],
      by_model: [{ model: 'gpt-5', total_tokens: 1000, cost_usd: 0.02, count: 1 }],
      daily: [{ date: '2026-10-01', tokens: 1000, cost: 0.02, count: 1 }],
      available_sources: ['codex'],
      available_models: ['gpt-5'],
    },
  }))
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(15000)
  page.setDefaultNavigationTimeout(20000)
  await routeQuotas(page)

  await page.goto(`${BASE_URL}/quotas`, { waitUntil: 'commit' })
  await page.locator('[data-provider="codex"]').waitFor()

  const geminiText = await page.locator('[data-provider="gemini"]').innerText()
  const grokText = await page.locator('[data-provider="grok"]').innerText()
  const kimiText = await page.locator('[data-provider="kimi"]').innerText()

  check('过期数据显示沿用旧值', geminiText.includes('可能已过期') || geminiText.includes('数据过期'))
  check('行内显示 source', geminiText.includes('来源 官方接口'))
  check('行内显示 lastSuccessAt', geminiText.includes('上次成功'))
  check('行内显示错误原因', geminiText.includes('读取超时'))
  check('partial 不显示成已连接', !grokText.includes('已连接'))
  check('manual 来源可见', kimiText.includes('来源 手动录入'))

  await page.getByRole('button', { name: /刷新额度/ }).click()
  await page.getByText(/刷新完成：3 家成功，1 家失败，1 家沿用旧值/).waitFor()
  check('刷新部分失败有摘要提示', await page.getByText(/刷新完成：3 家成功/).count() === 1)

  await page.getByRole('button', { name: /刷新额度/ }).click()
  await page.getByText(/约 12 秒后可再试/).waitFor()
  check('刷新频繁显示限制剩余时间', await page.getByText(/约 12 秒后可再试/).count() === 1)

  await page.getByRole('button', { name: /手动录入/ }).click()
  await page.getByRole('button', { name: /快捷手动录入/ }).click()
  const percentInputs = page.locator('input[type="number"]')
  check('手动录入不预填主窗口百分比', (await percentInputs.nth(0).inputValue()) === '')
  check('手动录入不预填周窗口百分比', (await percentInputs.nth(1).inputValue()) === '')
  check('手动录入明确 manual 来源', (await page.locator('[data-auth-provider]').innerText()).includes('manual'))

  await page.screenshot({ path: path.join(OUT_DIR, 'quota-page-refresh-states.png') })

  const home = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  home.setDefaultTimeout(15000)
  home.setDefaultNavigationTimeout(20000)
  await routeQuotas(home)
  await home.goto(BASE_URL, { waitUntil: 'commit' })
  await home.getByText('账号额度（预览）').waitFor()
  await home.getByText(/旧值/).waitFor()
  await home.getByText(/部分可读/).waitFor()
  const previewText = await home.locator('body').innerText()
  check('首页预览显示沿用旧值', previewText.includes('旧值'))
  check('首页预览 partial 不显示健康', previewText.includes('部分可读'))

  const authPage = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  authPage.setDefaultTimeout(15000)
  authPage.setDefaultNavigationTimeout(20000)
  await routeQuotas(authPage)
  let oauthStarts = 0
  let verifyCalls = 0
  let statusCalls = 0
  await authPage.route('**/api/quotas/auth**', (route) => {
    if (route.request().method() === 'GET') {
      statusCalls += 1
      return route.fulfill({ json: { provider: 'gemini', loggedIn: false, credentialUpdatedAt: 100, loginRevision: statusCalls < 2 ? 10 : 11 } })
    }
    const body = JSON.parse(route.request().postData() || '{}')
    if (body.method === 'oauth') {
      oauthStarts += 1
      return route.fulfill({ json: { pending: true, credentialUpdatedAt: 100, loginRevision: 10, message: '已打开终端' } })
    }
    verifyCalls += 1
    return route.fulfill({ status: 401, json: { error: '凭证已失效' } })
  })
  await authPage.goto(`${BASE_URL}/quotas`, { waitUntil: 'commit' })
  await authPage.getByRole('button', { name: /手动录入 \/ 提取/ }).click()
  await authPage.getByRole('button', { name: 'ANTIGRAVITY' }).click()
  await authPage.getByRole('button', { name: '打开终端并登录 Antigravity' }).click()
  await authPage.getByText(/凭证已失效；请检查终端登录结果/).waitFor()
  await authPage.waitForTimeout(2500)
  check('Antigravity 只发起一次终端登录', oauthStarts === 1)
  check('钥匙串登录事件后只校验一次且不再启动终端', verifyCalls === 1 && statusCalls === 2)

  await browser.close()
  console.log(failures === 0 ? '\n额度 UI 验收通过 ✓' : `\n${failures} 项验收失败 ✗`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
