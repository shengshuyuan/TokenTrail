#!/usr/bin/env node

/**
 * TokenTrail CLI — AI 编程工具 token 用量统计客户端
 *
 * 用法:
 *   tokentrail setup            初始化配置
 *   tokentrail status           查看服务器状态和数据统计
 *   tokentrail sync             同步所有数据源（本地文件 + 可选 VibeCafé）
 *   tokentrail report           上报当前会话用量
 *   tokentrail health           健康检查
 *   tokentrail doctor           本机服务诊断
 *   tokentrail open             打开 Dashboard
 *   tokentrail restart          重启 LaunchAgent 常驻服务
 *   tokentrail backup           备份 SQLite 数据库
 *   tokentrail install-service  安装本机常驻服务 + 每 4 小时定时同步
 *   tokentrail daemon install   install-service 的别名
 *   tokentrail daemon status    doctor 的别名
 *   tokentrail daemon restart   restart 的别名
 *   tokentrail daemon uninstall uninstall-service 的别名
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync, spawnSync } = require('child_process')

// ─── 配置 ──────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..')
const DEFAULT_SERVER_URL = 'http://localhost:3820'
const CONFIG_DIR = path.join(os.homedir(), '.tokentrail')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const LOG_DIR = path.join(CONFIG_DIR, 'logs')
const BACKUP_DIR = path.join(CONFIG_DIR, 'backups')
const RUNTIME_ROOT = path.join(CONFIG_DIR, 'runtime', 'TokenTrail')
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents')
const USER = os.userInfo().username
const SERVER_LABEL = `com.${USER}.tokentrail.server`
const SYNC_LABEL = `com.${USER}.tokentrail.sync`
const SERVER_PLIST = path.join(LAUNCH_AGENTS_DIR, `${SERVER_LABEL}.plist`)
const SYNC_PLIST = path.join(LAUNCH_AGENTS_DIR, `${SYNC_LABEL}.plist`)
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'token-trail.db')

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return null
  }
}

function loadConfigOrDefault() {
  return loadConfig() || { server_url: DEFAULT_SERVER_URL }
}

function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

function ensureLocalDirs() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.mkdirSync(LOG_DIR, { recursive: true })
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true })
}

function formatDateForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ─── HTTP 工具 ─────────────────────────────────────────────────

async function api(config, method, urlPath, body) {
  const url = `${config.server_url}${urlPath}`
  try {
    const opts = {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    }
    const res = await fetch(url, opts)
    const data = await res.json()
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    const message = err.message || String(err)
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return { ok: false, status: 0, data: { error: `无法连接到 ${config.server_url}，请确认 TokenTrail 服务已启动` } }
    }
    return { ok: false, status: 0, data: { error: message } }
  }
}

// ─── macOS LaunchAgent 工具 ────────────────────────────────────

function userLaunchctlTarget() {
  return `gui/${process.getuid()}`
}

function runLaunchctl(args, options = {}) {
  const result = spawnSync('launchctl', args, {
    encoding: 'utf-8',
    stdio: options.quiet ? 'pipe' : 'inherit',
  })
  return result
}

function isLaunchAgentLoaded(label) {
  const result = spawnSync('launchctl', ['print', `${userLaunchctlTarget()}/${label}`], {
    encoding: 'utf-8',
    stdio: 'pipe',
  })
  return result.status === 0
}

function writeLaunchAgent(file, label, command, options = {}) {
  const intervalXml = options.startInterval
    ? `  <key>StartInterval</key>\n  <integer>${options.startInterval}</integer>\n`
    : ''
  const keepAliveXml = options.keepAlive
    ? '  <key>KeepAlive</key>\n  <true/>\n'
    : ''
  const runAtLoadXml = options.runAtLoad === false
    ? ''
    : '  <key>RunAtLoad</key>\n  <true/>\n'

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  ${runAtLoadXml}${keepAliveXml}${intervalXml}  <key>WorkingDirectory</key>
  <string>${xmlEscape(options.workingDirectory || PROJECT_ROOT)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
  </array>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(LOG_DIR, `${label}.out.log`))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(LOG_DIR, `${label}.err.log`))}</string>
</dict>
</plist>
`
  fs.writeFileSync(file, plist)
}

function bootout(label) {
  runLaunchctl(['bootout', userLaunchctlTarget(), path.join(LAUNCH_AGENTS_DIR, `${label}.plist`)], { quiet: true })
}

function bootstrap(plistPath) {
  const result = runLaunchctl(['bootstrap', userLaunchctlTarget(), plistPath])
  if (result.status !== 0) {
    throw new Error(`LaunchAgent 加载失败: ${plistPath}`)
  }
}

function findServiceNodePath() {
  const candidates = [
    path.join(os.homedir(), '.nvm', 'versions', 'node', 'v20.20.2', 'bin', 'node'),
    process.execPath,
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || process.execPath
}

function runWithNodePath(nodePath, command, args, cwd) {
  const nodeDir = path.dirname(nodePath)
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${nodeDir}:${process.env.PATH || ''}`,
    },
  })
}

function prepareRuntimeCopy(nodePath) {
  fs.rmSync(RUNTIME_ROOT, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(RUNTIME_ROOT), { recursive: true })

  execFileSync('rsync', [
    '-a',
    '--exclude', 'node_modules',
    '--exclude', '.next',
    '--exclude', '.omx',
    '--exclude', '.playwright-cli',
    '--exclude', 'data/*.db',
    '--exclude', 'data/*.db-shm',
    '--exclude', 'data/*.db-wal',
    `${PROJECT_ROOT}/`,
    `${RUNTIME_ROOT}/`,
  ], { stdio: 'inherit' })

  runWithNodePath(nodePath, 'npm', ['install'], RUNTIME_ROOT)
  runWithNodePath(nodePath, 'npm', ['rebuild', 'better-sqlite3'], RUNTIME_ROOT)
}

// ─── 参数解析 ──────────────────────────────────────────────────

function parseFlags(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      const key = argv[i].slice(2)
      flags[key] = argv[++i]
    } else if (argv[i] === '-h' || argv[i] === '--help') {
      flags.help = true
    } else {
      positional.push(argv[i])
    }
  }
  return { flags, positional }
}

// ─── 命令 ──────────────────────────────────────────────────────

async function cmdSetup() {
  console.log('')
  console.log('  TokenTrail 配置向导')
  console.log('  ───────────────────')
  console.log('')

  const existing = loadConfig()
  if (existing) {
    console.log(`  当前配置:`)
    console.log(`    服务器地址: ${existing.server_url}`)
    console.log(`    VibeCafé:   ${existing.vibecafe_api_key ? '已配置' : '未配置'}`)
    console.log('')
  }

  const serverUrl = existing?.server_url || DEFAULT_SERVER_URL

  console.log(`  测试连接 ${serverUrl} ...`)
  const testResult = await api({ server_url: serverUrl }, 'GET', '/api/health')
  if (!testResult.ok) {
    console.log(`  ✗ 无法连接到 ${serverUrl}`)
    console.log('')
    console.log('  请先启动 TokenTrail 服务:')
    console.log('    cd TokenTrail && npm run dev')
    console.log('')
    process.exit(1)
  }
  console.log('  ✓ 服务器连接成功')

  const health = testResult.data
  console.log(`    记录数: ${health.records}  来源: ${health.sources}  模型: ${health.models}`)

  const config = {
    server_url: serverUrl,
    ...(existing?.vibecafe_api_key ? { vibecafe_api_key: existing.vibecafe_api_key } : {}),
  }

  saveConfig(config)

  console.log('')
  console.log('  ✓ 配置已保存到 ~/.tokentrail/config.json')
  console.log('')
  console.log('  下一步:')
  console.log('    tokentrail sync     — 同步数据')
  console.log('    tokentrail status   — 查看状态')
  console.log('')
}

async function cmdStatus() {
  const config = loadConfigOrDefault()

  const result = await api(config, 'GET', '/api/health')
  if (!result.ok) {
    console.log(`  ✗ 服务器不可用: ${result.data.error}`)
    process.exit(1)
  }

  const h = result.data
  const range = h.date_range || {}

  console.log('')
  console.log('  TokenTrail 状态')
  console.log('  ─────────────────')
  console.log(`  服务器:     ${config.server_url} ✓`)
  console.log(`  记录数:     ${h.records}`)
  console.log(`  数据来源:   ${h.sources} 个`)
  console.log(`  模型数量:   ${h.models} 个`)
  console.log(`  VibeCafé:   ${h.config?.vibecafe_api_key ? '已配置' : '未配置'}`)
  if (range.earliest) {
    const days = Math.ceil((Date.now() - new Date(range.earliest).getTime()) / 86400000)
    console.log(`  数据跨度:   ${days} 天 (${range.earliest.slice(0, 10)} ~ ${range.latest.slice(0, 10)})`)
  }
  console.log(`  Dashboard:  ${config.server_url}`)
  console.log('')
}

async function cmdSync() {
  const config = loadConfigOrDefault()

  console.log('  正在同步数据...')
  const result = await api(config, 'POST', '/api/sync', {
    ...(config.vibecafe_api_key ? { vibecafe_api_key: config.vibecafe_api_key } : {}),
  })

  if (!result.ok) {
    console.log(`  ✗ 同步失败: ${result.data.error}`)
    process.exit(1)
  }

  const data = result.data
  console.log('')
  console.log('  同步结果')
  console.log('  ────────')
  for (const r of data.results) {
    const status = r.errors > 0 ? '⚠' : '✓'
    const errors = r.errors > 0 ? `  错误 ${r.errors}` : ''
    console.log(`  ${status} ${r.source.padEnd(15)} 扫描 ${r.scanned}  新增 ${r.inserted}  重复 ${r.duplicates}${errors}`)
  }
  console.log('')
}

async function cmdReport(argv) {
  const config = loadConfig()
  if (!config) {
    console.log('  未配置，请先运行: tokentrail setup')
    process.exit(1)
  }

  const { flags } = parseFlags(argv)

  // --json 模式
  if (flags.json) {
    try {
      const payload = JSON.parse(flags.json)
      const result = await api(config, 'POST', '/api/report', payload)
      if (!result.ok) {
        console.log(`  ✗ 上报失败: ${result.data.error}`)
        process.exit(1)
      }
      console.log(`  ✓ 已上报: ${payload.model || result.data.model}  费用 $${result.data.cost_usd}  (ID: ${result.data.id})`)
      return
    } catch {
      console.log('  ✗ --json 参数格式错误')
      process.exit(1)
    }
  }

  const payload = {}
  if (flags.source) payload.source = flags.source
  if (flags.model) payload.model = flags.model
  if (flags.input) payload.input_tokens = parseInt(flags.input, 10)
  payload.output_tokens = flags.output ? parseInt(flags.output, 10) : 0
  if (flags.cached) payload.cached_input_tokens = parseInt(flags.cached, 10)
  if (flags.reasoning) payload.reasoning_tokens = parseInt(flags.reasoning, 10)
  if (flags['request-id']) payload.request_id = flags['request-id']

  if (!payload.source || !payload.model || !payload.input_tokens) {
    console.log('  用法: tokentrail report --source <来源> --model <模型> --input <输入token> [--output <输出token>]')
    console.log('')
    console.log('  示例:')
    console.log('    tokentrail report --source openclaw --model gpt-4.1 --input 5000 --output 1200')
    console.log('')
    process.exit(1)
  }

  const result = await api(config, 'POST', '/api/report', payload)
  if (!result.ok) {
    console.log(`  ✗ 上报失败: ${result.data.error}`)
    process.exit(1)
  }

  console.log(`  ✓ 已上报: ${payload.model}  费用 $${result.data.cost_usd}  (ID: ${result.data.id})`)
}

async function cmdHealth() {
  const config = loadConfigOrDefault()

  const result = await api(config, 'GET', '/api/health')
  if (!result.ok) {
    console.log('unhealthy')
    process.exit(1)
  }
  console.log('healthy')
}

async function cmdDoctor() {
  const config = loadConfigOrDefault()
  const issues = []
  const checks = []

  function check(label, ok, detail) {
    checks.push({ label, ok, detail })
    if (!ok) issues.push(label)
  }

  const health = await api(config, 'GET', '/api/health')
  check('服务连接', health.ok, health.ok ? `${config.server_url} 可用` : health.data.error)

  const configExists = fs.existsSync(CONFIG_FILE)
  check('CLI 配置', configExists, configExists ? CONFIG_FILE : `未创建，默认使用 ${DEFAULT_SERVER_URL}`)

  const serverInstalled = fs.existsSync(SERVER_PLIST)
  const syncInstalled = fs.existsSync(SYNC_PLIST)
  const runtimeInstalled = fs.existsSync(path.join(RUNTIME_ROOT, 'package.json'))
  check('常驻服务配置', serverInstalled, serverInstalled ? SERVER_PLIST : '未安装 LaunchAgent')
  check('定时同步配置', syncInstalled, syncInstalled ? SYNC_PLIST : '未安装 LaunchAgent')
  check('运行副本', runtimeInstalled, runtimeInstalled ? RUNTIME_ROOT : '未准备')

  const serverLoaded = serverInstalled && isLaunchAgentLoaded(SERVER_LABEL)
  const syncLoaded = syncInstalled && isLaunchAgentLoaded(SYNC_LABEL)
  check('常驻服务加载', serverLoaded, serverLoaded ? '已加载' : '未加载')
  check('定时同步加载', syncLoaded, syncLoaded ? '已加载' : '未加载')

  try {
    const Database = require('better-sqlite3')
    const dbExists = fs.existsSync(DB_PATH)
    check('数据库文件', dbExists, dbExists ? DB_PATH : '未找到 data/token-trail.db')

    if (dbExists) {
      const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
      const recordCount = db.prepare('SELECT COUNT(*) as count FROM usage_records').get().count
      const latest = db.prepare('SELECT MAX(timestamp) as latest FROM usage_records').get().latest
      const pricingCount = db.prepare('SELECT COUNT(*) as count FROM model_pricing').get().count
      db.close()
      check('用量记录', recordCount > 0, `${recordCount} 条，最近 ${formatRelativeTime(latest)}`)
      check('价格表', pricingCount > 0, `${pricingCount} 条`)
    }
  } catch (error) {
    check('数据库读取', false, error.message)
  }

  const backupCount = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter(name => name.endsWith('.db')).length
    : 0
  check('备份目录', fs.existsSync(BACKUP_DIR), fs.existsSync(BACKUP_DIR) ? `${BACKUP_DIR}，已有 ${backupCount} 个备份` : '未创建')

  console.log('')
  console.log('  TokenTrail Doctor')
  console.log('  ─────────────────')
  for (const item of checks) {
    console.log(`  ${item.ok ? '✓' : '✗'} ${item.label.padEnd(10)} ${item.detail}`)
  }
  console.log('')
  console.log(`  日志目录: ${LOG_DIR}`)
  console.log('')

  if (issues.length > 0) {
    console.log('  建议:')
    if (!serverInstalled || !syncInstalled || !serverLoaded || !syncLoaded) {
      console.log('    npm run install-service')
    }
    if (!health.ok && serverInstalled) {
      console.log('    npm run restart')
    }
    if (backupCount === 0 && fs.existsSync(DB_PATH)) {
      console.log('    npm run backup')
    }
    console.log('')
    process.exit(1)
  }
}

async function cmdOpen() {
  const config = loadConfigOrDefault()
  const result = spawnSync('open', [config.server_url], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`无法打开 ${config.server_url}`)
  }
  console.log(`  已打开 ${config.server_url}`)
}

async function cmdBackup() {
  ensureLocalDirs()
  if (!fs.existsSync(DB_PATH)) {
    console.log('  ✗ 未找到数据库: data/token-trail.db')
    process.exit(1)
  }

  const Database = require('better-sqlite3')
  const backupPath = path.join(BACKUP_DIR, `token-trail-${formatDateForFile()}.db`)
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
  await db.backup(backupPath)
  db.close()

  const sizeMb = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2)
  console.log('')
  console.log('  ✓ 数据库备份完成')
  console.log(`    文件: ${backupPath}`)
  console.log(`    大小: ${sizeMb} MB`)
  console.log('')
}

async function cmdInstallService(argv = []) {
  if (process.platform !== 'darwin') {
    console.log('  ✗ install-service 目前只支持 macOS LaunchAgent')
    process.exit(1)
  }

  const { flags } = parseFlags(argv)
  ensureLocalDirs()

  const existing = loadConfigOrDefault()
  saveConfig(existing)

  const nodePath = findServiceNodePath()

  console.log('')
  console.log(`  正在准备本机运行副本: ${RUNTIME_ROOT}`)
  prepareRuntimeCopy(nodePath)

  if (flags.build) {
    console.log('')
    console.log('  正在构建生产版本...')
    runWithNodePath(nodePath, 'npm', ['run', 'build'], RUNTIME_ROOT)
  }

  const serverCommand = `cd ${shellQuote(RUNTIME_ROOT)} && TOKENTRAIL_DB_PATH=${shellQuote(DB_PATH)} ${shellQuote(nodePath)} scripts/serve.js --dev`
  const syncCommand = `cd ${shellQuote(RUNTIME_ROOT)} && ${shellQuote(nodePath)} bin/tokentrail.js sync`

  writeLaunchAgent(SERVER_PLIST, SERVER_LABEL, serverCommand, { keepAlive: true, workingDirectory: RUNTIME_ROOT })
  writeLaunchAgent(SYNC_PLIST, SYNC_LABEL, syncCommand, { startInterval: 14400, workingDirectory: RUNTIME_ROOT })

  bootout(SERVER_LABEL)
  bootout(SYNC_LABEL)
  bootstrap(SERVER_PLIST)
  bootstrap(SYNC_PLIST)
  runLaunchctl(['kickstart', '-k', `${userLaunchctlTarget()}/${SERVER_LABEL}`])

  console.log('')
  console.log('  ✓ TokenTrail 常驻服务已安装')
  console.log(`    服务: ${SERVER_PLIST}`)
  console.log(`    同步: ${SYNC_PLIST}`)
  console.log(`    运行: ${RUNTIME_ROOT}`)
  console.log(`    日志: ${LOG_DIR}`)
  console.log('')
  console.log('  后续常用命令:')
  console.log('    tokentrail doctor')
  console.log('    tokentrail open')
  console.log('    tokentrail restart')
  console.log('    tokentrail backup')
  console.log('')
}

async function cmdUninstallService() {
  if (process.platform !== 'darwin') {
    console.log('  ✗ uninstall-service 目前只支持 macOS LaunchAgent')
    process.exit(1)
  }

  bootout(SERVER_LABEL)
  bootout(SYNC_LABEL)
  for (const file of [SERVER_PLIST, SYNC_PLIST]) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }

  console.log('')
  console.log('  ✓ TokenTrail 常驻服务已移除')
  console.log('  数据库、配置和备份已保留')
  console.log('')
}

async function cmdRestart() {
  if (process.platform !== 'darwin') {
    console.log('  ✗ restart 目前只支持 macOS LaunchAgent')
    process.exit(1)
  }

  if (!fs.existsSync(SERVER_PLIST)) {
    console.log('  ✗ 常驻服务尚未安装，请先运行: tokentrail install-service')
    process.exit(1)
  }

  if (!isLaunchAgentLoaded(SERVER_LABEL)) {
    bootstrap(SERVER_PLIST)
  }
  const result = runLaunchctl(['kickstart', '-k', `${userLaunchctlTarget()}/${SERVER_LABEL}`])
  if (result.status !== 0) {
    throw new Error('常驻服务重启失败')
  }
  console.log('  ✓ TokenTrail 常驻服务已重启')
}

function cmdHelp() {
  console.log('')
  console.log('  TokenTrail CLI — AI 编程工具 token 用量统计')
  console.log('')
  console.log('  用法: tokentrail <命令> [选项]')
  console.log('')
  console.log('  命令:')
  console.log('    setup              初始化配置（连接服务器）')
  console.log('    status             查看服务器状态和数据统计')
  console.log('    sync               同步所有数据源（本地文件 + 可选 VibeCafé）')
  console.log('    report [选项]      上报用量数据')
  console.log('    health             健康检查（返回 healthy/unhealthy）')
  console.log('    doctor             本机服务、数据库、同步配置诊断')
  console.log('    open               打开 Dashboard')
  console.log('    restart            重启 LaunchAgent 常驻服务')
  console.log('    backup             备份 SQLite 数据库')
  console.log('    install-service    安装常驻服务 + 每 4 小时自动同步')
  console.log('    uninstall-service  移除常驻服务（保留数据）')
  console.log('    daemon install     install-service 的别名')
  console.log('    daemon status      doctor 的别名')
  console.log('    daemon restart     restart 的别名')
  console.log('    daemon uninstall   uninstall-service 的别名')
  console.log('')
  console.log('  report 选项:')
  console.log('    --source <名称>    数据来源（如 openclaw、hermes）')
  console.log('    --model <ID>       模型 ID（如 gpt-4.1）')
  console.log('    --input <数量>     输入 token 数')
  console.log('    --output <数量>    输出 token 数（默认 0）')
  console.log('    --cached <数量>    缓存输入 token 数（默认 0）')
  console.log('    --reasoning <数量> 推理 token 数（默认 0）')
  console.log('    --request-id <ID>  请求唯一 ID（防重复）')
  console.log('    --json <JSON>      直接传 JSON 格式数据')
  console.log('')
  console.log('  示例:')
  console.log('    tokentrail setup')
  console.log('    tokentrail install-service')
  console.log('    tokentrail doctor')
  console.log('    tokentrail sync')
  console.log('    tokentrail report --source openclaw --model gpt-4.1 --input 5000 --output 1200')
  console.log('')
}

// ─── 入口 ──────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const subcommand = argv[1]

  if (command === '-h' || command === '--help' || !command) {
    cmdHelp()
    return
  }

  // 短别名: tokentrail daemon <install|status|restart|uninstall>
  if (command === 'daemon') {
    switch (subcommand) {
      case 'install':
        await cmdInstallService(argv.slice(2))
        return
      case 'status':
        await cmdDoctor()
        return
      case 'restart':
        await cmdRestart()
        return
      case 'uninstall':
        await cmdUninstallService()
        return
      default:
        console.log(`  未知 daemon 子命令: ${subcommand || '(空)'}`)
        console.log('')
        console.log('  可用子命令:')
        console.log('    daemon install    安装常驻服务')
        console.log('    daemon status     服务状态诊断')
        console.log('    daemon restart    重启常驻服务')
        console.log('    daemon uninstall  移除常驻服务')
        console.log('')
        process.exit(1)
    }
  }

  switch (command) {
    case 'setup':
      await cmdSetup()
      break
    case 'status':
      await cmdStatus()
      break
    case 'sync':
      await cmdSync()
      break
    case 'report':
      await cmdReport(argv.slice(1))
      break
    case 'health':
      await cmdHealth()
      break
    case 'doctor':
      await cmdDoctor()
      break
    case 'open':
      await cmdOpen()
      break
    case 'restart':
      await cmdRestart()
      break
    case 'backup':
      await cmdBackup()
      break
    case 'install-service':
      await cmdInstallService(argv.slice(1))
      break
    case 'uninstall-service':
      await cmdUninstallService()
      break
    default:
      console.log(`  未知命令: ${command}`)
      cmdHelp()
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(`  ✗ ${err.message}`)
  process.exit(1)
})
