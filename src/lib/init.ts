import { getDb } from './db'
import { seedPricing } from './seed-pricing'

let _initialized = false

/**
 * 确保数据库已初始化且价格已预置。
 * 幂等操作，多次调用安全。
 */
export function ensureInit() {
  if (_initialized) return
  getDb()
  seedPricing()
  _initialized = true
}
