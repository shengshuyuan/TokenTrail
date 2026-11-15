'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusLabel } from '@/components/ui/StatusLabel'
import { ProviderBrandIcon } from '@/components/dashboard/QuotaBrandIcons'
import { usePreferences } from '@/lib/PreferencesContext'
import { useLang } from '@/lib/LanguageContext'
import { SOURCE_DISPLAY_NAMES } from '@/types'

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
  skipped_files?: number
  duration_ms: number
  error?: string
  warning?: string
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
}

type GuideTab = 'quick' | 'proxy' | 'cli' | 'codex' | 'claude' | 'kimi' | 'traework'

type StorageTone = 'ok' | 'warning' | 'error' | 'pending'

const STORAGE_DOT_CLASS: Record<StorageTone, string> = {
  ok: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  pending: 'bg-gray-400 animate-pulse',
}

/**
 * 把 /api/status 的结果翻译成存储状态灯：
 * 读取失败 = 红；同步失败或数据超过 4 小时未更新 = 黄；其余 = 绿。
 */
function describeStorageHealth({ loading, error, data, lang }: {
  loading: boolean
  error: string | null
  data: StatusData | null
  lang: 'zh' | 'en'
}): { tone: StorageTone; title: string; detail?: string } {
  const zh = lang === 'zh'
  if (error) {
    return {
      tone: 'error',
      title: zh ? '无法读取本地存储状态' : 'Cannot read local storage status',
      detail: data
        ? (zh ? `显示的是上一次的结果（${error}）` : `showing previous result (${error})`)
        : error,
    }
  }
  if (!data) {
    return { tone: 'pending', title: loading ? (zh ? '正在检查本地存储…' : 'Checking local storage…') : (zh ? '尚无状态数据' : 'No status yet') }
  }
  if (data.status === 'error') {
    return { tone: 'error', title: zh ? '本地存储异常' : 'Local storage error' }
  }
  if (data.last_sync && !data.last_sync.success) {
    return {
      tone: 'warning',
      title: zh ? '上次同步失败' : 'Last sync failed',
      detail: data.last_sync.error || undefined,
    }
  }
  if (data.status === 'warning') {
    return {
      tone: 'warning',
      title: zh ? '本地存储可用，但数据超过 4 小时未更新' : 'Storage OK, but no new data for 4+ hours',
    }
  }
  return { tone: 'ok', title: zh ? '本地数据存储正常' : 'Local Data Storage Active' }
}

