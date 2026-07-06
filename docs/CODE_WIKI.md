# TokenTrail Code Wiki

> 生成时间：2026-06-29
> 适用范围：当前仓库主应用、CLI、API、数据层与 Dashboard 前端
> 说明：本仓库几乎没有传统意义上的“类（class）”，核心实现以 `函数 + React 组件 + Next.js Route Handler` 为主，因此本文档重点解释关键函数、组件和模块边界。

## 1. 项目是什么

TokenTrail 是一个本地优先的 AI Token 用量追踪器。它把来自 Claude Code、Codex、OpenClaw、Hermes 以及其他兼容工具的真实 token 用量统一写入本地 SQLite，然后通过一个 Next.js Dashboard 展示趋势、费用、来源分布、模型分布、项目归因和系统状态。

它包含 4 条核心能力链路：

1. 本地扫描：扫描 Claude Code 和 Codex 的本地会话 JSONL。
2. 主动上报：其他工具直接调用 `/api/report` 上报一条记录。
3. 代理采集：把 OpenAI 兼容 SDK 指向 `/proxy/openai/*`，自动记录 usage。
4. 本地常驻：CLI 可在 macOS 上注册 LaunchAgent，让服务和定时同步长期运行。

## 2. 技术栈

| 层 | 技术 | 作用 |
| --- | --- | --- |
| Web 框架 | Next.js 14 App Router | 页面渲染、API 路由 |
| 前端 | React 18 + TypeScript | Dashboard 交互与组件化 |
| 样式 | Tailwind CSS + 全局 CSS 变量主题系统 | 视觉主题、布局、动效 |
| 图表 | Recharts | 趋势图、柱状图、占比图 |
| 数据库 | SQLite + `better-sqlite3` | 本地持久化 |
| CLI | Node.js 脚本 | 启动、同步、诊断、备份、安装服务 |
| 平台能力 | macOS LaunchAgent | 常驻服务与定时同步 |
| SDK | `packages/tokentrail-report` | 外部工具低成本接入 |

## 3. 仓库结构

```text
TokenTrail/
├── bin/
│   └── tokentrail.js              # CLI 入口
├── docs/
│   ├── INTEGRATION.md             # 接入说明
│   ├── OPERATIONS.md              # 常驻运行与排障手册
│   ├── PRD.md                     # 产品说明
│   ├── SKILL.md                   # 给 AI 工具使用的技能描述
│   └── CODE_WIKI.md               # 本文档
├── packages/
│   └── tokentrail-report/         # 上报 SDK
├── scripts/
│   ├── serve.js                   # Next.js 本地服务入口
│   ├── sync-codex.js              # Codex 同步辅助脚本
│   └── verify-local.js            # 本机验收脚本
├── src/
│   ├── app/
│   │   ├── api/                   # Route Handlers
│   │   ├── globals.css            # 全局样式与主题系统
│   │   ├── layout.tsx             # 根布局
│   │   ├── page.tsx               # Dashboard 主页面
│   │   └── providers.tsx          # 全局 Provider
│   ├── components/
│   │   ├── dashboard/             # Dashboard 子组件
│   │   ├── Motion.tsx             # 轻量动效包装
│   │   └── ThemePicker.tsx        # 主题选择器
│   ├── lib/
│   │   ├── db.ts                  # SQLite 数据访问
│   │   ├── init.ts                # 初始化入口
│   │   ├── pricing.ts             # 费用计算
│   │   ├── seed-pricing.ts        # 价格表初始化
│   │   ├── sync.ts                # 多来源同步引擎
│   │   ├── i18n.ts                # 词典
│   │   ├── LanguageContext.tsx    # 语言上下文
│   │   ├── themes.ts              # 主题定义
│   │   └── format.ts              # 展示格式化
│   └── types/
│       └── index.ts               # 类型定义
├── public/                        # Logo 等静态资源
├── tests/                         # 现有自动化测试
├── package.json
└── README.md
```

## 4. 如何运行

### 4.1 本地开发

```bash
npm install
npm run dev
```

