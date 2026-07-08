'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '@/lib/LanguageContext'

interface GuideStep {
  title: string
  desc: string
  commands: { label: string; code: string }[]
}

interface QuickCommand {
  label: {
    zh: string
    en: string
  }
  code: string
  desc?: {
    zh: string
    en: string
  }
}

interface QuickCommandGroup {
  title: {
    zh: string
    en: string
  }
  desc: {
    zh: string
    en: string
  }
  commands: QuickCommand[]
}

interface SourceHealth {
  source: string
  record_count: number
  latest_record: string
  stale: boolean
}

interface StatusData {
  sources: SourceHealth[]
}

type TabId = 'quick' | 'codex' | 'claude-code' | 'traework' | 'openclaw' | 'hermes' | 'api' | 'cli'

interface SourcePlan {
  id: TabId
  title: string
  displayTitle?: {
    zh: string
    en: string
  }
  badge: {
    zh: string
    en: string
  }
  desc: {
    zh: string
    en: string
  }
  sourceKey?: string
  recommended?: boolean
}

const SOURCE_PLANS: SourcePlan[] = [
  {
    id: 'codex',
    title: 'Codex',
    badge: { zh: '自动扫描', en: 'Auto scan' },
    desc: {
      zh: '适合已经在本机使用 Codex 的用户。TokenTrail 读取本地会话记录，不需要代理或手工导出。',
      en: 'For local Codex users. TokenTrail reads local session records without a proxy or manual export.',
    },
    sourceKey: 'codex',
    recommended: true,
  },
  {
    id: 'claude-code',
    title: 'Claude Code',
    badge: { zh: '自动扫描', en: 'Auto scan' },
    desc: {
      zh: '适合 Claude Code 用户。同步时读取本地项目日志，可选安装 Skill 让 AI 帮你触发查询。',
      en: 'For Claude Code users. Sync reads local project logs; the optional Skill lets the AI trigger checks for you.',
    },
    sourceKey: 'claude-code',
    recommended: true,
  },
  {
    id: 'traework',
    title: 'TraeWork',
    badge: { zh: '历史导入', en: 'History import' },
    desc: {
      zh: '适合 TraeWork 用户。TokenTrail 会从本机聊天历史里补齐可识别的用量记录。',
      en: 'For TraeWork users. TokenTrail backfills recognizable usage records from local chat history.',
    },
    sourceKey: 'traework',
  },
  {
    id: 'openclaw',
    title: 'OpenClaw',
    badge: { zh: '需要接入', en: 'Needs wiring' },
    desc: {
      zh: '适合可改工具端代码的用户。要在模型返回后写入真实 response.usage，不能只写测试样例。',
      en: 'For users who can edit the tool pipeline. Write real response.usage after model calls, not only test samples.',
    },
    sourceKey: 'openclaw',
  },
  {
    id: 'hermes',
    title: 'Hermes',
    badge: { zh: '需要接入', en: 'Needs wiring' },
    desc: {
      zh: '适合可改 Hermes 调用链的用户。接入点应放在模型调用完成、拿到 usage 之后。',
      en: 'For users who can edit the Hermes call chain. Wire it after the model call returns usage.',
    },
    sourceKey: 'hermes',
  },
  {
    id: 'api',
    title: 'Custom / API',
    displayTitle: {
      zh: '自定义工具 / API',
      en: 'Custom / API',
    },
    badge: { zh: '通用方案', en: 'Universal' },
    desc: {
      zh: '适合任何自研脚本或代理服务。只要能拿到 tokens，就可以通过 API 或 CLI 上报。',
      en: 'For custom scripts or proxy services. If you can read token usage, report it through the API or CLI.',
    },
  },
]

