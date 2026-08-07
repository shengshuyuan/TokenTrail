# 丹砂长卷 / 松烟素笺 主题优化方案（交给小A实施）

> 日期：2026-08-07
> 范围：仅视觉 token 与少量 CSS，不动组件结构、数据流、布局顺序。
> 证据截图：`output/theme-audit/ember-scroll.png`、`output/theme-audit/editorial-paper.png`（1440px 全页，本地 :3820 实拍）。
> 主题映射：丹砂长卷 = `ember-scroll`，松烟素笺 = `editorial-paper`（token 在 `src/app/globals.css:131-301`，主题预览在 `src/lib/themes.ts`）。

## 0. 共性问题（两个主题都有，优先修）

**绿色霓虹 Logo 与暖色主题冲突。**
左上角 `logo-app.png` 是黑底绿色发光图标，在丹砂长卷的深棕底和松烟素笺的米白纸面上都非常突兀（截图左上角可见）。`.brand-logo` 的发光阴影虽然跟随 `--theme-primary`，但 PNG 本身的绿色改不了。

建议方案（三选一，推荐 a）：
- a. **CSS mask 着色**：把 `<img>` 换成 `<span>`，用 `mask: url(/logo-app.png) center/contain no-repeat` + `background: linear-gradient(135deg, var(--theme-primary), var(--theme-secondary))`。Logo 形状不变，颜色永远跟随主题，四个主题统一受益。
- b. 为每个主题出一张 Logo 资源，按 `data-theme` 切换 `<img src>`。效果最好但要做 4 张图。
- c. CSS `filter: hue-rotate()` 按主题旋转色相。改动最小但颜色不可控，不推荐。

## 1. 丹砂长卷（ember-scroll）问题与改法

实拍看到的问题：

1. **紫色 tertiary 严重出戏**。`--theme-tertiary: #8f7cdc`（紫）用在统计卡第 3/4 张的数字、趋势线、aurora 光晕里。"赤金绢纸"的暖色长卷里飘着一个冷紫，是全主题最割裂的地方。
2. **底色沉闷发脏**。`bg #120d0d` / `panel #1d1614` / `page-0 #241713` 三者明度太接近，面板浮不起来，整体像蒙了一层灰。
3. **层次靠边框硬撑**。面板上的暖光渐变（`globals.css:1297` 的 radial 0.08）太弱，远看是一块平板。

建议 token 调整（`globals.css:131-214` 的 `data-theme='ember-scroll'` 块）：

| Token | 现状 | 建议 | 理由 |
|---|---|---|---|
| `--theme-tertiary` | `#8f7cdc` | `#d8b46a`（绢金，即现 chart-5） | 消灭紫色，保留第三强调色 |
| `--theme-tertiary-rgb` | `143 124 220` | `216 180 106` | 同步 |
| `--theme-panel` | `#1d1614` | `#211915` | 提亮面板，与背景拉开 |
| `--theme-panel-rgb` | `29 22 20` | `33 25 21` | 同步 |
| `--theme-page-0` | `#241713` | `#2b1e17` | 顶部更暖更亮，纵向渐变有层次 |
| `--theme-text-muted` | `#b89a88` | `#c4a691` | 小字对比度提升 |
| `--theme-border` | `#563e33` | `#604738` | 边框在深底上更清晰 |
| `--theme-border-strong` | `#7a5a4c` | `#8a6752` | 同步 |
| `--theme-chart-2` | `#8f7cdc` | `#b5534d`（砖红前移） | 图表第二色不再是紫 |
| `--theme-chart-3` | `#b5534d` | `#d8b46a` | 图表第三色用绢金 |
| `--theme-chart-5` | `#d8b46a` | `#6fa08e`（松青） | 保留一个冷色做对照，避免全暖糊在一起 |

面板暖光加强（`globals.css:1297-1303` 的 `:root[data-theme='ember-scroll'] .eva-panel`）：
- `radial-gradient(circle at 100% 0, rgba(181, 83, 77, 0.08), …)` 的 `0.08` → `0.13`，让面板右上角有可见的炉火暖光。

`src/lib/themes.ts` 预览卡同步：`chart: ['#d79a5b', '#8f7cdc', '#b5534d']` → `['#d79a5b', '#b5534d', '#d8b46a']`。

