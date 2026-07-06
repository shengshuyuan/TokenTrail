# TokenTrail — 需求与架构设计文档

## 一、项目概述

**TokenTrail** 是一个本地优先的 AI 工具 Token 消耗追踪系统。采集 Codex、Claude Code、OpenClaw、Hermes 以及 NAS 上"龙虾"服务的 Token 用量数据，提供本地 Dashboard 进行可视化分析。后续可选部署到 Vercel。

---

## 二、功能需求

### 2.1 数据采集

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 统一上报 API | 本地 HTTP endpoint，所有工具按统一 Schema 上报 | P0 |
| 自动补录 | 服务启动时扫描官方日志目录，补录遗漏数据 | P1 |
| 去重 | 通过 request_id 防止重复上报 | P0 |
| 定时汇总 | 龙虾通过 cron 定时批量上报 | P1 |

### 2.2 费用计算

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 自动计费 | 根据模型价格表，自动计算每次消耗的美元费用 | P0 |
| 价格表内置 | 参考 OpenRouter 价格，预置主流模型价格 | P0 |
| 价格可编辑 | 支持通过 API 增删改模型价格 | P1 |
| 货币切换 | Dashboard 支持 USD / RMB 切换显示（汇率可配） | P1 |

### 2.3 Dashboard 看板

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 时间维度 | 今天 / 7天 / 30天 / 90天 | P0 |
| 来源筛选 | 按工具来源筛选（多选，点击切换） | P0 |
| 模型筛选 | 按模型筛选（多选，点击切换） | P0 |
| 统计卡片 | 总 Token 数、总费用、日均消耗、请求次数 | P0 |
| 趋势图 | 折线图：每日 Token / 费用趋势 | P0 |
| 对比图 | 柱状图：各工具 / 模型用量对比 | P0 |
| 占比图 | 环形图：工具用量占比 | P0 |
| 货币切换 | 页面按钮切换 USD / RMB | P1 |

### 2.4 UI 风格

- **主题**：四套原创视觉主题——机甲霓虹、赤焰卷轴、纸墨编辑、云光玻璃
- **切换方式**：顶部预览卡弹层；用户偏好保存在本地
- **视觉系统**：颜色、字体、圆角、阴影、纹理与图表色序均由语义化主题变量控制
- **安全边界**：不使用第三方角色、Logo、专有字体或标志性图形素材

---

## 三、技术架构

### 3.1 技术选型

| 层面 | 选择 | 理由 |
|------|------|------|
| 框架 | Next.js 14 (App Router) | 前后端一体，本地 `next dev` 跑，Vercel 一键部署 |
| 数据库 | SQLite (better-sqlite3) | 零配置、本地文件、轻量、单文件存储 |
| 图表 | Recharts | React 原生、灵活、社区活跃 |
| 样式 | Tailwind CSS + CSS Variables | 语义化令牌支持多主题切换 |
| UI 组件 | shadcn/ui | 高质量、可定制 |
| 定时任务 | node-cron | 轻量级 |
| 语言 | TypeScript | 类型安全 |

### 3.2 系统架构图

```
┌──────────────────────────────────────────────────────────┐
│                     TokenTrail                            │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  Codex   │  │ Claude   │  │ OpenClaw │  │ Lobster │ │
│  │          │  │  Code    │  │  Hermes  │  │  (NAS)  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       │             │             │             │        │
│       │  POST       │  POST       │  POST       │ POST   │
│       │  /api       │  /api       │  /api       │ /api   │
│       │  /report    │  /report    │  /report    │ /report│
│       ▼             ▼             ▼             ▼        │
│  ┌──────────────────────────────────────────────────┐    │
│  │            Next.js API Routes                     │    │
│  │  POST /api/report  — 接收上报                     │    │
│  │  GET  /api/usage   — 查询用量                     │    │
│  │  GET  /api/stats   — 聚合统计                     │    │
│  │  GET  /api/pricing — 价格管理                     │    │
│  └──────────────────────┬───────────────────────────┘    │
│                         │                                │
│                         ▼                                │
│  ┌──────────────────────────────────────────────────┐    │
│  │              SQLite (better-sqlite3)              │    │
│  │  usage_records  |  model_pricing                 │    │
│  └──────────────────────┬───────────────────────────┘    │
│                         │                                │
│                         ▼                                │
│  ┌──────────────────────────────────────────────────┐    │
│  │          Next.js Frontend (Dashboard)             │    │
│  │  4 Themes  |  Recharts  |  Filters               │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

---

## 四、数据库设计

### 4.1 usage_records（用量记录表）

```sql
CREATE TABLE usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,              -- 'codex' | 'claude-code' | 'openclaw' | 'hermes' | 'lobster'
  model TEXT NOT NULL,               -- 'claude-sonnet-4-6' | 'gpt-4o' | ...
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  request_id TEXT,                   -- 去重键
  timestamp INTEGER NOT NULL,        -- Unix 毫秒
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_usage_source ON usage_records(source);
CREATE INDEX idx_usage_model ON usage_records(model);
CREATE INDEX idx_usage_timestamp ON usage_records(timestamp);
CREATE UNIQUE INDEX idx_usage_request_id ON usage_records(request_id) WHERE request_id IS NOT NULL;
```

### 4.2 model_pricing（模型价格表）

```sql
CREATE TABLE model_pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL UNIQUE,          -- 'claude-sonnet-4-6'
  display_name TEXT NOT NULL,             -- 'Claude Sonnet 4.6'
  provider TEXT NOT NULL,                 -- 'anthropic' | 'openai' | 'google' | ...
  input_price_per_1m REAL NOT NULL,       -- USD / 1M input tokens
  cached_input_price_per_1m REAL DEFAULT 0,
  output_price_per_1m REAL NOT NULL,      -- USD / 1M output tokens
  reasoning_price_per_1m REAL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 五、API 设计

