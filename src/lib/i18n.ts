export type Lang = 'zh' | 'en'

// Keep these in English regardless of language:
// - Model names (claude-sonnet-4-20250514, gpt-4.1, etc.)
// - Source names (OpenClaw, Hermes, Codex, etc.)
// - Version numbers (v0.2.0)
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
  'filter.title': { zh: '筛选范围', en: 'FILTERS' },
  'filter.subtitle': { zh: '调整范围会同步影响所有统计与图表', en: 'Filters affect all stats & charts' },
  'filter.window': { zh: '时间窗口', en: 'WINDOW' },
  'filter.source': { zh: '来源', en: 'SOURCE' },
  'filter.model': { zh: '模型', en: 'MODEL' },
  'filter.all': { zh: '全部', en: 'All' },
  'filter.selectedCount': { zh: '已选 {n} 项', en: '{n} selected' },
  'filter.windowHint': { zh: '决定仪表盘统计周期', en: 'Defines the reporting window' },
  'filter.sourceHint': { zh: '限制数据来源范围', en: 'Limits which sources are included' },
  'filter.modelHint': { zh: '限制模型统计范围', en: 'Limits which models are included' },
  'filter.clearAll': { zh: '清除全部 ({n})', en: 'CLEAR ALL ({n})' },
  'filter.clear': { zh: '清除', en: 'CLEAR' },
  'filter.showMore': { zh: '+{n}', en: '+{n}' },
  'filter.showLess': { zh: '收起', en: 'LESS' },
  'filter.chartHint': { zh: '点击图表可筛选', en: 'Click chart to filter' },

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
  'stats.sparkHint': { zh: '近 7 天趋势', en: 'Last 7 days' },

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

  // Header scope
  'status.lastUpdatedShort': { zh: '更新于 {time}', en: 'Updated {time}' },

  // Footer
  'footer.desc': { zh: '本地 AI 用量追踪器', en: 'LOCAL AI USAGE TRACKER' },
  'footer.theme': { zh: '{name} 主题', en: '{name} THEME' },

  // IntegrationGuide
  'guide.title': { zh: '接入指南', en: 'GUIDE' },
  'guide.tabQuick': { zh: '快速开始', en: 'Quick Start' },
  'guide.tabCodex': { zh: 'Codex', en: 'Codex' },
  'guide.tabKimiCode': { zh: 'Kimi Code', en: 'Kimi Code' },
  'guide.tabClaudeCode': { zh: 'Claude Code', en: 'Claude Code' },
  'guide.tabTraework': { zh: 'TraeWork', en: 'TraeWork' },
  'guide.tabOpenclaw': { zh: 'OpenClaw', en: 'OpenClaw' },
  'guide.tabHermes': { zh: 'Hermes', en: 'Hermes' },
  'guide.tabApi': { zh: 'API 接入', en: 'API' },
  'guide.tabCli': { zh: 'CLI 工具', en: 'CLI' },
  'guide.copyBtn': { zh: '复制', en: 'Copy' },
  'guide.copiedBtn': { zh: '✓ 已复制', en: '✓ Copied' },
  'guide.toastCopied': { zh: '复制成功', en: 'Copied!' },
  'guide.close': { zh: '关闭', en: 'Close' },
  'guide.storageNote': { zh: '数据存储在本地 SQLite，不上传任何云服务', en: 'Data stored in local SQLite, no cloud uploads' },

  // Share
  'share.button': { zh: '分享', en: 'SHARE' },
  'share.title': { zh: '分享预览', en: 'SHARE PREVIEW' },
  'share.download': { zh: '下载图片', en: 'Download' },
  'share.copy': { zh: '复制图片', en: 'Copy Image' },
  'share.copied': { zh: '✓ 已复制', en: '✓ Copied' },
  'share.copyUnsupported': { zh: '当前浏览器不支持复制图片，请用下载', en: 'Copy not supported, use download' },
  'share.close': { zh: '关闭', en: 'Close' },
  'share.generating': { zh: '生成中...', en: 'Generating...' },
  'share.noData': { zh: '暂无数据，无法生成分享图', en: 'No data to share' },
  'share.privacyNote': { zh: '项目名称已隐藏', en: 'Project names hidden' },
  'share.topSources': { zh: 'Top 来源', en: 'Top Sources' },
  'share.topModels': { zh: 'Top 模型', en: 'Top Models' },
  'share.dailyAvg': { zh: '日均', en: 'Daily Avg' },
  'share.requests': { zh: '请求', en: 'Requests' },
  'share.trend': { zh: '趋势', en: 'Trend' },

  // Sync results detail table
  'syncDetail.title': { zh: '同步结果详情', en: 'SYNC RESULTS' },
  'syncDetail.source': { zh: '来源', en: 'Source' },
  'syncDetail.scanned': { zh: '扫描', en: 'Scanned' },
  'syncDetail.inserted': { zh: '新增', en: 'New' },
  'syncDetail.duplicates': { zh: '重复', en: 'Dup' },
  'syncDetail.errors': { zh: '错误', en: 'Err' },

  // Settings panel
  'settings.title': { zh: '设置', en: 'SETTINGS' },
  'settings.subtitle': { zh: '控制项目名称隐私和原始记录列表展示。', en: 'Toggle project-name privacy and the raw-records list.' },
  'settings.showProjects': { zh: '显示项目名称', en: 'Show project names' },
  'settings.showRaw': { zh: '显示原始明细', en: 'Show raw records' },

  // Project distribution panel
  'project.title': { zh: '项目分布', en: 'PROJECT MIX' },
  'project.tokens': { zh: 'Token', en: 'Token' },
  'project.cost': { zh: '费用', en: 'Cost' },
  'project.other': { zh: '其他', en: 'Other' },
  'project.noData': { zh: '暂无项目数据', en: 'NO PROJECT DATA' },

  // Raw records panel
  'raw.title': { zh: '原始记录', en: 'RAW RECORDS' },
  'raw.summary': { zh: '{n} 条记录 / 每页 {size}', en: '{n} records / {size} per page' },
  'raw.col.time': { zh: '时间', en: 'Time' },
  'raw.col.source': { zh: '来源', en: 'Source' },
  'raw.col.project': { zh: '项目', en: 'Project' },
  'raw.col.model': { zh: '模型', en: 'Model' },
  'raw.col.input': { zh: '输入', en: 'Input' },
  'raw.col.cached': { zh: '缓存', en: 'Cached' },
  'raw.col.output': { zh: '输出', en: 'Output' },
  'raw.col.reasoning': { zh: '推理', en: 'Reasoning' },
  'raw.col.cost': { zh: '费用', en: 'Cost' },
  'raw.page': { zh: '第 {n} / {total} 页', en: 'PAGE {n} / {total}' },
  'raw.prev': { zh: '上一页', en: 'PREV' },
  'raw.next': { zh: '下一页', en: 'NEXT' },
  'raw.goto': { zh: '跳转', en: 'GO' },
  'raw.gotoPlaceholder': { zh: '页码', en: 'page' },
  'raw.hidden': { zh: '已隐藏', en: 'hidden' },
  'raw.unknown': { zh: '未知', en: 'unknown' },

  // Accessibility labels for control clusters
  'a11y.lang': { zh: '语言', en: 'Language' },
  'a11y.currency': { zh: '货币', en: 'Currency' },

  // Quota center — header entry
  'quota.button': { zh: '账号额度', en: 'QUOTAS' },
  'quota.buttonA11y': { zh: '账号额度中心', en: 'Account quota center' },
  'quota.attention': { zh: '{n} 个需关注', en: '{n} to watch' },
  'quota.title': { zh: '账号额度', en: 'ACCOUNT QUOTAS' },
  'quota.services': { zh: '{n} 个服务', en: '{n} services' },
  'quota.attentionLine': { zh: '{n} 个需关注', en: '{n} need attention' },
  'quota.allNormal': { zh: '全部正常', en: 'All normal' },
  'quota.refresh': { zh: '刷新', en: 'REFRESH' },
  'quota.refreshing': { zh: '刷新中...', en: 'REFRESHING...' },
  'quota.updatedJustNow': { zh: '刚刚更新', en: 'Updated just now' },
  'quota.updatedAgo': { zh: '{m} 分钟前更新', en: 'Updated {m}m ago' },
  'quota.refreshThrottled': { zh: '刚刚刷新过，请稍后再试', en: 'Just refreshed, try again shortly' },
  'quota.refreshFailed': { zh: '刷新失败，保留原有数据', en: 'Refresh failed, previous data kept' },
  'quota.close': { zh: '关闭额度弹窗', en: 'Close quota dialog' },
  'quota.statusLive': { zh: '额度状态加载中', en: 'Loading quota status' },

  // Quota center — provider row
  'quota.product.subscription': { zh: '订阅', en: 'Subscription' },
  'quota.product.api': { zh: 'API', en: 'API' },
  'quota.product.mixed': { zh: '订阅 + API', en: 'Subscription + API' },
  'quota.source.local_session': { zh: '本地会话读取', en: 'Local session read' },
  'quota.source.local_cli': { zh: '本地 CLI 服务', en: 'Local CLI service' },
  'quota.source.official_api': { zh: '官方接口', en: 'Official API' },
  'quota.source.manual': { zh: '手动录入/提取', en: 'Manual extract' },
  'quota.source.unavailable': { zh: '无自动读取', en: 'No auto read' },
  'quota.used': { zh: '{p}% 已用', en: '{p}% used' },
  'quota.rawUsage': { zh: '已用 {used} / {limit}', en: '{used} / {limit} used' },
  'quota.rawUsed': { zh: '已用 {used}', en: '{used} used' },
  'quota.noLimit': { zh: '官方未提供额度上限', en: 'No official limit provided' },
  'quota.resetIn': { zh: '{d} 后重置', en: 'resets in {d}' },
  'quota.resetAt': { zh: '{d} {time} 重置', en: 'resets {d} {time}' },
  'quota.resetUnknown': { zh: '重置时间未提供', en: 'reset time not provided' },
  'quota.resetDone': { zh: '窗口已重置，等待官方数据', en: 'window reset, awaiting official data' },
  'quota.walletBalance': { zh: '{label}余额 {amount}', en: '{label} balance {amount}' },
  'quota.walletMonthly': { zh: '本月 {used}/{limit}', en: '{used}/{limit} this month' },
  'quota.staleNote': { zh: '可能已过期 · 上次成功于 {time}', en: 'May be stale · last success {time}' },
  'quota.updatedAtLine': { zh: '{source} · {time}', en: '{source} · {time}' },
  'quota.noticeMcp': { zh: 'MCP 月度用量 {used} / {total}（{p}%）', en: 'MCP monthly {used} / {total} ({p}%)' },
  'quota.noticeMcpNoPercent': { zh: 'MCP 月度用量 {used} / {total}', en: 'MCP monthly {used} / {total}' },
  'quota.action.openUrl': { zh: '打开官方 Usage', en: 'Open official Usage' },
  'quota.action.retry': { zh: '重试', en: 'Retry' },
  'quota.window.5h': { zh: '5 小时', en: '5-hour' },
  'quota.window.week': { zh: '每周', en: 'Weekly' },
  'quota.window.day': { zh: '每日', en: 'Daily' },
  'quota.window.primary': { zh: '主窗口', en: 'Primary' },
  'quota.window.secondary': { zh: '次窗口', en: 'Secondary' },
  'quota.window.window': { zh: '额度窗口', en: 'Window' },
  'quota.wallet.extra': { zh: '加油包', en: 'Extra pack' },
  'quota.wallet.prepaid': { zh: '预付余额', en: 'Prepaid' },
  'quota.wallet.moonshot-platform': { zh: 'Moonshot 开放平台', en: 'Moonshot platform' },
  'quota.wallet.credits': { zh: 'Credits', en: 'Credits' },
  'quota.wallet.month': { zh: '月度支出', en: 'Monthly spend' },

  // Quota center — provider status
  'quota.status.loading': { zh: '读取中...', en: 'Loading...' },
  'quota.status.healthy': { zh: '正常', en: 'Healthy' },
  'quota.status.warning': { zh: '额度偏低', en: 'Running low' },
  'quota.status.critical': { zh: '即将耗尽', en: 'Almost exhausted' },
  'quota.status.exhausted': { zh: '额度已用完', en: 'Quota exhausted' },
  'quota.status.partial': { zh: '部分可读', en: 'Partially readable' },
  'quota.status.stale': { zh: '数据过期', en: 'Stale data' },
  'quota.status.not_configured': { zh: '未连接', en: 'Not connected' },
  'quota.status.auth_error': { zh: '鉴权失效', en: 'Auth failed' },
  'quota.status.network_error': { zh: '网络异常', en: 'Network issue' },
  'quota.status.unsupported': { zh: '暂不支持自动读取', en: 'Auto read unavailable' },
  'quota.status.unsupported_version': { zh: '版本待升级', en: 'Update required' },

  // Quota center — table columns & legend
  'quota.col.service': { zh: '服务', en: 'Service' },
  'quota.col.product': { zh: '账号 / 产品', en: 'Account / Product' },
  'quota.col.status': { zh: '连接状态', en: 'Status' },
  'quota.col.usage': { zh: '额度使用', en: 'Quota Usage' },
  'quota.legend.official': { zh: '官方额度', en: 'Official Quota' },
  'quota.legend.local': { zh: '本地读取', en: 'Local Read' },
  'quota.legend.latency': { zh: '可能延迟', en: 'May Delay' },
  'quota.legend.localOnly': { zh: '凭证仅在本地使用', en: 'Credentials stored locally only' },
  'quota.status.connected': { zh: '已连接', en: 'Connected' },
  'quota.status.grokUnsupported': { zh: '订阅额度接口未返回数据', en: 'Subscription quota unavailable' },
  'quota.status.grokLoggedIn': { zh: '已登录 · 额度暂未返回', en: 'Signed in · quota unavailable' },
  'quota.status.codexNoData': { zh: '已登录 · 尚无额度记录', en: 'Signed in · no quota records yet' },
  'quota.status.geminiNoQuota': { zh: '已登录 · 无 GCP 项目额度', en: 'Signed in · no GCP quota project' },
  'quota.account.codexDefault': { zh: '个人账户', en: 'Personal' },
  'quota.account.geminiDefault': { zh: 'Pro', en: 'Pro' },
  'quota.account.grokDefault': { zh: 'X Premium+', en: 'X Premium+' },
  'quota.account.glmDefault': { zh: 'GLM 订阅', en: 'GLM Subscription' },
  'quota.account.kimiDefault': { zh: 'Kimi 账号', en: 'Kimi Account' },
  'quota.window.pro': { zh: 'Pro 模型', en: 'Pro model' },
  'quota.window.flash': { zh: 'Flash 模型', en: 'Flash model' },

  // Quota center — manual extraction & config
  'quota.manual.button': { zh: '手动获取 / 配置', en: 'Manual Fetch / Config' },
  'quota.manual.title': { zh: '账号额度 · 手动获取与配置', en: 'Manual Quota Fetch & Config' },
  'quota.manual.desc': { zh: '当服务暂不支持自动读取或尚未登录时，可使用浏览器一键脚本提取或手动录入。', en: 'Extract quota with 1-click browser snippet or enter manually when auto-read is unavailable.' },
  'quota.manual.tabExtractor': { zh: '浏览器一键提取', en: 'Browser 1-Click' },
  'quota.manual.tabForm': { zh: '快捷录入', en: 'Manual Form' },
  'quota.manual.tabApi': { zh: 'API 凭证配置', en: 'API Credentials' },
  'quota.manual.copyScript': { zh: '复制提取脚本', en: 'Copy Script' },
  'quota.manual.copied': { zh: '已复制到剪贴板', en: 'Copied!' },
  'quota.manual.pasteJson': { zh: '粘贴 JSON 并导入', en: 'Paste JSON & Import' },
  'quota.manual.importBtn': { zh: '导入并更新快照', en: 'Import Snapshot' },
  'quota.manual.importSuccess': { zh: '额度快照导入成功！', en: 'Quota snapshot imported!' },
  'quota.manual.importFailed': { zh: 'JSON 格式有误，请检查', en: 'Invalid JSON format' },
  'quota.manual.saveSuccess': { zh: '配置已保存成功！', en: 'Config saved!' },
  'quota.manual.saveBtn': { zh: '保存并应用', en: 'Save & Apply' },
  'quota.manual.docsLink': { zh: '查看完整开源指南 ↗', en: 'View Full Open Source Guide ↗' },
  'quota.manual.close': { zh: '关闭授权弹窗', en: 'Close authorization dialog' },
  'quota.error.codex.not_configured': { zh: '尚未登录 Codex · 点击发起 ChatGPT 官方授权', en: 'Codex is not signed in · start ChatGPT authorization' },
  'quota.error.codex.no_data': { zh: '尚无额度记录 · 启动 Codex 并完成一次请求后即可读取', en: 'No quota records yet · run a Codex request to enable reading' },
  'quota.error.codex.auth': { zh: 'Codex 登录已过期，请重新登录', en: 'Codex login expired, sign in again' },
  'quota.error.gemini.not_configured': { zh: 'Gemini CLI 未登录 · 请先在 Gemini CLI 中完成 Google 登录', en: 'Gemini CLI not logged in · sign in with Google in Gemini CLI first' },
  'quota.error.gemini.auth_error': { zh: 'Gemini 登录已失效 · 请在 Gemini CLI 重新登录', en: 'Gemini login expired · sign in again in Gemini CLI' },
  'quota.error.gemini.unsupported': { zh: '该 Gemini 账号没有可自动读取的额度窗口（需绑定 Google Cloud 项目，Gemini CLI 同样无法显示）', en: 'No readable quota for this Gemini account (needs a Google Cloud project; the CLI cannot show it either)' },
  'quota.error.grok.unsupported': { zh: 'Grok 已登录，但额度接口暂未返回可读数据', en: 'Grok is signed in, but its quota endpoint returned no readable data' },
  'quota.error.grok.not_configured': { zh: '尚未登录 Grok · 点击发起浏览器授权', en: 'Grok is not signed in · start browser authorization' },
  'quota.auth.grok.startOAuth': { zh: '打开终端并发起浏览器授权', en: 'Open Terminal and authorize' },
  'quota.auth.grok.openingBrowser': { zh: '正在打开授权终端...', en: 'Opening authorization terminal...' },
  'quota.auth.grok.waiting': { zh: '请在终端 / 浏览器中完成 Grok 授权…', en: 'Finish Grok sign-in in Terminal/browser…' },
  'quota.auth.grok.oauthHint': { zh: '将打开可见终端运行 grok login --oauth，再由官方 CLI 打开 auth.x.ai；完成后自动同步。', en: 'Opens a visible Terminal for grok login --oauth, then the official CLI opens auth.x.ai and TokenTrail syncs after completion.' },
  'quota.auth.grok.fallbackToggle': { zh: '无法跳转页面？手动输入 API Key', en: 'Can’t open the browser? Enter an API key' },
  'quota.auth.grok.hideApiKey': { zh: '收起 API Key 表单', en: 'Hide API key form' },
  'quota.auth.grok.fallbackHint': { zh: '仅在无法打开浏览器（SSH / CI / 无图形界面）时使用。需要 xAI Management Key 与 Team ID。', en: 'Use this only when a browser cannot be opened (SSH / CI / headless). Requires an xAI Management Key and Team ID.' },
  'quota.auth.grok.verifyKey': { zh: '验证 API Key', en: 'Verify API key' },
  'quota.auth.grok.verifyingKey': { zh: '正在验证连接...', en: 'Verifying…' },
  'quota.auth.grok.success': { zh: 'Grok 授权成功', en: 'Grok authorization succeeded' },
  'quota.auth.grok.timeout': { zh: '授权超时。可重试浏览器授权，或改为手动输入 API Key。', en: 'Authorization timed out. Retry browser sign-in, or enter an API key.' },
  'quota.auth.grok.cliMissing': { zh: '无法打开授权页。请确认已安装 Grok CLI，或改为手动输入 API Key。', en: 'Could not open the sign-in page. Install Grok CLI, or enter an API key instead.' },
  'quota.auth.grok.failed': { zh: 'Grok 授权失败', en: 'Grok authorization failed' },
  'quota.error.glm.not_configured': { zh: '未检测到 GLM Coding Plan 配置', en: 'No GLM Coding Plan configuration detected' },
  'quota.error.kimi.not_configured': { zh: 'Kimi Code 尚未登录或本地服务不可用', en: 'Kimi Code not logged in or local service unavailable' },
  'quota.error.kimi.auth_error': { zh: 'Kimi Code 登录已过期 · 请重新运行 kimi login', en: 'Kimi Code login expired · run kimi login again' },
  'quota.error.auth': { zh: '凭证已失效，请重新登录该服务', en: 'Credentials invalid, sign in again' },
  'quota.error.unsupported': { zh: '该服务暂不支持自动读取额度', en: 'Automatic quota reading unavailable' },
  'quota.error.auth_error': { zh: '凭证已失效，请重新登录该服务', en: 'Credentials invalid, sign in again' },
  'quota.error.rate_limited': { zh: '供应商限流，已保留上次数据', en: 'Provider rate limited, previous data kept' },
  'quota.error.timeout': { zh: '读取超时，已保留上次数据', en: 'Read timed out, previous data kept' },
  'quota.error.network': { zh: '网络异常，已保留上次数据', en: 'Network issue, previous data kept' },
  'quota.error.malformed': { zh: '响应异常，已保留上次数据', en: 'Unexpected response, previous data kept' },
  'quota.error.unsupported_version': { zh: '该服务接口结构已变化，需要升级 TokenTrail 适配', en: 'Provider interface changed, TokenTrail needs an update' },
  'quota.error.not_configured': { zh: '未连接该服务', en: 'Service not connected' },
  'quota.error.no_data': { zh: '暂无额度记录', en: 'No quota records yet' },
  'quota.error.unknown': { zh: '读取失败', en: 'Failed to read' },
} as const

export type TranslationKey = keyof typeof translations

export function t(key: TranslationKey, lang: Lang, params?: Record<string, string | number>): string {
  const entry = translations[key]
  // Defensive fallback: a missing or malformed entry should never crash the render.
  if (!entry) return key
  let text = entry[lang] ?? entry.en ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  return text
}