const QUICK_COMMAND_GROUPS: QuickCommandGroup[] = [
  {
    title: {
      zh: '单次同步',
      en: 'One-time sync',
    },
    desc: {
      zh: '手动执行一次数据同步，TokenTrail 会自动扫描本机已支持的数据源。',
      en: 'Run one manual sync. TokenTrail scans supported local sources automatically.',
    },
    commands: [
      {
        label: {
          zh: '同步',
          en: 'Sync',
        },
        code: 'node bin/tokentrail.js sync',
      },
    ],
  },
  {
    title: {
      zh: '持续同步',
      en: 'Continuous sync',
    },
    desc: {
      zh: '注册为本机后台服务，之后自动同步用量数据。',
      en: 'Install the local background service so usage keeps syncing automatically.',
    },
    commands: [
      {
        label: {
          zh: '安装',
          en: 'Install',
        },
        code: 'node bin/tokentrail.js daemon install',
      },
      {
        label: {
          zh: '状态',
          en: 'Status',
        },
        code: 'node bin/tokentrail.js daemon status',
      },
      {
        label: {
          zh: '重启',
          en: 'Restart',
        },
        code: 'node bin/tokentrail.js daemon restart',
      },
      {
        label: {
          zh: '卸载',
          en: 'Uninstall',
        },
        code: 'node bin/tokentrail.js daemon uninstall',
      },
    ],
  },
  {
    title: {
      zh: '验证与打开',
      en: 'Verify and open',
    },
    desc: {
      zh: '同步后用诊断命令确认是否接好，或者直接打开仪表盘查看。',
      en: 'After syncing, verify the setup or open the dashboard directly.',
    },
    commands: [
      {
        label: {
          zh: '诊断',
          en: 'Doctor',
        },
        code: 'node bin/tokentrail.js daemon status',
      },
      {
        label: {
          zh: '打开',
          en: 'Open',
        },
        code: 'node bin/tokentrail.js open',
      },
    ],
  },
]