### 5.1 POST /api/report — 上报用量

**Request:**
```json
{
  "source": "claude-code",
  "model": "claude-sonnet-4-6",
  "input_tokens": 12345,
  "cached_input_tokens": 0,
  "output_tokens": 5678,
  "reasoning_tokens": 0,
  "request_id": "uuid-v4-optional",
  "timestamp": 1717027200000
}
```

字段说明：
- `source`: 必填，工具来源标识
- `model`: 必填，模型 ID，需与 model_pricing.model_id 匹配
- `input_tokens` / `output_tokens`: 必填
- `cached_input_tokens` / `reasoning_tokens`: 可选，默认 0
- `request_id`: 可选，用于去重。相同 request_id 的重复请求会被忽略
- `timestamp`: 可选，Unix 毫秒。不传则使用服务端当前时间

**Response (200):**
```json
{
  "success": true,
  "cost_usd": 0.0423,
  "id": 1
}
```

费用计算逻辑：`cost_usd = (input_tokens / 1e6) * input_price + (cached_input_tokens / 1e6) * cached_price + (output_tokens / 1e6) * output_price + (reasoning_tokens / 1e6) * reasoning_price`

如果模型价格未配置，`cost_usd` 返回 0，但仍保存记录。

### 5.2 GET /api/usage — 查询用量

**Query Parameters:**
| 参数 | 类型 | 说明 |
|------|------|------|
| days | number | 时间范围（1/7/30/90），默认 7 |
| source | string | 筛选来源，逗号分隔多选，如 `claude-code,codex` |
| model | string | 筛选模型，逗号分隔多选 |

**Response:**
```json
{
  "records": [
    {
      "id": 1,
      "source": "claude-code",
      "model": "claude-sonnet-4-6",
      "input_tokens": 12345,
      "output_tokens": 5678,
      "total_tokens": 18023,
      "cost_usd": 0.0423,
      "timestamp": 1717027200000
    }
  ],
  "total": 150
}
```

### 5.3 GET /api/stats — 聚合统计

**Query Parameters:** 同 `/api/usage`

**Response:**
```json
{
  "total_tokens": 1234567,
  "total_cost_usd": 23.45,
  "total_requests": 89,
  "avg_daily_tokens": 176366,
  "avg_daily_cost_usd": 3.35,
  "by_source": [
    { "source": "claude-code", "total_tokens": 500000, "cost_usd": 12.0, "count": 40 }
  ],
  "by_model": [
    { "model": "claude-sonnet-4-6", "total_tokens": 400000, "cost_usd": 10.0, "count": 30 }
  ],
  "daily": [
    { "date": "2026-05-30", "total_tokens": 50000, "cost_usd": 1.2, "count": 10 }
  ]
}
```

### 5.4 GET /api/pricing — 获取价格表

**Response:**
```json
{
  "models": [
    {
      "model_id": "claude-sonnet-4-6",
      "display_name": "Claude Sonnet 4.6",
      "provider": "anthropic",
      "input_price_per_1m": 3.0,
      "output_price_per_1m": 15.0
    }
  ]
}
```

### 5.5 POST /api/pricing — 更新/新增价格

```json
{
  "model_id": "claude-sonnet-4-6",
  "display_name": "Claude Sonnet 4.6",
  "provider": "anthropic",
  "input_price_per_1m": 3.0,
  "output_price_per_1m": 15.0
}
```

---

## 六、项目目录结构

