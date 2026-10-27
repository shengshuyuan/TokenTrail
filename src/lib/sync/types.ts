export interface SyncResult {
  source: string
  scanned: number
  inserted: number
  duplicates: number
  errors: number
  /** Lines that are permanently unreadable (invalid JSON); included in `errors`. */
  bad_lines?: number
  /** Files left untouched because size and mtime still match the last full read. */
  skipped_files: number
  /** First failure reason for this source. Line-level parse errors share one message. */
  error?: string
  /** Non-fatal notice, e.g. a truncated Cursor history import. */
  warning?: string
  duration_ms: number
}

export interface SyncRunOptions {
  /** Stop starting new files / pages after this epoch ms. */
  deadline?: number
  signal?: AbortSignal
}