默认服务地址：

```text
http://localhost:3820
```

### 4.2 生产模式

```bash
npm run build
npm run start
```

### 4.3 常用 CLI 命令

| 命令 | 作用 |
| --- | --- |
| `npm run setup` | 初始化本地配置 |
| `npm run sync` | 立即同步所有来源 |
| `npm run status` | 查看服务状态与统计摘要 |
| `npm run doctor` | 做本机健康检查 |
| `npm run open` | 打开 Dashboard |
| `npm run backup` | 备份 SQLite |
| `npm run install-service` | 安装 macOS 常驻服务 |
| `npm run uninstall-service` | 卸载 macOS 常驻服务 |

### 4.4 关键本地文件

| 路径 | 用途 |
| --- | --- |
| `data/token-trail.db` | 项目本地 SQLite 数据库 |
| `~/.tokentrail/config.json` | 用户本地配置 |
| `~/.tokentrail/sync-status.json` | 最近一次同步状态 |
| `~/.tokentrail/backups/` | 数据库备份 |
| `~/.tokentrail/logs/` | 服务/同步日志 |
| `~/.tokentrail/runtime/TokenTrail/` | LaunchAgent 运行副本 |

## 5. 整体架构

```mermaid
flowchart LR
  A[Claude Code JSONL] --> E[sync.ts]
  B[Codex JSONL] --> E
  C[~/.openclaw/usage/*.jsonl] --> E
  D[VibeCafe API / 其他来源] --> E

  H[外部工具 / SDK] --> I[/api/report]
  J[OpenAI Compatible Client] --> K[/proxy/openai/*]

  E --> L[pricing.ts]
  I --> L
  K --> L

  E --> M[db.ts]
  I --> M
  K --> M

  M --> N[(SQLite)]
  N --> O[/api/stats]
  N --> P[/api/usage]
  N --> Q[/api/status]
  N --> R[/api/health]
  N --> S[/api/pricing]

  O --> T[Dashboard page.tsx]
  P --> T
  Q --> U[SystemStatus]
  S --> T

  V[bin/tokentrail.js CLI] --> O
  V --> Q
  V --> W[/api/sync]
  V --> X[/api/backup]
```

### 架构理解要点

- Web、API 和 Dashboard 都跑在同一个 Next.js 应用里，不是前后端分离项目。
- CLI 不是独立后端，它本质上是“本地服务管理器 + HTTP 客户端”。
- 所有数据最后都收敛到 SQLite，再由统计接口统一查询。
- 前端页面只有一个主要页面：`src/app/page.tsx`。

## 6. 核心数据流

### 6.1 同步流

1. `/api/sync` 触发 `syncAll()`。
2. `sync.ts` 依次扫描 Claude Code、Codex、本地 JSONL、VibeCafe API。
3. 每条记录会：
   - 推断或读取 `source / provider / project / model`
   - 用 `ensureModelPricing()` 保证价格表有该模型
   - 用 `calculateCost()` 计算 `cost_usd`
   - 用 `insertUsageRecord()` 写入 `usage_records`
4. 同步摘要写到 `~/.tokentrail/sync-status.json`。

### 6.2 主动上报流

1. 外部工具调用 `POST /api/report`。
2. 路由校验 JSON、字段类型、token 非负数、拒绝全 0 token。
3. 通过 `calculateCost()` 算费用。
4. 通过 `insertUsageRecord()` 写入库。

### 6.3 代理采集流

1. 工具把 `baseURL` 指向 `http://localhost:3820/proxy/openai`。
2. 代理将请求透传到上游 OpenAI 兼容接口。
3. 非流式：从 JSON `usage` 里提取 token。
4. 流式：从最终 SSE chunk 提取 `usage`。
5. 记录 usage 并把响应原样返回给调用方。

### 6.4 展示流

1. 首页调用 `/api/stats` 拉取聚合统计。
2. 首页调用 `/api/usage` 拉取原始记录分页。
3. `SystemStatus` 组件独立调用 `/api/status`。
4. 主题、语言、显示偏好存入 `localStorage`。

