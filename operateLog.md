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
