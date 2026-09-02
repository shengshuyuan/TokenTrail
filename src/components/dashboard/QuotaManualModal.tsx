'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '@/lib/LanguageContext'
import type { ProviderId, ProviderQuotaSnapshot } from '@/lib/quotas/types'
import { ProviderBrandIcon } from './QuotaBrandIcons'

interface QuotaManualModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  initialProvider?: ProviderId
  defaultTab?: 'auth' | 'extractor' | 'form'
}

const EXTRACTOR_SCRIPTS: Record<string, string> = {
  grok: `(async function extractGrok() {
  const now = Date.now();
  const snapshot = {
    provider: 'grok',
    product: 'subscription',
    accountLabel: 'X Premium+',
    status: 'healthy',
    windows: [
      { id: '5h', label: '5h', unit: 'request', usedPercent: 0, windowMinutes: 300, resetsAt: now + 2*3600000 + 18*60000 },
      { id: 'week', label: 'week', unit: 'request', usedPercent: 0, windowMinutes: 10080, resetsAt: now + 5*86400000 }
    ],
    wallets: [],
    source: 'manual',
    fetchedAt: now,
    lastSuccessAt: now
  };
  await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
  console.log('✅ Grok 额度已复制到剪贴板！');
})();`,
  kimi: `(async function extractKimi() {
  const now = Date.now();
  const snapshot = {
    provider: 'kimi',
    product: 'subscription',
    accountLabel: 'Kimi 账号',
    status: 'healthy',
    windows: [
      { id: 'kimi-300', label: '5h', unit: 'request', usedPercent: 37, windowMinutes: 300, resetsAt: now + 2*3600000 + 18*60000 },
      { id: 'kimi-10080', label: 'week', unit: 'request', usedPercent: 63, windowMinutes: 10080, resetsAt: now + 4*86400000 }
    ],
    wallets: [{ label: 'extra', balance: 42.80, currency: 'CNY' }],
    source: 'manual',
    fetchedAt: now,
    lastSuccessAt: now
  };
  await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
  console.log('✅ Kimi 额度已复制到剪贴板！');
})();`,
  glm: `(async function extractGlm() {
  const now = Date.now();
  const snapshot = {
    provider: 'glm',
    product: 'subscription',
    accountLabel: 'GLM 订阅',
    status: 'healthy',
    windows: [
      { id: 'tokens-5h', label: '5h', unit: 'token', usedPercent: 82, windowMinutes: 300, resetsAt: now + 2*3600000 + 18*60000 },
      { id: 'tokens-week', label: 'week', unit: 'token', usedPercent: 45, windowMinutes: 10080, resetsAt: now + 4*86400000 }
    ],
    wallets: [],
    source: 'manual',
    fetchedAt: now,
    lastSuccessAt: now
  };
  await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
  console.log('✅ GLM 额度已复制到剪贴板！');
})();`,
  codex: `(async function extractCodex() {
  const now = Date.now();
  const snapshot = {
    provider: 'codex',
    product: 'subscription',
    accountLabel: '个人账户',
    status: 'healthy',
    windows: [
      { id: '5h', label: '5h', unit: 'request', usedPercent: 6, windowMinutes: 300, resetsAt: now + 2*3600000 + 18*60000 },
      { id: 'week', label: 'week', unit: 'request', usedPercent: 22, windowMinutes: 10080, resetsAt: now + 4*86400000 }
    ],
    wallets: [],
    source: 'manual',
    fetchedAt: now,
    lastSuccessAt: now
  };
  await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
  console.log('✅ Codex 额度已复制到剪贴板！');
})();`,
  gemini: `(async function extractGemini() {
  const now = Date.now();
  const snapshot = {
    provider: 'gemini',
    product: 'subscription',
    accountLabel: 'Pro',
    status: 'healthy',
    windows: [
      { id: 'gemini-2.5-pro', label: 'pro', unit: 'request', usedPercent: 68, resetsAt: now + 2*3600000 + 18*60000 },
      { id: 'gemini-2.5-flash', label: 'flash', unit: 'request', usedPercent: 31, resetsAt: now + 4*86400000 }
    ],
    wallets: [],
    source: 'manual',
    fetchedAt: now,
    lastSuccessAt: now
  };
  await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
  console.log('✅ Gemini 额度已复制到剪贴板！');
})();`,
}