## 7. 数据库设计

### 7.1 `usage_records`

这是事实表，负责承载所有 token 使用记录。

| 字段 | 含义 |
| --- | --- |
| `source` | 来源工具，如 `codex`、`claude-code` |
| `provider` | 模型服务商 |
| `project` | 项目名，默认 `unknown` |
| `model` | 模型 ID |
| `input_tokens` | 输入 token |
| `cached_input_tokens` | 命中缓存的输入 token |
| `output_tokens` | 输出 token |
| `reasoning_tokens` | 推理 token |
| `cost_usd` | 按价格表算出的美元成本 |
| `request_id` | 去重主键之一 |
| `timestamp` | 事件时间 |

关键索引：

- `idx_usage_source`
- `idx_usage_model`
- `idx_usage_timestamp`
- `idx_usage_project`
- `idx_usage_request_id`（带唯一约束）

### 7.2 `model_pricing`

负责保存模型价格。

| 字段 | 含义 |
| --- | --- |
| `model_id` | 模型 ID |
| `display_name` | 展示名 |
| `provider` | 所属服务商 |
| `input_price_per_1m` | 输入单价 |
| `cached_input_price_per_1m` | 缓存输入单价 |
| `output_price_per_1m` | 输出单价 |
| `reasoning_price_per_1m` | 推理单价 |

### 7.3 `app_config`

负责存简单配置，例如：

- `vibecafe_api_key`
- `openai_api_key`

## 8. 主要模块职责

## 8.1 页面层

### `src/app/layout.tsx`

- 定义全局 `metadata`
- 加载全局字体和样式
- 在首屏脚本里恢复主题，避免主题闪烁
- 包装全局 `Providers`

### `src/app/page.tsx`

这是当前项目最重要的前端容器文件，负责：

- 管理 Dashboard 全局状态
- 拉取 `/api/stats` 与 `/api/usage`
- 处理自动刷新
- 触发 `/api/sync`
- 恢复并持久化用户偏好
- 拼装各个面板和图表

当前它同时承担“页面容器 + 数据编排 + 部分展示组件”的职责，文件偏大，是后续重构重点之一。

## 8.2 API 层

| 路由 | 职责 |
| --- | --- |
| `/api/health` | 健康检查、版本与基础统计 |
| `/api/stats` | 聚合统计查询 |
| `/api/usage` | 原始记录分页查询 |
| `/api/report` | 接收外部使用量上报 |
| `/api/sync` | 触发多来源同步 |
| `/api/status` | 系统状态、最近同步、备份情况 |
| `/api/backup` | 创建数据库备份 |
| `/api/pricing` | 读取和更新模型价格 |
| `/proxy/openai/[...path]` | OpenAI 兼容代理 + 自动采集 usage |

## 8.3 数据层

### `src/lib/db.ts`

- 数据库初始化
- 建表与轻量迁移
- 插入记录
- 聚合查询
- 价格与配置读写

### `src/lib/init.ts`

- 保证数据库初始化和价格种子只执行一次

### `src/lib/pricing.ts`

- 根据 `model_pricing` 计算美元成本
- 未知模型时返回 `0`，并打印警告

### `src/lib/sync.ts`

- 多数据源同步总控
- Claude Code / Codex / JSONL / VibeCafe 各来源解析
- 未知模型自动注册
- 项目名补写与规范化

## 8.4 CLI 与运行层

### `bin/tokentrail.js`

- 解析 CLI 命令
- 管理本地配置
- 调用 HTTP API
- 安装/卸载 LaunchAgent
- 准备运行时副本
- 打开 Dashboard、备份、诊断服务

### `scripts/serve.js`

- 本地启动 Next.js 应用
- 默认监听 `3820`

## 8.5 接入层

### `packages/tokentrail-report/index.js`

- 暴露 `report()`，直接调用 `/api/report`
- 暴露 `wrapOpenAI()`，在 SDK 调用后自动读 `response.usage` 并上报

## 8.6 UI 基础设施

### `src/lib/themes.ts`

