#!/usr/bin/env node

/**
 * 账号额度中心 UI 验收脚本
 *
 * 用 Playwright（系统 Chrome）驱动真实页面：
 * - 状态矩阵：全部正常 / 82% 黄色 / 95%+ 红色 / 耗尽 / 不支持 / 未登录 / 服务未运行 / 过期 / 首次加载
 * - 无障碍：role=dialog、焦点锁定、Escape、遮罩关闭、焦点归还
 * - 移动端 390px：底部抽屉、无横向溢出、触控高度
 * - 刷新：loading 保留旧数据、节流提示
 *
 * 用法：先启动服务（默认 http://localhost:3821），再 node scripts/ui-verify-quotas.mjs
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.QUOTA_VERIFY_URL || 'http://localhost:3821'
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

function response(providers, { status = 'healthy', attention = 0, fetchedAt = Date.now() } = {}) {
  return {
    status,
    attention_count: attention,
    providers,
    updated_at: fetchedAt,
    refreshing: false,
  }
}

const MIXED = response([
  provider('codex', 'healthy', {
    planLabel: 'plus',
    windows: [
      win('primary', '5h', 23, { windowMinutes: 300, resetsAt: Date.now() + 2.3 * 3600_000 }),
      win('secondary', 'week', 25, { windowMinutes: 10080, resetsAt: Date.now() + 5.5 * 86400_000 }),
    ],
    source: 'local_session',
  }),
  provider('gemini', 'unsupported', {
    error: { code: 'unsupported', safeMessage: 'no readable quota' },
  }),
  provider('grok', 'unsupported', {
    notices: ['subscription quota cannot be read automatically'],
    action: { label: 'usage', url: 'https://grok.com/settings', kind: 'open_url' },
    error: { code: 'unsupported', safeMessage: 'auto read unavailable' },
  }),
  provider('glm', 'not_configured', {
    error: { code: 'not_configured', safeMessage: 'not configured' },
  }),
  provider('kimi', 'not_configured', {
    error: { code: 'not_configured', safeMessage: 'not logged in or local service unavailable' },
  }),
])

const THRESHOLDS = response([
  provider('codex', 'exhausted', {
    windows: [win('primary', '5h', 100, { windowMinutes: 300, resetsAt: Date.now() + 1800_000 })],
    source: 'local_session',
  }),
  provider('gemini', 'critical', {
    windows: [win('m', 'gemini-pro', 96, { resetsAt: Date.now() + 3600_000 })],
    source: 'official_api',
  }),
  provider('glm', 'warning', {
    planLabel: 'GLM Coding Pro',
    windows: [win('tokens-5h', '5h', 82, { windowMinutes: 300, resetsAt: Date.now() + 2 * 3600_000 })],
    notices: ['mcp|120|400|30'],
    source: 'official_api',
  }),
  provider('grok', 'healthy', {
    product: 'mixed',
    windows: [win('monthly-postpaid', 'month', 42.5, { used: 42.5, limit: 100, unit: 'credit' })],
    wallets: [{ label: 'prepaid', balance: 200, currency: 'USD' }],
    source: 'official_api',
  }),
  provider('kimi', 'healthy', {
    windows: [win('kimi-300', '5h', 12, { used: 120, limit: 1000, windowMinutes: 300, resetsAt: Date.now() + 2 * 3600_000 })],
    wallets: [{ label: 'extra', balance: 15, currency: 'CNY', monthlyUsed: 15, monthlyLimit: 100 }],
    source: 'local_cli',
  }),
], { status: 'exhausted', attention: 3 })

const STALE = response([
  provider('codex', 'stale', {
    windows: [win('primary', '5h', 23, { windowMinutes: 300 })],
    source: 'local_session',
    stale: true,
    lastSuccessAt: Date.now() - 20 * 60_000,
  }),
  provider('gemini', 'loading'),
  provider('grok', 'loading'),
  provider('glm', 'loading'),
  provider('kimi', 'loading'),
], { status: 'stale', attention: 1, fetchedAt: Date.now() - 20 * 60_000 })

const ALL_LOADING = response(
  ['codex', 'gemini', 'grok', 'glm', 'kimi'].map((id) => provider(id, 'loading')),
  { status: 'not_configured', fetchedAt: null }
)

async function withRoute(page, payload, handler) {
  await page.route('**/api/quotas**', (route) =>
    route.fulfill({ json: payload })
  )
  try {
    await handler()
  } finally {
    await page.unroute('**/api/quotas**')
  }
}

