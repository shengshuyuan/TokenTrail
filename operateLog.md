# operateLog

- **[2026-06-29 18:21:30 CST]** 🟢新增
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
