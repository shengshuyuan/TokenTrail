const { execFileSync, spawn } = require('child_process')
const path = require('path')

const ALLOWED_CLIS = new Set(['grok', 'gemini', 'kimi', 'codex'])

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

function resolveCliBinary(name, deps = {}) {
  if (!ALLOWED_CLIS.has(name)) return null
  const envName = `${name.toUpperCase()}_BIN`
  const explicit = deps.env?.[envName]
  const fsMod = deps.fs
  const candidates = [
    explicit,
    deps.home && path.join(deps.home, '.local', 'bin', name),
    deps.home && path.join(deps.home, `.${name}`, 'bin', name),
    name === 'kimi' && deps.home && path.join(deps.home, '.kimi-code', 'bin', name),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      if (fsMod?.existsSync(candidate)) return candidate
    } catch {}
  }
  try {
    const execImpl = deps.execFileSyncImpl || execFileSync
    const resolved = execImpl('/bin/zsh', ['-lc', `command -v -- ${name}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return resolved || null
  } catch {
    return null
  }
}

/** Open a visible terminal so device codes, browser errors and completion remain observable. */
function launchCliLogin(name, args, deps = {}) {
  const bin = resolveCliBinary(name, deps)
  if (!bin) return { ok: false, reason: `${name}_cli_missing` }
  if ((deps.platform || process.platform) !== 'darwin') {
    return { ok: false, reason: 'visible_terminal_unavailable' }
  }
  const command = [bin, ...args].map(shellQuote).join(' ')
  const terminalCommand = `clear; ${command}; printf '\\nTokenTrail: authorization finished. You may close this window.\\n'`
  const appleScriptCommand = terminalCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const spawnImpl = deps.spawnImpl || spawn
  try {
    const child = spawnImpl('/usr/bin/osascript', [
      '-e', 'tell application "Terminal" to activate',
      '-e', `tell application "Terminal" to do script "${appleScriptCommand}"`,
    ], { detached: true, stdio: 'ignore' })
    child?.unref?.()
    return { ok: true }
  } catch {
    return { ok: false, reason: 'spawn_failed' }
  }
}

module.exports = { resolveCliBinary, launchCliLogin, shellQuote }
