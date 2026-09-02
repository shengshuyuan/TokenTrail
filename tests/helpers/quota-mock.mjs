// ─── quota 测试共享 mock 工具 ────────────────────────────────
// 仅供 tests/*.test.mjs 引用；node --test 只匹配 *.test.mjs。

import assert from 'node:assert/strict'
import { runAdapter } from '../../src/lib/quotas/refresh.js'

/** 极简内存 fs：entries = { 'path': 'file content' }，目录以隐式前缀存在。 */
export function createFakeFs(entries = {}) {
  const dirCache = new Set()
  for (const p of Object.keys(entries)) {
    let dir = p.slice(0, p.lastIndexOf('/'))
    while (dir) {
      dirCache.add(dir)
      dir = dir.slice(0, dir.lastIndexOf('/'))
    }
  }
  return {
    existsSync: (p) => Boolean(entries[p]) || dirCache.has(String(p)),
    readFileSync: (p) => {
      if (!(p in entries)) throw new Error('ENOENT')
      return entries[p]
    },
    readdirSync: (p, opts = {}) => {
      const prefix = String(p).endsWith('/') ? String(p) : `${p}/`
      const seen = new Set()
      for (const key of Object.keys(entries)) {
        if (key.startsWith(prefix)) seen.add(key.slice(prefix.length).split('/')[0])
      }
      for (const dir of dirCache) {
        if (dir.startsWith(prefix) && dir !== p) {
          const rest = dir.slice(prefix.length)
          if (rest && !rest.includes('/')) seen.add(rest)
        }
      }
      const names = [...seen]
      if (opts.withFileTypes) {
        return names.map((name) => ({
          name,
          isDirectory: () => !(prefix + name in entries),
        }))
      }
      return names
    },
    statSync: (p) => ({ mtimeMs: 0, size: String(entries[p] ?? '').length, isDirectory: () => !entries[p] }),
  }
}

/**
 * fake fetch：routes = [{ match: url|RegExp, status, json|text, delayMs, hang }]
 * 返回 { fetchImpl, calls }；无匹配路由按网络失败处理。
 */
export function createFakeFetch(routes = []) {
  const calls = []
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    const route = routes.find((r) => (typeof r.match === 'string' ? String(url).includes(r.match) : r.match.test(String(url))))
    if (!route) throw new Error('ECONNREFUSED')
    if (route.hang) {
      // 模拟真实 fetch：被 abort 信号取消时以 AbortError 拒绝
      return new Promise((_, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }
    if (route.delayMs) await new Promise((r) => setTimeout(r, route.delayMs))
    const body = route.text ?? JSON.stringify(route.json ?? {})
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      text: async () => body,
    }
  }
  return { fetchImpl, calls }
}

/** 内存 store。 */
export function createFakeStore(initialRows = []) {
  const rows = [...initialRows]
  return {
    rows,
    async loadAll() {
      return rows.map((r) => ({ ...r }))
    },
    async saveAll(next) {
      rows.length = 0
      rows.push(...next.map((r) => ({ ...r })))
    },
  }
}

/** 把 adapter 跑成快照（错误收敛为快照），供断言。 */
export async function snapshotOf(adapter, deps) {
  return runAdapter('x', adapter, { now: () => Date.now(), timeoutMs: 500, ...deps })
}

/** 断言 JSON 中不包含任何敏感片段。 */
export function assertNoSecrets(jsonString, secrets, label = 'snapshot') {
  for (const secret of secrets) {
    assert.ok(!jsonString.includes(secret), `${label} must not contain secret: ${secret.slice(0, 8)}...`)
  }
}
