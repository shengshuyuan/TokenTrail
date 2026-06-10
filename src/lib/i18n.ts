export type Lang = 'zh' | 'en'

// Keep these in English regardless of language:
// - Model names (claude-sonnet-4-20250514, gpt-4.1, etc.)
// - Source names (OpenClaw, Hermes, Codex, etc.)
// - Version numbers (v0.1.0)
// - Status terminal text (LOADING..., NO DATA, NO SIGNAL)
// - Technical labels (TOKEN VOLUME, COST CURVE, PEAK, requests, dup)

const translations: Record<string, Record<Lang, string>> = {
  // Header scope line
  'scope.window.24h': { zh: '24小时窗口', en: '24H WINDOW' },
  'scope.window.days': { zh: '{n}天窗口', en: '{n}D WINDOW' },
  'scope.allSources': { zh: '全部来源', en: 'all sources' },
  'scope.sources': { zh: '{n}个来源', en: '{n} source{s}' },
  'scope.allModels': { zh: '全部模型', en: 'all models' },
  'scope.models': { zh: '{n}个模型', en: '{n} model{s}' },
  'status.updatedAt': { zh: '更新 {time}', en: 'updated {time}' },

  // Sync button
  'sync.syncing': { zh: '同步中...', en: 'SYNCING...' },
  'sync.button': { zh: '同步', en: 'SYNC' },
  'sync.updated': { zh: '✓ 已是最新', en: '✓ Up to date' },
  'sync.failed': { zh: '✗ 失败', en: '✗ Failed' },
  'sync.networkError': { zh: '✗ 网络错误', en: '✗ Network error' },

  // Integration Guide button
  'guide.button': { zh: '接入指南', en: 'GUIDE' },

  // FilterBar
  'filter.window': { zh: '时间窗口', en: 'WINDOW' },
  'filter.source': { zh: '来源', en: 'SOURCE' },
  'filter.model': { zh: '模型', en: 'MODEL' },
  'filter.clearAll': { zh: '清除全部 ({n})', en: 'CLEAR ALL ({n})' },
  'filter.clear': { zh: '清除', en: 'CLEAR' },

  // StatsCards
  'stats.totalTokens': { zh: '总消耗', en: 'TOTAL TOKENS' },
  'stats.totalCost': { zh: '总费用', en: 'TOTAL COST' },
  'stats.dailyAvg': { zh: '日均消耗', en: 'DAILY AVG' },
  'stats.dailyCost': { zh: '日均费用', en: 'DAILY COST' },
  'stats.requests': { zh: '请求数', en: 'REQUESTS' },
  'stats.settledUsd': { zh: '以美元结算', en: 'settled in USD' },
  'stats.rateLabel': { zh: '汇率 {n}', en: 'rate {n}' },
  'stats.activeDays': { zh: '活跃天数均值', en: 'active days average' },
  'stats.costVelocity': { zh: '费用速率', en: 'cost velocity' },
  'stats.capturedCalls': { zh: '已捕获调用', en: 'captured calls' },

  // TrendChart
  'trend.title': { zh: '趋势', en: 'TREND' },
  'trend.dataPoints': { zh: '{n} 个数据点', en: '{n} DATA POINTS' },
  'trend.noDataHint': { zh: '请通过 /api/report 上报用量数据', en: 'Post usage data to /api/report to get started' },

  // ComparisonChart
  'comparison.title': { zh: '对比', en: 'COMPARISON' },
  'comparison.topBreakdown': { zh: '排名明细', en: 'TOP BREAKDOWN' },
  'comparison.bySource': { zh: '按来源', en: 'BY SOURCE' },
  'comparison.byModel': { zh: '按模型', en: 'BY MODEL' },
  'comparison.other': { zh: '其他', en: 'Other' },
  'comparison.cost': { zh: '费用', en: 'Cost' },
  'comparison.tokens': { zh: 'Tokens', en: 'Tokens' },

  // ProportionChart
  'proportion.title': { zh: '占比', en: 'PROPORTION' },
  'proportion.sourceMix': { zh: '来源构成', en: 'SOURCE MIX' },
  'proportion.total': { zh: '合计', en: 'TOTAL' },

  // Empty state
  'empty.noSignal': { zh: '无信号', en: 'NO SIGNAL' },
  'empty.waiting': { zh: '等待接收用量数据...', en: 'Waiting for usage data...' },
  'empty.testHint': { zh: '// 上报测试数据', en: '// Post test data' },
  'empty.docHint': { zh: '接入指南见 docs/INTEGRATION.md', en: 'See docs/INTEGRATION.md for integration guide' },

  // Error
  'error.label': { zh: '错误', en: 'ERROR' },

  // Footer
  'footer.desc': { zh: '本地 AI 用量追踪器', en: 'LOCAL AI USAGE TRACKER' },
  'footer.theme': { zh: 'EVA-01 主题', en: 'EVA-01 THEME' },

  // IntegrationGuide
  'guide.title': { zh: '接入指南', en: 'GUIDE' },
  'guide.tabQuick': { zh: '快速开始', en: 'Quick Start' },
  'guide.tabClaudeCode': { zh: 'Claude Code', en: 'Claude Code' },
  'guide.tabOpenclaw': { zh: 'OpenClaw', en: 'OpenClaw' },
  'guide.tabHermes': { zh: 'Hermes', en: 'Hermes' },
  'guide.tabApi': { zh: 'API 接入', en: 'API' },
  'guide.tabCli': { zh: 'CLI 工具', en: 'CLI' },
  'guide.copyBtn': { zh: '复制', en: 'Copy' },
  'guide.copiedBtn': { zh: '✓ 已复制', en: '✓ Copied' },
  'guide.toastCopied': { zh: '复制成功', en: 'Copied!' },
  'guide.close': { zh: '关闭', en: 'Close' },
  'guide.storageNote': { zh: '数据存储在本地 SQLite，不上传任何云服务', en: 'Data stored in local SQLite, no cloud uploads' },
} as const

export type TranslationKey = keyof typeof translations

export function t(key: TranslationKey, lang: Lang, params?: Record<string, string | number>): string {
  let text = translations[key][lang]
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  return text
}
