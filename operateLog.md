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