const PROVIDER_INFO: Record<ProviderId, { name: string; desc: string; authUrl?: string; authDoc: string }> = {
  glm: {
    name: 'GLM (智谱 Coding Plan)',
    desc: '支持通过智谱 Coding Plan Token / API Key 直连官方配额接口获取实时 5小时与每周 Token 消耗。',
    authUrl: 'https://bigmodel.cn',
    authDoc: '登录智谱开放平台 (bigmodel.cn) 或 api.z.ai 获取 API Key。',
  },
  grok: {
    name: 'xAI Grok',
    desc: '复用 Grok CLI 的官方 OAuth 登录态读取订阅 Credits；Management Key + Team ID 读取 xAI API 账单。',
    authUrl: 'https://grok.com/settings',
    authDoc: '点击「发起授权」会打开终端与官方浏览器登录页；若自动打开失败，可自行运行 grok login --oauth。',
  },
  gemini: {
    name: 'Google Gemini',
    desc: '复用本地 Gemini CLI OAuth 登录态，或输入 Google Cloud / AI Studio 项目 ID 读取 Pro / Flash 模型额度。',
    authUrl: 'https://aistudio.google.com',
    authDoc: '在终端运行 gemini 或登录 Google AI Studio 获取 Project ID。',
  },
  kimi: {
    name: 'Moonshot Kimi Code',
    desc: '复用 Kimi CLI 官方登录态或 Kimi Code Key 读取订阅额度；Moonshot 开放平台余额属于另一套账号产品。',
    authUrl: 'https://www.kimi.com/code',
    authDoc: '优先点击浏览器登录；若自动打开失败，可自行运行 kimi login。Kimi Code Key 必须来自 Kimi Code 控制台。',
  },
  codex: {
    name: 'OpenAI Codex',
    desc: '优先通过 Codex CLI 的 ChatGPT 官方登录读取订阅额度；API Key 是另一套产品，不能代替 ChatGPT 登录。',
    authUrl: 'https://chatgpt.com',
    authDoc: '优先点击浏览器登录；若自动打开失败，可自行运行 codex login。',
  },
}