```
TokenTrail/
├── package.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── postcss.config.js
├── src/
│   ├── app/
│   │   ├── layout.tsx              # 根布局与首屏主题初始化
│   │   ├── page.tsx                # Dashboard 主页
│   │   ├── globals.css             # 全局样式 + Tailwind
│   │   └── api/
│   │       ├── report/
│   │       │   └── route.ts        # POST /api/report
│   │       ├── usage/
│   │       │   └── route.ts        # GET /api/usage
│   │       ├── stats/
│   │       │   └── route.ts        # GET /api/stats
│   │       └── pricing/
│   │           └── route.ts        # GET/POST /api/pricing
│   ├── lib/
│   │   ├── db.ts                   # SQLite 连接与初始化
│   │   ├── pricing.ts              # 费用计算工具
│   │   ├── themes.ts               # 主题定义、校验与旧偏好迁移
│   │   └── seed-pricing.ts         # 预置 OpenRouter 价格数据
│   ├── components/
│   │   ├── ThemePicker.tsx          # 主题预览与切换弹层
│   │   ├── dashboard/
│   │   │   ├── StatsCards.tsx       # 顶部统计卡片
│   │   │   ├── FilterBar.tsx        # 筛选栏（时间/来源/模型）
│   │   │   ├── TrendChart.tsx       # 趋势折线图
│   │   │   ├── ComparisonChart.tsx  # 对比柱状图
│   │   │   ├── ProportionChart.tsx  # 占比环形图
│   │   │   └── CurrencyToggle.tsx   # USD/RMB 切换
│   │   └── ui/                     # shadcn/ui 组件
│   └── types/
│       └── index.ts                # 类型定义
├── data/                           # SQLite 数据库文件（自动生成）
└── docs/
    └── INTEGRATION.md              # 工具接入指南
```

---

## 七、主题系统设计规范

### 7.1 语义化令牌

| 类别 | 令牌 | 用途 |
|------|------|------|
| 页面 | `--theme-page-*` | 页面底色与背景层次 |
| 表面 | `--theme-panel` / `--theme-border` | 卡片、弹层和边框 |
| 品牌 | `--theme-primary` / `secondary` / `tertiary` | 选中态、重点内容与装饰 |
| 状态 | `--status-success` / `warning` / `danger` | 业务状态，不随品牌色含义改变 |
| 图表 | `--theme-chart-1` 至 `7` | 各主题独立的高对比数据色序 |
| 形态 | `--theme-radius` / `--theme-panel-shadow` | 圆角、阴影与材质 |

### 7.2 四套主题

- **机甲霓虹**：深色荧光终端、网格与低强度扫描线。
- **赤焰卷轴**：炭黑、赤橙、暗红和收紧的斜向纹理。
- **纸墨编辑**：暖纸底色、陶土强调色、衬线排版与大留白。
- **云光玻璃**：冷白底色、清透蓝、柔和玻璃层与大圆角。
- 极简主题关闭扫描线和强发光；所有主题尊重系统“减少动态效果”设置。

---

## 八、里程碑计划

### M1：项目骨架 + 数据库（预计 1-2h）
- Next.js 项目初始化
- SQLite 数据库初始化 + 建表
- 预置模型价格数据（OpenRouter 价格）
- API: POST /api/report, GET /api/usage, GET /api/stats, GET/POST /api/pricing

### M2：Dashboard 看板（预计 2-3h）
- 四主题视觉系统
- 统计卡片组件
- 筛选栏组件
- 折线图、柱状图、环形图
- 货币切换

### M3：集成与验证（预计 1h）
- 编写接入文档
- 接入 Claude Code 验证
- 接入 Codex 验证
- 修复问题

### M4（可选）：部署
- Vercel 部署配置
- 数据持久化方案（Turso / Vercel KV）

---

## 九、默认内置模型价格表（参考 OpenRouter，USD / 1M tokens）

| model_id | display_name | input | cached_input | output | reasoning |
|----------|-------------|-------|-------------|--------|-----------|
| claude-opus-4-7 | Claude Opus 4.7 | 15.00 | 1.50 | 75.00 | - |
| claude-sonnet-4-6 | Claude Sonnet 4.6 | 3.00 | 0.30 | 15.00 | - |
| claude-haiku-4-5 | Claude Haiku 4.5 | 0.80 | 0.08 | 4.00 | - |
| gpt-4o | GPT-4o | 2.50 | 1.25 | 10.00 | - |
| gpt-4o-mini | GPT-4o mini | 0.15 | 0.075 | 0.60 | - |
| gpt-4.1 | GPT-4.1 | 2.00 | 0.50 | 8.00 | - |
| gemini-2.5-pro | Gemini 2.5 Pro | 1.25 | - | 10.00 | - |
| gemini-2.5-flash | Gemini 2.5 Flash | 0.15 | - | 0.60 | - |
| deepseek-v3 | DeepSeek V3 | 0.27 | - | 1.10 | - |
| deepseek-r1 | DeepSeek R1 | 0.55 | - | 2.19 | - |

---

## 十、接入方式（工具侧）

工具通过向本地服务 POST JSON 即可完成上报：

```bash
curl -X POST http://localhost:3820/api/report \
  -H "Content-Type: application/json" \
  -d '{
    "source": "claude-code",
    "model": "claude-sonnet-4-6",
    "input_tokens": 12345,
    "output_tokens": 5678,
    "request_id": "uuid-here"
  }'
```

本地 Dashboard 默认使用固定端口 `3820`。

各工具可通过 hooks/plugins 机制在 session 结束时自动调用此接口。
