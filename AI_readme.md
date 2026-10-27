# TokenTrail 使用说明书（AI_readme）

TokenTrail 是一个只在你电脑上运行的「AI 用量记账本」：它把你用过的各个 AI 编程工具（Claude Code、Codex、Kimi Code、Grok、Cursor 等）每一次调用花了多少 token、值多少钱记下来，再画成图表；同时帮你盯着各家订阅套餐还剩多少额度。数据全部存在本机，不上传任何服务器。

更详细的技术文档见 `README.zh-CN.md`、`docs/INTEGRATION.md`、`docs/CODE_WIKI.md`。

## 一、怎么打开

| 操作 | 命令 / 地址 |
| --- | --- |
| 打开网页面板 | 浏览器访问 `http://localhost:3820`（或运行 `npm run open`） |
| 立刻同步一次所有工具的用量 | `npm run sync`，或网页「数据接入」页点「立即同步」 |
| 检查服务是否健康 | `npm run doctor` |
| 改完代码后让后台服务生效 | `npm run install-service`（后台服务跑的是 `~/.tokentrail/runtime/TokenTrail` 里的副本，不重装不会用到新代码） |

后台服务每 4 小时会自动同步一次，平时不用手动操作。

## 二、Cursor 接入（2026-10-07 新增）

**你需要做的：只要在电脑上的 Cursor 里保持登录即可，不需要填任何 Key。**

### 1. 用量统计（每次调用记一笔）
- 每次同步时，TokenTrail 用你本机 Cursor 的登录状态，去 Cursor 官网后台读取「每次调用」的账单：用了哪个模型、输入/输出/缓存各多少 token、这次调用值多少钱。
- 第一次同步会把历史全部导入；之后只补新增的部分，重复的会自动跳过。
- 在面板里来源显示为 **Cursor**。能找到对话记录的调用会归到对应项目（比如 TokenTrail、HabitSprout），找不到的显示为 unknown。
- 金额说明：Cursor 指定模型等会按账单 `totalCents` 记美元。**`grok-bot-*`（Cursor 套餐附带的 Grok Bot）只记 token 用量，金额固定记为 $0**——OpenRouter 也没有这些模型，账单上的金额只是等值参考，不是实付。改完后需 `npm run install-service` 才会进常驻服务；启动时会自动把历史 `grok-bot-*` 金额清零。

### 2. 额度监控（套餐还剩多少）
- 网页「账号额度」页会多出一行 **Cursor**，显示：
  - 套餐名和已用金额，如 `Cursor Pro · $5.52/$20`
  - **API 额度 · 月**：指定模型（Claude、GPT 等）用掉了套餐里多少比例
  - **总额度 · 月**：包含 Auto 模式在内的总占比
  - **按量付费**：只有你在 Cursor 后台开启了超额付费才会出现
  - 下次重置日期（就是你的计费周期结束日）
- 用到 80% 变黄、95% 变红提醒。

### 模型名说明（2026-10-15）
- Cursor 官网接口把 **Auto 模式** 记成字面量 `default`，TokenTrail 现在统一显示为 **`auto`**，并归入「Cursor 自有（Auto / composer）」分组（以前被错算进「指定模型」）。
- 去重编号 `request_id` 仍用接口原始名（`...:default`），所以改名不会造成重复记录。历史数据由启动迁移 `migration.cursor_default_to_auto_v1` 自动改名。
- Auto 的金额目前取 `totalCents`（按底层模型原价折算），通常是 Cursor 实际扣费 `chargedCents` 的 2～3 倍；指定模型两者相同。

### 3. 常见问题
| 现象 | 原因 / 解决办法 |
| --- | --- |
| 同步结果提示「Cursor 登录已过期」 | 打开 Cursor 重新登录一次，再点同步 |
| 额度页 Cursor 显示「未连接」 | 本机 Cursor 没登录，或没装 Cursor |
| 想手动检查 Cursor 能读到多少数据 | 在项目目录运行 `node src/lib/cursor.js`（只读，只打印条数） |

### 4. 相关代码
| 文件 | 作用 |
| --- | --- |
| `src/lib/cursor.js` | 读取 Cursor 登录态、分页拉取用量事件、转换成 TokenTrail 记录 |
| `src/lib/sync.ts` → `syncCursor()` | 每次同步时把 Cursor 记录写入数据库，失败原因会显示在「数据接入」页 |
| `src/lib/quotas/providers/cursor.js` | 额度中心的 Cursor 适配器 |
| `tests/cursor-usage.test.mjs` | 自动化测试（不联网） |

