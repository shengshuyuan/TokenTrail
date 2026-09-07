'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
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
}

type GuideTab = 'quick' | 'proxy' | 'cli' | 'codex' | 'claude' | 'kimi' | 'traework'

export default function ConnectionsPage() {
  const { lang, t } = useLang()
  const { syncing, triggerSync, lastSyncResult, refreshKey } = usePreferences()

  const [statusData, setStatusData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<GuideTab>('quick')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/status')
      if (res.ok) {
        const json = await res.json()
        setStatusData(json)
      }
    } catch {
      // keep previous
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus, refreshKey])

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCode(id)
      setTimeout(() => setCopiedCode(null), 2000)
    })
  }

  // Pre-configured list of known supported tools
  const KNOWN_TOOLS = [
    {
      id: 'codex',
      name: 'Codex / ChatGPT',
      type: 'CLI / Session',
      path: '~/.codex/sessions',
      desc: '自动扫描本地会话文件中的 rate_limits 与 usage 事件',
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      type: 'CLI 日志',
      path: '~/.claude/logs',
      desc: '扫描 Claude Code 本地对话生成的详细 turn-level token 日志',
    },
    {
      id: 'kimi-code',
      name: 'Kimi Code',
      type: 'CLI 日志',
      path: '~/.kimi-code/logs',
      desc: '解析 Kimi Code 本地 turn 级别 usage.record 与缓存用量',
    },
    {
      id: 'grok',
      name: 'Grok CLI',
      type: 'CLI 日志',
      path: '~/.grok/logs',
      desc: '扫描 Grok CLI 历史 inference_done 事件并区分项目',
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      type: 'Local Workspace',
      path: '~/.gemini/antigravity-cli/brain',
      desc: '解析 Antigravity 本地 transcripts 会话记录与模型切换事件',
    },
    {
      id: 'traework',
      name: 'TraeWork / Trae',
      type: 'IDE 存储',
      path: '~/Library/Application Support/Trae/User',
      desc: '提取 Trae IDE 对话历史中的 token 消耗记录与估算数据',
    },
    {
      id: 'openclaw',
      name: 'OpenClaw',
      type: 'CLI 日志',
      path: '~/.openclaw/workspace',
      desc: '自动发现并同步 OpenClaw 任务执行期间记录的 JSONL 日志',
    },
    {
      id: 'hermes',
      name: 'Hermes',
      type: 'CLI 日志',
      path: '~/.hermes/logs',
      desc: '监控 Hermes Agent 本地会话与工具调用的模型消耗',
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
      <div className="p-5 mb-8 bg-workbench-surface border border-workbench-border rounded-xl shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <h3 className="text-base font-bold text-workbench-text">
                {lang === 'zh' ? '本地数据存储正常' : 'Local Data Storage Active'}
              </h3>
            </div>
            <p className="text-xs text-workbench-text-muted mt-1">
              {lang === 'zh'
                ? `已记录 ${statusData?.records ?? 0} 条调用数据 · 本地 SQLite 引擎`
                : `${statusData?.records ?? 0} records stored locally in SQLite`}
            </p>
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
                className="p-4 bg-workbench-surface border border-workbench-border rounded-xl flex flex-col justify-between shadow-2xs hover:border-workbench-accent/40 transition-colors"
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

                <div className="mt-3 pt-2.5 border-t border-workbench-border/60 flex items-center justify-between text-[11px] font-mono text-workbench-text-muted">
                  <span className="truncate max-w-[200px]" title={tool.path}>{tool.path}</span>
                  {isConnected && health?.latest_record && (
                    <span className="shrink-0 text-emerald-700">
                      最近: {new Date(health.latest_record).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Integration Guide Section */}
      <div className="bg-workbench-surface border border-workbench-border rounded-xl p-5 sm:p-7 shadow-xs">
        <h2 className="text-lg font-bold text-workbench-text tracking-tight mb-2">
          {lang === 'zh' ? '接入指南与常用命令' : 'Integration Guide & Commands'}
        </h2>
        <p className="text-xs text-workbench-text-muted mb-6">
          {lang === 'zh'
            ? '通过 CLI 扫描或配置 API 代理，无需修改你的代码即可透明统计所有 AI 消耗。'
            : 'Scan logs via CLI or configure an API proxy to track usage transparently.'}
        </p>

        {/* Guide Navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 p-1 bg-workbench-sidebar border border-workbench-border rounded-lg mb-6 max-w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('quick')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'quick'
                ? 'bg-workbench-accent text-white shadow-2xs'
                : 'text-workbench-text-muted hover:text-workbench-text'
            }`}
          >
            快速同步
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('proxy')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'proxy'
                ? 'bg-workbench-accent text-white shadow-2xs'
                : 'text-workbench-text-muted hover:text-workbench-text'
            }`}
          >
            OpenAI 代理
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('codex')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'codex'
                ? 'bg-workbench-accent text-white shadow-2xs'
                : 'text-workbench-text-muted hover:text-workbench-text'
            }`}
          >
            Codex
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('claude')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'claude'
                ? 'bg-workbench-accent text-white shadow-2xs'
                : 'text-workbench-text-muted hover:text-workbench-text'
            }`}
          >
            Claude Code
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('kimi')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'kimi'
                ? 'bg-workbench-accent text-white shadow-2xs'
                : 'text-workbench-text-muted hover:text-workbench-text'
            }`}
          >
            Kimi Code
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'quick' && (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-workbench-text mb-1">单次手动同步</h4>
              <p className="text-xs text-workbench-text-muted mb-2">扫描并导入所有已支持工具的最新历史记录：</p>
              <div className="flex items-center justify-between p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono">
                <code>node bin/tokentrail.js sync</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard('node bin/tokentrail.js sync', 'quick-sync')}
                >
                  {copiedCode === 'quick-sync' ? '已复制 ✓' : '复制'}
                </Button>
              </div>
            </div>

            <div className="pt-3 border-t border-workbench-border/60">
              <h4 className="text-sm font-semibold text-workbench-text mb-1">启动本地常驻服务</h4>
              <p className="text-xs text-workbench-text-muted mb-2">在后台运行 TokenTrail 服务与仪表盘：</p>
              <div className="flex items-center justify-between p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono">
                <code>npm start</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard('npm start', 'quick-start')}
                >
                  {copiedCode === 'quick-start' ? '已复制 ✓' : '复制'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'proxy' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-workbench-text mb-1">本地透明代理 (Proxy Mode)</h4>
            <p className="text-xs text-workbench-text-muted mb-2">
              将任意支持 OpenAI 规范的应用（如 Cursor、Aider 等）的 Base URL 指向本地：
            </p>
            <div className="p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-workbench-text-muted">Base URL:</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard('http://127.0.0.1:3820/api/proxy/openai/v1', 'proxy-url')}
                >
                  {copiedCode === 'proxy-url' ? '已复制 ✓' : '复制'}
                </Button>
              </div>
              <code>http://127.0.0.1:3820/api/proxy/openai/v1</code>
            </div>
            <p className="text-[11px] text-workbench-text-muted leading-relaxed">
              请求经过代理时会自动透明转发到官方并拦截记账，绝不在服务器存储你的 API Key。
            </p>
          </div>
        )}

        {activeTab === 'codex' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-workbench-text mb-1">Codex CLI 登录与额度读取</h4>
            <p className="text-xs text-workbench-text-muted mb-2">
              Codex 使用官方 CLI 登录后，TokenTrail 将自动读取 ChatGPT 订阅限额：
            </p>
            <div className="flex items-center justify-between p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono">
              <code>codex login</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard('codex login', 'codex-login')}
              >
                {copiedCode === 'codex-login' ? '已复制 ✓' : '复制'}
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'claude' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-workbench-text mb-1">Claude Code 本地日志扫描</h4>
            <p className="text-xs text-workbench-text-muted mb-2">
              在 Claude Code 完成对话后，TokenTrail 在执行同步时将自动扫描并记账：
            </p>
            <div className="flex items-center justify-between p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono">
              <code>node bin/tokentrail.js sync --source claude-code</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard('node bin/tokentrail.js sync --source claude-code', 'claude-sync')}
              >
                {copiedCode === 'claude-sync' ? '已复制 ✓' : '复制'}
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'kimi' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-workbench-text mb-1">Kimi Code CLI 登录与日志</h4>
            <p className="text-xs text-workbench-text-muted mb-2">
              运行官方 kimi 登录后，系统会自动提取 5h 窗口、周窗口与钱包余额：
            </p>
            <div className="flex items-center justify-between p-3 rounded-lg bg-workbench-sidebar border border-workbench-border text-xs font-mono">
              <code>kimi login</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard('kimi login', 'kimi-login')}
              >
                {copiedCode === 'kimi-login' ? '已复制 ✓' : '复制'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
