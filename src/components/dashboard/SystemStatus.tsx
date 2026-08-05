'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useLang } from '@/lib/LanguageContext'

interface SourceHealth {
  source: string
  record_count: number
  latest_record: string
  stale: boolean
}

interface SyncSourceResult {
  scanned: number
  inserted: number
  duplicates: number
  errors: number
  duration_ms: number
}

interface StatusData {
  status: string
  records: number
  latest_record: string | null
  sources: SourceHealth[]
  last_sync: {
    at: string
    success: boolean
    sources: Record<string, SyncSourceResult>
    vibecafe_configured: boolean
    error: string | null
  } | null
  backup: {
    last_at: string | null
    count: number
  }
}

function formatRelativeTime(isoString: string | null, lang: 'zh' | 'en'): string {
  if (!isoString) return lang === 'zh' ? '无记录' : 'No records'
  const diffMs = Date.now() - new Date(isoString).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return lang === 'zh' ? '刚刚' : 'Just now'
  if (minutes < 60) return lang === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return lang === 'zh' ? `${hours} 小时前` : `${hours}h ago`
  const days = Math.round(hours / 24)
  return lang === 'zh' ? `${days} 天前` : `${days}d ago`
}

const SOURCE_DISPLAY: Record<string, string> = {
  'claude-code': 'Claude Code',
  'kimi-code': 'Kimi Code',
  'codex': 'Codex',
  'vibecafe': 'VibeCafé',
  'openclaw': 'OpenClaw',
  'hermes': 'Hermes',
  'lobster': 'Lobster',
  'traework': 'TraeWork',
}

function sourceDisplayName(source: string): string {
  return SOURCE_DISPLAY[source] || source
}

