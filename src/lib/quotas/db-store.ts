// ─── 账号额度中心 · DB 存储实现 ───────────────────────────────
// 把 refresh/cache 所需的 store 接口接到 better-sqlite3。
// 库里只落规范化快照，严禁凭证。

import { loadQuotaSnapshotRows, saveQuotaSnapshotRows, type QuotaSnapshotRow } from '@/lib/db'

export interface QuotaStore {
  loadAll: () => Promise<QuotaSnapshotRow[]>
  saveAll: (rows: QuotaSnapshotRow[]) => Promise<void>
}

export function createDbQuotaStore(): QuotaStore {
  return {
    async loadAll() {
      return loadQuotaSnapshotRows()
    },
    async saveAll(rows) {
      saveQuotaSnapshotRows(rows)
    },
  }
}