保留不动：8px 切角（tl-br）、-12° 斜纹网格、ZCOOL XiaoWei 标题字体——这些是"长卷"气质的正确部分。

## 2. 松烟素笺（editorial-paper）问题与改法

实拍看到的问题：

1. **太"平"，像没设计完**。grid/noise/texture/scan 全部为 0、aurora 仅 0.22，面板纯白平涂 + 1px 浅边框，整个页面空洞。纸主题不等于"什么都没有"，好纸要有纤维纹理和墨色层次。
2. **紫色 tertiary 跳色**。`#70528f` 的紫色数字（日均消耗/日均费用）在"松烟墨意"里没有依据。
3. **面板顶部 2px 深色边生硬**（`globals.css:1313` `border-top-width: 2px`），每个卡片像被钉了一根钉子。

建议 token 调整（`globals.css:222-301` 的 `data-theme='editorial-paper'` 块）：

| Token | 现状 | 建议 | 理由 |
|---|---|---|---|
| `--theme-tertiary` | `#70528f` | `#47617b`（黛蓝） | 松烟+黛色是经典纸墨配色，数字不再跳 |
| `--theme-tertiary-rgb` | `112 82 143` | `71 97 123` | 同步 |
| `--theme-noise-opacity` | `0` | `0.045` | 给纸面纤维纹理（需配合改 blend，见下） |
| `--theme-noise-blend` | `normal` | `multiply` | 噪点压进纸里，读作纸纤维而非脏点 |
| `--theme-aurora-opacity` | `0.22` | `0.35` | 页首有一点暖光晕，不死板 |
| `--theme-page-1` | `#eee6da` | `#e9dfd0` | 页面底色加深，白面板浮起来 |
| `--theme-panel-shadow` | `0 12px 32px rgba(75,55,37,0.08)` | `0 14px 34px rgba(75,55,37,0.12)` | 纸卡有轻微厚度 |
| `--theme-chart-3` | `#70528f` | `#47617b` | 图表同步去紫 |
| `--theme-chart-6` | `#9c4769` | `#8a6d4f`（赭石灰） | 第六色也更贴纸墨 |

两处配套 CSS 修改：

- **解开纸纹封印**（`globals.css:1094-1097`）：现在 `.grain-overlay` 对 editorial-paper 是 `display: none`。把 editorial-paper 从这条规则里移除（luminous-glass 保持隐藏），让上面的 noise token 生效。`.scan-overlay` 继续隐藏（扫描线不适合纸）。
- **去掉"钉子"**（`globals.css:1309-1314`）：`:root[data-theme='editorial-paper'] .eva-panel` 的 `border-top-width: 2px` 删去，恢复 1px 统一边框；同时把 `--theme-panel-decoration-opacity` 从 `0.22` 提到 `0.4`，用底部渐变装饰线替代顶部硬边。

`src/lib/themes.ts` 预览卡同步：`chart: ['#a84424', '#2f6254', '#70528f']` → `['#a84424', '#2f6254', '#47617b']`。

保留不动：衬线字体组合（Cormorant Garamond + Noto Serif SC）、2rem 大号衬线数字、7px 圆角——"素笺"的书卷气靠它们撑着。

## 3. 验证方式

1. `npm run build` 通过。
2. 本地服务下用 URL 参数切主题截图对比（无需点主题选择器）：
   ```
   http://localhost:3820/?theme=ember-scroll
   http://localhost:3820/?theme=editorial-paper
   ```
3. 截图工具示例（本机已有 Playwright 缓存的 headless chromium）：
   ```bash
   HS=~/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell
   "$HS" --headless --disable-gpu --hide-scrollbars \
     --screenshot=output/theme-audit/ember-scroll-after.png \
     --window-size=1440,3400 --virtual-time-budget=15000 \
     "http://localhost:3820/?theme=ember-scroll"
   ```
4. 桌面 1440px + 窄屏 390px 各检查一遍；确认另外两个主题（玄枢流萤/晴岚琉光）未被波及。

## 4. 不要做的事

- 不改 neon-mecha / luminous-glass 的任何 token（共性 Logo 修复除外，注意在 neon-mecha 下回归检查 Logo 效果）。
- 不改组件结构、面板顺序、筛选逻辑。
- 不给纸主题加玻璃模糊/扫描线/网格——纸的质感来自纹理和墨色层次，不是玻璃。
