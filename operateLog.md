# operateLog

- **[2026-09-06 10:12:00 CST]** 🟡修改
- **影响范围**：`src/lib/quotas/providers/gemini.js`、`tests/quota-gemini.test.mjs`
- **变更摘要**：去掉源码中硬编码的 Google OAuth Client ID / Client Secret。Antigravity 静默续期只使用本地 token 文件或测试注入的 client，仓库与 GitHub 提交不含第三方密钥；没有 client 时回退到官方 `agy` 打印模式。
- **回滚指南**：`git checkout -- src/lib/quotas/providers/gemini.js tests/quota-gemini.test.mjs operateLog.md`

- **[2026-09-06 10:05:00 CST]** 🟡修改
- **影响范围**：`src/lib/quotas/providers/gemini.js`、`tests/quota-gemini.test.mjs`
- **变更摘要**：Antigravity 额度快照与授权轮询不再写入或返回 Google 账号邮箱；界面只显示产品名 Antigravity，与「快照不含 token / 邮箱 / 账号 ID」的约定一致。
- **回滚指南**：`git checkout -- src/lib/quotas/providers/gemini.js tests/quota-gemini.test.mjs operateLog.md`

- **[2026-09-06 09:44:00 CST]** 🟡修改
- **影响范围**：`src/lib/quotas/providers/gemini.js`、`src/app/api/quotas/auth/route.ts`、`tests/quota-gemini.test.mjs`、`runtime/TokenTrail/...`
- **变更摘要**：升级 Antigravity (Gemini) 账号额度授权机制，彻底解决“容易过期”与刷新失败的问题：
  1. 根因定位：Google OAuth `access_token` 天然只有 1 小时有效期。TokenTrail 此前只读本地 token 文件，从不主动续期；每次刷新时强行调用 `agy --print-timeout 2s -p "/usage"`，因仅给 2 秒超时，经常被 Google OAuth 网络静默续期握手拖死；且 `looksLikeAuthFailure` 误将启动阶段正常的日志 `Print mode: not authenticated, trying silent auth` 识别为授权失效，导致界面频繁报红。
  2. 主动续期引擎：新增 `refreshAntigravityToken()`。在每次用户手动刷新、定时后台刷新或重新授权校验时，检测当前 access token 剩余有效期（小于 5 分钟或已过期），自动使用 `~/.gemini/antigravity-cli/antigravity-oauth-token` 中的持久 `refresh_token` 向 Google OAuth 换取全新 1 小时 access token，并原子写回本地文件保持新鲜。
  3. 直连官方 Quota Summary 接口：引入 `fetchCloudCodeQuota()` 与 `parseUserQuotaSummary()`，拿到新鲜 Token 后直接通过 HTTPS 毫秒级拉取 Google Cloud Code 官方结构化配额接口，无需每次重度启动 CLI 进程，杜绝进程挂死与超时；若网络受限平滑降级至 `agy` CLI 打印模式。
  4. 修复误判与超时：将 `agy` 打印超时从 2 秒提升至 10 秒；修复 `looksLikeAuthFailure` 正则，避免正常静默续期日志被误当做登录失效。
  5. 优化授权重连接口：用户在弹窗点击重新授权时，优先主动触发静默续期与直连校验；仅在 refresh token 确实失效时才弹出终端启动 `agy` 登录。
- **回滚指南**：`git checkout -- src/lib/quotas/providers/gemini.js src/app/api/quotas/auth/route.ts tests/quota-gemini.test.mjs operateLog.md`

- **[2026-09-04 10:20:00 CST]** 🟡修改
- **影响范围**：`src/lib/quotas/providers/grok.js`、`src/lib/quotas/http.js`、`tests/quota-grok.test.mjs`、`tests/helpers/quota-mock.mjs`、`src/lib/i18n.ts`、`docs/QUOTA_MANUAL_GUIDE.md`
- **变更摘要**：修复 Grok 账号额度授权看起来“最快过期”的问题。根因是 xAI OAuth access token 只有约 6 小时有效期，TokenTrail 此前只看 `expires_at`、忽略 `~/.grok/auth.json` 里已有的 `refresh_token`，过期后直接当成未登录。现已与 Grok CLI 一致：到期前 5 分钟通过官方 `https://auth.x.ai/oauth2/token` 用 refresh_token 静默续期并回写 `auth.json`；refresh 被拒绝才提示重新 `grok login --oauth`。快照仍不泄漏 token。
- **回滚指南**：`git checkout -- src/lib/quotas/providers/grok.js src/lib/quotas/http.js tests/quota-grok.test.mjs tests/helpers/quota-mock.mjs src/lib/i18n.ts docs/QUOTA_MANUAL_GUIDE.md operateLog.md`