## 三、数据口径说明（2026-10-13 更新）

| 概念 | 现在的含义 |
| --- | --- |
| 「今天」 | 从**本地今天零点**到现在（以前是"最近 24 小时"，会把昨天的数据算进来） |
| 「7 天 / 30 天 / 90 天」 | 今天 + 往前 N-1 个完整自然日，和趋势图的按天分组一致 |
| 实测 / 估算 | 汇总数字只算**实测**。估算记录（如 TraeWork 按字符估算）单独显示一行「另有 N 条估算记录未计入」 |
| 原始调用记录 | 默认只显示「实测」，和上方汇总条数一致；可切到「估算」或「全部」，估算行带黄色「估算」标签 |

接口参数：`GET /api/usage?days=7&kind=measured|estimated|all`（不传 `kind` 等于 all；传错返回 400）。

### 页面反馈
- 切换筛选很快时，只有**最后一次**选择的结果会显示（旧请求会被取消）。
- 用量、总览、额度、数据接入页读取失败时，会显示黄色提示 +「重试」按钮；有旧数据时会注明"显示的是上一次的结果"。
- 数据接入页的状态灯：绿=正常，黄=上次同步失败或超过 4 小时没新数据，红=读不到状态。
- 账号额度页在后台刷新期间每 3 秒自动重读一次（最多 10 次），刷新完会自动出现新值。单家「重试」不会再把「刷新额度」按钮锁 30 秒。

### 运维
- 常驻服务已改为 **production 模式**。`npm run doctor` 现在：
  - 用**文件内容指纹**判断运行副本是否和项目一致（以前只比修改时间）；
  - 从**正在运行的进程**判断是否 dev 模式（以前只看 plist 文件，文件被删时会误报）。
- `npm run install-service` 修复了"卸载还没完成就重新加载"导致的 `Bootstrap failed: 5` 报错。
- `tokentrail sync` 会先等服务启动（最多 60 秒）再同步，避免开机时同步失败。
- 自检脚本：`USAGE_VERIFY_URL=http://127.0.0.1:3830 node scripts/ui-verify-usage.mjs`（需先用数据库副本在 3830 端口启动服务；会拦截额度接口，不会真的去查供应商）。

## 四、模型价目表（2026-10-15 按 OpenRouter 更新）

**怎么更新价格**：在项目目录运行

| 命令 | 作用 |
| --- | --- |
| `node scripts/sync-openrouter-pricing.mjs` | 只预览：列出每个模型「旧价 → 新价」、取价依据、影响多少条记录，不写库 |
| `node scripts/sync-openrouter-pricing.mjs --apply` | 先备份数据库到 `~/.tokentrail/backups/`，再更新价格并重算历史费用 |

**取价规则**（单位：美元 / 百万 token）：
- OpenRouter 列表页的价格是「最便宜的那家服务商」，开源模型（GLM、Kimi 等）会被小服务商拉得很低，所以脚本改为取**模型原厂**在 OpenRouter 上的标准档报价（OpenAI、Anthropic、Z.AI、Moonshot…）；没有原厂报价时取各服务商的中位数。加速档 / 优先档 / 批处理档不参与。
- **思考 token 按输出价计费**。以前思考单价全是 0，Codex、Grok 等的思考 token 一直没算钱；现在 `src/lib/pricing.ts` 在思考价为 0 时自动按输出价算。
- Cursor 逐次账单用的是 Cursor 官方金额，**不会被重算**。
- 名字对不上但确定是同一模型的，在脚本顶部 `ALIASES` 里配置（如 `kimi-code/k3` → `moonshotai/kimi-k3`）。

**本次结果**：更新 113 个模型价格，重算 66,928 条记录，非 Cursor 来源总费用 \$4,120 → \$5,084。关键变化：`gpt-6.1-sol` 从 0 变为 2 / 0.1 / 10（2,528 条记录，补回 \$71）；`gpt-5.6-sol` 按 OpenAI 原厂价从 2 / 10 涨到 4 / 20；GLM-5.x 按 Z.AI 原厂价 1.4 / 0.26 / 4.4。

OpenRouter 上没有的模型（`composer-*`、`codex-auto-review`、`deepseek-flash` 等）保持原价；`grok-bot-*` 固定为 $0（只记用量）。

## 五、已知问题与后续可改进


