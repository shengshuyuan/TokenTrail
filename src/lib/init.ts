import { getDb } from './db'
import { seedPricing } from './seed-pricing'
import { runMigrations } from './migrations'

let _initialized = false

/**
 * 确保数据库已初始化、价格已预置、一次性数据迁移已执行。
 * 幂等操作，多次调用安全。
 */
export function ensureInit() {
  if (_initialized) return
  getDb()
  seedPricing()
  runMigrations()
  _initialized = true
}