- 提供 4 套主题定义
- 控制色板、字体、面板风格、视觉气质

### `src/lib/i18n.ts` + `src/lib/LanguageContext.tsx`

- 提供中英文词典
- 用 React Context 管理语言状态

### `src/components/Motion.tsx`

- 基于 `IntersectionObserver` 提供轻量入场动画

## 9. 关键函数与组件速查

| 符号 | 位置 | 作用 | 上游 / 下游 |
| --- | --- | --- | --- |
| `DashboardInner()` | `src/app/page.tsx` | 首页主容器 | 上游：浏览器；下游：所有 Dashboard 子组件 |
| `fetchData()` | `src/app/page.tsx` | 拉取 `/api/stats` | 下游：`setStats()` |
| `fetchRawRecords()` | `src/app/page.tsx` | 拉取 `/api/usage` | 下游：原始记录表 |
| `handleSync()` | `src/app/page.tsx` | 触发 `/api/sync` 并刷新页面数据 | 下游：同步结果表、图表 |
| `getDb()` | `src/lib/db.ts` | 初始化 SQLite、建表、迁移 | 下游：所有 DB 读写函数 |
| `insertUsageRecord()` | `src/lib/db.ts` | 插入一条 usage 记录并处理去重 | 上游：`sync.ts`、`/api/report`、`proxy` |
| `getAggregatedStats()` | `src/lib/db.ts` | 聚合统计查询 | 下游：`/api/stats` |
| `calculateCost()` | `src/lib/pricing.ts` | 按模型价格算成本 | 上游：所有入库链路 |
| `syncAll()` | `src/lib/sync.ts` | 同步总控入口 | 下游：4 路同步函数 |
| `syncClaudeCode()` | `src/lib/sync.ts` | 扫描 Claude Code 本地 JSONL | 下游：`insertUsageRecord()` |
| `syncCodex()` | `src/lib/sync.ts` | 扫描 Codex 本地 JSONL | 下游：`insertUsageRecord()` |
| `syncLocalUsageFiles()` | `src/lib/sync.ts` | 扫描 `~/.openclaw/usage`、`~/.hermes/usage` | 下游：`insertUsageRecord()` |
| `syncVibeCafe()` | `src/lib/sync.ts` | 调用远端 API 导入 | 下游：`insertUsageRecord()` |
| `handleRequest()` | `src/app/api/proxy/openai/[...path]/route.ts` | OpenAI 兼容代理主逻辑 | 上游：SDK / 客户端；下游：上游模型 API |
| `POST()` | `src/app/api/report/route.ts` | 单条 usage 上报入口 | 上游：SDK / 外部工具 |
| `ThemePicker()` | `src/components/ThemePicker.tsx` | 主题切换 | 下游：`data-theme` |
| `SystemStatus()` | `src/components/dashboard/SystemStatus.tsx` | 系统健康面板 | 上游：`/api/status` |
| `ComparisonChart()` | `src/components/dashboard/ComparisonChart.tsx` | 来源/模型对比图 | 上游：`stats.by_source / by_model` |

## 10. 模块依赖关系

```mermaid
flowchart TD
  A[page.tsx] --> B[dashboard components]
  A --> C[/api/stats]
  A --> D[/api/usage]
  A --> E[/api/sync]

  F[SystemStatus.tsx] --> G[/api/status]
  H[ThemePicker.tsx] --> I[themes.ts]
  A --> J[LanguageContext.tsx]
  J --> K[i18n.ts]

  C --> L[db.ts]
  D --> L
  G --> L
  E --> M[sync.ts]

  M --> L
  M --> N[pricing.ts]
  N --> L

  O[/api/report] --> N
  O --> L

  P[/proxy/openai/*] --> N
  P --> L

  Q[bin/tokentrail.js] --> R[HTTP API]
  S[tokentrail-report] --> O
```

### 依赖设计观察

- `pricing.ts -> db.ts` 是反向依赖，说明“价格计算”依赖数据库价格表。
- `page.tsx` 依赖面过大，目前承担了过多 UI 和状态责任。
- `SystemStatus` 自己轮询 `/api/status`，没有和首页主数据流共享缓存。

