'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '@/lib/LanguageContext'

interface GuideStep {
  title: string
  desc: string
  commands: { label: string; code: string }[]
}

type TabId = 'quick' | 'claude-code' | 'openclaw' | 'hermes' | 'api' | 'cli'

const GUIDE_CONTENT: Record<TabId, GuideStep[]> = {
  quick: [
    {
      title: '1. 启动服务',
      desc: '在项目目录下启动 TokenTrail 服务',
      commands: [
        { label: '启动', code: 'cd TokenTrail && npm run dev' },
      ],
    },
    {
      title: '2. 配置 CLI',
      desc: '初始化 CLI 工具，连接服务器',
      commands: [
        { label: '初始化', code: 'node bin/tokentrail.js setup' },
      ],
    },
    {
      title: '3. 安装 Skill（可选）',
      desc: '让 AI 工具自动识别 TokenTrail',
      commands: [
        { label: 'Claude Code', code: 'mkdir -p ~/.claude/skills/tokentrail && cp docs/SKILL.md ~/.claude/skills/tokentrail/SKILL.md' },
        { label: 'Cursor', code: 'mkdir -p ~/.cursor/skills/tokentrail && cp docs/SKILL.md ~/.cursor/skills/tokentrail/SKILL.md' },
      ],
    },
    {
      title: '4. 同步数据',
      desc: '拉取所有数据源的最新数据',
      commands: [
        { label: '同步', code: 'node bin/tokentrail.js sync' },
      ],
    },
  ],
  'claude-code': [
    {
      title: '自动同步（无需配置）',
      desc: 'Claude Code 的数据通过 SYNC 按钮自动从本地日志文件同步',
      commands: [
        { label: '查看数据目录', code: 'ls ~/.claude/projects/' },
        { label: '手动同步', code: 'node bin/tokentrail.js sync' },
      ],
    },
    {
      title: 'Skill 安装（推荐）',
      desc: '安装后用户对 Claude Code 说"看看用量"等会自动调用',
      commands: [
        { label: '安装 Skill', code: 'mkdir -p ~/.claude/skills/tokentrail && cp docs/SKILL.md ~/.claude/skills/tokentrail/SKILL.md' },
      ],
    },
  ],
  openclaw: [
    {
      title: '方式 1：本地 JSONL 写入（推荐）',
      desc: 'OpenClaw 在模型响应完成后写入真实 usage，TokenTrail 同步时扫描',
      commands: [
        { label: '写入目录', code: 'mkdir -p ~/.openclaw/usage' },
        { label: 'JSONL 示例', code: 'echo \'{"source":"openclaw","provider":"xiaomi","model":"mimo-v2.5-pro","input_tokens":5000,"output_tokens":1200,"request_id":"id","timestamp":1718000000000}\' >> ~/.openclaw/usage/$(date +%F).jsonl' },
        { label: '同步数据', code: 'node bin/tokentrail.js sync' },
      ],
    },
    {
      title: '核心规则',
      desc: '只在拿到模型返回的真实 response.usage 后写入；拿不到 usage 就跳过，不要写 0',
      commands: [
        { label: '字段要求', code: 'source=openclaw provider=实际服务商 model=实际模型 input_tokens/output_tokens=真实用量 request_id=响应ID' },
      ],
    },
  ],
  hermes: [
    {
      title: '方式 1：本地 JSONL 写入（推荐）',
      desc: 'Hermes 在模型响应完成后写入真实 usage，TokenTrail 同步时扫描',
      commands: [
        { label: '写入目录', code: 'mkdir -p ~/.hermes/usage' },
        { label: 'JSONL 示例', code: 'echo \'{"source":"hermes","provider":"anthropic","model":"claude-sonnet-4-6","input_tokens":5000,"output_tokens":1200,"request_id":"id","timestamp":1718000000000}\' >> ~/.hermes/usage/$(date +%F).jsonl' },
        { label: '同步数据', code: 'node bin/tokentrail.js sync' },
      ],
    },
    {
      title: '核心规则',
      desc: '只在拿到模型返回的真实 response.usage 后写入；拿不到 usage 就跳过，不要写 0',
      commands: [
        { label: '字段要求', code: 'source=hermes provider=实际服务商 model=实际模型 input_tokens/output_tokens=真实用量 request_id=响应ID' },
      ],
    },
  ],
  api: [
    {
      title: 'POST /api/report — 上报用量',
      desc: '任何工具都可以通过 HTTP 上报 token 用量',
      commands: [
        { label: '基本用法', code: 'curl -X POST http://localhost:3820/api/report -H "Content-Type: application/json" -d \'{"source":"my-tool","model":"gpt-4.1","input_tokens":12500,"output_tokens":3200}\'' },
        { label: '完整参数', code: 'curl -X POST http://localhost:3820/api/report -H "Content-Type: application/json" -d \'{"source":"my-tool","model":"gpt-4.1","input_tokens":12500,"output_tokens":3200,"cached_input_tokens":5000,"reasoning_tokens":0,"request_id":"unique-id"}\'' },
      ],
    },
    {
      title: 'POST /api/sync — 触发同步',
      desc: '手动触发全量数据同步',
      commands: [
        { label: '同步', code: 'curl -X POST http://localhost:3820/api/sync' },
      ],
    },
    {
      title: 'GET /api/health — 健康检查',
      desc: '检查服务状态和数据统计',
      commands: [
        { label: '健康检查', code: 'curl http://localhost:3820/api/health' },
      ],
    },
    {
      title: 'GET /api/stats — 查询统计',
      desc: '按天数、来源、模型筛选统计数据',
      commands: [
        { label: '7 天统计', code: 'curl "http://localhost:3820/api/stats?days=7"' },
        { label: '按来源筛选', code: 'curl "http://localhost:3820/api/stats?days=30&source=claude-code,openclaw"' },
      ],
    },
  ],
  cli: [
    {
      title: 'CLI 命令总览',
      desc: 'TokenTrail CLI 提供完整的命令行操作能力',
      commands: [
        { label: '初始化配置', code: 'node bin/tokentrail.js setup' },
        { label: '查看状态', code: 'node bin/tokentrail.js status' },
        { label: '同步数据', code: 'node bin/tokentrail.js sync' },
        { label: '健康检查', code: 'node bin/tokentrail.js health' },
      ],
    },
    {
      title: '上报用量',
      desc: '通过 CLI 直接上报 token 用量数据',
      commands: [
        { label: '基本上报', code: 'node bin/tokentrail.js report --source openclaw --model gpt-4.1 --input 5000 --output 1200' },
        { label: 'JSON 模式', code: 'node bin/tokentrail.js report --json \'{"source":"my-agent","model":"deepseek-v3","input_tokens":3000}\'' },
      ],
    },
    {
      title: '自动定时同步',
      desc: '通过 cron 实现定期自动同步',
      commands: [
        { label: 'cron 配置', code: '*/30 * * * * node /path/to/TokenTrail/bin/tokentrail.js sync >> ~/.tokentrail/sync.log 2>&1' },
      ],
    },
  ],
}