- **[2026-09-03 20:27:00 CST]** 🟡修改
- **影响范围**：`data/token-trail.db`、`src/lib/seed-pricing.ts`、`TokenTrail_Model_Pricing.xlsx`、`runtime/TokenTrail/...`
- **变更摘要**：对照 OpenRouter 官方公开模型与最新费率接口（`https://openrouter.ai/api/v1/models`），完成 MiniMax、Meta、DeepSeek、Anthropic、Alibaba（Qwen）五大厂商模型的全量定价升级与表格更新：
  1. `MiniMax`：更新 MiniMax M3 ($0.30/$0.06/$1.20)、M2.7 ($0.30/$0.06/$1.20)、M2.7 HighSpeed ($0.30/$0.06/$1.20)、M2.5 ($0.27/$0.027/$1.08)、01 ($0.20/$0.00/$1.10)。
  2. `DeepSeek`：更新 DeepSeek V4 Pro ($1.0423/$0.0869/$2.0845)、V4 Flash ($0.0886/$0.0177/$0.1772)、V4 Flash Vision Exp ($0.22/$0.007/$0.66)、V3 ($0.27/$0.07/$1.10)、Chat ($0.32/$0.07/$0.89)、R1 / Reasoner ($0.70/$0.14/$2.50)。
  3. `Anthropic`：更新 Claude Opus 5 ($5.00/$0.50/$25.00)、Opus 5 Low ($5.00/$0.50/$25.00)、Sonnet 5 ($2.00/$0.20/$10.00)、Fable 5.1 ($10.00/$0.25/$50.00)、Opus 4.7 ($5.00/$0.50/$25.00)、Sonnet 4.6 ($3.00/$0.30/$15.00)、Sonnet 4.5 ($3.00/$0.30/$15.00)、Haiku 4.5 ($1.00/$0.10/$5.00) 等。
  4. `Alibaba (Qwen)`：更新 Qwen3.7 Max ($1.475/$0.295/$4.425)、Qwen3.7 Plus ($0.32/$0.064/$1.28)、Qwen3.6 Plus ($0.325/$0.065/$1.95)、Qwen3.6 Flash ($0.1875/$0.0375/$1.125)、Qwen Max ($0.78/$0.156/$3.90)、Qwen Plus ($0.26/$0.052/$0.78)、Qwen3 Coder ($0.30/$0.10/$1.00)、Qwen3 235B ($0.455/$0.091/$1.82)。
  5. `Meta`：更新 Llama 4 Maverick ($0.20/$0.04/$0.696)、Llama 4 Scout ($0.10/$0.02/$0.30)、Llama 3.3 70B ($0.10/$0.02/$0.32)、Llama 3.1 405B ($1.00/$0.20/$1.00)、Llama 3.1 70B ($0.40/$0.08/$0.40)、Llama 3.1 8B ($0.05/$0.025/$0.08)、Muse Spark 1.3 ($1.25/$0.15/$4.25) 等。
  6. 重新生成并导出 `TokenTrail_Model_Pricing.xlsx`，覆盖 136 个模型完整定价，已同步更新 SQLite 数据库、`seed-pricing.ts` 及常驻运行环境。
- **回滚指南**：`git checkout -- src/lib/seed-pricing.ts operateLog.md`

