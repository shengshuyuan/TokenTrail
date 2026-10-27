import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { exportZcodeUsage: exportZcodeUsageJs } = require('../zcode.js') as {
  exportZcodeUsage: (options?: {
    dbPath?: string
    usageDir?: string
    statePath?: string
  }) => { ok: boolean; exported: number; files: string[]; reason?: string }
}

export function exportZcodeUsage(): { ok: boolean; exported: number; files: string[]; reason?: string } {
  return exportZcodeUsageJs()
}