1. **Cursor 接口不是公开 API**：用的是 Cursor 官网后台自己用的接口，如果 Cursor 改版，同步会提示「接口格式发生变化」，需要更新 `src/lib/cursor.js`。
2. **项目归属不完整**：Cursor 只在本地保留了少量对话记录，大部分 Cursor 调用目前归为 unknown。
3. **只支持个人账号**：团队账号（teamUsage）的额度暂未展示。
4. **部署会带上所有未提交改动**：`npm run install-service` 会把整个工作区复制到运行副本，部署前最好先跑 `npm run check`。
5. **（2026-10-09 复查）代码长时间没有提交**：约 60 个文件、三千多行改动还停留在工作区，最后一次提交是 `93b0cb4`。建议按功能分批提交，方便出问题时回退。
6. **网络同步的计时器起步太早**：`src/lib/sync/index.ts` 先启动 Cursor/VibeCafé 的 45 秒计时，再同步跑本地扫描；本地扫描是"堵住整个进程"的同步代码，网络请求其实无法并行。首次全量扫描超过 45 秒时，Cursor 同步可能刚开始就被判超时。
7. **`src/lib/sync/sources/*.ts` 有大量复制来的无用 import**（例如 cursor.ts 引了十几个用不到的函数），不影响运行，但增加阅读成本。
8. **依赖安全（2026-10-13）**：`npm audit` 需用官方源（`--registry=https://registry.npmjs.org`，默认的 npmmirror 不支持）。Next.js 已升到 15.5.27（React 19），官方源上 Next 自身的 critical / high 告警已消失。定价表脚本改为 ExcelJS，不再依赖有原型污染和 ReDoS 告警的 SheetJS `xlsx@0.18.5`。`postcss` 锁在 8.5.30。剩下的告警在 Tailwind CSS 3 的构建依赖（braces、micromatch、glob）和 ExcelJS 带的 `uuid`（moderate，只在手动导入导出定价表时加载）。升到 Tailwind 4 才能清掉构建链告警，那是另一轮迁移。服务仍然只监听 127.0.0.1。
9. **sync LaunchAgent 的 plist 曾被删除**（服务仍在内存中运行）。原因不明，如果再出现，doctor 现在会提示「未找到 LaunchAgent 文件」，重跑 `npm run install-service` 即可。
10. **页面上的中文文案大多是写死的**，没有走 `i18n.ts`，切到英文时部分表头仍是中文。
11. **新模型价格默认 0**：同步遇到价格表里没有的模型时会自动登记 0 元价格，费用会被少算。发现新模型后运行一次 `node scripts/sync-openrouter-pricing.mjs --apply` 即可补价并重算。注意：网页改价格（`POST /api/pricing`）**不会**重算历史费用；旧的 `scripts/import-pricing-excel.mjs` 会连 Cursor 官方账单一起覆盖，不建议再用。
12. **模型名大小写不统一**：`GLM-5.3-Flash`（ZCode）和 `glm-5.3-flash`、`MiniMax-M2.7-highspeed` 和 `minimax-m2.7-highspeed` 在按模型统计时会被拆成两行。
13. **残留测试数据**：hermes 来源下还有 `test`、`test-model`、`verify-model` 三条测试记录（金额为 0，不影响总额）。
14. **生产构建不在 `npm run check` 里**：Next 15 的路由参数类型错误只在 `npm run install-service` 构建时才暴露（2026-10-15 已修复代理路由）。部署前建议额外跑一次 `npx next build`。
15. Antigravity 日志本身不带模型名，模型是从文字和设置里推断的。已核对：本机 Antigravity 日志里 639 次模型选择全部是 `Gemini 3.8 Flash (High)`，与记录一致。

已解决（2026-10-27）：`grok-bot-*` 只记用量、金额恒为 $0；启动迁移清零历史金额与价目表。

已解决（2026-10-13）：筛选竞争；「今天」口径；汇总与明细口径一致（实测/估算筛选+标签）；所有写入路径（同步、上报、代理）都会立即清统计缓存；额度后台刷新自动轮询、单家刷新不再锁全局；错误提示与重试；同步时单行写入失败不再把整个文件标记为已完成（坏 JSON 行单独计入 `bad_lines`；Grok 日志因超时中断时也不再被标记完成）；远程模式下所有代理请求（含 POST）都必须自带 `Authorization: Bearer`；常驻服务改 production。测试 222 个全部通过。

已解决（2026-10-09 确认）：sync.ts 已拆分为 `src/lib/sync/`；总览页的估算值改为「另有估算」且不计入实测总数；VibeCafé 插入前先判断是否已有明细；`doctor` 能检测运行副本过期和 dev 模式；代理 GET 增加了来源校验；新增端到端冒烟测试（共 210 个测试全部通过）。
