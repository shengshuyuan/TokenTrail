// ─── 账号额度中心 · Adapter 共享工具 ─────────────────────────
// 统一超时 / 错误码 / JSON 校验。所有供应商请求只在服务端执行；
// 任何日志与错误信息都不得包含凭证或响应原文。

/** 抛出带错误码的异常（auth / rate_limited / timeout / network / malformed / unsupported_version）。 */
function codedError(code, message) {
  const err = new Error(message || code)
  err.code = code
  return err
}

/** 读取 JSON 文件；不存在/损坏返回 null，绝不抛出。 */
function readJsonIfExists(fsMod, filePath) {
  try {
    if (!fsMod.existsSync(filePath)) return null
    return JSON.parse(fsMod.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function queryString(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
}

/**
 * 发起 JSON 请求并做白名单化错误映射。
 * 返回 { status, json }；2xx 且 JSON 合法才返回，否则抛 codedError。
 */
async function requestJson(url, opts = {}) {
  const { method = 'GET', headers = {}, body, timeoutMs = 5500, fetchImpl } = opts
  if (typeof fetchImpl !== 'function') throw codedError('network', 'no fetch impl')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if (err && (err.name === 'AbortError' || controller.signal.aborted)) throw codedError('timeout', 'request timeout')
    throw codedError('network', 'request failed')
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401 || res.status === 403) throw codedError('auth', 'unauthorized')
  if (res.status === 429) throw codedError('rate_limited', 'rate limited')
  if (res.status >= 500) throw codedError('network', 'server error')

  let json
  try {
    json = JSON.parse(await res.text())
  } catch {
    throw codedError('malformed', 'malformed response')
  }

  if (!res.ok) throw codedError('network', `http ${res.status}`)
  return { status: res.status, json }
}

/** 数值容错解析：接受 number 或纯数字字符串。 */
function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

/** 时间容错解析：Unix 秒/毫秒或 ISO 字符串 → 毫秒时间戳。 */
function toEpochMs(value) {
  const num = toFiniteNumber(value)
  if (num !== null) return num < 1e12 ? Math.round(num * 1000) : Math.round(num)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * 由分钟数生成窗口标识（UI 依据 windowMinutes 做本地化）。
 * 固定映射常见窗口：300→5h、1440→day、10080→week。
 */
function windowKindFromMinutes(minutes) {
  if (minutes === 300) return '5h'
  if (minutes === 1440) return 'day'
  if (minutes === 10080) return 'week'
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null
  if (minutes % 10080 === 0) return `${minutes / 10080}w`
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

module.exports = {
  codedError,
  readJsonIfExists,
  queryString,
  requestJson,
  toFiniteNumber,
  toEpochMs,
  windowKindFromMinutes,
}
