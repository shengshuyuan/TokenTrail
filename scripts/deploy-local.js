#!/usr/bin/env node
/**
 * 本地增量部署：把项目源码同步到 LaunchAgent 运行副本并重启服务。
 *
 * 为什么不直接用 `npm run daemon-install`：
 * install-service 会 `rm -rf` 运行副本再 `npm install --rebuild`，
 * 网络或原生模块一出问题，服务就起不来，而且每次都要重装依赖。
 * 这个脚本只做三件事：rsync 源码 → 按需 build → kickstart，不删任何目录。
 *
 * 用法:
 *   npm run deploy              源码有更新才 build
 *   npm run deploy -- --force   强制重新 build
 *   npm run deploy -- --no-restart  只同步和构建，不重启服务
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const RUNTIME_ROOT = path.join(os.homedir(), '.tokentrail', 'runtime', 'TokenTrail')
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'token-trail.db')
const HEALTH_URL = 'http://127.0.0.1:3820/api/health'

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const noBuild = argv.includes('--no-build')
const noRestart = argv.includes('--no-restart')

const EXCLUDES = [
  'node_modules', '.next', '.git', '.omx', '.playwright-cli',
  'data/*.db', 'data/*.db-shm', 'data/*.db-wal',
]

function log(msg) {
  console.log(msg)
}

function fail(msg, code = 1) {
  console.error(`  ✗ ${msg}`)
  process.exit(code)
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options })
  if (result.error) fail(`${cmd} 启动失败: ${result.error.message}`)
  if (result.status !== 0) fail(`${cmd} ${args.join(' ')} 退出码 ${result.status}`)
  return result
}

function findServerLabel() {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents')
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  const hit = names.find((name) => /tokentrail/i.test(name) && /server/i.test(name) && name.endsWith('.plist'))
  return hit ? hit.slice(0, -'.plist'.length) : null
}

/** 源码是否比上次构建新 */
function sourcesNewerThanBuild() {
  const buildId = path.join(RUNTIME_ROOT, '.next', 'BUILD_ID')
  if (!fs.existsSync(buildId)) return true
  const buildTime = fs.statSync(buildId).mtimeMs
  const roots = ['src', 'bin', 'scripts', 'packages']
  const exts = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.css'])
  const stack = roots.map((dir) => path.join(PROJECT_ROOT, dir)).filter((dir) => fs.existsSync(dir))
  while (stack.length > 0) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!exts.has(path.extname(entry.name))) continue
      if (fs.statSync(full).mtimeMs > buildTime) return true
    }
  }
  const extra = ['package.json', 'next.config.js', 'tailwind.config.ts', 'postcss.config.js']
  return extra.some((name) => {
    const file = path.join(PROJECT_ROOT, name)
    return fs.existsSync(file) && fs.statSync(file).mtimeMs > buildTime
  })
}

async function waitHealthy(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL, { cache: 'no-store' })
      if (res.ok) return await res.json()
    } catch {
      // 服务正在重启
    }
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
  return null
}

async function main() {
  if (process.platform !== 'darwin') {
    fail('本地部署只支持 macOS LaunchAgent')
  }
  if (!fs.existsSync(RUNTIME_ROOT)) {
    fail(`运行副本不存在: ${RUNTIME_ROOT}\n    先跑一次 npm run daemon-install 建立副本，之后都可以用 npm run deploy`)
  }
  if (!fs.existsSync(DB_PATH)) {
    log(`  ! 没找到数据库 ${DB_PATH}，服务会自己创建`)
  }

  log('')
  log(`  项目目录  ${PROJECT_ROOT}`)
  log(`  运行副本  ${RUNTIME_ROOT}`)
  log('')

  log('  1/4  同步源码（不删 node_modules / .next / 数据）')
  const rsyncArgs = ['-a', '--itemize-changes']
  for (const pattern of EXCLUDES) rsyncArgs.push('--exclude', pattern)
  rsyncArgs.push(`${PROJECT_ROOT}/`, `${RUNTIME_ROOT}/`)
  const synced = spawnSync('rsync', rsyncArgs, { encoding: 'utf8' })
  if (synced.status !== 0) fail(`rsync 失败: ${synced.stderr || synced.status}`)
  const changed = (synced.stdout || '').split('\n').filter((line) => line.startsWith('>f')).length
  log(`        ${changed} 个文件有变化`)

  const needBuild = force || sourcesNewerThanBuild()
  log('  2/4  构建生产版本')
  if (noBuild) {
    log('        --no-build，跳过')
  } else if (!needBuild) {
    log('        源码没有比上次构建更新，跳过（--force 可强制）')
  } else {
    const build = spawnSync('npm', ['run', 'build'], {
      cwd: RUNTIME_ROOT,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    })
    if (build.status !== 0) fail('构建失败，服务未被重启，仍在跑旧构建')
    log('        构建完成')
  }

  log('  3/4  重启常驻服务')
  const label = findServerLabel()
  if (noRestart) {
    log('        --no-restart，跳过')
  } else if (!label) {
    log('        没找到 tokentrail server 的 LaunchAgent，跳过重启')
  } else {
    const target = `gui/${process.getuid()}/${label}`
    run('launchctl', ['kickstart', '-k', target])
    const health = await waitHealthy()
    if (!health) fail('服务重启后 30 秒内没有响应，检查 ~/.tokentrail/logs')
    log(`        ${label} 已重启，版本 ${health.version}，记录 ${health.records} 条`)
  }

  log('  4/4  校验数据接口')
  try {
    const quotas = await (await fetch('http://127.0.0.1:3820/api/quotas', { cache: 'no-store' })).json()
    const workbuddy = (quotas.providers || []).find((p) => p.provider === 'workbuddy')
    if (workbuddy) {
      const windows = workbuddy.windows.map((w) => `${w.id}=${w.used}`).join(' ')
      const wallet = workbuddy.wallets?.[0]
      log(`        workbuddy: ${windows}${wallet ? ` | 余额 ${wallet.balance} ${wallet.currency}` : ''}`)
    } else {
      log(`        额度中心返回 ${(quotas.providers || []).length} 个 provider，暂时没有 workbuddy`)
    }
  } catch (err) {
    log(`        ! 额度接口读取失败: ${err.message}`)
  }

  log('')
  log('  ✓ 部署完成')
  log('')
}

main().catch((err) => fail(err && err.message ? err.message : String(err)))