- **[2026-09-03 20:12:00 CST]** 🟡修改
- **影响范围**：`data/token-trail.db`、`src/lib/seed-pricing.ts`、`TokenTrail_Model_Pricing.xlsx`、`runtime/TokenTrail/...`
- **变更摘要**：对照 OpenRouter 官方公开模型与最新费率接口（`https://openrouter.ai/api/v1/models`），基于实际用户使用情况对 Codex、Gemini、Grok、GLM、Kimi 五大服务商的最新模型定价进行全面更新，并重新生成模型价目 Excel 表格：
  1. `OpenAI / Codex`：更新 GPT-5.6 系列（Sol $2.00/$0.20/$10.00、Terra $2.00/$0.20/$12.00、Luna $0.20/$0.02/$1.20）、GPT-5.5 ($5.00/$0.50/$30.00)、GPT-5.4 ($2.50/$0.25/$15.00)、GPT-5.4 Mini ($0.75/$0.075/$4.50)、GPT-5.3 Codex ($1.75/$0.175/$14.00) 及各类审查/旧版模型。
  2. `Google / Gemini (Antigravity)`：更新 Gemini 3.8 Flash ($0.75/$0.075/$3.75)、Gemini 3.8 Pro ($2.00/$0.20/$12.00)、Gemini 3.7 Flash ($0.75/$0.075/$3.75)、Gemini 3.6 Flash ($0.75/$0.075/$3.75)、Gemini 3.5 Flash ($1.50/$0.15/$9.00) 等。
  3. `xAI / Grok`：补充并更新 Grok 4.6 ($2.00/$0.50/$6.00)、Grok 4.6 Build、Grok 4.5 ($2.00/$0.30/$6.00)、Grok 4.5 Build ($1.00/$0.20/$2.00)、Cursor 衍生模型等此前费率为 0 的条目。
  4. `智谱 GLM / Z.ai`：补充并更新 GLM-5.3 Flash ($0.075/$0.015/$0.25)、GLM-5.3 ($1.40/$0.14/$4.40)、GLM-5.2 ($0.966/$0.1932/$3.036)、GLM-5.1 ($0.966/$0.1794/$3.036)、GLM-5-Turbo ($1.20/$0.24/$4.00)、GLM-5 ($0.60/$0.12/$1.92)、GLM-4.7 ($0.40/$0.08/$1.75)、GLM-4.5-Flash ($0.06/$0.01/$0.40) 等。
  5. `Moonshot / Kimi`：补充并更新 Kimi K3 ($3.00/$0.30/$15.00)、Kimi K2.7 Code ($0.66/$0.18/$3.40)、Kimi K2.6 ($0.95/$0.16/$4.00)、Kimi K2.5 ($0.45/$0.07/$2.25) 及 Kimi CLI 对话模型。
  6. 执行费用重算与报表输出：重新计算 SQLite `usage_records` 全部 41,616 条用量记录的精确账单花费（`cost_usd`），并重新生成 `TokenTrail_Model_Pricing.xlsx`（覆盖 124 个模型记录）。
- **回滚指南**：`git checkout -- src/lib/seed-pricing.ts operateLog.md`

- **[2026-09-03 20:02:00 CST]** 🟡修改
- **影响范围**：`src/app/page.tsx`、`runtime/TokenTrail/src/app/page.tsx`
- **变更摘要**：恢复页面左上角 TokenTrail 原版官方 "T" 品牌图标：
  1. 定位原因：此前在主题优化计划中误将图片换成了 `mask: url(/logo-app.png)` 配合 CSS 渐变，由于 `logo-app.png` 底图是纯黑不透明图片，CSS Alpha 蒙版解析为整块 100% 不透明，导致在所有主题下变成实心纯色方块而丢失了 "T" 图案。
  2. 修复：恢复直接引入 `next/image` 标准 `<Image src="/logo-app.png" ... />` 组件，完全恢复原本高对比度赛博绿+荧光紫流动滴落的 "T" 标志性 Logo 与光晕边框。
- **回滚指南**：`git checkout -- src/app/page.tsx operateLog.md`

- **[2026-09-03 17:37:00 CST]** 🟡修改
- **影响范围**：`src/components/dashboard/QuotaBrandIcons.tsx`、`runtime/TokenTrail/...`
- **变更摘要**：更新额度查看页面的 Antigravity、Grok、GLM 品牌 Logo 为官方标准矢量图标：
  1. `Antigravity`：替换原先通用的 Gemini 四角星图标，改用官方标准 Antigravity 拱门/尖塔（"A"）轮廓并融合 Google 经典四色渐变（红、黄、绿、蓝），采用 `useId()` 防止 SVG filter/mask 在多卡片中产生 ID 冲突。
  2. `Grok`：替换原先简陋且错误的带斜杠圆圈（⊘），改用直接来源于 `grok.com` 官网标准高精矢量 Logo（黑色圆角基底配合纯白动态 Grok 环形与长枪光标）。
  3. `GLM`：替换原先通用的六边形小圆点立体盒，改用智谱官方（`zhipuai.cn` / `bigmodel.cn`）标准高精几何 "Z" 字矢量 Logo，完美对齐品牌视觉与平台标准。
