#!/usr/bin/env node
/**
 * 校准 WorkBuddy 剩余积分余额。
 *
 * 背景：WorkBuddy 官方接口需要用户登录 token（存在加密 keyblob 里），
 * 桌面端拿不到，所以 TokenTrail 的余额是「你在官网看到多少就填多少」。
 *
 * 用法：
 *   npm run calibrate 8848.89
 *   npm run calibrate            # 不带参数 → 打印当前值
 *   npm run calibrate --help     # 显示帮助
 *
 * 校准后立即生效（不用重启服务）。建议每次官网数字明显变化时校准一次，
 * 否则面板显示的是「你最后一次确认的值」，不会自动变化。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { URL } = require('url')

const HEALTH_URL = 'http://127.0.0.1:3820/api/health'
const CONFIG_URL = 'http://127.0.0.1:3820/api/quotas/config'
const QUOTAS_URL = 'http://127.0.0.1:3820/api/quotas'
const OFFICIAL_URL = 'https://www.workbuddy.cn/profile/credits-usage'

function help() {
  console.log('')
  console.log('  用法: npm run calibrate <余额>')
  console.log('')
  console.log('  参数:')
  console.log('    <余额>      WorkBuddy 官网额度页显示的剩余积分，例如 8848.89')
  console.log('    (不带参数)  只显示当前已校准的值')
  console.log('')
  console.log('  示例:')
  console.log('    npm run calibrate 8848.89')
  console.log('    npm run calibrate          # 查看当前')
  console.log('')
  console.log(`  官方额度页: ${OFFICIAL_URL}`)
  console.log('')
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json()
}

async function main() {
  const arg = process.argv[2]

  if (arg === '--help' || arg === '-h') {
    help()
    return
  }

  // 1. 确认服务在线
  try {
    const health = await getJson(HEALTH_URL)
    console.log(`  ✓ 服务在线（${health.version}, ${health.records} 条记录）`)
  } catch (err) {
    console.error(`  ✗ TokenTrail 服务不可用: ${err.message}`)
    console.error('    请确认 npm run daemon-install 已执行，服务在 3820 端口运行')
    process.exit(1)
  }

  // 2. 无参数：显示当前值
  if (!arg) {
    const quotas = await getJson(QUOTAS_URL)
    const wb = (quotas.providers || []).find((p) => p.provider === 'workbuddy')
    if (!wb) {
      console.error('  ✗ 额度中心没找到 WorkBuddy 卡片')
      process.exit(1)
    }
    const wallet = wb.wallets && wb.wallets[0]
    if (wallet) {
      console.log(`  当前余额: ${wallet.balance} ${wallet.currency}`)
      console.log('')
      console.log(`  若要校准：npm run calibrate <官网显示的数字>`)
      console.log(`  官方额度页: ${OFFICIAL_URL}`)
    } else {
      console.log('  当前余额: (未校准)')
      console.log('  已消耗窗口:')
      for (const w of wb.windows) {
        console.log(`    ${w.id} ${w.used} ${w.unit}`)
      }
      console.log('')
      console.log(`  校准: npm run calibrate <官网显示的数字>`)
      console.log(`  官方额度页: ${OFFICIAL_URL}`)
    }
    return
  }

  // 3. 校准
  const balance = Number(arg)
  if (!Number.isFinite(balance) || balance < 0) {
    console.error(`  ✗ 余额必须是 ≥ 0 的数字，收到: "${arg}"`)
    process.exit(1)
  }

  const at = new Date().toISOString()
  const res = await fetch(CONFIG_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      WORKBUDDY_CREDITS_BALANCE: String(balance),
      WORKBUDDY_CREDITS_BALANCE_AT: at,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`  ✗ 校准失败: ${res.status} ${text}`)
    process.exit(1)
  }

  console.log(`  ✓ 余额已校准为 ${balance}`)
  console.log(`    校准时间: ${at}`)
  console.log('')

  // 4. 拉取最新快照做确认
  const quotas = await getJson(QUOTAS_URL)
  const wb = (quotas.providers || []).find((p) => p.provider === 'workbuddy')
  if (wb) {
    console.log('  当前 WorkBuddy 卡片:')
    for (const w of wb.windows) {
      console.log(`    ${w.id.padEnd(20)} ${w.used} ${w.unit}`)
    }
    const wallet = wb.wallets && wb.wallets[0]
    if (wallet) {
      console.log(`    ${'remaining'.padEnd(20)} ${wallet.balance} ${wallet.currency}`)
    }
  }
}

main().catch((err) => {
  console.error(`  ✗ ${err.message}`)
  process.exit(1)
})
