# 悬浮高光 + 玻璃层次深化 实施方案（交给 Grok 实施）

> 日期：2026-08-07
> 范围：纯视觉增强。方向 A（光标跟随高光）+ 方向 B（玻璃层次深化），四个主题全覆盖。
> 约束：不改组件结构、数据流、布局顺序；效果纯 CSS 渲染；尊重 `prefers-reduced-motion`。
> 关键文件：`src/app/globals.css`（全部样式）、`src/app/page.tsx`（dashboard 根容器）、`src/lib/themes.ts`（如需新 token 的预览同步）。

## 1. 光标跟随高光（Spotlight Hover）

### 1.1 JS：事件委托写 CSS 变量

`src/app/page.tsx:352` 的根容器 `<div className="dashboard-shell min-h-screen">` 上加一个 `onMouseMove`，用事件委托找到最近的 `.eva-panel`，把光标相对面板的局部坐标写为 CSS 变量。**不写 React state，不触发重渲染**：

```tsx
const handleSpotlightMove = (e: React.MouseEvent<HTMLDivElement>) => {
  const panel = (e.target as HTMLElement).closest<HTMLElement>('.eva-panel');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  panel.style.setProperty('--spotlight-x', `${e.clientX - rect.left}px`);
  panel.style.setProperty('--spotlight-y', `${e.clientY - rect.top}px`);
};
```

```tsx
<div className="dashboard-shell min-h-screen" onMouseMove={handleSpotlightMove}>
```

说明：面板 hover 时有 `translateY(-3px)` 变换，但 rect 每次移动都重新取，坐标始终正确。`getBoundingClientRect` + `setProperty` 不触发重排，无需节流。

### 1.2 CSS：注册可过渡变量 + 背景叠加高光层

`globals.css` 顶部（`@layer base` 之外）新增：

```css
@property --spotlight-opacity {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}
```

`.eva-panel`（`globals.css:508`）的 `background` 最前叠加一层，并把 `--spotlight-opacity` 加进现有 transition 列表：

```css
.eva-panel {
  background:
    radial-gradient(
      260px circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%),
      rgba(var(--theme-primary-rgb), calc(var(--spotlight-opacity) * var(--theme-spotlight-strength, 0.1))),
      transparent 70%
    ),
    /* …现有三层保持不变… */;
  transition:
    --spotlight-opacity 240ms ease,
    /* …现有四项保持不变… */;
}

.eva-panel:hover {
  --spotlight-opacity: 1;
}
```

**注意：`.eva-panel` 的 background 被主题规则重写过，一共 5 处声明都要加这一层**（漏一处该主题就没有高光）：

1. `globals.css:511` 基础 `.eva-panel`
2. `globals.css:574` `.eva-panel-stat`（统计卡）
3. `globals.css:1297` `ember-scroll .eva-panel`
4. `globals.css:1309` `editorial-paper .eva-panel`
5. `globals.css:1323` `luminous-glass .eva-panel`

`@property` 不支持的旧浏览器会退化为高光直接出现/消失（无淡入淡出），功能不受影响，可接受。

### 1.3 每主题强度 token

在各主题块里加 `--theme-spotlight-strength`（控制高光透明度上限）：

| 主题 | 建议值 | 说明 |
|---|---|---|
| neon-mecha（默认块 `:root`） | `0.12` | 深色最明显 |
| ember-scroll | `0.10` | 暖色收敛一点 |
| editorial-paper | `0.05` | 纸面只是轻微提亮 |
| luminous-glass | `0.08` | 介于两者之间 |

统计卡现有的扫光（`.stat-sheen`）保留，与 spotlight 不冲突。

## 2. 玻璃层次深化

### 2.1 新增两个 token

```css
--theme-panel-opacity: 0.9;   /* 面板背景不透明度，替换现有硬编码值 */
--theme-glass-saturate: 1;    /* backdrop-filter 的饱和度 */
```

逐主题定值：

| Token | neon-mecha | ember-scroll | editorial-paper | luminous-glass |
|---|---|---|---|---|
| `--theme-panel-opacity` | `0.78` | `0.85` | `0.96`（基本不动） | `0.66` |
| `--theme-glass-saturate` | `1.35` | `1.2` | `1` | `1.3` |

### 2.2 应用点

- `.eva-panel` / `.eva-panel-stat` 背景里的 `rgba(var(--theme-panel-rgb), 0.9)` / `0.92` 改为 `rgba(var(--theme-panel-rgb), var(--theme-panel-opacity))`；主题重写块里的 `0.94` / `0.96` / `0.68` 同样替换。ember-scroll 主题的 0.94 用 `calc(var(--theme-panel-opacity) + 0.09)` 或直接接受 0.85（与主题重写块协调好，只留一个真相源）。
- `.eva-panel` 的 `backdrop-filter: blur(var(--theme-panel-blur))` 改为：
  ```css
  backdrop-filter: blur(var(--theme-panel-blur)) saturate(var(--theme-glass-saturate));
  -webkit-backdrop-filter: blur(var(--theme-panel-blur)) saturate(var(--theme-glass-saturate));
  ```
- `.theme-picker-popover`（`globals.css:862`）：`blur(22px)` → `blur(24px) saturate(1.4)`（带 `-webkit-` 前缀），背景 `bg-eva-panel/95` → 面板色 0.85 透明度，让弹层与面板拉开层级。
- `.chart-tooltip`（`globals.css:1165`）：`saturate(1.15)` → `saturate(1.35)`，背景 0.88 → 0.8。
- `.glass-header`（`globals.css:703`）：加 `backdrop-filter: blur(18px) saturate(var(--theme-glass-saturate))`（带前缀），顶栏毛玻璃更润。

### 2.3 悬浮折射边

`.eva-panel-hover:hover`（`globals.css:557`）的 box-shadow 第一项 inset 高光提亮一档（`color-mix` 里 70% → 85%），让悬浮时面板顶边有一道更亮的"玻璃折射线"，与 spotlight 配合形成完整光照感。

## 3. reduced-motion 与浅色主题边界

- 全局 `prefers-reduced-motion` 规则（`globals.css:1427`）已把所有 transition 压到 0.01ms，spotlight 淡入淡出自动遵循，无需额外处理。
- editorial-paper 不做玻璃深化以外的任何效果叠加：不加噪点之外的纹理、不加扫光。spotlight 强度 0.05 只是"提亮"，不是发光。

## 4. 验证清单

1. `npm run build`、`npm run check` 通过。
2. 本地 :3820 用 URL 参数逐主题检查（`?theme=neon-mecha` / `ember-scroll` / `editorial-paper` / `luminous-glass`）：
   - 光标移入统计卡/图表面板：高光跟随移动，进入淡出平滑，无光标划过边缘时的闪烁。
   - 页面顶部 aurora 光晕能透过面板隐约可见（深色主题明显，纸主题几乎不可见属正常）。
   - 主题选择弹窗、图表 tooltip 玻璃感强于面板。
3. 窄屏 390px 检查高光不溢出、不影响横向滚动。
4. 截图工具：
   ```bash
   HS=~/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell
   "$HS" --headless --disable-gpu --hide-scrollbars \
     --screenshot=/tmp/shot.png --window-size=1440,3400 --virtual-time-budget=15000 \
     "http://localhost:3820/?theme=neon-mecha"
   ```

## 5. 不做的事

- 不做磁吸按钮、数字缩放反馈等 JS 微交互（方向 C，本次排除）。
- 不改 `.stat-sheen` 扫光、`.pulse-dot` 呼吸、能量条等已有动效。
- 不动 `tailwind.config.ts`；新 token 全部走 CSS 变量。