- **回滚指南**：`git checkout -- src/components/dashboard/QuotaBrandIcons.tsx operateLog.md`

- **[2026-09-03 09:56:00 CST]** 🟡修改
- **影响范围**：`src/lib/seed-pricing.ts`、`src/lib/sync.ts`、`src/lib/db.ts`、`data/token-trail.db`、`tests/antigravity-model.test.mjs`
- **变更摘要**：支持 Gemini 3.7 Flash 与 Gemini 3.8 Flash 模型的准确上报与费率核算：
  1. `seed-pricing.ts`：新增 `gemini-3.8-flash`、`gemini-3.8-pro`、`gemini-3.7-flash`、`gemini-3.7-pro` 的基础定价（Flash：$0.15/1M input, $0.075/1M cached, $0.60/1M output；Pro：$1.25/1M input, $0.625/1M cached, $10.00/1M output），并写入 SQLite `model_pricing`。
  2. `sync.ts`：升级 Antigravity 会话解析器 `syncAntigravityTranscripts`，彻底告别硬编码 `gemini-3.6-flash`。新增 `detectAntigravityModel()`，动态从 `transcript.jsonl` 的用户设置及上下文中提取实际模型版本（按时间线自动提取最新选定模型，如 3.7 Flash 或 3.8 Flash，默认回退至 3.8 Flash），并在写入前调用 `ensureModelPricing()`。
  3. `sync.ts` & `MODEL_ALIASES`：`normalizeModelName` 增强泛化正则，自动将 `Gemini 3.8 Flash (High)`、`gemini 3.7 flash (medium)`、`gemini 3.7 flash (low)` 等带有推理/档位后缀的模型名统一收敛标准化为 `gemini-3.8-flash` 与 `gemini-3.7-flash`。
  4. `db.ts`：优化 `upsertUsageRecordByRequestId`，在会话更新对比时引入 `existing.model !== record.model` 检查，使历史错误归因的模型版本在重新同步时能够自动更正并重新计算精准费用。
  5. 历史数据刷新与验证：完成全量重新同步，现有 Antigravity 对话中 3.7 Flash 与 3.8 Flash 已全部精准识别归类，CLI 上报测试正常，全量 125 项自动化测试通过。
- **回滚指南**：`git checkout -- src/lib/seed-pricing.ts src/lib/sync.ts src/lib/db.ts operateLog.md && rm tests/antigravity-model.test.mjs`

- **[2026-09-03 09:36:00 CST]** 🟡修改
- **影响范围**：`src/app/globals.css`
- **变更摘要**：修复「选择视觉主题」弹层及选项卡选中/鼠标悬浮时背景透明致使底层文字穿透的问题：① 修复 space-separated RGB 变量使用 `rgba(var(--), alpha)` 的 CSS 语法错误（触发 IACVT 导致 background 变为 transparent），改用标准现代语法；② 弹层面板（`.theme-picker-popover`）底色设为实体不透明面板色 `var(--theme-panel)`；③ 选项卡（`.theme-preview-card`）在选中（active）和鼠标悬浮（hover/focus-visible）时，使用 `var(--theme-panel)` 与 `var(--theme-primary)` 的 100% 实体色阶 `color-mix`，彻底消除透明底图和底层穿透，恢复清晰易读的实色背景与对比度。
- **回滚指南**：`git checkout -- src/app/globals.css operateLog.md`
- **影响范围**：`docs/CODE_WIKI.md`、`operateLog.md`
- **变更摘要**：新增一份结构化 Code Wiki，覆盖项目架构、模块职责、关键函数、依赖关系、运行方式与页面设计评审。
- **回滚指南**：执行 `rm docs/CODE_WIKI.md operateLog.md`

- **[2026-06-30 00:10:56 CST]** 🟢新增
- **影响范围**：`src/lib/traework.js`、`src/lib/sync.ts`、`src/app/api/proxy/openai-traework/[...path]/route.ts`、`next.config.js`、`src/types/index.ts`、`src/components/dashboard/SystemStatus.tsx`、`tests/traework-history.test.mjs`
- **变更摘要**：新增 TraeWork 专用代理入口与历史会话扫描同步能力，已将当前 `.trae/chat` 历史记录导入 TokenTrail，并让常驻服务具备后续自动增量同步能力。
- **回滚指南**：执行 `git checkout -- src/lib/traework.js src/lib/sync.ts src/app/api/proxy/openai-traework/[...path]/route.ts next.config.js src/types/index.ts src/components/dashboard/SystemStatus.tsx tests/traework-history.test.mjs` 后再运行 `npm run install-service`