## 11. 关键实现细节

### 11.1 去重策略

- `request_id` 在 `usage_records` 上有唯一索引。
- Codex 同步使用 `codex:<相对路径>:L<行号>` 生成去重键。
- 代理和主动上报优先使用响应中的真实请求 ID。

### 11.2 未知模型处理

- 未知模型不会阻断入库。
- 系统会给它补一个价格记录，默认价格为 0。
- `calculateCost()` 会打印警告，提醒后续补齐价格。

### 11.3 项目归因

- `project` 默认是 `unknown`。
- Codex 同步会在读到会话上下文后，用 `backfillProjectByRequestPrefix()` 回填之前未归因的数据。

### 11.4 Hydration 安全

- 首页把会受 `localStorage` 影响的状态先用“服务端安全默认值”初始化。
- 挂载后再恢复用户偏好，降低 hydration mismatch 风险。

## 12. 当前页面设计评审

以下评审同时参考了源码结构和真实页面预览。

### 12.1 当前做得好的地方

- 视觉语言统一：主题、边框、荧光色、字体现代感一致。
- 信息分类清晰：过滤、系统状态、图表、原始记录基本按任务分区。
- 本地工具气质明显：很符合“开发者仪表盘”的产品调性。
- 主题系统完整：不只是换色，而是整套视觉语气切换。

### 12.2 当前最值得优先优化的问题

#### P0：首屏过于“控制台化”，核心数据价值露出太晚

现象：

- 首屏先看到大量筛选器、开关、系统状态，真正最有价值的统计卡片和图表在更下方。
- 用户打开页面时，第一眼看到的是“如何控制界面”，不是“今天花了多少钱、哪个工具最贵、趋势是否异常”。

影响：

- 新用户不容易立刻理解产品价值。
- 日常回访用户要滚动后才能看到关键业务指标。

建议：

1. 将 `StatsCards` 提升到筛选器之后、系统状态之前，或直接放到首屏 Hero 下方。
2. 把“设置”区块下沉到页面更后面，避免抢占首屏注意力。
3. 将“同步”和“最近更新时间”合并成更清晰的一组主操作状态。

#### P0：视觉层级偏平，霓虹效果强但扫描效率不足

现象：

- 很多按钮、芯片、卡片边框的亮度和阴影强度接近。
- 小字较多，且大量使用等宽字体，长期阅读会更累。
- 深色主题下，正文、次级信息、禁用态的层级差还不够大。

影响：

- 页面“酷”，但不够“快读”。
- 高频使用时更容易疲劳。

建议：

1. 只保留 1 个主强调色区用于主操作和主指标，减少到处都亮。
2. 数字指标继续保留强对比，说明文字降低发光强度。
3. 小字号区域尽量减少等宽字体覆盖面，只给数字、代码、标签使用。

#### P1：过滤区缺少收纳策略，数据一多会横向膨胀

现象：

- 来源和模型筛选都使用横向按钮堆叠。
- 模型数量继续增长时，过滤区会快速变高或横向滚动。

影响：

- 首屏高度进一步被过滤器吃掉。
- 模型较多时难以快速定位。

建议：

1. 来源保留 chip，模型改成可搜索的下拉多选。
2. 默认只展示 Top N 常用模型，其余折叠到“更多”。
3. 在筛选区展示“已选摘要”，减少重复阅读。

#### P1：系统状态面板信息质量高，但权重偏重

现象：

- 系统状态当前位于统计卡片之前，而且占据较大的垂直空间。
- 对多数用户来说，这是“次高频排障信息”，而非“主阅读内容”。

影响：

- 正常使用时，状态面板会压住主要分析内容。

建议：

1. 默认折叠“同步详情”与“数据源健康”次级内容。
2. 系统状态保留 3 个摘要卡即可，详细信息进入抽屉或二级展开。
3. 若系统正常，可减少警示色与卡片面积。