export function QuotaManualModal({
  isOpen,
  onClose,
  onSuccess,
  initialProvider = 'grok',
  defaultTab = 'auth',
}: QuotaManualModalProps) {
  const { t } = useLang()
  const [tab, setTab] = useState<'auth' | 'extractor' | 'form'>(defaultTab)
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(initialProvider)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [pendingProvider, setPendingProvider] = useState<ProviderId | null>(null)
  const [grokShowApiKey, setGrokShowApiKey] = useState(false)
  const [codexShowApiKey, setCodexShowApiKey] = useState(false)
  const grokPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // 授权表单字段
  const [glmToken, setGlmToken] = useState('')
  const [glmBaseUrl, setGlmBaseUrl] = useState('https://api.z.ai')
  const [grokKey, setGrokKey] = useState('')
  const [grokTeamId, setGrokTeamId] = useState('')
  const [kimiKey, setKimiKey] = useState('')
  const [codexKey, setCodexKey] = useState('')
  const [geminiProject, setGeminiProject] = useState('')

  // 快捷手动录入
  const [accountLabel, setAccountLabel] = useState('')
  const [h5Percent, setH5Percent] = useState('35')
  const [weekPercent, setWeekPercent] = useState('60')
  const [walletBalance, setWalletBalance] = useState('')

  // JSON 导入
  const [jsonInput, setJsonInput] = useState('')

  useEffect(() => {
    if (initialProvider) setSelectedProvider(initialProvider)
    if (defaultTab) setTab(defaultTab)
  }, [initialProvider, defaultTab])

  const stopAuthPoll = () => {
    if (grokPollRef.current) {
      clearInterval(grokPollRef.current)
      grokPollRef.current = null
    }
    setPendingProvider(null)
  }

  useEffect(() => {
    if (!isOpen || (pendingProvider && selectedProvider !== pendingProvider)) {
      if (grokPollRef.current) {
        clearInterval(grokPollRef.current)
        grokPollRef.current = null
      }
      setPendingProvider(null)
    }
  }, [isOpen, selectedProvider, pendingProvider])

  useEffect(() => {
    return () => {
      if (grokPollRef.current) clearInterval(grokPollRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    const getFocusable = () =>
      dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) ?? []
    getFocusable()[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...getFocusable()]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, onClose])

  if (!isOpen || typeof document === 'undefined') return null

  // 发起官方授权与连接校验
  const handleVerifyAuth = async () => {
    setMessage(null)
    setLoading(true)
    try {
      const credentials: Record<string, string> = {}
      if (selectedProvider === 'glm') {
        credentials.token = glmToken
        credentials.baseUrl = glmBaseUrl
      } else if (selectedProvider === 'grok') {
        credentials.key = grokKey
        credentials.teamId = grokTeamId
      } else if (selectedProvider === 'kimi') {
        credentials.key = kimiKey
      } else if (selectedProvider === 'codex') {
        credentials.key = codexKey
      } else if (selectedProvider === 'gemini') {
        credentials.project = geminiProject
      }

      const res = await fetch('/api/quotas/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          credentials,
          method:
            selectedProvider === 'grok'
              ? 'apikey'
              : selectedProvider === 'kimi'
                ? 'kimi_code_key'
                : selectedProvider === 'codex'
                  ? 'apikey'
                  : undefined,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setMessage({ text: data.message || '授权成功，额度已实时同步！', type: 'success' })
        if (onSuccess) onSuccess()
      } else if (res.ok && data.pending) {
        startAuthPolling(selectedProvider, data.message)
      } else {
        const manual = data.manualCommand ? `；也可在终端手动运行：${data.manualCommand}` : ''
        setMessage({ text: `${data.error || '授权校验失败，请检查凭证'}${manual}`, type: 'error' })
      }
    } catch {
      setMessage({ text: '网络请求异常，请稍后再试', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const finishCliAuth = async (provider: ProviderId) => {
    const res = await fetch('/api/quotas/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, method: 'oauth' }),
    })
    const data = await res.json()
    if (res.ok && data.success) {
      stopAuthPoll()
      setMessage({ text: data.message || '授权完成，已同步可读取额度。', type: 'success' })
      if (onSuccess) onSuccess()
      return true
    }
    return false
  }

  const startAuthPolling = (provider: ProviderId, initialMessage?: string) => {
    setPendingProvider(provider)
    setMessage({ text: initialMessage || '已打开授权窗口，请按提示完成登录', type: 'success' })
    const deadline = Date.now() + 180_000
    grokPollRef.current = setInterval(async () => {
      if (Date.now() > deadline) {
        stopAuthPoll()
        if (provider === 'grok') setGrokShowApiKey(true)
        if (provider === 'codex') setCodexShowApiKey(true)
        setMessage({ text: '授权等待超时；可重新发起，或在终端手动完成登录。', type: 'error' })
        return
      }
      try {
        const statusRes = await fetch(`/api/quotas/auth?provider=${provider}`)
        const status = await statusRes.json()
        if (status.loggedIn) await finishCliAuth(provider)
      } catch {
        // keep polling
      }
    }, 2000)
  }

  const handleCliOAuth = async (provider: 'grok' | 'kimi' | 'codex' | 'gemini') => {
    setMessage(null)
    setLoading(true)
    const labels = {
      grok: { success: t('quota.auth.grok.success'), failed: t('quota.auth.grok.failed'), missing: t('quota.auth.grok.cliMissing'), manual: 'grok login --oauth' },
      kimi: { success: 'Kimi Code 授权成功', failed: 'Kimi Code 授权失败', missing: '无法打开授权窗口；请在终端手动运行 kimi login', manual: 'kimi login' },
      codex: { success: 'Codex 授权成功', failed: 'Codex 授权失败', missing: '无法打开授权窗口；请在终端手动运行 codex login', manual: 'codex login' },
      gemini: { success: 'Gemini 授权成功', failed: 'Gemini 授权失败', missing: '无法打开授权窗口；请在终端手动运行 gemini', manual: 'gemini' },
    } as const
    const copy = labels[provider]
    try {
      const res = await fetch('/api/quotas/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, method: 'oauth' }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setMessage({ text: data.message || copy.success, type: 'success' })
        if (onSuccess) onSuccess()
        return
      }
      if (res.ok && data.pending) {
        startAuthPolling(provider, data.message)
        return
      }
      if (provider === 'grok' && data.fallback === 'apikey') {
        setGrokShowApiKey(true)
        setMessage({ text: data.error || copy.missing, type: 'error' })
        return
      }
      if (provider === 'codex') setCodexShowApiKey(true)
      const manual = data.manualCommand ? `；也可在终端手动运行：${data.manualCommand}` : `；也可在终端手动运行：${copy.manual}`
      setMessage({ text: `${data.error || copy.failed}${manual}`, type: 'error' })
    } catch {
      if (provider === 'grok') setGrokShowApiKey(true)
      if (provider === 'codex') setCodexShowApiKey(true)
      setMessage({ text: copy.missing, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // 复制浏览器提取脚本
  const handleCopyScript = async () => {
    const script = EXTRACTOR_SCRIPTS[selectedProvider] || ''
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {}
  }

  // 导入 JSON 快照
  const handleImportJson = async () => {
    setMessage(null)
    if (!jsonInput.trim()) return
    try {
      const parsed = JSON.parse(jsonInput)
      setLoading(true)
      const res = await fetch('/api/quotas/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setMessage({ text: t('quota.manual.importSuccess'), type: 'success' })
        setJsonInput('')
        if (onSuccess) onSuccess()
      } else {
        setMessage({ text: data.error || t('quota.manual.importFailed'), type: 'error' })
      }
    } catch {
      setMessage({ text: t('quota.manual.importFailed'), type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // 快捷表单保存
  const handleSaveForm = async () => {
    setMessage(null)
    setLoading(true)
    try {
      const now = Date.now()
      const p5 = Math.max(0, Math.min(100, parseFloat(h5Percent) || 0))
      const pW = Math.max(0, Math.min(100, parseFloat(weekPercent) || 0))
      const bal = parseFloat(walletBalance)

      const payload: Partial<ProviderQuotaSnapshot> = {
        provider: selectedProvider,
        product: 'subscription',
        accountLabel: accountLabel.trim() || undefined,
        status: 'healthy',
        windows: [
          {
            id: selectedProvider === 'gemini' ? 'gemini-pro' : '5h',
            label: selectedProvider === 'gemini' ? 'pro' : '5h',
            unit: selectedProvider === 'glm' ? 'token' : 'request',
            usedPercent: p5,
            windowMinutes: 300,
            resetsAt: now + 2 * 3600_000 + 18 * 60_000,
          },
          {
            id: selectedProvider === 'gemini' ? 'gemini-flash' : 'week',
            label: selectedProvider === 'gemini' ? 'flash' : 'week',
            unit: selectedProvider === 'glm' ? 'token' : 'request',
            usedPercent: pW,
            windowMinutes: 10080,
            resetsAt: now + 4 * 86400_000,
          },
        ],
        wallets: !isNaN(bal) && bal > 0 ? [{ label: 'extra', balance: bal, currency: selectedProvider === 'kimi' ? 'CNY' : 'USD' }] : [],
        source: 'manual',
        fetchedAt: now,
        lastSuccessAt: now,
        stale: false,
      }

      const res = await fetch('/api/quotas/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setMessage({ text: t('quota.manual.saveSuccess'), type: 'success' })
        if (onSuccess) onSuccess()
      } else {
        setMessage({ text: data.error || '保存失败', type: 'error' })
      }
    } catch {
      setMessage({ text: '保存失败', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const currentInfo = PROVIDER_INFO[selectedProvider]

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4 sm:p-6"
      style={{ zIndex: 400, background: 'rgba(0, 0, 0, 0.72)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
      data-auth-overlay="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quota-auth-dialog-title"
        data-auth-dialog="true"
        className="relative flex w-full max-w-xl sm:max-w-2xl flex-col overflow-hidden rounded-xl border border-eva-border bg-eva-bg text-eva-text shadow-2xl"
        style={{ maxHeight: 'min(88vh, 44rem)', margin: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-eva-border bg-eva-panel/40 px-5 py-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <ProviderBrandIcon provider={selectedProvider} className="mt-0.5 size-7 shrink-0" />
            <div className="min-w-0">
              <h3 id="quota-auth-dialog-title" className="text-base font-semibold leading-tight">
                账号授权与额度配置 · {currentInfo.name}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-eva-text-dim">{currentInfo.desc}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('quota.manual.close')}
            className="shrink-0 rounded p-1.5 text-eva-text-dim hover:bg-eva-panel hover:text-eva-text"
          >
            ✕
          </button>
        </div>

        {/* Provider Switcher Strip */}
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-eva-border/60 bg-eva-panel/20 px-5 py-2.5">
          {(['glm', 'codex', 'gemini', 'grok', 'kimi'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setSelectedProvider(p)
                setMessage(null)
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${
                selectedProvider === p
                  ? 'border-eva-purple bg-eva-purple/20 text-eva-text font-bold shadow-sm'
                  : 'border-eva-border/60 bg-eva-panel/40 text-eva-text-dim hover:text-eva-text hover:border-eva-border'
              }`}
            >
              <ProviderBrandIcon provider={p} className="size-4" />
              <span>{p.toUpperCase()}</span>
            </button>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 gap-4 border-b border-eva-border bg-eva-panel/10 px-5 pt-2 text-xs font-mono">
          <button
            type="button"
            onClick={() => { setTab('auth'); setMessage(null) }}
            className={`pb-2.5 px-1 border-b-2 font-medium transition-colors ${
              tab === 'auth' ? 'border-eva-purple text-eva-text font-bold' : 'border-transparent text-eva-text-dim hover:text-eva-text'
            }`}
          >
            🔑 官方凭证授权 (推荐)
          </button>
          <button
            type="button"
            onClick={() => { setTab('form'); setMessage(null) }}
            className={`pb-2.5 px-1 border-b-2 font-medium transition-colors ${
              tab === 'form' ? 'border-eva-purple text-eva-text font-bold' : 'border-transparent text-eva-text-dim hover:text-eva-text'
            }`}
          >
            📝 快捷手动录入
          </button>
        </div>

        {/* Status / Message Alert */}
        {message && (
          <div
            className={`px-5 py-2 text-xs font-mono flex items-center justify-between ${
              message.type === 'success' ? 'bg-status-success/15 text-status-success' : 'bg-status-danger/15 text-status-danger'
            }`}
          >
            <span>{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} className="text-current opacity-70 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Tab Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-xs" data-auth-provider={selectedProvider}>
          {tab === 'auth' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-eva-border/60 bg-eva-panel/40 p-3.5 space-y-1.5 leading-relaxed">
                <div className="flex items-center justify-between font-semibold text-eva-text">
                  <span>授权方式与说明：</span>
                  {currentInfo.authUrl && (
                    <a
                      href={currentInfo.authUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-eva-purple hover:underline"
                    >
                      打开官方管理控制台 ↗
                    </a>
                  )}
                </div>
                <p className="text-eva-text-dim">{currentInfo.authDoc}</p>
              </div>

              {/* Specific inputs for each provider */}
              {selectedProvider === 'glm' && (
                <div className="space-y-3">
                  <div>
                    <label className="block mb-1 font-medium text-eva-text-dim">智谱 API Key / Coding Plan Token：</label>
                    <input
                      type="password"
                      value={glmToken}
                      onChange={(e) => setGlmToken(e.target.value)}
                      placeholder="zhipu... 或 token 字符串"
                      className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text focus:border-eva-purple focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium text-eva-text-dim">Base URL 端点：</label>
                    <select
                      value={glmBaseUrl}
                      onChange={(e) => setGlmBaseUrl(e.target.value)}
                      className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text focus:border-eva-purple focus:outline-none"
                    >
                      <option value="https://api.z.ai">https://api.z.ai (国际 / Coding Plan)</option>
                      <option value="https://open.bigmodel.cn">https://open.bigmodel.cn (国内开放平台)</option>
                    </select>
                  </div>
                </div>
              )}

              {selectedProvider === 'grok' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => void handleCliOAuth('grok')}
                    disabled={loading || pendingProvider === 'grok'}
                    className="pressable control-surface w-full py-2.5 text-xs font-mono font-semibold text-center disabled:opacity-50"
                  >
                    {pendingProvider === 'grok' ? t('quota.auth.grok.waiting') : loading ? t('quota.auth.grok.openingBrowser') : t('quota.auth.grok.startOAuth')}
                  </button>
                  <p className="text-[11px] text-eva-text-dim leading-relaxed">
                    {t('quota.auth.grok.oauthHint')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setGrokShowApiKey((open) => !open)}
                    className="text-[11px] font-mono text-eva-purple hover:underline"
                  >
                    {grokShowApiKey ? t('quota.auth.grok.hideApiKey') : t('quota.auth.grok.fallbackToggle')}
                  </button>
                  {grokShowApiKey && (
                    <div className="space-y-3 rounded-lg border border-eva-border/60 bg-eva-panel/30 p-3">
                      <p className="text-[11px] text-eva-text-dim">{t('quota.auth.grok.fallbackHint')}</p>
                      <div>
                        <label className="block mb-1 font-medium text-eva-text-dim">xAI Management API Key：</label>
                        <input
                          type="password"
                          value={grokKey}
                          onChange={(e) => setGrokKey(e.target.value)}
                          placeholder="xai-..."
                          className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text focus:border-eva-purple focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block mb-1 font-medium text-eva-text-dim">xAI Team ID：</label>
                        <input
                          type="text"
                          value={grokTeamId}
                          onChange={(e) => setGrokTeamId(e.target.value)}
                          placeholder="team_..."
                          className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text focus:border-eva-purple focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedProvider === 'kimi' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => void handleCliOAuth('kimi')}
                    disabled={loading || pendingProvider === 'kimi'}
                    className="pressable control-surface w-full py-2.5 text-xs font-mono font-semibold text-center disabled:opacity-50"
                  >
                    {pendingProvider === 'kimi' ? '请在终端 / 浏览器完成 Kimi 登录…' : loading ? '正在打开授权终端...' : '打开终端并登录 Kimi Code'}
                  </button>
                  <p className="text-[11px] text-eva-text-dim leading-relaxed">
                    TokenTrail 会运行 <code className="font-mono">kimi login</code>，由官方 CLI 打开登录页。若窗口未打开，可自行在终端运行同一命令。
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-eva-text-dim">
                    <span className="h-px flex-1 bg-eva-border/60" />
                    <span>或使用 Kimi Code 控制台 Key</span>
                    <span className="h-px flex-1 bg-eva-border/60" />
                  </div>
                  <div>
                    <label className="block mb-1 font-medium text-eva-text-dim">Kimi Code API Key：</label>
                    <input
                      type="password"
                      value={kimiKey}
                      onChange={(e) => setKimiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text focus:border-eva-purple focus:outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-eva-text-dim">Moonshot 开放平台 API Key 只能读取钱包余额，不能代替 Kimi Code 订阅额度。</p>
                </div>
              )}

              {selectedProvider === 'gemini' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => void handleCliOAuth('gemini')}
                    disabled={loading || pendingProvider === 'gemini'}
                    className="pressable control-surface w-full py-2.5 text-xs font-mono font-semibold text-center disabled:opacity-50"
                  >
                    {pendingProvider === 'gemini' ? '请在终端选择 Sign in with Google…' : loading ? '正在打开授权终端...' : '打开终端并登录 Gemini'}
                  </button>
                  <p className="text-[11px] text-eva-text-dim leading-relaxed">
                    TokenTrail 会运行 <code className="font-mono">gemini</code>。请选择 <strong>Sign in with Google</strong>，CLI 会打开官方登录页。若窗口未打开，可自行在终端运行同一命令。
                  </p>
                  <div>
                    <label className="block mb-1 font-medium text-eva-text-dim">Google Cloud Project ID（可选）：</label>
                    <input
                      type="text"
                      value={geminiProject}
                      onChange={(e) => setGeminiProject(e.target.value)}
                      placeholder="如：my-gcp-project-1234"
                      className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text focus:border-eva-purple focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {selectedProvider === 'codex' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => void handleCliOAuth('codex')}
                    disabled={loading || pendingProvider === 'codex'}
                    className="pressable control-surface w-full py-2.5 text-xs font-mono font-semibold text-center disabled:opacity-50"
                  >
                    {pendingProvider === 'codex' ? '请在终端 / 浏览器完成 Codex 登录…' : loading ? '正在打开授权终端...' : '打开终端并登录 Codex'}
                  </button>
                  <p className="text-[11px] text-eva-text-dim leading-relaxed">
                    TokenTrail 会运行 <code className="font-mono">codex login</code>，由官方 CLI 打开 ChatGPT 登录页。若窗口未打开，可自行在终端运行同一命令。
                  </p>
                  <button
                    type="button"
                    onClick={() => setCodexShowApiKey((open) => !open)}
                    className="text-[11px] font-mono text-eva-purple hover:underline"
                  >
                    {codexShowApiKey ? '收起 API Key 表单' : '无法跳转页面？手动输入 OpenAI API Key'}
                  </button>
                  {codexShowApiKey && (
                    <div className="space-y-3 rounded-lg border border-eva-border/60 bg-eva-panel/30 p-3">
                      <p className="text-[11px] text-eva-text-dim">
                        API Key 属于 OpenAI API 产品，不能代替 ChatGPT / Codex 订阅登录。仅在无法打开浏览器时使用。
                      </p>
                      <div>
                        <label className="block mb-1 font-medium text-eva-text-dim">OpenAI API Key：</label>
                        <input
                          type="password"
                          value={codexKey}
                          onChange={(e) => setCodexKey(e.target.value)}
                          placeholder="sk-..."
                          className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text focus:border-eva-purple focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded border border-eva-border/60 bg-eva-panel/40 p-2.5 text-[11px] text-eva-text-dim flex items-center gap-2">
                <span>🔒</span>
                <span>API 密钥保存在 macOS 钥匙串；SQLite 只保存非敏感配置和额度快照。</span>
              </div>

              {selectedProvider !== 'grok' && selectedProvider !== 'kimi' && selectedProvider !== 'codex' && selectedProvider !== 'gemini' && (
                <button
                  type="button"
                  onClick={handleVerifyAuth}
                  disabled={loading || pendingProvider === selectedProvider}
                  className="pressable control-surface w-full py-2.5 text-xs font-mono font-semibold text-center disabled:opacity-50"
                >
                  {pendingProvider === selectedProvider ? '等待完成授权...' : loading ? '正在验证连接...' : '⚡ 发起连接并验证授权'}
                </button>
              )}
              {selectedProvider === 'grok' && grokShowApiKey && (
                <button
                  type="button"
                  onClick={handleVerifyAuth}
                  disabled={loading || pendingProvider === 'grok'}
                  className="pressable control-surface w-full py-2.5 text-xs font-mono font-semibold text-center disabled:opacity-50"
                >
                  {loading ? t('quota.auth.grok.verifyingKey') : t('quota.auth.grok.verifyKey')}
                </button>
              )}
              {selectedProvider === 'kimi' && (
                <button
                  type="button"
                  onClick={handleVerifyAuth}
                  disabled={loading || pendingProvider === 'kimi' || !kimiKey.trim()}
                  className="pressable control-surface w-full py-2.5 text-xs font-mono font-semibold text-center disabled:opacity-50"
                >
                  {loading ? '正在验证 Kimi Code Key...' : '验证 Kimi Code Key'}
                </button>
              )}
              {selectedProvider === 'gemini' && geminiProject.trim() && (
                <button
                  type="button"
                  onClick={handleVerifyAuth}
                  disabled={loading || pendingProvider === 'gemini'}
                  className="pressable control-surface w-full py-2.5 text-xs font-mono font-semibold text-center disabled:opacity-50"
                >
                  {loading ? '正在验证项目...' : '使用该 Project ID 读取额度'}
                </button>
              )}
              {selectedProvider === 'codex' && codexShowApiKey && (
                <button
                  type="button"
                  onClick={handleVerifyAuth}
                  disabled={loading || pendingProvider === 'codex' || !codexKey.trim()}
                  className="pressable control-surface w-full py-2.5 text-xs font-mono font-semibold text-center disabled:opacity-50"
                >
                  {loading ? '正在验证 API Key...' : '验证 OpenAI API Key'}
                </button>
              )}
            </div>
          )}

          {false && tab === 'extractor' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-eva-border/60 bg-eva-panel/40 p-3.5 space-y-2">
                <div className="font-semibold text-eva-text flex items-center justify-between">
                  <span>三步快速提取：</span>
                  {currentInfo.authUrl && (
                    <a
                      href={currentInfo.authUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-eva-purple hover:underline"
                    >
                      打开 {selectedProvider.toUpperCase()} 网页 ↗
                    </a>
                  )}
                </div>
                <ol className="list-decimal list-inside space-y-1 text-eva-text-dim leading-relaxed">
                  <li>打开并登录目标官方控制台或网页。</li>
                  <li>按 <kbd className="px-1 py-0.5 rounded bg-eva-panel border border-eva-border font-mono">F12</kbd> 切换到 <strong>Console（控制台）</strong>。</li>
                  <li>复制下方脚本并粘贴回车运行（用量 JSON 会自动复制到剪贴板）。</li>
                  <li>回到此处粘贴 JSON，点击「导入并更新快照」即可！</li>
                </ol>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-eva-text-dim">一键提取脚本 (JavaScript)：</span>
                  <button
                    type="button"
                    onClick={handleCopyScript}
                    className="pressable control-surface inline-flex items-center gap-1.5 px-3 py-1 text-xs font-mono"
                  >
                    {copied ? t('quota.manual.copied') : t('quota.manual.copyScript')}
                  </button>
                </div>
                <pre className="max-h-28 overflow-y-auto rounded-lg border border-eva-border bg-black/40 p-3 font-mono text-[11px] text-emerald-400">
                  {EXTRACTOR_SCRIPTS[selectedProvider]}
                </pre>
              </div>

              <div className="space-y-2">
                <label className="block font-medium text-eva-text-dim">{t('quota.manual.pasteJson')}</label>
                <textarea
                  rows={3}
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  placeholder="在此粘贴脚本复制的 JSON 快照..."
                  className="w-full rounded-lg border border-eva-border bg-black/30 p-2.5 font-mono text-xs text-eva-text focus:border-eva-purple focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleImportJson}
                  disabled={loading || !jsonInput.trim()}
                  className="pressable control-surface w-full py-2 text-xs font-mono font-semibold text-center disabled:opacity-50"
                >
                  {loading ? '导入中...' : t('quota.manual.importBtn')}
                </button>
              </div>
            </div>
          )}

          {tab === 'form' && (
            <div className="space-y-3.5">
              <div>
                <label className="block mb-1 text-eva-text-dim">账号 / 套餐名称：</label>
                <input
                  type="text"
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                  placeholder="如：个人账户 / X Premium+ / GLM 订阅"
                  className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 text-eva-text-dim">5小时 / 主模型 已用比例 (%)：</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={h5Percent}
                    onChange={(e) => setH5Percent(e.target.value)}
                    className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-eva-text-dim">每周 / 次模型 已用比例 (%)：</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={weekPercent}
                    onChange={(e) => setWeekPercent(e.target.value)}
                    className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 text-eva-text-dim">钱包 / 加油包余额（可选）：</label>
                <input
                  type="number"
                  step="0.01"
                  value={walletBalance}
                  onChange={(e) => setWalletBalance(e.target.value)}
                  placeholder="如：42.80"
                  className="w-full rounded-lg border border-eva-border bg-eva-panel p-2.5 font-mono text-xs text-eva-text"
                />
              </div>

              <button
                type="button"
                onClick={handleSaveForm}
                disabled={loading}
                className="pressable control-surface w-full py-2.5 text-xs font-mono font-semibold text-center disabled:opacity-50"
              >
                {loading ? '保存中...' : t('quota.manual.saveBtn')}
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-eva-border bg-eva-panel/30 px-5 py-3 text-xs text-eva-text-dim">
          <span>TokenTrail 账号额度中心</span>
          <a
            href="https://github.com/shengshuyuan/TokenTrail"
            target="_blank"
            rel="noreferrer"
            className="text-eva-purple hover:underline"
          >
            {t('quota.manual.docsLink')}
          </a>
        </div>
      </div>
    </div>,
    document.body
  )
}