// ─── Toast ──────────────────────────────────────────────────────

function Toast({ message, visible }: { message: string; visible: boolean }) {
  if (!visible) return null
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
      <div className="px-4 py-2 rounded-md border border-eva-green/40 bg-eva-panel/95 backdrop-blur-sm text-eva-green text-sm font-mono shadow-lg shadow-eva-green/10 animate-toast-in">
        {message}
      </div>
    </div>
  )
}

// ─── CopyButton ────────────────────────────────────────────────

function CopyButton({ text, onCopy }: { text: string; onCopy: () => void }) {
  const [copied, setCopied] = useState(false)
  const { t } = useLang()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      onCopy()
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      onCopy()
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="min-h-[28px] shrink-0 rounded border px-2 py-1 text-[10px] font-mono transition-all hover:scale-105 active:scale-95"
      style={{
        borderColor: copied ? 'var(--eva-green)' : 'var(--eva-border)',
        color: copied ? 'var(--eva-green)' : 'var(--eva-text-dim)',
        background: copied ? 'rgba(var(--eva-green-rgb), 0.1)' : 'transparent',
      }}
    >
      {copied ? t('guide.copiedBtn') : t('guide.copyBtn')}
    </button>
  )
}

// ─── CommandBlock ──────────────────────────────────────────────