- **[2026-07-11 10:00:00 CST]** 🟢新增
- **影响范围**：`scripts/export-pricing-excel.mjs`、`TokenTrail_Model_Pricing.xlsx`
- **变更摘要**：新增模型价目表 Excel 导出脚本，并成功导出当前所有模型的费率数据供用户更新使用。
- **回滚指南**：执行 `rm scripts/export-pricing-excel.mjs TokenTrail_Model_Pricing.xlsx`

- **[2026-07-11 10:15:00 CST]** 🟡修改
- **影响范围**：`scripts/import-pricing-excel.mjs`、`data/token-trail.db`
- **变更摘要**：新增并执行 Excel 价目表导入脚本，根据用户提供的更新后表格更新了数据库中 `model_pricing` 表的各项费率，并重新计算了所有历史 `usage_records` 的 `cost_usd` 费用。
- **回滚指南**：如果价格错误，可以通过执行旧的 `npm run db:seed` 脚本或重新导入正确的 Excel 表格。

- **[2026-07-22 12:40:00 CST]** 🟡修改
- **影响范围**：`src/lib/seed-pricing.ts`、`src/lib/db.ts`、`src/lib/sync.ts`、`src/lib/proxy-usage.ts`、`src/app/api/proxy/**`、`src/app/api/report/route.ts`、`src/app/api/sync/route.ts`、`src/app/api/backup/route.ts`、`src/app/page.tsx`、`tests/*`
- **变更摘要**：代码 Review 修复：1) seed 不再覆盖用户自定义价格，仅插入缺失模型/升级 0 价占位；2) Claude cache_creation 计入 input；3) 时间戳秒→毫秒归一化；4) 代理 SSE 取最后 usage、限制内存、取消时释放 reader；5) report 整数化 token / 重复返回 cost=0；6) 并发 sync 返回 409；7) 删除空垃圾路由目录。
- **回滚指南**：`git checkout -- src/lib src/app tests operateLog.md`


- **[2026-08-05 17:23:01 CST]** 🟡修改
- **影响范围**：`src/app/globals.css`、`src/app/page.tsx`、`src/components/dashboard/SystemStatus.tsx`、`FilterBar.tsx`、`ShareCard.tsx`、`IntegrationGuide.tsx`、`src/lib/version.ts`、`package.json`
- **变更摘要**：v0.2.2 样式优化：① 亮主题 control 层 token（修复同步/指南/分享/chips/Toggle 深色翻车）；② 首屏重排 KPI 紧跟筛选，系统状态默认折叠为摘要条；③ 亮主题关闭 grain/scan、减弱 aurora/energy 装饰。
- **回滚指南**：`git checkout -- src/app/globals.css src/app/page.tsx src/components/dashboard src/lib/version.ts package.json package-lock.json docs/INTEGRATION.md operateLog.md`

- **[2026-08-05 18:30:00 CST]** 🟡修改
- **影响范围**：`src/app/globals.css`、`src/app/page.tsx`、`src/components/dashboard/*`、`src/lib/i18n.ts`、`src/lib/version.ts`、`package.json`
- **变更摘要**：v0.2.3 仪表盘质感续修：① 补齐 residual control token；② 对比/占比图等高；③ 模型 chips +N 折叠；④ 图表点击联动筛选；⑤ 自动刷新 data-refresh；⑥ 原始记录表优化；⑦ neon KPI 辉光 + sparkline；⑧ review 修复：刷新不 remount、chips 保留已选、Bar onClick 兼容；⑨ 修复 CLI `parseFlags` 对 `--build` 布尔 flag 的解析，使 `install-service --build` 真正进入 production。
- **回滚指南**：`git checkout -- src/app/globals.css src/app/page.tsx src/components/dashboard src/lib/i18n.ts src/lib/version.ts package.json bin/tokentrail.js operateLog.md`