#### P2：设置区和原始明细区的产品语义还可以更清楚

建议：

1. “显示项目名称”改成更面向结果的文案，例如“屏幕共享时隐藏项目名”。
2. “显示原始明细”可放进“高级分析”分组，而不是首屏常驻。
3. 原始记录区适合支持固定列、复制请求 ID、快速跳转到来源。

### 12.3 UI / 可访问性 / 交互实现层问题

这些问题更偏工程实现，但会直接影响体验质量。

| 优先级 | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| 高 | 首页缺少跳过导航的 skip link | `src/app/layout.tsx` | 给主内容增加“跳到主内容”入口 |
| 高 | 集成指南弹窗没有明确的 `role="dialog"` / `aria-modal="true"` | `src/components/dashboard/IntegrationGuide.tsx` | 补齐语义并聚焦管理 |
| 高 | 多个分段按钮只做了视觉选中，没有暴露 `aria-pressed` / `aria-selected` | `src/app/page.tsx`、`FilterBar.tsx`、`ComparisonChart.tsx` | 给语言、货币、筛选、图表模式等状态控件补语义 |
| 中 | Toast 没有 `aria-live="polite"` | `src/components/dashboard/IntegrationGuide.tsx` | 让复制成功能被辅助技术读到 |
| 中 | Logo 图片没有显式 `width` / `height` | `src/app/page.tsx` | 避免 CLS，提升图像稳定性 |
| 中 | 许多样式使用 `transition-all` | `src/app/globals.css`、多个组件 | 改成精确属性，减少重绘与维护成本 |
| 中 | 筛选状态、分页、图表模式没有同步到 URL | `src/app/page.tsx` | 让页面支持分享、刷新恢复与深链 |
| 低 | 文案里大量使用 `...` 而不是 `…` | `src/lib/i18n.ts` 等 | 统一排版细节 |

### 12.4 推荐优化路线

#### 第一阶段：不改后端，只提升体验

- 调整首屏布局顺序：`头部 -> 核心指标 -> 趋势图 -> 筛选器 -> 系统状态`
- 下沉设置区
- 折叠原始明细区
- 弱化过强的边框发光与 hover 动效

#### 第二阶段：提升交互质量

- URL 同步筛选状态
- 模型筛选改成搜索式多选
- 系统状态改成摘要 + 展开
- 原始记录表加入更多审计动作

#### 第三阶段：做结构重构

- 将 `src/app/page.tsx` 拆成 `containers + sections + hooks`
- 独立 `useDashboardData()`、`useDashboardPrefs()`、`useSyncAction()`
- 让 `SystemStatus` 与首页共享数据缓存，避免重复轮询

## 13. 建议的后续重构清单

| 优先级 | 事项 | 价值 |
| --- | --- | --- |
| 高 | 拆分 `page.tsx` | 降低页面复杂度，提高可维护性 |
| 高 | 把筛选状态同步到 URL | 增强分享、恢复、深链能力 |
| 高 | 重做首屏信息层级 | 让产品价值更快被看见 |
| 中 | 给集成指南弹窗补完整 a11y | 提升可访问性与键盘体验 |
| 中 | 减少 `transition-all` | 优化性能与可控性 |
| 中 | 给原始记录区增强操作性 | 提升排障效率 |
| 低 | 完善自动化测试覆盖前端行为 | 防止 UI 回归 |

## 14. 新同学上手顺序

如果是第一次接手这个项目，建议按这个顺序读：

1. `README.md`
2. `package.json`
3. `src/app/page.tsx`
4. `src/lib/db.ts`
5. `src/lib/sync.ts`
6. `src/app/api/report/route.ts`
7. `src/app/api/proxy/openai/[...path]/route.ts`
8. `bin/tokentrail.js`
9. `docs/INTEGRATION.md`
10. `docs/OPERATIONS.md`

## 15. 一句话总结

TokenTrail 的本质是：**一个把多来源 AI token usage 收口到本地 SQLite，再通过 Next.js Dashboard 做可视化和运维管理的本地优先全栈应用。**