async function openDialog(page) {
  await page.getByRole('button', { name: /账号额度|QUOTAS/ }).click()
  await page.waitForSelector('[role="dialog"]')
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(8000)

  // ─── 场景 1：混合真实状态 ─────────────────────────────────
  await withRoute(page, MIXED, async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    const trigger = page.getByRole('button', { name: /账号额度|QUOTAS/ })
    check('顶部入口存在且带 aria-haspopup', (await trigger.getAttribute('aria-haspopup')) === 'dialog')
    await trigger.click()
    const dialog = page.locator('[role="dialog"]')
    await dialog.waitFor()
    check('弹窗 role=dialog + aria-modal', (await dialog.getAttribute('aria-modal')) === 'true')
    check('五家 Provider 始终可见', (await dialog.locator('[data-provider]').count()) === 5)
    check('Codex 正常绿色', await dialog.locator('[data-provider="codex"] .text-status-success').count() > 0)
    check('Grok 显示“打开官方 Usage”入口', await dialog.getByRole('link', { name: /打开官方 Usage|Open official Usage/ }).count() === 1)
    check('Grok 不伪造订阅数据（无进度条）', (await dialog.locator('[data-provider="grok"] [role="progressbar"]').count()) === 0)
    check('Gemini 未配置灰色引导', (await dialog.locator('[data-provider="gemini"]').innerHTML()).includes('quota.error.gemini.unsupported') === false)
    await page.screenshot({ path: path.join(OUT_DIR, 'quota-desktop-mixed.png') })
    // Escape 关闭 + 焦点归还
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    check('Escape 关闭弹窗', (await page.locator('[role="dialog"]').count()) === 0)
    check('焦点归还到入口按钮', await trigger.evaluate((el) => el === document.activeElement))
  })

  // ─── 场景 2：阈值状态（黄/红/耗尽）────────────────────────
  await withRoute(page, THRESHOLDS, async () => {
    await openDialog(page)
    const dialog = page.locator('[role="dialog"]')
    await dialog.locator('[data-provider="glm"] [aria-valuenow="82"]').waitFor()
    check('GLM 82% 黄色警告', await dialog.locator('[data-provider="glm"] .text-status-warning').count() > 0)
    check('Gemini 96% 红色危险', await dialog.locator('[data-provider="gemini"] .text-status-danger').count() > 0)
    check('Codex 100% 额度已用完', (await dialog.locator('[data-provider="codex"]').innerText()).includes('额度已用完'))
    check('进度条提供 aria-valuenow', (await dialog.locator('[data-provider="glm"] [role="progressbar"]').getAttribute('aria-valuenow')) === '82')
    check('Kimi 加油包钱包渲染', (await dialog.locator('[data-provider="kimi"]').innerText()).includes('¥15'))
    await page.screenshot({ path: path.join(OUT_DIR, 'quota-desktop-thresholds.png') })

    // 焦点锁定：Tab 循环不逃出弹窗
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab')
    const insideFocus = await dialog.evaluate((el) => el.contains(document.activeElement))
    check('Tab 焦点锁定在弹窗内', insideFocus)
    await page.locator('[role="dialog"]').getByRole('button', { name: /关闭额度弹窗|Close quota dialog/ }).click()
    await page.waitForTimeout(150)
    check('点击关闭按钮后弹窗消失', (await page.locator('[role="dialog"]').count()) === 0)
  })

  // ─── 场景 3：过期数据不伪装实时 ───────────────────────────
  await withRoute(page, STALE, async () => {
    await openDialog(page)
    const dialog = page.locator('[role="dialog"]')
    check('过期标记“可能已过期”', (await dialog.locator('[data-provider="codex"]').innerText()).includes('可能已过期'))
    check('过期行不显示绿色正常', (await dialog.locator('[data-provider="codex"] .text-status-success').count()) === 0)
    await page.screenshot({ path: path.join(OUT_DIR, 'quota-desktop-stale.png') })
    await page.keyboard.press('Escape')
  })

  // ─── 场景 4：首次无缓存（骨架屏）─────────────────────────
  await withRoute(page, ALL_LOADING, async () => {
    await openDialog(page)
    const dialog = page.locator('[role="dialog"]')
    check('首次无缓存显示骨架屏', (await dialog.locator('.animate-pulse').count()) >= 5)
    await page.screenshot({ path: path.join(OUT_DIR, 'quota-desktop-loading.png') })
    await page.keyboard.press('Escape')
  })

  // ─── 场景 5：移动端 390px 底部抽屉 ────────────────────────
  await withRoute(page, THRESHOLDS, async () => {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
    mobile.setDefaultTimeout(8000)
    await mobile.route('**/api/quotas**', (route) => route.fulfill({ json: THRESHOLDS }))
    await mobile.goto(BASE_URL, { waitUntil: 'networkidle' })
    await mobile.getByRole('button', { name: /账号额度|QUOTAS/ }).click()
    await mobile.locator('[role="dialog"]').waitFor()
    const dialog = mobile.locator('[role="dialog"]')
    const overflow = await dialog.evaluate((el) => document.documentElement.scrollWidth > window.innerWidth + 1)
    check('390px 无横向溢出', !overflow)
    const refreshBox = await dialog.getByRole('button', { name: /刷新|REFRESH/ }).boundingBox()
    check('移动端刷新按钮触控高度 ≥44px', (refreshBox?.height ?? 0) >= 44, `height=${refreshBox?.height}`)
    await mobile.screenshot({ path: path.join(OUT_DIR, 'quota-mobile-thresholds.png') })
    // 遮罩点击关闭
    await mobile.mouse.click(10, 60)
    await mobile.waitForTimeout(200)
    check('移动端点击遮罩关闭', (await mobile.locator('[role="dialog"]').count()) === 0)
    await mobile.close()
  })

  // ─── 场景 6：手动刷新（保留旧数据 + 节流提示）────────────
  {
    let refreshCount = 0
    await page.route('**/api/quotas', (route) => route.fulfill({ json: MIXED }))
    await page.route('**/api/quotas/refresh', async (route) => {
      refreshCount += 1
      if (refreshCount >= 2) {
        await new Promise((r) => setTimeout(r, 400)) // 验证等待期间旧数据仍在
      }
      route.fulfill({ json: { ...THRESHOLDS, throttled: refreshCount >= 2 } })
    })
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await openDialog(page)
    const dialog = page.locator('[role="dialog"]')
    await dialog.getByRole('button', { name: /^刷新$|^REFRESH$/ }).click()
    await page.waitForTimeout(600)
    check('刷新响应后更新数据', (await dialog.innerText()).includes('额度已用完'))
    await dialog.getByRole('button', { name: /^刷新$|^REFRESH$/ }).click()
    check('刷新等待期间保留旧数据', (await dialog.locator('[data-provider="codex"]').count()) === 1)
    await page.waitForTimeout(700)
    check('节流时显示提示', (await dialog.innerText()).includes('刚刚刷新过'))
    await page.unroute('**/api/quotas**')
    await page.unroute('**/api/quotas/refresh')
  }

  await browser.close()

  console.log(failures === 0 ? '\n全部 UI 验收通过 ✓' : `\n${failures} 项验收失败 ✗`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((err) => {
  console.error('验收脚本异常:', err)
  process.exit(1)
})