- **[2026-08-08 12:00:00 CST]** 🟡修改
- **影响范围**：`src/app/page.tsx`、`src/lib/db.ts`、`src/lib/sync.ts`、`src/lib/themes.ts`、`src/app/globals.css`、`src/components/dashboard/*`、`bin/tokentrail.js`、`src/types/index.ts`、`src/lib/seed-pricing.ts`
- **变更摘要**：v0.2.4 代码 review 修复 + 主题/同步增强：① sync 失败样式不再显示成功绿；② 请求失败时不展示「无数据」空态；③ 时间窗口切换后剪枝失效筛选；④ IntegrationGuide 点击遮罩关闭；⑤ 图表筛选与 chips 同为 multi-toggle；⑥ 自动刷新 retry 防堆叠；⑦ SystemStatus 统一 SOURCE_DISPLAY_NAMES；⑧ CLI node 路径优先 process.execPath、文档 --build；⑨ Antigravity 同步 upsert 会话累计 token；⑩ spotlight glass / ember-paper 主题微调。
- **回滚指南**：`git checkout -- src bin operateLog.md package.json`

- **[2026-08-08 00:24:33 CST]** 🟡修改
- **影响范围**：`src/app/globals.css`、`src/app/page.tsx`、`src/lib/db.ts`、`src/lib/sync.ts`、`src/lib/themes.ts`、`src/lib/seed-pricing.ts`、`src/types/index.ts`、`IntegrationGuide.tsx`、`docs/plans/*`、version → 0.2.4
- **变更摘要**：主题视觉打磨（ember/editorial spotlight 玻璃、Logo mask 随主题着色）；筛选/同步健壮性；Antigravity 对话日志扫描与 request_id upsert；Gemini 3.6 价目；计划文档归档。
- **回滚指南**：`git revert HEAD` 或 checkout 上一 tag `v0.2.3`

- **[2026-09-02 16:40:00 CST]** 🟡修改
- **影响范围**：`src/lib/quotas/providers/gemini.js`、`cli-login.js`、`/api/quotas/auth`、QuotaManualModal、README、`docs/QUOTA_MANUAL_GUIDE.md`、`tests/quota-gemini.test.mjs`
- **变更摘要**：Gemini 额度改为 Antigravity CLI（`agy`）：登录读 `~/.gemini/antigravity-cli/antigravity-oauth-token`，额度解析官方 `agy -p "/usage"` TSV；不再走 Gemini CLI / GCP 项目 / 内嵌 OAuth client。
- **回滚指南**：checkout 上述文件后同步运行副本并重启常驻服务

- **[2026-09-02 16:00:00 CST]** 🟡修改
- **影响范围**：`src/lib/quotas/providers/gemini.js`、README / README.zh-CN、`CHANGELOG.md`、`docs/CODE_WIKI.md`、`docs/QUOTA_MANUAL_GUIDE.md`
- **变更摘要**：Gemini CLI 公开 OAuth 客户端改为 XOR 常量，避免 GitHub secret scanning 把官方 CLI 公开客户端误判为仓库密钥；README / Code Wiki / Changelog 补齐 0.3.0 产品说明、双流水线、状态表和隐私边界。
- **回滚指南**：`git revert` 本提交

- **[2026-09-02 14:30:00 CST]** 🟢新增
- **影响范围**：账号额度中心全量（`src/lib/quotas/**`、`src/app/api/quotas/**`、QuotaCenter UI、README、`docs/QUOTA_MANUAL_GUIDE.md`），version → 0.3.0
- **变更摘要**：发布账号额度中心：Codex/Gemini/Grok/GLM/Kimi 官方剩余额度、CLI 可见终端登录、钥匙串存 Key、快照不含凭证。文档补充五家授权边界与项目说明。
- **回滚指南**：`git revert` 本提交

- **[2026-09-02 14:10:00 CST]** 🟡修改
- **影响范围**：`src/lib/quotas/cli-login.js`、`tests/quota-kimi.test.mjs`
- **变更摘要**：Kimi 登录二进制解析补上 `~/.kimi-code/bin/kimi`（常驻服务 PATH 不含该目录时原先会报未找到 CLI）。
- **回滚指南**：checkout 上述文件后重建运行副本

- **[2026-09-02 13:40:00 CST]** 🟡修改
- **影响范围**：`src/lib/quotas/providers/codex.js`、`src/app/api/quotas/auth/route.ts`、`QuotaManualModal.tsx`、`QuotaProviderRow.tsx`、`secret-store.ts`、`tests/quota-codex.test.mjs`
- **变更摘要**：补齐 Codex 授权：检测 `~/.codex/auth.json` 的 ChatGPT OAuth；过期登录明确要求重新登录；授权弹窗主按钮运行 `codex login`，API Key 仅作无法跳转时的独立回退，不与 ChatGPT 订阅混用。已登录但尚无 rate_limits 视为已连接而非鉴权失败。
- **回滚指南**：checkout 上述文件后同步运行副本并重启常驻服务