export default function ConnectionsPage() {
  const { lang, t } = useLang()
  const { syncing, triggerSync, refreshKey } = usePreferences()

  const [statusData, setStatusData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<GuideTab>('quick')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const [statusError, setStatusError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/status', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setStatusData(json)
      setStatusError(null)
    } catch (err) {
      console.error('[TokenTrail] connections: status request failed', err)
      setStatusError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const storage = describeStorageHealth({ loading, error: statusError, data: statusData, lang })

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus, refreshKey])

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCode(id)
      setTimeout(() => setCopiedCode(null), 2000)
    })
  }

  // Pre-configured list of known supported tools（说明文字跟随语言）
  const L = (zh: string, en: string) => (lang === 'zh' ? zh : en)
  const KNOWN_TOOLS = [
    {
      id: 'codex',
      name: 'Codex / ChatGPT',
      type: L('CLI / 会话', 'CLI / Session'),
      path: '~/.codex/sessions',
      desc: L('自动扫描本地会话文件中的 rate_limits 与 usage 事件', 'Scans local session files for rate_limits and usage events'),
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      type: L('CLI 日志', 'CLI logs'),
      path: '~/.claude/logs',
      desc: L('扫描 Claude Code 本地对话生成的详细 turn-level token 日志', 'Reads the per-turn token logs Claude Code writes for each local conversation'),
    },
    {
      id: 'kimi-code',
      name: 'Kimi Code',
      type: L('CLI 日志', 'CLI logs'),
      path: '~/.kimi-code/logs',
      desc: L('解析 Kimi Code 本地 turn 级别 usage.record 与缓存用量', 'Parses Kimi Code per-turn usage.record entries including cache usage'),
    },
    {
      id: 'grok',
      name: 'Grok CLI',
      type: L('CLI 日志', 'CLI logs'),
      path: '~/.grok/logs',
      desc: L('扫描 Grok CLI 历史 inference_done 事件并区分项目', 'Scans Grok CLI inference_done events and attributes them to projects'),
    },
    {
      id: 'cursor',
      name: 'Cursor',
      type: L('官方账单', 'Official billing'),
      path: 'cursor.com/dashboard',
      desc: L(
        '复用本机 Cursor 登录态，拉取官方账单里每次调用的模型、token 与真实费用；Auto 模式的底层模型按本机对话记录还原',
        'Reuses the local Cursor login to pull per-call model, tokens and billed cost from the official dashboard; the model behind Auto is resolved from local chat stores',
      ),
    },
    {
      id: 'cursor-grok-bot',
      name: 'Cursor Grok Bot',
      type: L('官方账单（套餐附带）', 'Official billing (included)'),
      path: 'cursor.com/dashboard',
      desc: L(
        'Cursor 账单里的 grok-bot-*：不是 IDE 对话，底层模型不公开，只记 token、不计费。和 Cursor 同一次同步拉取，单独列出以免淹没真正用的模型',
        'grok-bot-* rows on the Cursor bill: not IDE chats, underlying model not exposed, tokens only at $0. Fetched with Cursor but listed separately so it does not bury the models you actually used',
      ),
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      type: L('本地工作区', 'Local workspace'),
      path: '~/.gemini/antigravity-cli/brain',
      desc: L('解析 Antigravity 本地 transcripts 会话记录与模型切换事件', 'Parses Antigravity local transcripts and model-switch events'),
    },
    {
      id: 'traework',
      name: 'TraeWork / Trae',
      type: L('IDE 存储', 'IDE storage'),
      path: '~/Library/Application Support/Trae/User',
      desc: L('提取 Trae IDE 对话历史中的 token 消耗记录与估算数据', 'Extracts token usage and estimates from Trae IDE chat history'),
    },
    {
      id: 'openclaw',
      name: 'OpenClaw',
      type: L('CLI 日志', 'CLI logs'),
      path: '~/.openclaw/workspace',
      desc: L('自动发现并同步 OpenClaw 任务执行期间记录的 JSONL 日志', 'Discovers and syncs the JSONL logs OpenClaw writes while running tasks'),
    },
    {
      id: 'hermes',
      name: 'Hermes',
      type: L('CLI 日志', 'CLI logs'),
      path: '~/.hermes/logs',
      desc: L('监控 Hermes Agent 本地会话与工具调用的模型消耗', 'Tracks model usage of Hermes Agent sessions and tool calls'),
    },
  ]

  // Map health from statusData
  const healthMap = new Map<string, SourceHealth>()
  if (statusData?.sources) {
    for (const s of statusData.sources) {
      healthMap.set(s.source.toLowerCase(), s)
    }
  }

  return (
    <AppShell>
      {/* Page Header */}
      <PageHeader
        title={lang === 'zh' ? '数据接入' : 'Data Connections'}
        subtitle={
          lang === 'zh'
            ? '接入并维护各开发工具与平台的本地日志与 API 代理'
            : 'Connect and synchronize usage logs from your developer tools'
        }
        actions={
          <Button
            variant="primary"
            loading={syncing}
            onClick={() => triggerSync()}
            icon={
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          >
            {syncing
              ? lang === 'zh' ? '正在同步本地日志...' : 'Syncing...'
              : lang === 'zh' ? '立即同步' : 'Sync Now'}
          </Button>
        }
      />

      {/* Sync Status Banner */}
      <div className="p-5 mb-8 apple-glass-panel">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${STORAGE_DOT_CLASS[storage.tone]}`} />
              <h3 className="text-base font-bold text-workbench-text">{storage.title}</h3>
              {statusError && (
                <Button size="sm" variant="secondary" onClick={() => fetchStatus()}>
                  {lang === 'zh' ? '重试' : 'Retry'}
                </Button>
              )}
            </div>
            <p className="text-xs text-workbench-text-muted mt-1">
              {storage.detail ? `${storage.detail} · ` : ''}
              {statusData
                ? lang === 'zh'
                  ? `已记录 ${statusData.records} 条调用数据 · 本地 SQLite 引擎`
                  : `${statusData.records} records stored locally in SQLite`
                : ''}
            </p>
            {statusData?.last_sync?.sources && Object.entries(statusData.last_sync.sources).some(([, item]) => item.error || item.warning) && (
              <ul className="mt-2 space-y-1 text-xs text-status-warning">
                {Object.entries(statusData.last_sync.sources).filter(([, item]) => item.error || item.warning).map(([source, item]) => (
                  <li key={source}>
                    {SOURCE_DISPLAY_NAMES[source] || source}：{item.error || `${t('connections.historyTruncated')} (${item.warning})`}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs font-mono text-workbench-text-muted">
            {statusData?.last_sync?.at && (
              <div>
                {lang === 'zh' ? '上次同步：' : 'Last Sync: '}
                <span className="font-semibold text-workbench-text">
                  {new Date(statusData.last_sync.at).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid of Known Sources */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-workbench-text tracking-tight">
            {lang === 'zh' ? '支持的工具与数据源' : 'Supported Tools & Data Sources'}
          </h2>
          <span className="text-xs text-workbench-text-muted">
            {lang === 'zh' ? '自动识别本地目录，同步时增量提取' : 'Auto-detected locally during sync'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {KNOWN_TOOLS.map((tool) => {
            const health = healthMap.get(tool.id)
            const isConnected = Boolean(health && health.record_count > 0)

            return (
              <div
                key={tool.id}
                className="p-4 apple-glass-panel flex flex-col justify-between apple-glass-panel-hover"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5">
                      <ProviderBrandIcon provider={tool.id} className="size-7 shrink-0" />
                      <div>
                        <div className="font-semibold text-sm text-workbench-text">{tool.name}</div>
                        <div className="text-[11px] text-workbench-text-muted font-mono">{tool.type}</div>
                      </div>
                    </div>

                    <StatusLabel
                      size="sm"
                      status={isConnected ? 'healthy' : 'neutral'}
                      label={
                        isConnected
                          ? lang === 'zh' ? `${health?.record_count} 条记录` : `${health?.record_count} records`
                          : lang === 'zh' ? '待接入 / 无记录' : 'Not Connected'
                      }
                    />
                  </div>

                  <p className="text-xs text-workbench-text-muted mt-2 leading-relaxed">
                    {tool.desc}
                  </p>
                </div>

                <div className="mt-3 pt-2.5 border-t border-workbench-border/50 flex items-center justify-between text-[11px] font-mono text-workbench-text-muted">
                  <span className="truncate max-w-[200px]" title={tool.path}>{tool.path}</span>
                  {isConnected && health?.latest_record && (
                    <span className="shrink-0 text-emerald-700 dark:text-emerald-400 font-semibold">
                      {L('最近: ', 'Latest: ')}{new Date(health.latest_record).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Integration Guide Section */}
      <div className="apple-glass-panel p-5 sm:p-7">
        <h2 className="text-lg font-bold text-workbench-text tracking-tight mb-2">
          {lang === 'zh' ? '接入指南与常用命令' : 'Integration Guide & Commands'}
        </h2>
        <p className="text-xs text-workbench-text-muted mb-6">
          {lang === 'zh'
            ? '通过 CLI 扫描或配置 API 代理，无需修改你的代码即可透明统计所有 AI 消耗。'
            : 'Scan logs via CLI or configure an API proxy to track usage transparently.'}
        </p>

        {/* Guide Navigation Tabs */}
        <div className="mb-6 max-w-full overflow-x-auto">
          <SegmentedControl
            size="sm"
            value={activeTab}
            onChange={(tab) => setActiveTab(tab)}
            options={[
              { value: 'quick', label: lang === 'zh' ? '快速同步' : 'Quick sync' },
              { value: 'proxy', label: lang === 'zh' ? 'OpenAI 代理' : 'OpenAI proxy' },
              { value: 'codex', label: 'Codex' },
              { value: 'claude', label: 'Claude Code' },
              { value: 'kimi', label: 'Kimi Code' },
            ]}
          />
        </div>

        {/* Tab Content */}
        {activeTab === 'quick' && (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-workbench-text mb-1">{L('单次手动同步', 'One-off manual sync')}</h4>
              <p className="text-xs text-workbench-text-muted mb-2">{L('扫描并导入所有已支持工具的最新历史记录：', 'Scan and import the latest history from every supported tool:')}</p>
              <div className="flex items-center justify-between p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono">
                <code>node bin/tokentrail.js sync</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard('node bin/tokentrail.js sync', 'quick-sync')}
                >
                  {copiedCode === 'quick-sync' ? L('已复制 ✓', 'Copied ✓') : L('复制', 'Copy')}
                </Button>
              </div>
            </div>

            <div className="pt-3 border-t border-workbench-border/60">
              <h4 className="text-sm font-semibold text-workbench-text mb-1">{L('启动本地常驻服务', 'Start the local service')}</h4>
              <p className="text-xs text-workbench-text-muted mb-2">{L('在后台运行 TokenTrail 服务与仪表盘：', 'Run the TokenTrail service and dashboard in the background:')}</p>
              <div className="flex items-center justify-between p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono">
                <code>npm start</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard('npm start', 'quick-start')}
                >
                  {copiedCode === 'quick-start' ? L('已复制 ✓', 'Copied ✓') : L('复制', 'Copy')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'proxy' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-workbench-text mb-1">{L('本地透明代理 (Proxy Mode)', 'Local transparent proxy (Proxy Mode)')}</h4>
            <p className="text-xs text-workbench-text-muted mb-2">
              {L('将任意支持 OpenAI 规范的应用（如 Cursor、Aider 等）的 Base URL 指向本地：', 'Point any OpenAI-compatible app (Cursor, Aider, …) at this local Base URL:')}
            </p>
            <div className="p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-workbench-text-muted">Base URL:</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard('http://127.0.0.1:3820/api/proxy/openai/v1', 'proxy-url')}
                >
                  {copiedCode === 'proxy-url' ? L('已复制 ✓', 'Copied ✓') : L('复制', 'Copy')}
                </Button>
              </div>
              <code>http://127.0.0.1:3820/api/proxy/openai/v1</code>
            </div>
            <p className="text-[11px] text-workbench-text-muted leading-relaxed">
              {L('请求经过代理时会自动透明转发到官方并拦截记账，绝不在服务器存储你的 API Key。', 'Requests are forwarded to the provider unchanged and metered on the way through; your API key is never stored on the server.')}
            </p>
          </div>
        )}

        {activeTab === 'codex' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-workbench-text mb-1">{L('Codex CLI 登录与额度读取', 'Codex CLI login and quota reading')}</h4>
            <p className="text-xs text-workbench-text-muted mb-2">
              {L('Codex 使用官方 CLI 登录后，TokenTrail 将自动读取 ChatGPT 订阅限额：', 'Once you log in with the official Codex CLI, TokenTrail reads your ChatGPT subscription limits:')}
            </p>
            <div className="flex items-center justify-between p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono">
              <code>codex login</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard('codex login', 'codex-login')}
              >
                {copiedCode === 'codex-login' ? L('已复制 ✓', 'Copied ✓') : L('复制', 'Copy')}
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'claude' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-workbench-text mb-1">{L('Claude Code 本地日志扫描', 'Claude Code local log scan')}</h4>
            <p className="text-xs text-workbench-text-muted mb-2">
              {L('在 Claude Code 完成对话后，TokenTrail 在执行同步时将自动扫描并记账：', 'After a Claude Code conversation finishes, the next sync scans and records it:')}
            </p>
            <div className="flex items-center justify-between p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono">
              <code>node bin/tokentrail.js sync --source claude-code</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard('node bin/tokentrail.js sync --source claude-code', 'claude-sync')}
              >
                {copiedCode === 'claude-sync' ? L('已复制 ✓', 'Copied ✓') : L('复制', 'Copy')}
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'kimi' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-workbench-text mb-1">{L('Kimi Code CLI 登录与日志', 'Kimi Code CLI login and logs')}</h4>
            <p className="text-xs text-workbench-text-muted mb-2">
              {L('运行官方 kimi 登录后，系统会自动提取 5h 窗口、周窗口与钱包余额：', 'After logging in with the official kimi CLI, the 5h window, weekly window and wallet balance are read automatically:')}
            </p>
            <div className="flex items-center justify-between p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono">
              <code>kimi login</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard('kimi login', 'kimi-login')}
              >
                {copiedCode === 'kimi-login' ? L('已复制 ✓', 'Copied ✓') : L('复制', 'Copy')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