export function SystemStatus({
  defaultCollapsed = true,
}: {
  /** First-screen density: show a one-line summary until expanded. */
  defaultCollapsed?: boolean
} = {}) {
  const { lang } = useLang()
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [backingUp, setBackingUp] = useState(false)
  const [backupResult, setBackupResult] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(!defaultCollapsed)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status')
      if (!res.ok) return
      const json = await res.json()
      setData(json)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleBackup = async () => {
    if (backingUp) return
    setBackingUp(true)
    setBackupResult(null)
    try {
      const res = await fetch('/api/backup', { method: 'POST' })
      const json = await res.json()
      if (json.success) {
        const sizeKb = (json.size_bytes / 1024).toFixed(0)
        setBackupResult(lang === 'zh' ? `✓ 已备份 (${sizeKb} KB)` : `✓ Backed up (${sizeKb} KB)`)
        await fetchStatus()
      } else {
        setBackupResult(lang === 'zh' ? `✗ ${json.error}` : `✗ ${json.error}`)
      }
    } catch {
      setBackupResult(lang === 'zh' ? '✗ 备份失败' : '✗ Backup failed')
    } finally {
      setBackingUp(false)
      setTimeout(() => setBackupResult(null), 3000)
    }
  }

  if (loading && !data) {
    return (
      <div className="eva-panel p-3 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2 text-sm font-mono text-eva-text-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-status-success pulse-dot" />
          {lang === 'zh' ? '系统状态 · 加载中…' : 'SYSTEM STATUS · loading…'}
        </div>
      </div>
    )
  }

  if (!data) return null

  const hasSyncData = data.last_sync !== null
  const overallOk = data.status === 'ok'
  const staleCount = data.sources.filter(s => s.stale).length
  const summaryLine = lang === 'zh'
    ? `${overallOk ? '正常' : '需关注'} · ${data.records.toLocaleString()} 条 · 同步 ${hasSyncData ? formatRelativeTime(data.last_sync!.at, lang) : '从未'}${staleCount > 0 ? ` · ${staleCount} 源过期` : ''}`
    : `${overallOk ? 'OK' : 'Attention'} · ${data.records.toLocaleString()} rec · sync ${hasSyncData ? formatRelativeTime(data.last_sync!.at, lang) : 'never'}${staleCount > 0 ? ` · ${staleCount} stale` : ''}`

  return (
    <div className={`eva-panel eva-panel-hover ${expanded ? 'p-5' : 'px-4 py-3'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="group flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full pulse-dot ${overallOk ? 'bg-status-success/80 text-status-success' : 'bg-status-warning text-status-warning'}`} />
          <span className="section-title mb-0 shrink-0">
            {lang === 'zh' ? '系统状态' : 'SYSTEM STATUS'}
          </span>
          {!expanded && (
            <span className="min-w-0 truncate text-sm font-mono text-eva-text-dim">
              {summaryLine}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] font-mono text-eva-text-dim/80 group-hover:text-eva-green">
            {expanded ? (lang === 'zh' ? '收起 ▴' : 'Collapse ▴') : (lang === 'zh' ? '展开 ▾' : 'Expand ▾')}
          </span>
        </button>
        <button
          type="button"
          onClick={fetchStatus}
          className="control-surface pressable shrink-0 rounded-full px-3 py-1.5 text-xs font-mono"
        >
          {lang === 'zh' ? '刷新' : 'REFRESH'}
        </button>
      </div>

      {!expanded && !overallOk && (
        <p className="mt-2 text-xs font-mono text-status-warning">
          {lang === 'zh'
            ? '⚠ 数据可能过期，展开查看详情或手动同步'
            : '⚠ Data may be stale — expand for details or sync'}
        </p>
      )}

      {expanded && (
      <>
      {/* Stale data warning banner */}
      {!overallOk && (
        <div className="mb-4 mt-3 rounded-md border border-status-warning/25 bg-status-warning/5 px-3 py-2.5 text-sm leading-6 font-mono text-status-warning">
          {lang === 'zh'
            ? '⚠ 数据长时间未更新，建议手动同步或检查自动同步任务'
            : '⚠ Data not updated recently. Try manual sync or check scheduled sync task'}
        </div>
      )}

      <div className={`grid gap-3 lg:grid-cols-3 ${overallOk ? 'mt-4' : ''}`}>
        {/* Service Status */}
        <StatusCard
          label={lang === 'zh' ? '服务' : 'SERVICE'}
          ok={overallOk}
          value={overallOk
            ? (lang === 'zh' ? '运行中' : 'Running')
            : (lang === 'zh' ? '需要关注' : 'Needs attention')
          }
          detail={data.latest_record
            ? `${lang === 'zh' ? '最近数据' : 'Latest'}: ${formatRelativeTime(data.latest_record, lang)}`
            : (lang === 'zh' ? '暂无数据' : 'No data yet')
          }
          stat={`${data.records.toLocaleString()} ${lang === 'zh' ? '条记录' : 'records'}`}
        />

        {/* Last Sync */}
        <StatusCard
          label={lang === 'zh' ? '最近同步' : 'LAST SYNC'}
          ok={hasSyncData ? data.last_sync!.success : false}
          value={hasSyncData
            ? formatRelativeTime(data.last_sync!.at, lang)
            : (lang === 'zh' ? '从未同步' : 'Never synced')
          }
          detail={hasSyncData && data.last_sync!.error
            ? data.last_sync!.error
            : (hasSyncData
              ? `${Object.keys(data.last_sync!.sources).length} ${lang === 'zh' ? '个数据源' : 'sources'}`
              : (lang === 'zh' ? '无同步记录' : 'No sync history'))
          }
          stat={hasSyncData
            ? (data.last_sync!.success
              ? (lang === 'zh' ? '成功' : 'Success')
              : (lang === 'zh' ? '有错误' : 'Has errors'))
            : '--'
          }
        />

        {/* Backup */}
        <StatusCard
          label={lang === 'zh' ? '备份' : 'BACKUP'}
          ok={data.backup.count > 0}
          value={data.backup.last_at
            ? formatRelativeTime(data.backup.last_at, lang)
            : (lang === 'zh' ? '未备份' : 'No backups')
          }
          detail={`${data.backup.count} ${lang === 'zh' ? '个备份文件' : 'backup files'}`}
          stat={
            <button
              type="button"
              onClick={handleBackup}
              disabled={backingUp}
              className={`pressable control-surface px-2.5 py-1 text-xs font-mono ${
                backingUp
                  ? 'border-status-warning/50 text-status-warning animate-pulse'
                  : backupResult
                    ? 'border-status-success/50 text-status-success'
                    : ''
              }`}
            >
              {backingUp
                ? (lang === 'zh' ? '备份中...' : 'BACKING UP...')
                : backupResult || (lang === 'zh' ? '手动备份' : 'BACKUP NOW')
              }
            </button>
          }
        />
      </div>

      {/* Per-source health */}
      {data.sources.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[13px] font-semibold uppercase text-eva-text-dim/90">
            {lang === 'zh' ? '数据源健康' : 'DATA SOURCE HEALTH'}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.sources.map(src => (
              <div
                key={src.source}
                className={`flex items-center justify-between rounded-md border px-3 py-2.5 text-sm font-mono transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-px ${
                  src.stale
                    ? 'border-status-warning/20 bg-status-warning/5 hover:border-status-warning/40'
                    : 'border-eva-border/80 bg-[var(--theme-control-bg)] hover:border-eva-green/25'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 shrink-0 rounded-full pulse-dot ${src.stale ? 'bg-status-warning text-status-warning' : 'bg-status-success text-status-success'}`} />
                  <span className="truncate text-eva-text">{sourceDisplayName(src.source)}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <span className="text-eva-text-dim">{src.record_count.toLocaleString()}</span>
                  <span className={`text-xs ${src.stale ? 'text-status-warning' : 'text-eva-text-dim/80'}`}>
                    {formatRelativeTime(src.latest_record, lang)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last sync details (expandable) */}
      {hasSyncData && (
        <SyncDetails sources={data.last_sync!.sources} lang={lang} />
      )}
      </>
      )}
    </div>
  )
}

function StatusCard({
  label,
  ok,
  value,
  detail,
  stat,
}: {
  label: string
  ok: boolean
  value: string
  detail: string
  stat: ReactNode
}) {
  return (
    <div className={`rounded-lg border px-4 py-3.5 transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-px ${
      ok
        ? 'border-eva-border/80 bg-[var(--theme-control-bg)] hover:border-eva-green/25'
        : 'border-status-warning/20 bg-status-warning/5 hover:border-status-warning/40'
    }`}>
      <div className="mb-2 flex items-center justify-between gap-2 text-[13px] font-semibold uppercase text-eva-text-dim/90">
        <span>{label}</span>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full pulse-dot ${
            ok ? 'bg-status-success text-status-success' : 'bg-status-warning text-status-warning'
          }`}
          aria-hidden="true"
        />
      </div>
      <div className={`text-[15px] font-mono font-medium ${ok ? 'text-status-success' : 'text-status-warning'}`}>
        {value}
      </div>
      <div className="mt-1 text-sm leading-6 font-mono text-eva-text-dim/90">{detail}</div>
      <div className="mt-3 text-sm font-mono">
        {typeof stat === 'string' ? (
          <span className="text-eva-text-dim/70">{stat}</span>
        ) : stat}
      </div>
    </div>
  )
}

function SyncDetails({
  sources,
  lang,
}: {
  sources: Record<string, SyncSourceResult>
  lang: 'zh' | 'en'
}) {
  const [expanded, setExpanded] = useState(false)
  const entries = Object.entries(sources)

  if (entries.length === 0) return null

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="pressable flex items-center gap-1 text-[13px] font-mono text-eva-text-dim hover:text-eva-green transition-[transform,color] duration-150"
      >
        <span className={`inline-block transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>▸</span>
        {lang === 'zh' ? '同步详情' : 'SYNC DETAILS'}
      </button>
      {expanded && (
        <div className="control-inset mt-2 overflow-x-auto">
          <table className="w-full text-xs font-mono text-left">
            <thead>
              <tr className="border-b border-eva-border text-eva-text-dim">
                <th className="px-3 py-1.5 font-normal">{lang === 'zh' ? '来源' : 'Source'}</th>
                <th className="px-3 py-1.5 font-normal text-right">{lang === 'zh' ? '扫描' : 'Scanned'}</th>
                <th className="px-3 py-1.5 font-normal text-right">{lang === 'zh' ? '新增' : 'New'}</th>
                <th className="px-3 py-1.5 font-normal text-right">{lang === 'zh' ? '重复' : 'Dup'}</th>
                <th className="px-3 py-1.5 font-normal text-right">{lang === 'zh' ? '错误' : 'Err'}</th>
                <th className="px-3 py-1.5 font-normal text-right">{lang === 'zh' ? '耗时' : 'Time'}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([source, r]) => (
                <tr key={source} className="border-b border-eva-border/50 last:border-0">
                  <td className="px-3 py-1.5 text-eva-text">{sourceDisplayName(source)}</td>
                  <td className="px-3 py-1.5 text-right text-eva-text-dim">{r.scanned.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right text-status-success">{r.inserted > 0 ? `+${r.inserted}` : '0'}</td>
                  <td className="px-3 py-1.5 text-right text-eva-text-dim">{r.duplicates.toLocaleString()}</td>
                  <td className={`px-3 py-1.5 text-right ${r.errors > 0 ? 'text-status-warning' : 'text-eva-text-dim'}`}>
                    {r.errors > 0 ? r.errors : '0'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-eva-text-dim">{(r.duration_ms / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