const GUIDE_CONTENT: Record<TabId, GuideStep[]> = {
  quick: [
    {
      title: '如果你只想先用起来',
      desc: '先复制上面的“单次同步”。能看到数据后，再安装“持续同步”。大多数用户不需要先理解每个数据源的底层接入方式。',
      commands: [],
    },
    {
      title: '怎么判断接好了',
      desc: '成功的标准不是“命令跑过”，而是系统状态里能看到对应来源、记录数和最近更新时间。',
      commands: [
        { label: '健康检查', code: 'curl http://localhost:3820/api/health' },
      ],
    },
    {
      title: '服务没启动时',
      desc: '如果命令提示无法连接服务，再启动 TokenTrail。已经安装持续同步服务时通常不用做这一步。',
      commands: [
        { label: '启动', code: 'cd TokenTrail && npm run dev' },
      ],
    },
    {
      title: '安装 Skill（可选）',
      desc: '让 Codex 或 Claude Code 能用自然语言帮你同步、查状态、做健康检查。',
      commands: [
        { label: 'Codex', code: 'mkdir -p ~/.codex/skills/tokentrail && cp docs/SKILL.md ~/.codex/skills/tokentrail/SKILL.md' },
        { label: 'Claude Code', code: 'mkdir -p ~/.claude/skills/tokentrail && cp docs/SKILL.md ~/.claude/skills/tokentrail/SKILL.md' },
        { label: 'Cursor', code: 'mkdir -p ~/.cursor/skills/tokentrail && cp docs/SKILL.md ~/.cursor/skills/tokentrail/SKILL.md' },
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
  codex: [
    {
      title: '方式 1：零配置本地扫描（推荐）',
      desc: 'Codex 会把每次调用的真实增量用量写入本地会话；TokenTrail 直接读取，无需插件、代理或手工导出',
      commands: [
        { label: '确认会话目录', code: 'find ~/.codex/sessions -type f -name \'*.jsonl\' | head' },
        { label: '同步到 TokenTrail', code: 'node bin/tokentrail.js sync' },
      ],
    },
    {
      title: '方式 2：独立预检与导入',
      desc: '先只读预检识别结果，确认无误后再通过 TokenTrail API 导入；request_id 会自动去重',
      commands: [
        { label: '只读预检', code: 'node scripts/sync-codex.js --dry-run' },
        { label: '正式导入', code: 'node scripts/sync-codex.js --host=http://localhost:3820' },
      ],
    },
    {
      title: '方式 3：安装 Codex Skill（可选）',
      desc: '安装后可以直接让 Codex 调用 TokenTrail CLI 同步、查询状态或执行健康检查',
      commands: [
        { label: '安装 Skill', code: 'mkdir -p ~/.codex/skills/tokentrail && cp docs/SKILL.md ~/.codex/skills/tokentrail/SKILL.md' },
        { label: '自然语言调用', code: '同步 TokenTrail 数据并汇报 Codex 用量' },
      ],
    },
    {
      title: '采集规则',
      desc: '读取 ~/.codex/sessions/**/*.jsonl 中 token_count.last_token_usage 的真实增量；不会修改 Codex 会话文件',
      commands: [
        { label: '采集字段', code: 'input_tokens cached_input_tokens output_tokens reasoning_output_tokens' },
        { label: '去重规则', code: 'request_id=codex:<会话相对路径>:L<事件行号>' },
      ],
    },
  ],
  traework: [
    {
      title: '方式 1：本地历史扫描（推荐）',
      desc: 'TraeWork 的历史会话会在同步时自动扫描；适合先把已有记录补进 TokenTrail。',
      commands: [
        { label: '确认历史目录', code: 'find ~/.trae/chat -name chat_histories.json | head' },
        { label: '同步到 TokenTrail', code: 'node bin/tokentrail.js sync' },
      ],
    },
    {
      title: '接入成功标准',
      desc: '同步完成后，系统状态的数据源健康里应出现 TraeWork，并显示记录数与最近更新时间。',
      commands: [
        { label: '查看状态', code: 'node bin/tokentrail.js status' },
      ],
    },
  ],
  openclaw: [
    {
      title: '方式 1：在 OpenClaw 调用链写入真实 usage（推荐）',
      desc: '接入点放在模型响应完成之后：拿到 response.usage 才写入 JSONL；没有 usage 就跳过，不要写 0。',
      commands: [
        { label: '写入目录', code: 'mkdir -p ~/.openclaw/usage' },
        { label: '真实写入字段', code: 'source provider model input_tokens output_tokens cached_input_tokens reasoning_tokens request_id timestamp' },
        { label: '同步数据', code: 'node bin/tokentrail.js sync' },
      ],
    },
    {
      title: '测试样例（只用于验证管道）',
      desc: '下面这条只用来确认 TokenTrail 能扫描 JSONL，不代表 OpenClaw 已经持续接入。',
      commands: [
        { label: '写入一条测试记录', code: 'echo \'{"source":"openclaw","provider":"xiaomi","model":"mimo-v2.5-pro","input_tokens":5000,"output_tokens":1200,"request_id":"openclaw-test-001","timestamp":1718000000000}\' >> ~/.openclaw/usage/$(date +%F).jsonl' },
      ],
    },
  ],
  hermes: [
    {
      title: '方式 1：在 Hermes 调用链写入真实 usage（推荐）',
      desc: '接入点放在模型响应完成之后：拿到 response.usage 才写入 JSONL；没有 usage 就跳过，不要写 0。',
      commands: [
        { label: '写入目录', code: 'mkdir -p ~/.hermes/usage' },
        { label: '真实写入字段', code: 'source provider model input_tokens output_tokens cached_input_tokens reasoning_tokens request_id timestamp' },
        { label: '同步数据', code: 'node bin/tokentrail.js sync' },
      ],
    },
    {
      title: '测试样例（只用于验证管道）',
      desc: '下面这条只用来确认 TokenTrail 能扫描 JSONL，不代表 Hermes 已经持续接入。',
      commands: [
        { label: '写入一条测试记录', code: 'echo \'{"source":"hermes","provider":"anthropic","model":"claude-sonnet-4-6","input_tokens":5000,"output_tokens":1200,"request_id":"hermes-test-001","timestamp":1718000000000}\' >> ~/.hermes/usage/$(date +%F).jsonl' },
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
      <div
        aria-live="polite"
        className="px-4 py-2 rounded-md border border-eva-green/40 bg-eva-panel/95 backdrop-blur-sm text-eva-green text-sm font-mono shadow-lg shadow-eva-green/10 animate-toast-in"
      >
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
      type="button"
      onClick={handleCopy}
      className="min-h-[30px] shrink-0 rounded border px-2.5 py-1 text-[11px] font-mono transition-[transform,border-color,background-color,color,box-shadow] duration-200 hover:-translate-y-0.5 active:translate-y-0.5"
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
        <span className="text-[11px] font-mono uppercase tracking-wider text-eva-text-dim/70">{label}</span>
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

function QuickCommandPanel({ onCopy }: { onCopy: () => void }) {
  const { lang } = useLang()

  return (
    <div className="space-y-5 rounded-xl border border-eva-green/20 bg-eva-bg/25 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-eva-green/80">
            {lang === 'zh' ? '推荐路径' : 'Recommended path'}
          </div>
          <h3 className="mt-1 text-xl font-mono font-semibold tracking-wide text-eva-text sm:text-2xl">
            {lang === 'zh' ? '先同步，再后台常驻' : 'Sync once, then keep it running'}
          </h3>
          <p className="mt-1 text-[13px] leading-6 font-mono text-eva-text-dim/90">
            {lang === 'zh'
              ? '普通用户只需要复制这里的命令；下面的数据源卡片只是告诉你 TokenTrail 已经能自动识别哪些工具。'
              : 'Most users only need these commands. The source cards below explain what TokenTrail can already detect.'}
          </p>
        </div>
        <span className="w-fit rounded-full border border-eva-green/25 bg-eva-green/10 px-3 py-1 text-[11px] font-mono text-eva-green">
          {lang === 'zh' ? '本地运行 · 不上传云端' : 'Local only · no cloud upload'}
        </span>
      </div>

      <div className="space-y-5">
        {QUICK_COMMAND_GROUPS.map(group => (
          <section key={group.title.zh} className="space-y-3">
            <div>
              <h4 className="text-[18px] font-mono font-semibold tracking-wide text-eva-text">
                {group.title[lang]}
              </h4>
              <p className="mt-1 text-[13px] leading-6 font-mono text-eva-text-dim/90">
                {group.desc[lang]}
              </p>
            </div>
            <div className="space-y-2">
              {group.commands.map(command => (
                <div
                  key={`${group.title.zh}-${command.code}`}
                  className="flex flex-col gap-2 rounded-lg border border-eva-border/80 bg-eva-panel/60 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="w-12 shrink-0 text-[13px] font-mono text-eva-text-dim/70 sm:w-14">
                      {command.label[lang]}
                    </span>
                    <code className="min-w-0 break-all text-[15px] leading-6 font-mono text-eva-text sm:text-[16px]">
                      {command.code}
                    </code>
                  </div>
                  <CopyButton text={command.code} onCopy={onCopy} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="rounded-lg border border-status-warning/20 bg-status-warning/5 px-3 py-2.5 text-[13px] leading-6 font-mono text-eva-text-dim">
        {lang === 'zh'
          ? '提示：如果你已经把 TokenTrail CLI 加入 PATH，可以把上面的 node bin/tokentrail.js 替换成 tokentrail，例如 tokentrail sync、tokentrail daemon install。'
          : 'Tip: if the TokenTrail CLI is already in your PATH, replace node bin/tokentrail.js with tokentrail, e.g. tokentrail sync, tokentrail daemon install.'}
      </div>
    </div>
  )
}

function formatRelativeTime(isoString: string | null, lang: 'zh' | 'en'): string {
  if (!isoString) return lang === 'zh' ? '未检测到' : 'Not detected'
  const diffMs = Date.now() - new Date(isoString).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return lang === 'zh' ? '刚刚' : 'Just now'
  if (minutes < 60) return lang === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return lang === 'zh' ? `${hours} 小时前` : `${hours}h ago`
  const days = Math.round(hours / 24)
  return lang === 'zh' ? `${days} 天前` : `${days}d ago`
}

function SourceOverview({
  status,
  onSelect,
}: {
  status: StatusData | null
  onSelect: (tab: TabId) => void
}) {
  const { lang } = useLang()
  const healthBySource = useMemo(() => {
    const map = new Map<string, SourceHealth>()
    status?.sources.forEach(source => map.set(source.source, source))
    return map
  }, [status])

  return (
    <div className="rounded-lg border border-eva-green/15 bg-eva-bg/25 p-3 sm:p-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-[15px] font-mono font-semibold tracking-wide text-eva-text">
            {lang === 'zh' ? 'TokenTrail 已支持的来源' : 'Sources TokenTrail already supports'}
          </h3>
          <p className="mt-1 text-[13px] leading-6 font-mono text-eva-text-dim/90">
            {lang === 'zh'
              ? '绿色代表已经检测到数据；未检测到也没关系，通常先执行上面的同步命令即可。'
              : 'Green means data was detected. If not, usually start with the sync command above.'}
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {SOURCE_PLANS.map(plan => {
          const sourceHealth = plan.sourceKey ? healthBySource.get(plan.sourceKey) : undefined
          const detected = Boolean(sourceHealth)
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => onSelect(plan.id)}
              className={`group rounded-md border px-3 py-3 text-left transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 ${
                detected
                  ? 'border-status-success/35 bg-status-success/5 hover:shadow-[0_0_22px_rgba(var(--eva-green-rgb),0.10)]'
                  : plan.recommended
                    ? 'border-eva-green/25 bg-eva-green/5'
                    : 'border-eva-border/80 bg-eva-bg/20'
              }`}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-sm font-mono font-semibold text-eva-text">{plan.displayTitle?.[lang] || plan.title}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-mono ${
                  detected
                    ? 'border-status-success/35 text-status-success'
                    : 'border-eva-border text-eva-text-dim'
                }`}>
                  {detected
                    ? (lang === 'zh' ? '已检测' : 'Detected')
                    : plan.badge[lang]}
                </span>
              </div>
              <p className="min-h-[44px] text-[13px] leading-6 font-mono text-eva-text-dim/90">{plan.desc[lang]}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-[12px] font-mono">
                <span className={detected ? 'text-status-success' : 'text-eva-text-dim/70'}>
                  {detected && sourceHealth
                    ? `${sourceHealth.record_count.toLocaleString()} ${lang === 'zh' ? '条' : 'records'} · ${formatRelativeTime(sourceHealth.latest_record, lang)}`
                    : (lang === 'zh' ? '查看接入步骤' : 'View setup steps')}
                </span>
                <span className="text-eva-green opacity-80 transition-transform group-hover:translate-x-0.5">→</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Modal ─────────────────────────────────────────────────────

function Modal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabId>('quick')
  const [status, setStatus] = useState<StatusData | null>(null)
  const [toastMsg, setToastMsg] = useState('')
  const [toastVisible, setToastVisible] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const { t } = useLang()

  const GUIDE_TABS = useMemo(() => [
    { id: 'quick' as TabId, label: t('guide.tabQuick') },
    { id: 'codex' as TabId, label: t('guide.tabCodex') },
    { id: 'claude-code' as TabId, label: t('guide.tabClaudeCode') },
    { id: 'traework' as TabId, label: t('guide.tabTraework') },
    { id: 'openclaw' as TabId, label: t('guide.tabOpenclaw') },
    { id: 'hermes' as TabId, label: t('guide.tabHermes') },
    { id: 'api' as TabId, label: t('guide.tabApi') },
    { id: 'cli' as TabId, label: t('guide.tabCli') },
  ], [t])

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 3000)
  }, [])

  const selectTab = useCallback((tabId: TabId) => {
    setActiveTab(tabId)
    window.requestAnimationFrame(() => {
      document.getElementById(`integration-guide-tab-${tabId}`)?.focus()
    })
  }, [])

  const handleTabKeyDown = useCallback((e: ReactKeyboardEvent<HTMLButtonElement>, tabId: TabId) => {
    const currentIndex = GUIDE_TABS.findIndex(tab => tab.id === tabId)
    if (currentIndex === -1) return

    let nextIndex = currentIndex
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % GUIDE_TABS.length
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + GUIDE_TABS.length) % GUIDE_TABS.length
    else if (e.key === 'Home') nextIndex = 0
    else if (e.key === 'End') nextIndex = GUIDE_TABS.length - 1
    else return

    e.preventDefault()
    selectTab(GUIDE_TABS[nextIndex].id)
  }, [GUIDE_TABS, selectTab])

  useEffect(() => {
    let cancelled = false
    fetch('/api/status')
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (!cancelled && json && Array.isArray(json.sources)) setStatus({ sources: json.sources })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // ESC 关闭 + Tab 焦点留在弹窗内
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true')

      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // 初始焦点与关闭后还原
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => {
      document.getElementById('integration-guide-tab-quick')?.focus()
    }, 0)
    return () => {
      window.clearTimeout(focusTimer)
      previousFocusRef.current?.focus?.()
    }
  }, [])

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
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="integration-guide-title"
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
              <span id="integration-guide-title" className="text-sm font-mono font-semibold text-eva-green tracking-[0.08em]">{t('guide.title')}</span>
              <span className="hidden text-[11px] font-mono text-eva-text-dim tracking-[0.08em] sm:inline">INTEGRATION GUIDE</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('guide.close')}
              className="flex h-8 w-8 items-center justify-center rounded border text-xs font-mono text-eva-text-dim transition-[transform,border-color,background-color,color,box-shadow] duration-200 hover:border-eva-green/30 hover:text-eva-text"
              style={{ borderColor: 'var(--eva-border)' }}
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div
            role="tablist"
            aria-label={t('guide.title')}
            className="flex gap-1 overflow-x-auto border-b px-3 py-2 sm:px-4"
            style={{ borderColor: 'var(--eva-border)' }}
          >
            {GUIDE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`integration-guide-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`integration-guide-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
                className={`min-h-[32px] whitespace-nowrap rounded px-3 py-1.5 text-[11px] font-mono transition-[transform,border-color,background-color,color,box-shadow] duration-200 ${
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
          <div
            id={`integration-guide-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`integration-guide-tab-${activeTab}`}
            className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-5"
          >
            {activeTab === 'quick' && (
              <QuickCommandPanel onCopy={() => showToast(t('guide.toastCopied'))} />
            )}
            {activeTab === 'quick' && (
              <SourceOverview status={status} onSelect={selectTab} />
            )}
            {steps.map((step, i) => (
              <div key={i} className="space-y-3">
                <div>
                  <h3 className="text-sm font-mono font-semibold text-eva-text tracking-wide">{step.title}</h3>
                  <p className="text-[13px] leading-6 font-mono text-eva-text-dim mt-1">{step.desc}</p>
                </div>
                {step.commands.length > 0 && (
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
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"
            style={{ borderColor: 'var(--eva-border)' }}
          >
            <span className="text-[11px] font-mono text-eva-text-dim/60">
              {t('guide.storageNote')}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[32px] rounded border border-eva-green/30 px-3 py-1.5 text-xs font-mono text-eva-green transition-[transform,border-color,background-color,color,box-shadow] duration-200 hover:bg-eva-green/10"
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
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[32px] rounded-md border border-eva-border bg-eva-bg/45 px-3 py-1.5 text-xs font-mono text-eva-text-dim transition-[transform,border-color,background-color,color,box-shadow] duration-200 hover:border-eva-green/20 hover:text-eva-text"
      >
        {t('guide.title')}
      </button>

      {open && <Modal onClose={() => setOpen(false)} />}
    </>
  )
}