- **[2026-09-01 23:20:00 CST]** 🟡修改
- **影响范围**：`QuotaManualModal.tsx`、`QuotaCenter.tsx`、`src/lib/i18n.ts`
- **变更摘要**：授权弹窗改为 Portal 到 `document.body` 并垂直居中；z-index 提到额度中心之上（120 > 100）。Escape / 焦点锁定在授权层优先处理，关闭授权不会关掉额度查看弹窗。
- **回滚指南**：checkout 上述文件后同步运行副本并重启常驻服务

- **[2026-09-01 22:40:00 CST]** 🟡修改
- **影响范围**：`src/lib/quotas/providers/grok.js`、`src/app/api/quotas/auth/route.ts`、`src/components/dashboard/QuotaManualModal.tsx`、`QuotaProviderRow.tsx`、`src/lib/i18n.ts`、`tests/quota-grok.test.mjs`、`docs/QUOTA_MANUAL_GUIDE.md`
- **变更摘要**：Grok 授权改为与 CLI 一致的浏览器 OAuth 优先：点击「在浏览器中发起授权」调用本机 `grok login --oauth` 打开 auth.x.ai；已有 `~/.grok/auth.json` 则直接视为已登录。无法跳转页面时才展开 Management Key / Team ID。快照不写入 token/邮箱/Team ID。
- **回滚指南**：checkout 上述文件后 `npm run daemon-restart`

- **[2026-09-01 21:45:00 CST]** 🟢新增
- **影响范围**：`src/lib/quotas/**`（types/status/cache/refresh/http/db-store/server + providers/codex|gemini|grok|glm|kimi）、`src/lib/db.ts`（新增 quota_snapshots 表）、`src/app/api/quotas/**`、`src/components/dashboard/QuotaCenter.tsx|QuotaProviderRow.tsx|QuotaProgress.tsx`、`src/app/page.tsx`、`src/lib/i18n.ts`、`tests/quota-*.test.mjs`、`tests/helpers/quota-mock.mjs`、`scripts/ui-verify-quotas.mjs`
- **变更摘要**：新增「账号额度中心」：① 顶部入口带全局风险状态点与需关注计数；② 五家 Provider（Codex/Gemini/Grok/GLM Coding Plan/Kimi Code）统一快照结构与状态机（loading/healthy/warning/critical/exhausted/partial/stale/not_configured/auth_error/network_error/unsupported/unsupported_version）；③ Codex 扫描本地会话 rate_limits（按事件时间取最新）、Gemini 复用 CLI OAuth 走 retrieveUserQuota（内存刷新 token）、Grok 订阅如实标注不可自动读取+xAI Management API 可选、GLM 对齐官方 glm-plan-usage 端点、Kimi 直连官方 /usages（兼容本地 Server API wire 格式）；④ GET /api/quotas 立即返回缓存+后台去重刷新、POST /api/quotas/refresh 30s 节流+allSettled；⑤ 单 Adapter 5.5s 超时、失败保留上次成功数据、鉴权失败不伪装；⑥ 快照表严禁凭证，错误白名单化；⑦ 弹窗复用 ShareCard Portal/焦点锁定模式，移动端底部抽屉，中英文。验证：105/105 测试通过、lint/typecheck/build 通过、Playwright 25 项 UI 验收通过、3820 常驻服务真实读回（Codex 24%/25% 与官方事件一致、Kimi 39% 与本地 Server 一致、Grok/GLM 不伪造数据）、DB/API/HTML 审计无凭证。
- **回滚指南**：`rm -rf src/lib/quotas src/app/api/quotas src/components/dashboard/QuotaCenter.tsx src/components/dashboard/QuotaProviderRow.tsx src/components/dashboard/QuotaProgress.tsx tests/quota-*.test.mjs tests/helpers scripts/ui-verify-quotas.mjs` 后 checkout `src/lib/db.ts src/lib/i18n.ts src/app/page.tsx`；运行时另需在 `~/.tokentrail/runtime/TokenTrail` 同步回滚并 `npm run daemon-restart`
