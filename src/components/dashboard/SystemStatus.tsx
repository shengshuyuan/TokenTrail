'use client'

import { useState, useEffect, useCallback } from 'react'
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
  'codex': 'Codex',
  'vibecafe': 'VibeCafé',
  'openclaw': 'OpenClaw',
  'hermes': 'Hermes',
  'lobster': 'Lobster',
}

function sourceDisplayName(source: string): string {
  return SOURCE_DISPLAY[source] || source
}

export function SystemStatus() {
  const { lang } = useLang()
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [backingUp, setBackingUp] = useState(false)
  const [backupResult, setBackupResult] = useState<string | null>(null)

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
      <div className="eva-panel eva-panel-hover p-5">
        <div className="section-title">
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-eva-green" />
            {lang === 'zh' ? '系统状态' : 'SYSTEM STATUS'}
          </span>
        </div>
        <div className="py-6 text-center font-mono text-xs text-eva-text-dim">LOADING...</div>
      </div>
    )
  }

  if (!data) return null

  const hasSyncData = data.last_sync !== null
  const overallOk = data.status === 'ok'

  return (
    <div className="eva-panel eva-panel-hover p-5">
      <div className="section-title flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${overallOk ? 'bg-eva-green' : 'bg-eva-orange animate-pulse'}`} />
          {lang === 'zh' ? '系统状态' : 'SYSTEM STATUS'}
        </span>
        <button
          type="button"
          onClick={fetchStatus}
          className="text-[10px] font-mono text-eva-text-dim hover:text-eva-green transition-colors"
        >
          {lang === 'zh' ? '刷新' : 'REFRESH'}
        </button>
      </div>

      {/* Stale data warning banner */}
      {!overallOk && (
        <div className="mb-4 rounded-md border border-eva-orange/30 bg-eva-orange/10 px-3 py-2 text-xs font-mono text-eva-orange">
          {lang === 'zh'
            ? '⚠ 数据长时间未更新，建议手动同步或检查自动同步任务'
            : '⚠ Data not updated recently. Try manual sync or check scheduled sync task'}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
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
              className={`rounded border px-2 py-0.5 text-[10px] font-mono transition-all ${
                backingUp
                  ? 'border-eva-orange/50 text-eva-orange animate-pulse'
                  : backupResult
                    ? 'border-eva-green/50 text-eva-green'
                    : 'border-eva-border text-eva-text-dim hover:border-eva-green/30 hover:text-eva-green'
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
          <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-eva-text-dim mb-2">
            {lang === 'zh' ? '数据源健康' : 'DATA SOURCE HEALTH'}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.sources.map(src => (
              <div
                key={src.source}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs font-mono transition-colors ${
                  src.stale
                    ? 'border-eva-orange/30 bg-eva-orange/5'
                    : 'border-eva-border bg-eva-bg/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${src.stale ? 'bg-eva-orange' : 'bg-eva-green'}`} />
                  <span className="truncate text-eva-text">{sourceDisplayName(src.source)}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <span className="text-eva-text-dim">{src.record_count.toLocaleString()}</span>
                  <span className={`text-[10px] ${src.stale ? 'text-eva-orange' : 'text-eva-text-dim/60'}`}>
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
  stat: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border px-3 py-3 ${
      ok ? 'border-eva-border bg-eva-bg/30' : 'border-eva-orange/30 bg-eva-orange/5'
    }`}>
      <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-eva-text-dim mb-1.5">{label}</div>
      <div className={`text-sm font-mono font-medium ${ok ? 'text-eva-green' : 'text-eva-orange'}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] font-mono text-eva-text-dim">{detail}</div>
      <div className="mt-2 text-xs font-mono">
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
        className="text-[10px] font-mono text-eva-text-dim hover:text-eva-green transition-colors flex items-center gap-1"
      >
        <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
        {lang === 'zh' ? '同步详情' : 'SYNC DETAILS'}
      </button>
      {expanded && (
        <div className="mt-2 overflow-x-auto rounded border border-eva-border bg-eva-bg/20">
          <table className="w-full text-[11px] font-mono text-left">
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
                  <td className="px-3 py-1.5 text-right text-eva-green">{r.inserted > 0 ? `+${r.inserted}` : '0'}</td>
                  <td className="px-3 py-1.5 text-right text-eva-text-dim">{r.duplicates.toLocaleString()}</td>
                  <td className={`px-3 py-1.5 text-right ${r.errors > 0 ? 'text-eva-orange' : 'text-eva-text-dim'}`}>
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
