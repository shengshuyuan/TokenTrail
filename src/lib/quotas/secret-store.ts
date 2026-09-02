import { execFileSync } from 'node:child_process'

const SERVICE = 'com.tokentrail.quota'

export const QUOTA_SECRET_KEYS = [
  'XAI_MANAGEMENT_KEY',
  'GLM_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'KIMI_CODE_API_KEY',
  'MOONSHOT_API_KEY',
  'OPENAI_API_KEY',
] as const

export type QuotaSecretKey = (typeof QUOTA_SECRET_KEYS)[number]

/** Read a provider secret from the process environment or the macOS Keychain. */
export function getQuotaSecret(key: QuotaSecretKey): string | undefined {
  const fromEnv = process.env[key]?.trim()
  if (fromEnv) return fromEnv
  if (process.platform !== 'darwin') return undefined
  try {
    const value = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', SERVICE, '-a', key, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    return value || undefined
  } catch {
    return undefined
  }
}

/** Persist a provider secret without placing it in SQLite or application logs. */
export function setQuotaSecret(key: QuotaSecretKey, value: string): void {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Secret cannot be empty')
  if (process.platform !== 'darwin') {
    throw new Error('当前系统不支持安全保存，请使用环境变量配置凭证')
  }
  execFileSync(
    '/usr/bin/security',
    ['add-generic-password', '-U', '-s', SERVICE, '-a', key, '-w', trimmed],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  )
}