function CommandBlock({ label, code, onCopy }: { label: string; code: string; onCopy: () => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-eva-text-dim/70">{label}</span>
        <CopyButton text={code} onCopy={onCopy} />
      </div>
      <div
        className="rounded border px-3 py-2 text-xs font-mono break-all leading-relaxed"
        style={{
          borderColor: 'var(--eva-border)',
          background: 'rgba(var(--eva-bg-rgb), 0.6)',
          color: 'var(--eva-text)',
        }}
      >
        <code>{code}</code>
      </div>
    </div>
  )
}

// ─── Modal ─────────────────────────────────────────────────────

function Modal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabId>('quick')
  const [toastMsg, setToastMsg] = useState('')
  const [toastVisible, setToastVisible] = useState(false)
  const { t } = useLang()

  const GUIDE_TABS = [
    { id: 'quick' as TabId, label: t('guide.tabQuick') },
    { id: 'claude-code' as TabId, label: t('guide.tabClaudeCode') },
    { id: 'openclaw' as TabId, label: t('guide.tabOpenclaw') },
    { id: 'hermes' as TabId, label: t('guide.tabHermes') },
    { id: 'api' as TabId, label: t('guide.tabApi') },
    { id: 'cli' as TabId, label: t('guide.tabCli') },
  ]

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 3000)
  }, [])

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // 锁定滚动
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const steps = GUIDE_CONTENT[activeTab]

  return createPortal(
    <>
      <Toast message={toastMsg} visible={toastVisible} />

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-3 z-[95] flex items-start justify-center pt-3 sm:inset-8 sm:pt-8 md:inset-12 lg:inset-x-48 lg:inset-y-12">
        <div
          className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border animate-modal-in sm:max-h-[calc(100vh-6rem)]"
          style={{
            borderColor: 'var(--eva-border)',
            background: 'var(--eva-panel)',
            boxShadow: '0 25px 80px rgba(0,0,0,0.5), 0 0 60px rgba(var(--eva-green-rgb), 0.05)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5"
            style={{ borderColor: 'var(--eva-border)' }}
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-eva-green animate-pulse-slow" />
              <span className="text-sm font-mono font-semibold text-eva-green tracking-[0.08em]">{t('guide.title')}</span>
              <span className="hidden text-[10px] font-mono text-eva-text-dim tracking-[0.08em] sm:inline">INTEGRATION GUIDE</span>
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded border text-xs font-mono text-eva-text-dim transition-all hover:border-eva-green/30 hover:text-eva-text"
              style={{ borderColor: 'var(--eva-border)' }}
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div
            className="flex gap-1 overflow-x-auto border-b px-3 py-2 sm:px-4"
            style={{ borderColor: 'var(--eva-border)' }}
          >
            {GUIDE_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[32px] whitespace-nowrap rounded px-3 py-1.5 text-[11px] font-mono transition-all ${
                  activeTab === tab.id
                    ? 'bg-eva-green/10 text-eva-green border border-eva-green/30'
                    : 'text-eva-text-dim hover:text-eva-text border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-5">
            {steps.map((step, i) => (
              <div key={i} className="space-y-3">
                <div>
                  <h3 className="text-sm font-mono font-semibold text-eva-text tracking-wide">{step.title}</h3>
                  <p className="text-xs font-mono text-eva-text-dim mt-0.5">{step.desc}</p>
                </div>
                <div className="space-y-3">
                  {step.commands.map((cmd, j) => (
                    <CommandBlock
                      key={j}
                      label={cmd.label}
                      code={cmd.code}
                      onCopy={() => showToast(t('guide.toastCopied'))}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"
            style={{ borderColor: 'var(--eva-border)' }}
          >
            <span className="text-[10px] font-mono text-eva-text-dim/50">
              {t('guide.storageNote')}
            </span>
            <button
              onClick={onClose}
              className="min-h-[32px] rounded border border-eva-green/30 px-3 py-1.5 text-xs font-mono text-eva-green transition-all hover:bg-eva-green/10"
            >
              {t('guide.close')}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

// ─── Export ─────────────────────────────────────────────────────

export function IntegrationGuide() {
  const [open, setOpen] = useState(false)
  const { t } = useLang()

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="min-h-[32px] rounded-md border border-eva-border bg-eva-bg/50 px-3 py-1.5 text-xs font-mono text-eva-text-dim transition-all hover:border-eva-green/30 hover:text-eva-green"
      >
        {t('guide.title')}
      </button>

      {open && <Modal onClose={() => setOpen(false)} />}
    </>
  )
}
