#!/usr/bin/env node

/**
 * TokenTrail 本机验收脚本
 *
 * 一次性检查所有关键组件：
 * - 服务可访问性
 * - API 健康检查
 * - LaunchAgent 加载状态
 * - 数据库可读
 * - 最近同步时间
 * - 备份目录
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const CONFIG_DIR = path.join(os.homedir(), '.tokentrail')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const BACKUP_DIR = path.join(CONFIG_DIR, 'backups')
const SYNC_STATUS_FILE = path.join(CONFIG_DIR, 'sync-status.json')
const DB_PATH = path.join(__dirname, '..', 'data', 'token-trail.db')
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents')
const SERVER_LABEL = 'com.shengshuyuan.tokentrail.server'
const SYNC_LABEL = 'com.shengshuyuan.tokentrail.sync'

const DEFAULT_SERVER_URL = 'http://localhost:3820'

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return { server_url: DEFAULT_SERVER_URL }
  }
}

function userLaunchctlTarget() {
  return `gui/${process.getuid()}`
}

function isLaunchAgentLoaded(label) {
  const result = spawnSync('launchctl', ['print', `${userLaunchctlTarget()}/${label}`], {
    encoding: 'utf-8',
    stdio: 'pipe',
  })
  return result.status === 0
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '无记录'
  const diffMs = Date.now() - timestamp
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

async function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(data) })
        } catch {
          resolve({ ok: false, status: res.statusCode, data: null })
        }
      })
    })
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, data: { error: err.message } })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, data: { error: '请求超时' } })
    })
  })
}

async function main() {
  const config = loadConfig()
  const serverUrl = config.server_url || DEFAULT_SERVER_URL
  const checks = []
  let allPassed = true

  function check(label, ok, detail) {
    checks.push({ label, ok, detail })
    if (!ok) allPassed = false
  }

  console.log('')
  console.log('  TokenTrail 本机验收')
  console.log('  ══════════════════')
  console.log('')

  // 1. 服务可访问
  const healthRes = await httpGet(`${serverUrl}/api/health`)
  check('服务可访问', healthRes.ok, healthRes.ok ? `${serverUrl} ✓` : `${serverUrl} — ${healthRes.data?.error || '不可达'}`)

  // 2. API 健康检查
  if (healthRes.ok) {
    const h = healthRes.data
    check('数据库可读', h.records > 0, `${h.records} 条记录，${h.models} 个模型，${h.sources} 个来源`)
    if (h.date_range?.latest) {
      const latestTime = new Date(h.date_range.latest).getTime()
      const hoursAgo = Math.round((Date.now() - latestTime) / 3600000)
      const fresh = hoursAgo < 4
      check('最近数据', fresh, `${h.date_range.latest.slice(0, 16)}（${hoursAgo} 小时前）`)
    } else {
      check('最近数据', false, '无数据')
    }
  } else {
    check('数据库可读', false, '服务不可用，无法验证')
    check('最近数据', false, '服务不可用，无法验证')
  }

  // 3. LaunchAgent 状态
  const serverPlist = path.join(LAUNCH_AGENTS_DIR, `${SERVER_LABEL}.plist`)
  const syncPlist = path.join(LAUNCH_AGENTS_DIR, `${SYNC_LABEL}.plist`)

  const serverInstalled = fs.existsSync(serverPlist)
  const syncInstalled = fs.existsSync(syncPlist)
  check('常驻服务配置', serverInstalled, serverInstalled ? '已安装' : `未找到 ${serverPlist}`)

  if (serverInstalled) {
    const serverLoaded = isLaunchAgentLoaded(SERVER_LABEL)
    check('常驻服务加载', serverLoaded, serverLoaded ? '已加载运行中' : '未加载')
  }

  check('定时同步配置', syncInstalled, syncInstalled ? '已安装' : `未找到 ${syncPlist}`)

  if (syncInstalled) {
    const syncLoaded = isLaunchAgentLoaded(SYNC_LABEL)
    check('定时同步加载', syncLoaded, syncLoaded ? '已加载' : '未加载')
  }

  // 4. 同步状态
  if (fs.existsSync(SYNC_STATUS_FILE)) {
    try {
      const syncStatus = JSON.parse(fs.readFileSync(SYNC_STATUS_FILE, 'utf-8'))
      const lastSync = new Date(syncStatus.last_sync_at)
      const hoursAgo = Math.round((Date.now() - syncStatus.last_sync_at) / 3600000)
      const fresh = hoursAgo < 2
      check('最近同步', fresh, `${lastSync.toLocaleString('zh-CN')}（${hoursAgo} 小时前）${syncStatus.success ? ' ✓' : ' 有错误'}`)
    } catch {
      check('最近同步', false, 'sync-status.json 读取失败')
    }
  } else {
    check('最近同步', false, '无同步记录（从未同步或手动同步后无记录）')
  }

  // 5. 备份目录
  if (fs.existsSync(BACKUP_DIR)) {
    const backupFiles = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'))
    check('备份目录', backupFiles.length > 0, `${BACKUP_DIR}，${backupFiles.length} 个备份文件`)
  } else {
    check('备份目录', false, `${BACKUP_DIR} 不存在`)
  }

  // Print results
  for (const item of checks) {
    const icon = item.ok ? '✓' : '✗'
    console.log(`  ${icon} ${item.label.padEnd(10)} ${item.detail}`)
  }

  console.log('')
  if (allPassed) {
    console.log('  ✓ 全部验收通过')
  } else {
    console.log('  ✗ 有检查项未通过，请参考上方详情')
  }
  console.log('')

  process.exit(allPassed ? 0 : 1)
}

main().catch(err => {
  console.error(`  ✗ 验收脚本出错: ${err.message}`)
  process.exit(1)
})
