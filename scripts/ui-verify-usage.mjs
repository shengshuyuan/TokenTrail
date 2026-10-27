#!/usr/bin/env node

/**
 * 用量分析页 UI 验收脚本（数据正确性相关）。
 *
 * 用法：先用一份数据库副本启动服务，再运行：
 *   USAGE_VERIFY_URL=http://127.0.0.1:3830 node scripts/ui-verify-usage.mjs
 *
 * 检查项：
 * 1. 筛选竞争：7 天的慢响应不能覆盖之后选中的 90 天
 * 2. 汇总请求失败时显示错误与「重试」，而不是空数据
 * 3. 明细默认只看实测（kind=measured），可切换到估算
 * 4. 手机宽度截图（输出到 output/）
 *
 * /api/stats 由 Playwright 改写返回值，不修改数据库。
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.USAGE_VERIFY_URL || 'http://127.0.0.1:3830'
const OUT_DIR = path.join(process.cwd(), 'output')
fs.mkdirSync(OUT_DIR, { recursive: true })

let failures = 0
function check(name, condition, detail = '') {
  const ok = Boolean(condition)
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(15000)

  const usageRequests = []
  page.on('request', (req) => {
    if (req.url().includes('/api/usage?')) usageRequests.push(req.url())
  })

  // Never let the verify run read real provider quotas.
  await page.route('**/api/quotas**', (route) => route.fulfill({
    json: {
      status: 'healthy',
      attention_count: 0,
      updated_at: Date.now(),
      refreshing: false,
      providers: [{ provider: 'codex', status: 'healthy', windows: [], wallets: [], source: 'local_session', stale: false }],
    },
  }))

  let failDays30 = true
  await page.route('**/api/stats?*', async (route) => {
    const url = new URL(route.request().url())
    const days = url.searchParams.get('days')
    if (days === '30' && failDays30) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false,"error":"boom"}' })
      return
    }
    const response = await route.fetch()
    const body = await response.json()
    // Distinct markers so the page shows which response won.
    if (days === '7') {
      await sleep(2500)
      body.total_tokens = 7_000_000
    }
    if (days === '90') body.total_tokens = 90_000_000
    await route.fulfill({ response, json: body })
  })

  const metric = () => page.locator('text=当前消耗').locator('xpath=following-sibling::div[1]').innerText()

  // 1. Race: the slow 7-day response arrives after 90 days was selected.
  await page.goto(`${BASE_URL}/usage?days=7`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('radio', { name: '90天' }).first().click()
  await sleep(4000)
  const shown = await metric()
  check('慢的 7 天响应没有覆盖 90 天结果', shown.includes('90'), `显示「${shown}」，地址 ${page.url()}`)
  check('地址栏保持 90 天', page.url().includes('days=90'))

  // 2. Error feedback with retry.
  await page.getByRole('radio', { name: '30天' }).first().click()
  await page.getByText('汇总加载失败').waitFor({ timeout: 5000 }).catch(() => {})
  const bannerVisible = await page.getByText('汇总加载失败').isVisible().catch(() => false)
  check('汇总失败时显示错误提示', bannerVisible)
  failDays30 = false
  await page.getByRole('button', { name: '重试' }).first().click()
  await sleep(1500)
  check('重试成功后错误提示消失', !(await page.getByText('汇总加载失败').isVisible().catch(() => false)))

  // 3. Records default to measured; switch to estimated.
  check('明细默认请求 kind=measured', usageRequests.some((u) => u.includes('kind=measured')))
  await page.getByRole('radio', { name: '估算', exact: true }).first().click()
  await sleep(1500)
  check('切换后请求 kind=estimated', usageRequests.some((u) => u.includes('kind=estimated')))
  await page.screenshot({ path: path.join(OUT_DIR, 'usage-desktop.png'), fullPage: true })

  // 4. Mobile screenshots.
  await page.setViewportSize({ width: 390, height: 844 })
  for (const route of ['usage', 'connections', 'quotas', '']) {
    await page.goto(`${BASE_URL}/${route}`, { waitUntil: 'domcontentloaded' })
    await sleep(3500)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(`手机宽度 /${route} 无横向溢出`, overflow <= 1, `溢出 ${overflow}px`)
    await page.screenshot({ path: path.join(OUT_DIR, `mobile-${route || 'overview'}.png`), fullPage: true })
  }

  await browser.close()
  console.log(failures ? `\n${failures} 项未通过` : '\n全部通过')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
