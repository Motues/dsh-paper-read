# PaperReader 设计稿

> 版本 1.0 · 2026-11-04
> 状态：已按本文实现（Host + Client），代码即契约的落地；§11.5 记录了实现时的取舍。
> 原型源码即本仓库 `src/client/`，可运行版本已安装到 DSH `desktop` profile。

---

## 目录

1. [产品定义](#1-产品定义)
2. [信息架构与状态机](#2-信息架构与状态机)
3. [视觉系统](#3-视觉系统)
4. [页面规格](#4-页面规格)
5. [交互规格](#5-交互规格)
6. [数据模型](#6-数据模型)
7. [Host 侧架构](#7-host-侧架构)
8. [导入管线](#8-导入管线)
9. [AI 契约](#9-ai-契约)
10. [记忆与检索](#10-记忆与检索)
11. [工程与接入](#11-工程与接入)
12. [分期与验收](#12-分期与验收)
13. [明确不做的事](#13-明确不做的事)

---

## 1. 产品定义

### 1.1 一句话

**一个常驻的论文库 + 保真阅读器 + 跨论文记忆层。AI 是贴在阅读动作上的边注，不是另开的聊天窗。**

### 1.2 核心闭环

```
导入 → 30 秒导读 → 边读边问 → 沉淀成可检索的记忆
```

四步对应四个能力，缺任何一步产品都不成立：

| 步骤 | 能力 | 失败形态 |
|---|---|---|
| 导入 | PDF / 链接进入库，产出结构化导读 | 只能存文件，读之前还要自己翻 |
| 导读 | 结论、方法、局限、可复用点、相关文献 | 只是一个摘要，读完就忘 |
| 边读边问 | 原版排版 + 选段即问 + 边注 | 跳出去问，回来找不到位置 |
| 记忆 | 笔记/批注/关联/跨库检索 | 下次想找"那篇讲过 X 的"找不到 |

### 1.3 用户与场景

- **主要用户**：每天读 1–3 篇论文的研究者/工程师，已有 50–500 篇存量 PDF。
- **典型时刻**：
  - 早上批量导入昨晚下载的 5 篇 arXiv，扫导读决定读哪篇；
  - 读某篇时卡在 §3.2 的一个公式，选中就问，答完继续；
  - 写 related work 时问"我库里哪些论文讨论过线性时间替代注意力"。

### 1.4 定位边界

- 不是 Zotero 替代品：不做引文格式、Word 插件、文献库同步。
- 不是 PDF 重排器：不做 HTML 化、不做流式阅读。
- 不是通用聊天助手：AI 的全部入口都绑定到具体论文/段落。

---

## 2. 信息架构与状态机

### 2.1 入口与外壳

侧边栏 **一个**入口：`sidebar.panellist` 注册 `id = paperreader`，`order = -1`（置于最上），标签「论文」。
点击后由宿主 `layout.selectPanel('paperreader')` 打开 `main` 槽位中以同 key 注册的整页。

页面内是**顶栏 + 左导航 + 内容**的工作区外壳：最上方一行固定顶栏（返回 · 标签栏 · 工具栏），
下面是左侧 226px 的四模块导航与右侧内容区。

```
┌──────────────────────────────────────────────────────────────────┐
│ ← │ 论文库 │ Attention Is All You Need × │ BERT × │ + │ ▤ ▥ ☰ ○ ✦AI │
├──────────────┬───────────────────────────────────────────────────┤
│ [+ 导入论文] │  内容区（随模块切换）                              │
│  ──────────  │                                                   │
│  最近阅读   9 │                                                   │
│  文献库     9 │                                                   │
│  关联         │                                                   │
│  系统设置     │                                                   │
└──────────────┴───────────────────────────────────────────────────┘
```

- **标签栏是工作区，不是阅读器的一部分**：首个「论文库」标签固定、不可关闭；每打开一篇论文
  追加一个标签。标签顺序 = 打开顺序，横向溢出时滚动；激活标签自动滚入视野。
- **标签内容**：状态点 + 标题（tooltip 给出完整标题/作者/场馆年份）+ 关闭 `×`；中键也可关闭。
  关闭标签只是关视图，不删除论文；论文进回收站或彻底删除时它的标签自动消失。关闭时标签在
  160ms 内收拢、淡出，右侧标签平滑左移；`prefers-reduced-motion` 下直接移除。
- **返回**回到「论文库」标签；已经在论文库时禁用。**工具栏**随上下文变化：阅读时是
  左栏开关与视图 · 页码与缩放 · 阅读模式 · 查找/已读/右栏开关；论文库页留空。
- **可调侧栏**：主页面左导航（默认 224）与文献库文件夹栏（默认 202）的右边缘可拖动调宽，
  阅读器左栏和 AI 面板同理；宽度上限会让位于内容区（见 §3.5、§4.2）。
- 导航与内容区都**不铺底色**（透明，露出宿主背景），只有悬停/选中项才有底色；
  填充按钮使用宿主的蓝色强调色 `--dsw-alias-button-info-fill`（见 §3.2），随浅/深主题自动切换。

阅读器是整页，激活论文标签后外壳（含左侧导航）让位给纸面；顶栏保留。

### 2.2 页面状态

```
   论文库标签 ─┬─ 最近阅读
               ├─ 文献库
               ├─ 关联
               └─ 系统设置

   论文标签 1..N ─→ Reader（整页，各自记住页码/滚动/缩放/布局）
```

- **最近阅读**：默认态。按 `lastRead.at` 倒序，默认最多 20 篇（设置 → 界面可改，10/20/30/50）；表格 / 卡片双视图，默认跟随界面设置；没有阅读记录时显示导入引导。
- **文献库**：文件夹 + 状态 + 标签 + 搜索的组合筛选，卡片/列表两种密度。
- **关联**：主题、关联理由、局部关系图、跨库检索。
- **系统设置**：存储、模型、界面、实验性功能、对话、用量、维护。

工作区状态（打开的标签、激活标签、每个标签的页码/滚动/缩放/布局、左栏模式、上次选择的布局）
保存在 `localStorage` 的 `paperreader.workspace.v1`，**不写入 URL、不新建会话**。
侧栏宽度、左栏收起与 AI 面板开关属于界面偏好，单独保存在 `paperreader.layout.v1`：
`nav / folders / railPreview / railTitle / panel` 五个宽度，加上 `railCollapsed / aiOpen`。
刷新或切走面板回来时恢复；失效论文（已删除或在回收站）的标签在库加载后剔除。
`view`（最近阅读 / 文献库 / 关联 / 系统设置，以及实验性的任务列表）仍是页面内状态，刷新回到最近阅读。

### 2.3 导入状态机

```
[idle] --点「导入」--> [dialog: pdf|identifiers]
      --开始导入/上传--> [queue: 0→1→2→3] --完成--> [library, 新卡片高亮]
      --关闭/失败--> [idle]
```

- 对话框与队列是**两个独立浮层**：批量上传时对话框保持打开并显示进度，上传完成后关闭；队列随后可见，避免一次性堆两个弹窗。
- 队列可关闭；关闭不取消任务（后台继续），完成时以 toast 提示。
- 受限 PDF 的任务以 `done + warnings` 结束：元数据入库、无全文、卡片提示「需上传 PDF」。

### 2.4 Reader 内部状态

| 状态 | 触发 | 退出 |
|---|---|---|
| 选区工具条 | 在纸面选中 ≥ 2 字符 | 点击任一操作 / 点空白 / Esc |
| 边注气泡 | 翻译 | 关闭 / Esc / 新选区 |
| 待定标记 | 翻译时 | 保留在当前页，直到换页 |
| 副驾引用 | 工具条「解释」/ 气泡「继续追问」 | 发送 / 移除引用 / 关闭面板 |
| 副驾展开/收起 | 顶栏按钮、工具条「解释」、气泡「继续追问」 | 同上 |

---

## 3. 视觉系统

### 3.1 原则

1. **纸面优先**：阅读时纸面是唯一的视觉主体，UI 让位。
2. **只用宿主令牌**：所有颜色走 `--dsw-alias-*`，禁止硬编码主题色（唯一例外见 3.3）。
3. **深色是同一套结构，不是滤镜**：填充色、纸面亮度、阴影分别取值。
4. **密度紧凑**：13px 基准，行高 1.55，控件高度 24/26/30 三档。

### 3.2 令牌

```css
/* 语义 */
--pr-line:         var(--dsw-alias-border-l1)
--pr-line-strong:  var(--dsw-alias-border-l2)
--pr-ink:          var(--dsw-alias-label-primary)
--pr-ink-2:        var(--dsw-alias-label-secondary)
--pr-ink-3:        var(--dsw-alias-label-tertiary)
--pr-accent:       var(--pr-accent-host, var(--we-accent, var(--dsw-alias-state-business-primary, #4176e6)))
--pr-on-accent:    var(--pr-ink-host, var(--we-accent-ink, #fff))
--pr-accent-solid: var(--pr-accent)
--pr-paper:        color-mix(layer-1 88%, #fff 12%)
```

**主题色怎么取（实测内核 + 本机换肤插件）**

三级链，越靠前越“正式”：

1. **`--pr-accent-host`（本插件镜像）**：取自 `ctx.theme.getTheme().active.tokens` 的**字面量**。
   内置 `light`/`dark` 两个主题的 token 表是**空对象**（调色板在平台样式表里），所以这张表里
   出现的任何东西都来自第三方：`ctx.theme.register()` 注册的主题，或
   `ctx.theme.overrideTokens()` 叠的层（后者被 `ui-layout` 的 presenter 逐条写成 `body` 行内
   样式）。`index.tsx` 在挂载与每次 `theme/change` 时重读，写到根节点上。
   读哪个令牌：`brand-primary` → `state-business-primary` → `button-primary-fill` 取第一个非空
   字面量；`var(...)` 表达式原样透传，交给浏览器解析。这样**插件选哪个令牌都能跟上**。
2. **`--we-accent`（本机 wallpaper-engine 的私有变量）**：见下。
3. **`--dsw-alias-state-business-primary`（宿主强调色）**：默认 `#4176e6` / `#7aaaff`。

「用户改的配色」有两种完全不同、互不相干的通路：

- **A. 主题令牌层**：`overrideTokens()` → `composeActive()` 合并进 `snapshot.active.tokens` →
  presenter 写成 body 行内样式（优先级最高、向下继承）。dsh-dream-skin 的 `ACCENT_TOKENS` 是
  四个：`brand-primary`、`state-business-primary`、`button-primary-fill`、`button-primary-dimmed`。
- **B. 私有变量 + 锚点作用域**：`desktop` profile 的 **dsh-plugin-wallpaper-engine** 把「全局配色」
  写成 `--we-accent` / `--we-accent-ink`（body 行内），同时用**作用域选择器**就地改宿主：

  ```css
  body[data-we-glass-page] [data-composer-seat] { --dsw-alias-button-info-fill: var(--we-ui-send, #4f8cff) }
  body[data-we-glass-page] [data-presented-file] { --dsw-alias-link: var(--we-ui-link, #4f8cff) }
  /* 设置窗 / 左栏各自再覆盖 brand-primary、state-business-primary */
  ```

  **这些覆盖只在该锚点子树里生效**，主内容区的插件一个都吃不到 —— 这正是
  「侧栏和发送按钮变粉了、论文页没变」的原因，所以必须直接读 `--we-accent`。

| 令牌 / 变量 | 默认 | 跟随配色？ | 说明 |
| --- | --- | --- | --- |
| **`--pr-accent-host`** | 无（未覆盖时为空） | ✅ | 令牌表镜像，覆盖所有走主题契约的插件 |
| **`--we-accent`** | `#4f8cff` | ✅（本机实测 `#F1717F`） | wallpaper-engine 的私有 body 变量，插件卸载即自动让位 |
| **`--dsw-alias-state-business-primary`** | `#4176e6` / `#7aaaff` | ✅ | 宿主强调色 + 焦点环颜色 |
| `--dsw-alias-brand-primary` | `#0f1115` / `#f9fafb` | ✅ | 单色对比色，深色下等于纯白 → 不能用来填充 |
| `--dsw-alias-button-primary-fill` | = brand | ✅ | 设置/对话框主按钮的填充，默认单色 |
| `--dsw-alias-button-info-fill` | `#4176e6` / `#7aaaff` | ❌ | 静态别名（`deepseek-500/400`），**没有任何令牌层改它** |
| `--dsw-alias-label-primary-foreground` | `#fff` / `#0f1115` | — | 单色填充的文字色，强调色填充**不能**用 |

**兼容性矩阵**（换配色插件时的行为）

| 插件的做法 | 跟随？ | 命中哪级 |
| --- | --- | --- |
| `theme.overrideTokens()` / `register()` 改品牌令牌（dream-skin 那类） | ✅ | 1 |
| 只改 `--dsw-alias-brand-primary`（inspect 文档称它 “Primary brand accent”，最容易只改这个） | ✅ | 1（优先取它） |
| 只改 `state-business-primary` / `button-primary-fill` | ✅ | 1（顺位取） |
| 私有 body 变量 + 锚点作用域（wallpaper-engine 那类） | ✅ | 2 |
| 完全不改令牌，只画壁纸/玻璃 | 保持宿主蓝 | 3 |

结论：`--pr-accent` = `var(--pr-accent-host, var(--we-accent, var(--dsw-alias-state-business-primary, #4176e6)))`，
文字 = `var(--pr-ink-host, var(--we-accent-ink, #fff))`（两条来源都按 WCAG 亮度算黑/白，阈值 .45，
与本机插件同规则）。若将来出现第三种既不进令牌表、也不叫 `--we-accent` 的插件，它就没有对外契约可读：
加一级只需在 `ACCENT_TOKENS` 数组或这条 CSS 链上各加一行。

三次踩坑记录：`brand-primary`（浅色近黑、深色纯白）→ `button-info-fill`（颜色锁死、换配色不跟随）
→ 现在这条三级链。

深色覆盖通过根节点 `data-scheme="dark"` 生效，值由 `ctx.theme.getTheme().active.colorScheme` 读取，并订阅 `theme/change` 实时刷新。

### 3.3 高亮六色

纸面高亮用半透明叠色，必须同时满足「浅色纸面可见」与「深色纸面不刺眼」。

| key | 标签 | 浅色 | 深色 |
|---|---|---|---|
| `yellow` | 黄 | `rgba(245,197,66,.34)` | `rgba(245,197,66,.26)` |
| `blue` | 蓝 | `rgba(79,141,245,.26)` | `rgba(79,141,245,.24)` |
| `rose` | 玫红 | `rgba(239,106,140,.24)` | `rgba(239,106,140,.22)` |
| `green` | 绿 | `rgba(63,174,122,.24)` | `rgba(63,174,122,.22)` |
| `purple` | 紫 | `rgba(155,123,240,.24)` | `rgba(155,123,240,.22)` |
| `orange` | 橙 | `rgba(240,138,60,.26)` | `rgba(240,138,60,.24)` |

**待定标记**（刚提问过的段落）：`accent 20%` 底色 + 1px accent 45% 下边线。
**历史标记**：透明底 + 1px accent 30% 下边线。两者都不进「批注」列表。

语义色（状态点、成功/警告）沿用宿主：在读 `#e0a020`、已读 `#2fa36b`、待读 `--pr-ink-3`。

### 3.4 字体与排版

- UI：宿主 sans（`--ds-font-family`），正文 13/1.55。
- 纸面：`"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", "Noto Serif CJK SC", serif`。
- 纸面基准：页宽 **800px**，正文 **11.6px / 1.66**，两端对齐，双栏（`column-gap: 28px`）。
- 标题层级：页面标题 16/650、卡片标题 14/600、区块标题 12.5/600、元信息 11.5、角标 10.5。

> 11.6px 是"整页适配"的缩放值，不是正文字号。用户放大到 150% 时约 17px，符合阅读舒适区。

### 3.5 尺度

| 项 | 值 |
|---|---|
| 圆角 | 控件 6–9，卡片 12，弹层 12–14，胶囊 99 |
| 间距 | 2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 |
| 卡片 | 内边距 12×13×10，栅格 `minmax(292px, 1fr)`，间距 13 |
| 头部 | 高约 44，左右 24 |
| 侧栏宽度 | 主页面导航 224（176–340）/ 文件夹栏 202（168–340）/ 阅读器左栏 预览 120（96–320）、标题 212（160–360）/ AI 面板 366（300–560）；拖动调整，双击复位，窄窗口自动夹紧 |
| 顶栏 | 高 46：返回 28 / 标签 30（宽 84–208）/ 工具栏 |
| 阴影 | 卡片悬停 `0 18px 44px -22px rgba(15,23,42,.38)`；纸面 `0 24px 60px -30px`；弹窗 `0 44px 100px -36px` |

### 3.6 动效

- 悬停：120–160ms `ease`，只动 `background / border-color / box-shadow / transform(±1px)`。
- 弹层：`pr-fade` 140ms + `pr-pop` 160ms（位移 6px + 缩放 .99）。
- 流式光标：1s 方波闪烁。
- 侧栏拖拽：拖动期间关闭宽度过渡（`.pr-root[data-resizing]`），由 rAF 直接写宽度，跟手；
  松手提交一次并持久化。收起/展开、预览↔标题切换走 200ms `cubic-bezier(.2,.8,.2,1)`。
- 标签关闭：160ms 宽度收拢 + 淡出，邻居标签与 `+` 同步左移。
- 侧栏运动期间 PDF 只做容器重排：文本层与位图延后到运动结束一次性更新（见 §4.2）。
- 尊重 `prefers-reduced-motion`：全部降为 0ms。

---

## 4. 页面规格

### 4.0 Recent（默认页）

```
┌──────────────┬────────────────────────────────┐
│ 最近阅读   9  │ 最近阅读                        │
│ 文献库     9  │ 按最后一次打开时间排序，最多 12 篇│
├──────────────┴────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │ 卡片     │ │ 卡片     │ │ 卡片     │        │
│ └──────────┘ └──────────┘ └──────────┘        │
└───────────────────────────────────────────────┘
```

- 排序键是 `lastRead.at`（**打开过才进榜**），最多 12 篇；点卡片直接回到 `lastRead.page`。
- 卡片与文献库共用同一个 `PaperCard`（见 §4.1）：右下角是进度条 + 上次阅读时间，不再单独显示「第 N 页」。
- 没有阅读记录时是引导空态：导入论文 / 打开文献库。

### 4.1 Library

```
┌──────────────┬──────────────┬────────────────────────────────────┐
│ 最近阅读   9  │ 全部   9     │ 文献库 9 篇 · 2 个文件夹            │
│ 文献库     9  │ 未分类 3     │ [搜索…Ctrl F][▦|☰][+新建文件夹]     │
├──────────────┼ 回收站 1     │ [全部|待读|在读|已读]        9 篇    │
│              │ ───────────  │ #偏置漂移  #综述  #状态空间         │
│              │ 文件夹       │ ┌────────┐ ┌────────┐ ┌────────┐  │
│              │ ▾ 精读     4 │ │ 卡片    │ │ 卡片   │ │ 卡片   │  │
│              │   ▸ 扩散模型 │ └────────┘ └────────┘ └────────┘  │
│              │ 综述       2 │                                    │
└──────────────┴──────────────┴────────────────────────────────────┘
```

**文件夹栏（默认 202px，可拖拽 168–340px；沿用 DSH 工作区侧栏的形态）**：顶部是「文献库 + 计数」标题；
下面是 **全部 / 未分类 / 回收站** 三个固定行；再下面是「文件夹」分区标题行，
标题右侧三个图标：搜索（在同一标题行内就地展开输入框）、新建文件夹、全部折叠；
再往下是可多级的用户文件夹树。右边缘拖动调宽，松手写入 `paperreader.layout.v1`，双击复位；
窗口变窄时宽度自动夹紧，最多占用约 46% 视口并给论文列保留内容宽度。

- **文件夹行**：默认显示文件夹图标，hover 时换成展开/收起箭头（已展开时箭头朝下）；
  点击整行＝选中它（右侧列出直属论文）并切换展开/收起。展开/收起用 180ms 的 0fr→1fr
  高度动画，箭头同步旋转；收起的子树同时退出 tab 顺序与无障碍树，`prefers-reduced-motion`
  下直接切换。展开状态记在 `localStorage`，从右侧子文件夹胶囊进入某个文件夹时只自动展开它的祖先。
- **hover 文件夹**：右侧出现两个图标 —— 省略号（更多操作：重命名、新建子文件夹、删除整个子树）
  和导入图标（直接打开导入对话框，导入完成即归入该文件夹）。选中本身不显示操作按钮。
  子文件夹用 18px 缩进表达层级，文件夹行与固定行统一 32px 高。
- **拖动文件夹**：拖动整行即可调整同级顺序或层级。目标文件夹行上/下 1/4 是排到它前/后，
  中间 1/2 是移入该文件夹（成为最后一个子项）；拖回顶层放到顶层文件夹行的边缘。
  拖动时显示 DSH 风格的插入线（前/后）或行高亮（移入），不能拖进自己的子树，
  同层重名会被拒绝。顺序与 `parentId` 一起写回 `library.json`，重启后保持。
- **新建文件夹**：输入行与目标层级对齐（根级对齐根文件夹、子级对齐子文件夹），
  文件夹图标、输入框与同级文件夹行共用同一列。
- **计数**：未分类、各文件夹和标签胶囊的计数都由当前 active `papers` 派生；
  移动论文、移入回收站、还原、删除文件夹或改标签后同一帧刷新，不等待下一次静默重载。
- **文件夹多级、同名只在同一层唯一**；一篇论文仍只属于一个文件夹，跨主题用标签表达。
- **删除文件夹**：两段确认，删除整棵子树，里面的论文回到「未分类」，不删除任何数据。
- **选中文件夹的右侧**：只列出**直属**论文；它的子文件夹在工具栏上方以小胶囊展示（带计数），点击可下钻。
  父文件夹的计数也只统计直属论文，和右侧列表一致。
- **搜索**：标题行内 180ms 展开/收起；栏内搜索与工具栏搜索共享同一个查询，
  同时过滤文件夹树（保留命中项的祖先）与论文列表。点击搜索框外任意位置、按 Esc
  或点右侧清空按钮，都会收起并清空搜索。

**回收站**：删除论文是软删除 —— 记录、PDF、批注、导读都保留，只写 `deletedAt`；
回收站按删除时间倒序，可逐篇「还原」「彻底删除」，也可「清空回收站」（两段确认）。
回收站里的论文不出现在全部/未分类/文件夹计数、最近阅读、关联、跨库检索与会话侧栏里。

**整理**：卡片右上角更多按钮 → 整理对话框，选文件夹 + 增删标签 + **移入回收站**；文件夹下拉按树的层级缩进展示，搜索时结果压平并带父级路径，选中的值显示完整路径（如 `父母 / 孩子`）。

**卡片**：四行，最近阅读与文献库共用同一套 —— ① 顶部小字：左侧状态点 + 状态（+「无全文 / 需上传 PDF」「刚刚导入」胶囊），右侧 `年份 · 出版物`；② 标题（2 行截断）；③ 作者（1 行省略）；④ 底部小字：左侧所属文件夹 + 标签，右侧阅读进度条 + 上次阅读时间（没读过显示「未读」）。导读不再上卡片。
**列表**：单行，标题 + 文件夹 + 标签 + 年份 + 状态 + 整理按钮。
**空结果**：区分「库是空的」（导入引导）与「筛选没命中」（提示换条件）。

交互：
- 文件夹、状态、标签、作者、年份、期刊、搜索可叠加；点标签是切换。
- 搜索先本地匹配标题/作者/标签/导读（< 500 篇直接内存过滤），再防抖请求 Host 补充摘要/期刊/标识符/笔记/PDF 全文命中；全文/笔记命中数显示在筛选行右侧。
- 新导入卡片的顶部状态行带「刚刚导入」胶囊，停留到下次进入页面。

### 4.2 Reader

```
┌──────┬──────────────────────────────────────────────────────┬──────────────────┐
│ ◧ ☰  │  ┌────────────────┐  ┌────────────────┐              │ AI  DeepSeek     │
│ ▢1   │  │  第 1 页        │  │  第 2 页        │              │ 对话 批注 关联 信息│
│ ▣2   │  │  ▓▓ 高亮 ▓▓     │  │                │              │                  │
│ ▢3   │  └────────────────┘  └────────────────┘              │ 对话流…           │
│      │                              [− 100% + │ 1–2 / 20]     │                  │
└──────┴──────────────────────────────────────────────────────┴──────────────────┘
```

- **顶栏**（全局，见 §2.1）：返回、标签栏；阅读器的操作都在阅读页自己的工具栏里。论文标题与场馆年份不再单独占一行：
  标题在标签上（tooltip 带作者与场馆），元信息在 AI 面板「文献信息」。
- **左栏**：顶部两个图标切 **预览图** / **标题**，最右侧是「收起左栏」；预览图默认 120px，
  按页懒加载实际 PDF 画面，当前页 accent 描边；有批注的页左上角显示色点（最多 3 个 + 剩余数）。
  标题模式默认 212px，优先展示 PDF 书签（目录，按层级缩进、当前章节高亮），没有书签时每页一行取该页首行文字；
  两种模式共用滚动位置、当前页同步与批注色点，但**各自记忆宽度**，切换时 200ms 过渡。
  右边缘可拖动调宽（预览 96–320，标题 160–360）。收起后宽度归零、纸面平滑扩张，
  并在纸面左上角保留一个悬浮「展开」条；收起状态写入 `paperreader.layout.v1`。滚动条 6px、无上下箭头。
- **阅读工具栏**（高 40，左/中/右三区）：左区是「收起左栏」与「预览图 / 标题」；中区是页码、
  缩放（文本回退模式隐藏）与 **单面 / 双面 / 连续**，三段用 1px 竖线分隔；右区是 **查找**、
  已读圆点与「收起右栏」。两组图标按钮都不画外框，只用选中态底色标记当前项。
- **全文查找**：右区放大镜点开后在原位展开成搜索框（180ms，同文件夹搜索）；输入即在本论文
  解析出的全文里做不区分大小写的命中，下拉列出「第 N 页 + 片段」（命中词高亮），↑/↓ 选择、
  回车跳转；跳转后**命中的文字本身**按行闪一次淡黄高亮（约 3s 淡出）：用页面的文本层把命中串
  重新定位成逐行矩形，跨行命中画多个小框；文本层找不到时回退整段。点外部或 Esc 收起并清空。
- **阅读模式**：工具栏中区三态切换，按标签记住，新建标签继承上一次的选择。
  - **单面**：一页居中，适应宽度。
  - **双面**：两页并排、按 1-2 / 3-4 直接配对（论文没有封面页的概念）；每页适配半栏宽，
    左右键与 PageUp/PageDown 按「对开」翻页，页码显示 `3–4 / 20`。
  - **连续**：全部页面纵向堆叠，只渲染视口 ±1 页（占位块保持滚动高度）；滚动测绘当前页，
    缩略图/批注定位都改成「滚动到该页」；缩放以当前阅读位置为锚点，避免放大后跳页。
  - 文本回退模式同样支持三种布局（文本页按页堆叠/并排），但不参与缩放。
- **纸面**：每页固定 100% 几何 + 单层 `transform: scale()`；四周留白 ≥ 26，顶部留 24 给纸张阴影；
  PDF 页面有 1px 环形描边与四向柔和投影。阅读区滚动条隐藏，滚轮仍可滚动。
- **调宽时的纸面**：拖动分隔条或收起侧栏时页面容器连续跟随；这段运动里 `PdfPage` 跳过文本层
  重测与位图重绘，旧 canvas 用 CSS 拉伸，运动停止后按最终宽度一次性重排/重绘。连续阅读模式
  记录「当前页 + 页内偏移」作为锚点，调宽结束恢复到原阅读位置。
- **缩放控件**：右下角常驻胶囊 `− 100% + | 页码`，档位 `60/75/90/100/110/125/150/175/200%`，
  点百分比回 100%；纸面内 **Ctrl/⌘ + 滚轮** 同级缩放（阻止浏览器缩放）；缩放按标签记住。
- **AI 面板**：默认 366px（可拖动 300–560）；关闭时宽度 200ms 收到 0，纸面平滑扩张，
  内容列固定宽度裁切，不在收起过程中反复重排；面板保持挂载，草稿、展开的注入块与编辑态不丢，
  但关闭后 `visibility: hidden` / `pointer-events: none`，退出焦点与无障碍树。
  对话流由**工作区层**持有：切到别的标签时回答继续生成，切回来还是同一段流式文本。
  页签顺序：**对话 / 导读 / 批注 N / 关联 N / 文献信息**，批注与关联带数量徽标（`.pr-tab-count`，不用 `.pr-tag`
  ——后者读的 `--dsw-alias-bg-layer-2` 在玻璃主题下是透明的，数字会变成裸文字、看着像没显示）。导读页展示结构化导读与相关论文，支持就地修改和重新生成；有手动修改时重新生成先二次确认。
  面板顶部：`AI` + 这条会话真正在跑的模型名。页签下方是**对话栏**：左侧显示当前会话的标题
  （没有标题时显示「新对话」），右侧是历史对话与新建对话两个图标按钮。输入框下方一行（自左向右）：
  环形上下文占用（14px 圆环 + 百分比，点开是明细面板，压缩动作在面板里）、
  模型切换（当前模型名 + 思考强度，点开是「模型 / 思考强度」两段菜单）、
  发送（圆形纸飞机按钮，28px）。模型切换照 DSH 自己的选择器做成两层：第一层两行
  「模型 / 思考强度」各自显示当前值并带右箭头，第二层是列表——模型列表按供应商加小标题分组，
  强度列表按该模型实际的 effort 阶梯，「模型默认」只在该适配器没有默认值时出现。
  占用面板底部只保留「压缩上下文」（把旧轮次压成摘要）；新建对话在对话栏右侧，不再二次确认。
  **对话历史**：点历史按钮把对话栏**切换成管理视图**（不是浮层），按「当前 → 更早 → 已归档」
  列出该论文的所有 DSH 会话，每条显示标题、消息数与时间；行内可切换、重命名、归档，
  已归档的可以恢复，左上角返回对话。切换旧会话等于把它重新设为活动会话，后续提问续在它上面。
  注入的固定资料与检索片段在对话里各自占一行折叠条，默认收起，点击展开/收回。
- **全文翻译**：阅读工具栏右区新增「翻译」按钮，点开是全文翻译面板（进度只在面板里显示，
  工具栏图标不再挂数字）。翻译按页并发（默认 2 页），每页按约 2200 字符切块，模型以
  **JSONL 流式逐块**返回，收到一块就落盘一块；截断最多损失最后一块，失败块单独重试或二分，
  不再整页报废。`papers/<id>/translation.json` 按**原文内容哈希**缓存译文，重新解析导致的
  block id 变化、重复页眉页脚都能复用；system prompt 固定为「规则 + 标题/作者/摘要」，
  页内容只放在 user 后缀，给供应商前缀缓存留出命中机会。
  参考文献（到 Appendix/Extended Data 为止）、作者/单位/邮箱/版权/arXiv 标识、页眉页脚/页码、
  图表内文字、已是中文的段落都会在调用模型前自动跳过；跳过原因随页面返回并在面板里汇总。
  译文不是改 PDF：**译文页 = 原 PDF 页位图打底 + 白块遮住已翻译正文 + 黑字覆盖**，所以图片、
  表格线、公式字形和图表都保持原样，未翻译/跳过的内容继续显示原文；底色固定白纸黑字，
  暗色主题下也不跟随界面主题。
  **回填按原文几何排，不靠 CSS 硬缩**：`pages.json` v4 为每块保留行盒、基线、行距、首行缩进与
  对齐方式；旧论文第一次用到版面时按 `parseVersion` 自动重解析一次，译文按内容哈希缓存，不会
  重新花钱。提取侧按「上一行提前结束」切段（论文通常没有段间距），否则整栏会被当成一个段落、
  译成一整块文字；行内的上下标与公式造成的基线抖动也不再拆行。排版用 canvas 度量 + 二分字号
  （下限 0.62×），行距取原文 leading 并按行数轻微摊平（至多 1.2×），放不下时先缩字号再向下
  借用空白（到下一块 top−2，且不超过块高 75%），中文字面另加 1.06× 补偿；遮罩按原文行盒逐行
  绘制并向下多盖 0.24em（字母降部），最后用 DOM 的 `scrollHeight` 复核，度量误差只会让字号再
  小一档，不会裁字。
  行内公式、引用编号在送模型前换成 `⟦n⟧` 占位符，回包逐块校验顺序，缺失或重复只重试该块；
  标题与摘要抽一次术语表存进 `translation.json`（`glossary`），固定进 system prompt；每页请求
  带上上一页结尾作上下文，切块不切断跨栏/跨页的续段。
  四种显示：**原文 / 左右对照 / 仅译文 / 重排**，按标签记住。**重排**是整篇连续的单栏阅读视图：
  标题层级优先按章节编号（3.1 → h3）再按字号推导，跨页续段合并成一段，正文首行缩进 2em；
  图片/表格/公式从原页位图裁切后按阅读顺序插入，参考文献在文末折叠保留原文；对照模式下双面
  布局暂不可用，连续模式按页对纵向堆叠。
- **自定义翻译来源（实验性）**：设置 → 实验性功能打开「自定义翻译来源」后，设置导航出现「翻译」
  页，全文与选段翻译共用同一个来源选择。来源分两类，由代码而不是模型自动决定管线：
  **LLM 引擎**（DSH 模型、OpenAI 兼容 API、Ollama/LM Studio/llama.cpp）沿用现有 JSONL 流式协议、
  术语表和前缀缓存；**MT 引擎**（DeepL、Google Cloud、Azure、LibreTranslate/Argos、浏览器内置、
  宿主 Bing/Google）只收纯文本：代码按阅读顺序把 block 批量发出，按下标映射回 block id，不要求
  模型返回 id，也不使用提示词或术语表。公式、引用与参考文献在发送前由占位符/跳过规则保护，回包
  逐个校验后再落盘，公式缺一个就只重试该块。浏览器内置 Translator 只能在 Chrome 138+/Edge 的页面
  里运行；DSH 桌面窗口是 Electron（`Translator` 存在但模型不加载），必须用 UA 检测 + 超时兜底并
  提示用户用 Chrome/Edge 打开同一地址，宿主来源不受此限制。来源切换不自动重译：缓存仍按原文哈希
  复用，每页记录引擎标签，阅读器提示缓存来自哪个引擎，用户点「重新翻译」才覆盖。实验开关关闭时
  「翻译」页隐藏、生效来源强制回 DSH 模型、进行中的自定义来源运行取消，但已保存的选择和密钥保留。
  AI 总开关只停 `dsh` 与在线大模型 API（`tokens`）；本地、浏览器、在线机器翻译与按字符计费的专用
  翻译 API 仍可用。
- **滚动条**：左栏与面板内各滚动区共用一条细滚动条（8px，左栏 6px）：透明轨道、圆角滑块、
  内缩 2px、悬停加深；`::-webkit-scrollbar-button` 置空，去掉原生上下箭头，只留滑块本体。
  读区（`.pr-stage`）仍然完全隐藏滚动条，滚轮可滚。

### 4.3 Relations（关联图谱）

整页是「工具条 + 图谱/列表双视图 + 右侧检查器」，主视图是**可交互力导向图**（原「不做全屏图」的决策已被推翻：
用筛选、聚焦与连通分量打包解决可读性）。

1. **顶部工具条**：搜索框（即时过滤标题/作者/标签/理由，支持 `tag:` / `author:` / `year:>2023` / `kind:` /
   `cluster:` / `is:pending|isolated|missing`，回车走跨库语义检索）；六种关系类型胶囊（带计数，`0` 时变淡）；
   视图切换（图谱 / 列表）；「重建关联」按钮，重建期间显示当前步骤。
2. **主题簇行**：AI 命名的簇胶囊（颜色点 + 计数），点击隔离该簇；「待确认」胶囊一键过滤低置信边。
3. **图谱**：节点大小 = 加权度，颜色 = 主题簇；边按关系类型着色，虚线 = 待确认（置信度 < 0.62）。
   支持拖拽（只移动被拖节点，不复算布局）、滚轮缩放（0.35×–3×）、空白平移、
   单击聚焦（邻居与一跳边点亮、标题显示，其余节点与边淡出）、双击打开、
   悬停浮层（标题/年份/度数/簇）、选中后悬停另一节点显示最短路（`N 跳 · A → B`）。
   孤立论文与断开的小分量打包到画布底部的「pod 条」，不再把一个孤儿放大成缩略图。
   右上角 HUD：放大 / 缩小 / 适应画布 / 标题开关。
4. **列表视图**：左列论文卡（簇色点、年份、度数、标签），右列关联分组（按类型，组内按置信度）；
   两列共享同一份筛选状态，切换不丢上下文。
5. **检查器**（右栏 344px）：
   - 未选中：全库概览——四个统计（论文 / 已确认 / 待确认 / 覆盖率）、最可信的 4 条关联、待确认列表（可就地接受/忽略）、
     主题簇、未连上的论文、跨库命中片段。
   - 选中：论文卡（标题、年份、场馆、标签、疑似重复提示）→ **AI 关联综述**（2–3 句 + 2–4 条要点，按需生成并缓存，
     可重新生成）→ 关联列表（类型、方向、理由、信号 chip、置信度细条、打开/忽略）。
6. **动效**：页面分节淡入；节点淡入（`prefers-reduced-motion` 下关闭）；选中节点呼吸光环；路径边流动虚线；
   列表用 `motion` 的布局动画；检查器切换交叉淡入。力导向用 `d3-force`，其余自研 CSS/rAF。
7. **可访问性**：关系类型同时用颜色、虚线与文字标签区分；焦点环用 accent；图谱的等价信息在列表中完整可读。

> 关联生成本身见 §10.2：确定性层（引用 / 书目耦合 / 概念重叠）永远可用，模型层只负责类型、方向与理由，
> 无模型时页面照常出图，只缺 AI 文本。

### 4.4 导入对话框

- 宽 560，居中，遮罩 44% 冷色 + 2px 模糊。
- 头部：图标 + 标题 +「导入后会自动解析全文、抓取元数据与参考文献，并生成导读。」
- 页签：**PDF 文件** / **标识符 / 链接**。
- PDF：拖放区支持文件与**整个文件夹**（递归子目录），也可点「选择文件夹」；选择会追加并去重，可清空；批量上传时显示 `已完成/总数 · 文件名` 进度。
- 标识符/链接：输入框（DOI / arXiv ID / PMID / PubMed 或出版社链接）、示例（DOI、arXiv、PMID）、回车提交。
- 底部：提示语 + 取消 + 开始导入（未就绪时禁用）。
- 受限 PDF：只导入元数据；任务提示「需要登录或订阅，请下载 PDF 后上传」，阅读器提供上传入口。

### 4.5 队列抽屉

右下角 336px 卡片：来源行（图标 + 文件名/链接 + 大小）、八步进度（识别 → 落库 → 解析 → 补全元数据 → 分块 → 导读 → 关联 → 索引）、一句状态说明；完成或失败后保留，可手动收起。认证墙与缺失 PDF 通过 `warnings` 显示。

### 4.6 Settings

左侧分类导航（通用 / 数据）+ 右侧独立滚动内容，页头固定。所有改动自动保存，页头右侧只显示「保存中… / 已保存 / 保存失败」，不再有显式保存按钮：

1. **文献来源**：文件夹列表（默认项标「默认」）、**「添加文件夹」直接调起系统目录选择器**、手动粘贴路径作为兜底、立即扫描。增删文件夹即时保存并扫描。
2. **模型**：当前路由（指定 / 跟随默认）、关联页模型开关、自动导读开关、模型下拉（来自 `ctx.llm` 的 provider → model 目录，首项「跟随 DSH 默认」，右侧「用默认」一键回退）。拉不到模型列表时按 provider 显示原因。
3. **对话**：论文会话是否出现在宿主侧栏；profile 没有 agents / agentPresets 时提示会退化为单轮问答。
4. **存储**：单篇上限（MB，失焦或回车保存）、`$DSH_HOME/paperreader` 路径（可复制）。
5. **维护**：重建检索索引、检查缺失文件（列出后二次确认才从库中移除）。
6. **翻译**（实验性，仅「自定义翻译来源」打开时显示）：来源卡片（DSH 模型 / 本地 / API / 浏览器内置 / 在线机器翻译）、按来源变化的引擎表单、模型探测、连接/试译、API 密钥（只写不读，存在 DSH 凭据里）。切换来源不自动重译，底部说明缓存与「重新翻译」的关系。

> 设置项是扁平的「label + 说明 / 右侧控件」行，行间 1px 分隔，不再套卡片；控件统一 32px 高、8px 圆角，开关是 38×22 纯色胶囊。≤1080px 分类导航变为横向标签，≤640px 行改为上下布局。
> 设置页把「扫描」和「保存」合成一个动作：保存文件夹后立刻扫描，省掉一次「我明明加了文件夹却没反应」。
> 设置读不出来时（宿主刚重启、接口 503）内容区显示「重新加载」，而不是让状态永远停在「已保存」。

---

## 5. 交互规格

### 5.1 选区 → 工具条

1. `mouseup` 后延迟 0ms 读取 `getSelection()`。
2. 选区必须完全落在纸面容器内，且文本 ≥ 2 字符。
3. 工具条浮于选区上方 8px，水平居中，左右各留 160px 安全边距（六色后工具条宽约 290）。
4. `mousedown` 阻止默认，避免点击时丢失选区。
5. 选区文字按 PDF 文本块重建：行间断词补空格、去掉标点前的多余空格；**几何只取字形**：片段首尾空白裁掉，纯空白文本项（有些 PDF 行尾会带 100pt 以上的空 span）只参与文本、不参与矩形，仅用来桥接两端有字的词间距。高亮矩形按行合并，再按可见字形收紧（顶部下移 0.22、高度 1.02，下边界到基线下约 0.24em，p/g/y 的下伸部不再被裁掉），避免重叠加深和框高于文字；选中时的 overlay、落下的高亮与搜索命中三处共用同一收紧。
6. 选中过程中 `selectionchange` 每帧重算 overlay，原生选区透明；松开鼠标后才显示工具条。

工具条：`解释 · 翻译 | ■ ■ ■ ■ ■ ■ | 复制`

- **解释**不立即请求：把引文放进副驾输入框，用户补充问题后发送；直接发送时使用默认问题「解释这段内容」。

### 5.2 选段常驻

原生选区会在点击别处时消失，因此**提问瞬间把选区固化为持久标记**：

```
ensureMark(range, color?) →
  若起点已在 mark.pr-hl 内，复用该节点
  否则 surroundContents；跨块失败则 extractContents + insertNode
  加 class pr-hl-pending
```

- 新标记出现时，把上一个 `pr-hl-pending` 降级为 `pr-hl-asked`（淡出为下划线）。
- 用户再给该段上色 → 移除 pending/asked，写入 `data-c`。
- 换页清空（DOM 重建）。

### 5.3 边注气泡

- 位置：选区右侧 +14px；右侧不够则翻到左侧；顶部不低于 72px，底部至少留 18px。
- 高度：最大高度取 `min(46vh, 460px)` 与“顶部到视口底”的较小值，正文在气泡内滚动；长译文不会把底部操作行推出屏幕。
- 内容：页签式的动作名 + 页码 → 引文（≤ 62px 高）→ 流式正文 → 引用角标 → 操作行（复制 / 继续追问 / 关闭）。
- 「继续追问」不立即发送：关闭气泡，把引文放进副驾输入框；直接发送时使用默认问题「继续展开这段内容」。
- 流式：每 16ms 追加约 5 字符；结束后才出现操作行。
- 翻译的临时选段标记在流结束、出错或关闭气泡时移除，不再残留到下次重渲染。
- 气泡跟随滚动：保存 `Range`，`scroll` 时重算 `getBoundingClientRect()`。

### 5.4 副驾

- 空态：一句上下文 + 三个建议问题（点击即发送）。
- 消息：用户消息灰底气泡；AI 消息纯文本 + 流式光标。
- 输入：Enter 发送、Shift+Enter 换行、`busy` 时禁止发送。
- 引用：工具条「解释」或气泡「继续追问」把选段放进输入框上方，可输入补充问题；引文存在时允许空输入直接发送。
- 上下文提示：`⌘ 上下文：全文 + 当前页`。
- 批注页签：列出已上色条目（色点 + 引文 + 页码 + 同页序号，如 `第 3 页 · 2/5`）；「定位」会切到对应页、滚动到该条批注的包围框并描边脉冲 3 秒，同页多条也不会认错。
- 关联页签：单列该论文的关联，先「本文引用 N」再「被引用 N」，每条一行卡片（关系类型药丸 + 年份 → 标题 → 一句理由），点开在阅读器里换成那篇。之前它挂在批注页签底部，只露前 5 条。
- 文献信息页签：摘要、元数据与参考文献统一使用面板正文的无衬线字体；摘要不单独套 serif。

### 5.5 缩放与布局

- 每页是一层**固定 100% 几何**（适配宽度）的图层，缩放只改这一层的 `transform: scale()`；文本层、选区、批注、画布一起缩放，缩放一步只写一个样式，不重排、不重测字宽。不用 CSS `zoom`：它会让整页参与布局，每档都重排。
- 单面：适配宽度 = `stage.clientWidth − 72`；双面：每页适配 `(stage.clientWidth − 72 − 24) / 2`；连续：与单面同宽，每页按自己的纵横比占位。
- 外层 `.pr-pdfpage` 按 `100% 尺寸 × ratio` 占位；单面/双面用 `width: max-content` + `margin: 0 auto` 居中——内容比视口宽时从左侧开始，不会被 flex 居中裁掉左边。
- 连续模式里页面盒高度随 ratio 变化，缩放会改变滚动高度：缩放后按 `scrollTop × (newRatio / oldRatio)` 校正，保持正在读的位置；只重绘视口附近的页。
- 缩放后工具条/气泡位置由 `Range` 重算，无需额外逻辑；选区坐标按 `页面 scale × zoom` 反算回页坐标。
- 位图按 `fit × ratio × DPR` 重绘，像素总量上限 10MP（200% 下自动降 DPR，而不是分配几十 MP 的位图）。
- 连续缩放：缩放过程只做 CSS 变换，手势停下 `ZOOM_SETTLE_MS`（160ms）后才重绘位图；进行中的 render 由 AbortController 取消，同一 canvas 的渲染任务串行。页面 textContent 按文档缓存（LRU 16 页），文本层 `scaleX` 比例按「页 + 适配宽度」缓存，缩放时不重复解析/测量。
- 换页与缩放重绘都先画到离屏画布，完成后一次性 `drawImage` 替换，杜绝 `canvas.width` 清空造成的闪白。
- 翻页时只有 PDF 视图不请求 `pages.json`（文本回退才需要），省掉一次与翻页无关的往返。

### 5.6 键盘

| 键 | 作用 |
|---|---|
| `Esc` | 关气泡 / 关工具条 / 关对话框 |
| `Enter` | 链接导入提交；对话发送 |
| `Shift+Enter` | 对话换行 |
| `←` / `→` | 翻页；双面按对开翻，连续滚到上一页/下一页 |
| `PageUp` / `PageDown` | 翻页；连续模式按视口高度滚动 |
| `Ctrl/⌘+F` | 打开当前页的插件内搜索（阅读器找文内、文献库找论文、关联页过滤） |
| `⌘/Ctrl+J` | 对选中段落追问（P2 实现） |
| `+` / `-` | 缩放（P2，聚焦纸面时） |

> 不绑定 `⌘/Ctrl+W`、`⌘/Ctrl+Tab`：浏览器会先截获它们（关掉宿主标签页、切换宿主标签页），插件拿不到。
> 标签的关闭用 `×` 或中键。

---

## 6. 数据模型

### 6.1 实体

```ts
type Status = 'todo' | 'reading' | 'done'
type PdfUnavailable = 'auth' | 'missing'

interface ReferenceEntry {
  title?: string
  authors?: string[]
  year?: number
  venue?: string
  doi?: string
  pmid?: string
  url?: string
  raw?: string               // 只有原始引用字符串时的兜底
}

interface Paper {
  id: string                 // 稳定 ID，建议 arxivId 或 doi 哈希，缺失时 uuid
  title: string
  authors: string[]
  year?: number
  venue?: string
  abstract?: string
  doi?: string
  arxivId?: string
  pmid?: string
  references?: ReferenceEntry[] // 详情接口返回；存 papers/<id>/references.json
  tags: string[]
  folder: string | null      // 多级文件夹（一篇只属于一个）；null = 未分类
  status: Status
  progress: number           // 0–100
  addedAt: string            // ISO
  updatedAt: string
  source: 'pdf' | 'link'
  filePath?: string          // 引用原文件，不复制
  sourceUrl?: string
  pageCount?: number
  hasFullText: boolean
  hasSummary: boolean
  missing?: boolean
  pdfUnavailable?: PdfUnavailable  // 只有元数据：auth=需登录/订阅，missing=未抓到
  lastRead?: { page: number; scrollTop: number; at: string }
  deletedAt?: string         // 在回收站里；缺省 = 正常
}

// folders 在 library.json 里是扁平数组；同一 parentId 下的兄弟顺序就是数组里的相对顺序。
// 拖拽只改数组位置与 parentId，所以顺序和层级一起持久化。
interface Folder {
  id: string
  name: string               // 多级；同一层同名唯一
  parentId: string | null    // null / 缺省 = 顶层
  createdAt: string
}

interface Summary {
  paperId: string
  tldr: string               // ≤ 60 字，卡片上那一句
  problem: string
  method: string
  findings: string[]
  limitations: string[]
  reusable: string[]         // 可复用的点：数据集/技巧/假设
  related: Array<{ paperId: string; reason: string; weight: number }>
  model: string
  createdAt: string
}

interface PageText {
  page: number
  width: number              // PDF 点
  height: number
  blocks: Array<{
    id: string
    bbox: [number, number, number, number]
    text: string
    kind: 'title' | 'para' | 'caption' | 'equation' | 'ref'
    size?: number            // 字号（pt）
    leading?: number         // 行距（pt，v2+）
    indent?: number          // 首行缩进（pt，v2+）
    align?: 'left' | 'center' | 'right'
    lines?: Array<{ box: [number, number, number, number]; baseline: number }>   // v2+：逐行盒
  }>
}

interface Chunk {            // 检索单元
  id: string
  paperId: string
  page: number
  blockIds: string[]
  text: string
  tokens: number
}

interface Annotation {
  id: string
  paperId: string
  page: number
  rects: Array<[number, number, number, number]>   // 页坐标（PDF 点，左上原点）
  quote: string
  prefix: string             // 前 32 字，重锚定用
  suffix: string             // 后 32 字
  color: 'yellow' | 'blue' | 'rose' | 'green' | 'purple' | 'orange'
  noteId?: string            // 关联的笔记
  createdAt: string
  updatedAt: string
}

interface Note {
  id: string
  paperId: string
  page?: number
  body: string
  origin: 'user' | 'ai'      // ai = 从边注「存入笔记」
  createdAt: string
}

interface Edge {
  from: string
  to: string
  kind: 'cites' | 'builds-on' | 'same-method' | 'same-problem' | 'uses' | 'contradicts'
  reason: string             // 一句话，展示在关联列表
  origin: 'auto' | 'user'
  confidence: number
  status?: 'confirmed' | 'suggested' | 'rejected'   // 缺省 = confirmed（旧数据）
  signals?: { ref?: number; concept?: number; claim?: number; lexical?: number; external?: number }
  evidence?: { sharedConcepts?: string[]; sharedRefs?: string[]; refIndex?: number; direction?: 'a2b' | 'b2a'; noteA?: string; noteB?: string }
  model?: string
  at?: string
}

interface PaperProfile {      // papers/<id>/profile.json，AI 生成、可按内容哈希复用
  paperId: string
  question: string
  method: string              // 方法族（用于判“同方法/基于”）
  approach: string
  claims: string[]
  concepts: string[]          // 6–10 个可比较概念，概念重叠打分用
  tasks: string[]
  limitations: string[]
  fingerprint: string         // 60–100 字自述，代替 embedding 做相似度
  contentHash: string
  model: string
  createdAt: string
}
```

关联页的读模型（`RelationGraph`）由 Host 计算：节点带 `cluster/degree/weight/isolated/duplicateOf`，
边带 `status/signals/evidence/direction`，簇带 `label/paperIds/color/aiNamed`，另附 `stats`。

### 6.2 锚定规则（重要）

- **坐标一律存页坐标**（PDF 点，左上原点），不存像素。缩放/换设备时按 `scale` 反算。
- 重锚定顺序：`quote + page` 精确匹配 → `prefix/suffix` 邻域匹配 → 标为 `orphaned`（UI 显示"原文已变，批注待确认"）。
- 跨块选区允许 `rects` 多段。

### 6.3 存储布局

```
$DSH_HOME/paperreader/
  library.json                 # papers + collections（整体原子写）
  config.json                  # 监控文件夹、模型路由、导入上限、侧栏开关
  relations.json               # 全部 Edge（含 status/signals/evidence）
  relations-meta.json          # 判定缓存、簇命名缓存、上次重建摘要
  index/bm25.json              # 预留：倒排索引快照（当前启动时从 chunks 重建）
  jobs/<jobId>.json            # 导入 / 关联重建任务状态
  tasks.json                   # 任务列表历史：类型 / 状态 / 起止时间 / 模型 token / 错误（最多 500 条）
  workspace/                   # 侧栏根分组；每篇论文一个子目录，也是该论文会话的 cwd
  papers/<paperId>/             # 书目信息在 library.json，这里放派生数据
    summary.json
    profile.json               # PaperProfile：AI 生成的关联画像
    relation-insight.json      # 该论文的 AI 关联综述（带内容签名）
    pages.json                 # PageText[]
    translation.json           # 全文译文缓存：每页 sourceHash / sources + 按 blockId 的译文
    visuals.json               # 图片/表格/公式区域，供重排裁切和跳过图表内文字
    references.json            # ReferenceEntry[]，避免 library.json 膨胀
    chunks.json                # 检索单元，避免启动时重解析 pages
    annotations.json           # 写入串行化；每次成功写入同步 .bak
    annotations.json.bak       # 主文件损坏/截断时回退，避免“批注全没了”
    notes.json
  files/<paperId>.pdf          # 链接导入时保存的副本（上传的 PDF 落在 inbox/）
  inbox/                       # 默认监控文件夹
```

**对话不在这里。** 每篇论文的对话是 harness 的会话日志（`$DSH_HOME/sessions/<cwd 派生目录>/<sessionId>/`），
由 `dsh-session-persistence-jsonl` 落盘、`ctx.sessionQuery` 读回。旧的 `thread.json` 已彻底移除，不迁移也不回灌。

数据量 > 2000 篇或全文 > 200MB 时迁移 SQLite（FTS5），接口层不变。

---

## 7. Host 侧架构

### 7.1 分层

```
client (React)  ──fetch /api/paperreader/*──▶  host (Cordis plugin)
                                                ├─ library    论文与文件
                                                ├─ extract    PDF → PageText
                                                ├─ summoner   LLM 调用（ctx.llm）
                                                ├─ memory     BM25 + 关联
                                                └─ jobs       队列与进度
```

客户端**不直接读文件**；所有文件与模型访问都在 Host 侧，客户端只拿 JSON 与流。

### 7.2 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/paperreader/papers` | 库列表（`?q=&status=&tag=&folder=&sort=recent`），附带文件夹计数、标签计数、各状态数量与回收站列表 |
| GET | `/api/paperreader/papers/:id` | 元数据 + 参考文献 + 导读 + 批注 + 笔记 + 对话 + `fileUrl`（无 PDF 时为 null；回收站里的论文 404） |
| PATCH | `/api/paperreader/papers/:id` | 状态、进度、标签、文件夹、`lastRead`，以及手动修正的标题 / 作者 / 年份 / 期刊 / 摘要 / DOI / arXiv / PMID |
| DELETE | `/api/paperreader/papers/:id` | 软删除进回收站；`?permanent=1` 彻底删除（记录 + 目录 + 关联） |
| POST | `/api/paperreader/papers/:id/restore` | 从回收站还原 |
| DELETE | `/api/paperreader/trash` | 清空回收站（逐篇彻底删除） |
| GET/POST | `/api/paperreader/folders` | 文件夹列表（带计数）/ 新建（`{ name, parentId }`，同一层同名拒绝） |
| PATCH/DELETE | `/api/paperreader/folders/:id` | 重命名 / 删除整棵子树（论文回到未分类） |
| POST | `/api/paperreader/folders/:id/move` | 调整顺序与层级（`{ parentId, beforeId }`，`beforeId=null` 追加为末子项） |
| POST | `/api/paperreader/maintenance/reindex` | 重建 BM25 索引 |
| GET | `/api/paperreader/maintenance/missing` | 列出原文件已不在的论文 |
| POST | `/api/paperreader/maintenance/clean-missing` | 从库中移除这些论文（显式操作） |
| GET | `/api/paperreader/papers/:id/pages/:n` | PageText（文本回退视图与引用上下文） |
| GET | `/api/paperreader/papers/:id/file` | PDF 字节流，支持 Range（206） |
| POST | `/api/paperreader/papers/:id/attach` | 给只有元数据的论文补 PDF（原始字节，`?name=`），解析后合并到同一条记录 |
| POST | `/api/paperreader/import/pdf` | 原始 PDF 字节（`?name=`），写入 inbox 后入队 |
| POST | `/api/paperreader/import` | 标识符/链接导入 `{url}`：DOI、arXiv ID、PMID、PubMed 或页面 URL |
| POST | `/api/paperreader/import/file` | 本机路径导入 `{path}`（不复制） |
| GET | `/api/paperreader/jobs` | 最近 12 个任务 |
| GET | `/api/paperreader/jobs/:id` | 单任务快照 |
| GET | `/api/paperreader/jobs/:id/stream` | 任务进度 SSE（终态后自动关闭） |
| GET | `/api/paperreader/tasks` | 任务列表：进行中 + 历史；`kind/state/q/from/to/offset/limit` 筛选 |
| POST | `/api/paperreader/ask` | 提问 / 解释 / 翻译，SSE 流式回答（前两者进会话，翻译一次性） |
| GET | `/api/paperreader/papers/:id/chat` | 该论文的对话记录 + 上下文占用 + 当前模型路由（`{ messages, context, route }`） |
| GET | `/api/paperreader/papers/:id/models` | 该论文的模型目录与可选思考强度（`{ options, current }`） |
| POST | `/api/paperreader/papers/:id/model` | 切换该论文的模型路由 `{ provider, model, reasoningEffort? }`，返回已记录的 `route` |
| POST | `/api/paperreader/papers/:id/compact` | 手动压缩，返回 `{ removed, freedTokens }` |
| POST | `/api/paperreader/papers/:id/reset` | 清理上下文（兼容入口）：换一条新会话，返回 `{ sessionId, retired }` |
| GET | `/api/paperreader/papers/:id/conversations` | 该论文的会话历史：`{ paperId, activeId, conversations[] }` |
| POST | `/api/paperreader/papers/:id/conversations` | 新建对话（旧的进入历史） |
| POST | `/api/paperreader/papers/:id/conversations/:sid/select` | 切回某条历史对话，把它设为活动会话 |
| PATCH | `/api/paperreader/papers/:id/conversations/:sid` | 重命名一条对话 `{ title }` |
| POST | `/api/paperreader/papers/:id/conversations/:sid/archive` | 归档（隐藏，日志保留） |
| POST | `/api/paperreader/papers/:id/conversations/:sid/unarchive` | 从归档恢复 |
| GET | `/api/paperreader/papers/:id/translation` | 全文翻译状态：总页数 / 已完成 / 部分完成 / 运行中 / 每页状态 / 块计数 |
| GET | `/api/paperreader/papers/:id/translation/pages/:n` | 单页的 `PageText` + 译文块 + 跳过原因 + 阅读顺序 + 视觉区域 |
| GET | `/api/paperreader/papers/:id/translation/document` | 整篇文档（重排视图）：所有页的结构、译文、跳过原因与视觉区域 |
| POST | `/api/paperreader/papers/:id/translation` | `{ action: 'start' \| 'cancel', pages?, force? }` |
| POST | `/api/paperreader/papers/:id/translation/blocks` | 浏览器来源提交单页译文 `{ page, blocks: [{ id, t }] }`；校验 block id/原文哈希/公式占位符，幂等 |
| GET | `/api/paperreader/translation/sources` | 生效来源、引擎（label/mode/billing/available）、密钥配置状态与 AI 开关放行结果 |
| GET | `/api/paperreader/translation/models?target=api\|local` | 探测 OpenAI 兼容端点的模型目录 |
| POST | `/api/paperreader/translation/test` | 用一句样例实测当前来源，返回耗时/样例/错误 |
| POST | `/api/paperreader/translation/key` | `{ provider, value }`：写入或清除 DSH 凭据，响应只回配置状态 |
| GET/POST | `/api/paperreader/papers/:id/annotations` | 列批注 / 新建批注 |
| PATCH/DELETE | `/api/paperreader/papers/:id/annotations/:aid` | 改色 / 写笔记 / 删除 |
| GET/POST/DELETE | `/api/paperreader/papers/:id/notes` | 独立笔记（可选） |
| GET | `/api/paperreader/relations` | 全库关联（旧读模型，保留兼容） |
| GET | `/api/paperreader/relations/graph` | 图谱读模型：节点 / 边 / 簇 / 统计；`?focus=&depth=2&limit=400` |
| GET | `/api/paperreader/relations/insights/:paperId` | 该论文的 AI 关联综述（缓存；`?refresh=1` 重生成） |
| POST | `/api/paperreader/relations/rebuild` | 入队全库或单篇重建 `{scope?}` → `{jobId}`（复用任务 SSE） |
| POST | `/api/paperreader/relations/feedback` | 接受 / 忽略 / 置顶 / 删除一条关联 `{from,to,kind,action}` |
| GET | `/api/paperreader/relations/:id` | 单篇关联（含方向与理由） |
| POST | `/api/paperreader/relations/remove` | 手动删除一条关联（兼容旧调用） |
| POST | `/api/paperreader/search` | 跨库检索（`rerank` 可关） |
| GET/POST | `/api/paperreader/config` | 监控文件夹、模型路由、自动导读、AI 总开关（`aiEnabled`，缺省开启） |
| GET | `/api/paperreader/models` | `ctx.llm` 的 provider → model 目录 + 默认路由（设置页下拉的数据源） |
| POST | `/api/paperreader/scan` | 重新扫描监控文件夹，返回新增的 jobId |
| POST | `/api/paperreader/papers/:id/summarize` | 重新生成导读（失败后重试入口；AI 关闭时 503 `AI_DISABLED`） |
| PATCH | `/api/paperreader/papers/:id/summary` | 手动保存导读字段（`tldr/problem/method/findings/limitations/reusable`），写 `editedAt` 并同步卡片 `tldr` |
| GET | `/api/paperreader/search/papers` | 库内全局搜索：元数据 + 笔记 + PDF 全文；返回 `{ query, matches, total }` |
| GET | `/api/paperreader/static/pdf.worker.min.mjs` | pdf.js worker（离线可用） |
| GET | `/api/paperreader/static/katex/katex.min.css`、`.../fonts/:file` | KaTeX 样式与字体（构建时复制到 `dist/vendor/katex/`，离线可用） |
| GET | `/api/paperreader/health` | 自检：篇数、索引大小、模型路由、数据目录 |

> 全部挂在**一条 prefix 路由** `/api/paperreader/` 上，内部按 `(method, path)` 匹配；路由冲突只可能发生一次。

> 路由注册用 `ctx.webServer.register(...)`；具体 `WebRoute` 字段以 `cordis_inspect_query`（host `Service` → `webServer`）为准，实现第一步先核对。

### 7.3 服务边界

| 模块 | 职责 | 依赖 |
|---|---|---|
| `Library` | 增删改查、监控文件夹扫描、去重（DOI/arXiv/文件哈希） | `ctx.fs` |
| `Extractor` | pdfjs-dist legacy 解析 → PageText；缓存 | — |
| `Summarizer` | 分节摘要 → 合并 → 结构化 JSON；关联判定 | `ctx.llm` |
| `Memory` | 分块、BM25 索引、检索、重排 | — |
| `Jobs` | 串行队列、进度事件、失败重试（≤ 2 次） | — |
| `PaperChat` | 每篇论文一条 DSH 会话：懒创建/恢复、LRU 保活、流式帧桥接、压缩、侧栏归档 | `ctx.agents` `agentPresets` `sessionQuery` `sessionPersistence` `tokenMeter` `workspaceRegistry` `sessionTitle`（全部经 `ctx.get`，可缺） |
| `Translation` | 来源解析、DSH/OpenAI 兼容/专用 MT/浏览器引擎、内容哈希缓存、外部提交 | `ctx.llm` `ctx.credentials` `ctx.translator`（后两者可缺）、`store` |

### 7.4 并发与限流

- 导入串行（一次一篇），避免同时打满模型额度。
- 摘要用低温度（0.2），提问用 0.3，翻译用 0。
- 单篇摘要预算：输入 ≤ 12k tokens（分节 map-reduce），输出 ≤ 1.2k。

---

## 8. 导入管线

```
选文件 / 文件夹 / 贴标识符或链接
  → ① 识别：hash、DOI/arXiv/PMID 规范化、去重（路径/指纹/DOI/arXiv/PMID）
  → ② 落库：写入 meta（状态 todo，记录 `pdfUnavailable`）
  → ③ 解析：pdfjs 取每页 textContent → bbox → PageText
  → ④ 补全元数据：Crossref / OpenAlex / Europe PMC / arXiv / DataCite
  → ⑤ 分块：按段落聚合到 ~400 tokens，重叠 60
  → ⑥ 摘要：分节 map → 合并 reduce → Summary（schema 校验，失败重试一次）
  → ⑦ 关联：候选 top-20（标签 + BM25）→ LLM 逐对判定 + 理由 → Edge
  → ⑧ 索引：BM25 增量更新
  → ⑨ 完成：状态置 todo，推事件
```

- 任一步失败 → 任务标 `failed`，保留已解析页面，允许「重试」。
- 链接/标识符导入：先走公开元数据 API；元数据源优先级为 Crossref（DOI）→ OpenAlex，arXiv API（arXiv）→ OpenAlex，Europe PMC（PMID）→ OpenAlex，DataCite 兜底。OpenAlex 同时提供 OA `pdf_url` 与参考文献图。
- 参考文献写入 `Paper.references`（最多 200 条，去重），在阅读器「文献信息」页签展示；`venue` 统一承载期刊/会议。
- 本地 PDF：解析后若正文含 DOI/arXiv，再异步补一轮元数据，页面标题让位于外部元数据（若存在）。
- 受限 PDF：401/403、登录跳转或订阅墙 → 仅保存元数据与 `pdfUnavailable: 'auth'`，任务以 warning 提示下载后上传；阅读器「上传 PDF」调用 `/papers/:id/attach` 补齐同一条记录。
- 扫描文件夹：启动时 + 手动触发；只新增，不删除（缺失文件标 `missing`，不自动清理）。

---

## 9. AI 契约

### 9.1 三个入口，一条管线

| 入口 | 走法 | 输出 |
|---|---|---|
| 导入导读 | 一次性 `llm.json`（全文分节） | Summary（结构化） |
| 选段翻译 | 一次性调用生效翻译来源（默认 DSH `llm.stream`），**不进会话** | 边注气泡（流式） |
| 全文翻译 | 按来源：LLM 走 `llm.stream` + JSONL；MT 走批量纯文本；**不进会话** | `translation.json` 缓存 + 译文版面 / 重排 |
| 选段解释 | 进会话，按正常一轮处理（`mode: 'explain'`） | 气泡流式显示，同时落进副驾对话 |
| 副驾提问 | 进会话（`mode: 'ask'`） | 消息（流式 + 引用角标） |

所有流式入口共用同一套 SSE 协议（`delta` / `done` / `error`）与「AI 气泡」样式。

### 9.2 会话形态

每篇论文一个 DSH 会话：`sessionId = pr-<paperId>`（写进 `library.json` 的 `sessionId` 字段，缺省按规则派生）。
会话由 `ctx.agents.create/resume` 驱动，跑在插件随包注册的 `paper-reader` preset 下：无工具、无 skill、无 plan，
只有一段固定人设与它自己的压缩服务。

上下文布局（决定前缀缓存是否命中）：

```
[system]     preset 里的 dsh-persona（prefix + complete），字节永远不变
[user]       digest：标题/作者/摘要/一句话结论/页首骨架/关键段 —— 每会话只写一次
──────────── 以下只追加，前缀不再改变 ────────────
[user]       本轮检索片段（source.mode = 'context'，UI 显示为折叠条）
[user]       本轮问题（source.mode = 'ask' | 'explain'，带 page/quote）
[assistant]  回答
```

- 检索结果**永远追加**，绝不再改前缀；这是与旧实现（把检索塞进 system、把历史压成一条 user）最大的区别。
- 消息元数据用自定义 `MessageSource`（`kind: 'paperreader'` + `mode/page/quote/pages`）随会话日志持久化，
  不需要侧车文件；历史接口把 digest / 检索块投影成 `injected: 'digest' | 'retrieval'`（带 `pages`），
  面板按原位置渲染成默认收起的折叠条（结构照 DSH 自己的 compaction 行：图标换 chevron、标题 · 摘要、正文内缩）。
- 模型选择按论文记住：`library.json` 的 `chatModel` 是权威副本，`POST /papers/:id/model` 先走
  `llm.resolveCallConfig` 校验（不支持的思考强度直接 409），再写回记录并 `agent.model.select()`；
  下一次开轮前 loop 会把它写成 `model/selection`，随后一轮 `request/header` 变成 `reason: change` 的
  新 provider/model/reasoningEffort。冷启动 `resume` 时用同一个记录重新 `select`，否则沿用日志里的选择。
- 新建对话 = 换会话，不是清日志：DSH 的日志格式里没有 reset 事件，`agent` 也没有 `clear()`，
  所以新建时先 `dispose` 活动 agent，再把 `paper.sessionId` 换成 `pr-<paperId>-<8 hex>`，
  把旧 id 记进 `retiredSessions`（保留最近 20 条）。旧会话不会消失：它进入该论文的**对话历史**，
  `GET /conversations` 会列出活动会话与全部旧会话（标题取用户自定义名或首条提问，带消息数与时间）。
  切回旧会话时反过来：旧 id 从 `retiredSessions` 移出并设为 `sessionId`，原活动会话进入历史。
- **对话出现在侧栏：一个根分组 + 每篇论文一个子分组**：打开「对话出现在侧栏」后，注册
  `$DSH_HOME/paperreader/workspace` 为「论文阅读」根工作区，每篇论文的
  `workspace/<paperId>` 作为它的子工作区（标题为论文标题），把该论文的活动会话与全部历史会话都
  `attachSession` 进去。DSH 的「按工作区树」分组会按路径前缀自动嵌套；插件不改宿主的全局分组偏好。
  会话的 header cwd 必须是 `workspace/<paperId>`，否则 DSH 的成员校验会拒绝 attach，所以
  `agents.create` 的 `meta.cwd` 用论文目录而不是共享根目录。旧版本会话的 cwd 是根目录且无法改写：
  开启侧栏时把这类会话从论文记录里清掉并 `archiveSession`（日志保留在磁盘，不删除），之后的新会话
  落在各自的论文目录。关闭开关时归档全部会话并删除论文子工作区与根工作区；论文删除/移入回收站时
  归档并摘除它名下的会话，再删除它的子工作区。
- 自动压缩由 preset 里的 `compaction-basic` 在每步 `compactIfNeeded` 完成；手动压缩走
  `agentPresets.serviceFor(agent, 'compaction').compactNow(...)`（Web profile 把全局 compaction 关掉了，
  压缩服务在每个 preset 的隔离 realm 里），返回 `shadowedSeqs.length` / `shadowedTokenCount` 给 UI。
- 空 preset 只保证「不注册工具」，挡不住**别人注册的全局工具**（skills-manager / sidebar / dsh-ops 等）。
  所以 `setup` 里还会取一次全局视图 `tools.definitions()` 并 `tools.restrict({ deny: names })`——作用域是
  该 agent，随它卸载；实测请求头 `tools: none []`。
- 侧栏可见性 = 归档开关 + 一个根工作区：关闭时对全部 `pr-*` 会话 `archiveSession` 并删除论文子工作区与根工作区，
  打开时重建根工作区，按会话 header cwd 把会话挂到对应论文子工作区并 `unarchiveSession`；
  成员关系要显式记录，不会按 cwd 自动推导。切换对已有会话立即生效，日志从不删除。
  注意 harness 的 `archived-session-gate` 会拒绝归档会话的下一步（轮次以 `blocked` 结束），所以隐藏状态下
  提问时先 `unarchiveSession`，本轮结束再归档回去。
- 上下文组装用 `agent.inject()`（next-step 队列，不唤醒）而不是直接 `session.append`：loop 只在开轮时追加
  `system/message`，直接 append 会让 digest 排在 system 之前。`claim('next-turn')` 先取整个 next-step 队列，
  再取一条 prompt，因此 surface 稳定为 `[system][digest][retrieval][question]`。
- live agent 走 LRU 保活（默认 3 个），其余 `dispose()` 只拆运行时，日志还在，下次提问 `resume`。

### 9.3 提示词骨架

**人设（system，静态）** —— 权威副本在 `cordis.patch.yml` 的 `dsh-persona.prefix`，与 `src/host/ai/persona.ts`
的 `PAPER_PERSONA` 逐字节相同（`test:chat` 断言）。

```
你是论文阅读器里的对话助手，陪读者一起读一篇论文。
回答规则：短（≤180 字）；只用对话里给出的论文资料；每个结论标「第 N 页」；
不复述问题；公式说明每个符号；用中文回答。
```

**导读**（一次性）

```
你在为一篇论文写导读。读者是研究者，不需要科普。
只输出 JSON：{ tldr, problem, method, findings[], limitations[], reusable[] }
tldr ≤ 60 字，说清"它做了什么、凭什么"。
findings 每条 ≤ 40 字，必须是论文自己的结论，不是你的评价。
reusable 写"读者可以拿走什么"（数据集/技巧/反例/假设）。
不知道的字段留空数组，不要编造。
```

**digest**（会话第一条 user 消息）

```
【论文】标题 【作者】… 【出处】年份 · 期刊
【一句话结论】tldr 【摘要】… 【问题】… 【方法】… 【发现】… 【局限】…
【页首骨架】第 1 页 · … 第 2 页 · …
【关键段落】第 N 页：…
以上是这篇论文的固定资料。之后我会就具体位置提问，请只依据论文内容回答。
```

**检索片段**（每轮追加）

```
与「<问题>」相关的原文片段：
【第 N 页】…
```

### 9.4 引用与防幻觉

- `done` 帧携带本轮检索命中的页码集合，UI 用作角标；回答里的页码必须来自这些块。
- 无检索结果时，提示「库里没有直接相关的段落」而不是自由发挥。
- 解释一轮把页码与选段同时写进 `source`，历史里能还原「这是对第 N 页某段的解释」。

### 9.5 失败与降级

- `agents` / `agentPresets` 缺失（别的 profile）→ 自动退回一次性 `llm.stream`（同一份 digest + 检索 + 人设），
  设置页标注「退化成一次性单轮问答」。
- preset 未注册（装了旧包）→ `mount` 失败 → 同样走降级，日志里留一条原因。
- `resume` 失败（日志丢失/版本不符）→ 用新 id 重建会话并写回 `library.json`，等于「对话已重置」。
- 流异常结束（没有 `committed` end 帧）→ SSE `error`，前端 `onError` 必解锁 `busy`；
  `askStream` 自身也补了「流结束但没有终帧」的兜底。
- 同一论文并发提问按论文串行排队；进程重启后是冷会话，首次提问时 `resume`。

### 9.6 翻译来源契约

来源是**运行期选择**，不是模型选择：`effectiveTranslationSource(config)` 在实验开关关闭时恒为 `dsh`。
`translationMode(settings)` 决定管线，代码不请求模型判断 block：

| 来源 | 引擎 | mode | billing | 全文 | 选段 |
|---|---|---|---|---|---|
| `dsh` | 宿主 `llm` / `summoner` | `llm` | `dsh` | JSONL + 术语表 + 前缀缓存 | 一次性提示词 |
| `api`（openai） | OpenAI 兼容 `/v1/chat/completions` | `llm` | `tokens` | 同上；结构化失败逐段回退 | 一次性提示词 |
| `local`（llm） | Ollama / LM Studio / llama.cpp | `llm` | `local` | 同上，并发 1 | 一次性提示词 |
| `api`（deepl/google/azure/libretranslate） | 专用翻译 REST | `mt` | `characters` | 批量纯文本→按下标映射 | 直接翻译 |
| `local`（libretranslate） | 本地 LibreTranslate / Argos | `mt` | `local` | 批量纯文本→按下标映射 | 直接翻译 |
| `browser` | Chrome/Edge `Translator` | `mt` | `free` | 页面内逐块，客户端驱动 | 页面内直接翻译 |
| `native` | 宿主 `ctx.translator`（Bing/Google） | `mt` | `free` | 宿主逐块，4000 字符上限 | 宿主直接翻译 |

MT 管线：`planDocument` 先做确定性跳过（参考文献/图表/公式/已中文），代码用 `protectMath` 把公式与引用
替换成 `⟦n⟧`，按 provider 的批量/字符上限发送，回包条数必须与请求一致，否则拆半重试；`restoreMath`
逐个 block 校验占位符，缺一个只重试该块。缓存仍按原文内容哈希，`entry.model` 记录引擎标签；切换来源
不自动重译。浏览器来源由页面拉 `/translation/document` 自行计算缺失块，逐页 `POST /translation/blocks`，
宿主在同一条 `commit()`/`finalizePage()` 路径里校验并落盘；Electron 窗口必须提前拒绝，避免 `Translator`
Promise 永不返回。API 密钥只存 `ctx.credentials`（`PAPERREADER_TRANSLATION_*`），设置接口只回
`configured`。用量页只统计 DSH 模型调用；本地模型与外部翻译 API 的 token/字符消耗以 provider 账单为准，
不进入 `ctx.tokenMeter` 账本。

---

## 10. 记忆与检索

### 10.1 检索流程

```
query
 → 分词（中英混合：中文 bigram + 英文词干）
 → BM25 top 30（仅在 chunks 上）
 → 过滤（状态/标签/年份，可选）
 → LLM 重排为 5 条，各带一句"为什么相关"
 → 返回 [{paperId, page, quote, reason, score}]
```

### 10.2 关联生成

三层，确定性层永远可用，模型层只补类型与理由：

```
① 画像（1 次/篇）   标题 + 摘要 + 导读 + 首页 ≤3k 字
   → PaperProfile { question / method / approach / claims / concepts / tasks / limitations / fingerprint }
   → contentHash 变化才重算

①② 确定性层（不花模型）
   引用解析   references[] 的 DOI → arXiv/PMID → 标题精确 → 标题模糊(0.9 Jaccard)
             命中即写 cites 边（conf 0.99/0.90/0.80）
   书目耦合   |R_A∩R_B| / sqrt(|R_A|·|R_B|)      共享参考文献越多越相关
   概念重叠   concepts 的**词元**向量余弦 + 短语精确命中加成（capped IDF，避免小库里共享词被压没）
   画像相似   question / method / approach / claims / fingerprint 的 TF-IDF 余弦
   文本相似   标题（双倍权重）+ 摘要 + 导读的 TF-IDF 余弦，去掉学术泛词
   fused = .20·ref + .30·concept + .25·claim + .25·lexical（可选 +.10 external，重归一）

③ 候选与判定
   候选：fused ≥ 0.08，且 ≥2 路信号 ≥ 0.06，每篇最多 6 个
   判定：一篇一次批调用 → {kind, direction, reason, evidenceA/B, confidence}
         kind ∈ cites / builds-on / same-method / same-problem / uses / contradicts / none
         理由必须点名方法/假设/结论，泛泛而谈会被拒并回退到信号生成的具体句
         最终 conf = 0.70·LLM + 0.30·fused；≥0.62 已确认，否则待确认

④ 落库与解释
   边写入 relations.json；判定按内容哈希缓存到 relations-meta.json
   用户忽略 → status:rejected，重建不再生成；用户接受/置顶 → 保留
   聚类：加权标签传播（无向、权重=confidence），单点归「未关联」；AI 一次调用给各簇命名
   个性化相关度：conf + 0.25·Adamic-Adar/最大 + 0.15·conceptSim
```

- 无模型：只跑 ②，页面显示「未配置模型：只显示引用与文本相似度」，不阻塞导入。
- 全量重建是显式动作（`POST /relations/rebuild`），复用任务队列与 SSE；重建会清掉不再被推导的 auto 边，
  保留用户边与忽略记录。单篇重建只重算该论文的出边与引用边，其余论文的边原样保留。
- 标题归一化相同的两条记录（同一篇论文重复入库）**不生成语义边**，只在节点上标「疑似重复」；
  图里也会过滤掉历史遗留的这类 auto 边。
- 旧数据（没有 `status`）按 `confirmed` 读入；对称关系（同方法/同问题/相反）按 id 排序去重。

### 10.3 演化方向（不在本期）

- embedding 检索：`ctx.llm` 暂不保证 embedding 能力；画像 + IDF 概念重叠是可解释的过渡，
  后续接向量库时只替换 `signals.ts` 的概念相似一项，不改上层。
- 主题页：按关联图的连通分量生成独立主题页。

---

## 11. 工程与接入

### 11.1 包结构

Host 与 Client 均为 TypeScript，数据契约集中在 `src/shared/`；构建产物只写 `dist/`，包入口指向 `dist/`。

```
PaperReader/
  package.json            # name: paperreader; main → dist/host/index.js; dsh.bundle + dsh.client
  cordis.patch.yml        # insert paperreader + translator + preset rows
  tsconfig.json           # 全仓 strict 类型检查（noEmit）
  tsconfig.build.json     # 只产 Host：src/host + src/shared → dist/
  src/shared/             # domain.ts（唯一数据源）、constants.ts、labels.ts、translation.ts（来源契约/默认值/生效来源）
  src/host/               # Host 半侧入口与分层
    index.ts              # Cordis 插件，挂 /api/paperreader/
    app.ts                # 组合根（store / indexer / jobs / retrieval / ask / translation engines）
    library/ store.ts     # 持久化
    library/ queries.ts   # 卡片、筛选、文件夹计数、详情视图
    ingest/ pipeline.ts   # 导入管线（解析、元数据补全、attach）
    ingest/ identifiers.ts# DOI / arXiv / PMID / URL 规范化
    ingest/ metadata.ts   # Crossref / OpenAlex / Europe PMC / arXiv / DataCite
    ingest/ link.ts       # 标识符/链接 → 元数据 + OA PDF，认证墙识别
    pdf/                  # extract / metadata / chunk
    search/               # bm25 / indexer / retrieval
    relations/            # keys / profile / signals / adjudicate / cluster / insight / service
    ai/                   # summoner / summarize / ask / translate
    ai/engines/           # dsh / openai 兼容 / deepl / google / azure / libretranslate / native / registry
    jobs/                 # job.ts（模型 + 自定义步骤）+ queue.ts（串行执行）
    http/                 # http.ts（响应原语）+ handler.ts + routes/*.ts
    util/                 # JSON 原子写、tokenizer 等
  src/client/             # 浏览器半侧
    index.tsx             # 注册槽位、主题订阅、样式注入
    app.tsx               # 外壳与页面状态机
    features/{recent,library,relations,reader,settings,import}/
    features/relations/   # RelationsPage / GraphCanvas / RelationList / Inspector / query / palette
    features/settings/    # SettingsPage / TranslationPanel / UsagePanel
    components/           # 图标、PageHead、NavItem、RichText
    lib/                  # api.ts、pdf.ts、format.ts、browser-translate.ts（Translator 页面运行器）
    theme/styles/         # 按功能拆分的样式模块，index.ts 汇总后一次注入
  build/
    package.json          # 只有 esbuild
    build.mjs             # 打包 → 包一层 __ModuleLoader__ 信封
  scripts/
    test-relations.mjs    # 引擎回归（标识符、引用、打分、判定、聚类、边台账）
    test-translation-sources.mjs # 翻译来源：OpenAI 兼容、MT 批量映射、浏览器提交、开关
    test-translation-routes.mjs  # 翻译设置路由：配置、密钥、模型探测、试译、提交、回退
    import-test-papers.mjs# arXiv 测试集导入（可重复执行，已存在则跳过）
    preview-relations.mjs # 静态预览 + headless 截图（亮/暗、图谱/列表）
  dist/
    host/                 # tsc 产物，与 src/host 同构
    client/client.js      # esbuild 产物
    vendor/pdf.worker.min.mjs
  DESIGN.md
```

### 11.2 槽位注册（已实现，勿改）

```ts
export const name = 'paper-reader'
export const inject = ['slots', 'theme']

ctx.slots.inject('main', () =>
  ctx.slots.register({ name: 'main', key: 'paperreader' }, () => <AppRoot ctx={ctx} />))

ctx.slots.inject('sidebar.panellist', () =>
  ctx.slots.register(
    { name: 'sidebar.panellist', id: 'paperreader', order: -1, label: () => '论文' },
    (owner = {}) => <PaperIcon size={owner.size ?? 18} />))
```

约束：
- 一个 `id` 同时是 `sidebar.panellist` 的 id 与 `main` 的 key，点图标即切面板。
- React 由宿主模块表提供，**不得打进包**；`react`、`react/jsx-runtime` 保持 external。
- 样式用 `<style id="paperreader-styles">` 注入一次，卸载时移除。

### 11.3 构建

```bash
pnpm run build             # tsc → dist/host；esbuild → dist/client/client.js + dist/vendor/
pnpm run typecheck         # strict，--noEmit
```

Host 用 `tsc` 逐文件产出 ESM（保留 `.js` 说明符，Node 直接加载）；Client 用 esbuild 打成 IIFE 并包 `__ModuleLoader__` 信封。pdf.js worker 从依赖复制到 `dist/vendor/`，由 Host 通过 `/api/paperreader/static/pdf.worker.min.mjs` 提供。KaTeX 的 CSS 与字体同样在构建时复制到 `dist/vendor/katex/`，CSS 里的字体 URL 改写为 `/api/paperreader/static/katex/fonts/…`，不依赖 CDN。

### 11.4 从原型到实现的最小改动

1. `mock.ts` 整体删除，改为 `api.ts`（`fetch` 封装）与 `types.ts`。
2. `Reader` 的纸面从「静态 HTML」换成「pdf.js canvas + text layer」，选区与坐标换算按 §6.2。
3. 高亮从 DOM `mark` 换成绝对定位覆盖层（页坐标矩形）。
4. 流式回答从本地 `setInterval` 换成 SSE。
5. 三态路由不变。

### 11.5 实现时的取舍（与本文的差异）

| 位置 | 本文 | 实现 | 原因 |
|---|---|---|---|
| §4.4 导入 | 对话框 → 队列浮层 | 同左；上传先落 `inbox/` 再入队 | 浏览器拿不到本地路径，落进监控文件夹后仍然是「引用原文件」 |
| §5.2 批注 | `annotations.json` + `notes.json` 两个实体 | 批注上的笔记直接存在 `Annotation.note`，同时进检索索引 | 一条批注只配一条笔记，分表反而要维护外键 |
| §7.2 批注路由 | `POST /annotations` 顶层 | 收在 `/papers/:id/annotations` | 少一层「paperId 放 body 还是路径」的分歧 |
| §8 管线失败 | 任一步失败 → 任务 failed | 解析 / 分块失败 → failed；导读 / 关联失败 → 记录 warning，任务仍 done，可重试 | 导读失败不该让已经能读的 PDF 变成失败任务 |
| §2.1 设置 | `settings.section` | 左侧导航「系统设置」整页 | 监控文件夹、模型路由、界面默认值、实验开关与维护按钮按分区组织，做成独立页更完整 |
| §6.3 索引 | `index/bm25.json` 快照 | 启动时从 `papers/*/chunks.json` 重建 | 少一份要和数据同步的持久化状态 |
| §6.1 归类 | `collections: string[]` | `folder: string \| null`（多级文件夹）+ 多标签 | 归类要确定，跨主题用标签表达 |
| §12 P3 | Agent 工具 | 未实现 | 需要 `ctx.tools.register` 与权限模型，单独一期 |

**路由前缀的边界（最重要的一条）**：`webServer` 的 prefix 匹配逻辑是

```js
if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
```

注册 `/api/paperreader/`（带尾斜杠）会让它去找 `/api/paperreader//config`，**永远不匹配**，整个插件对外表现为 404，且重启无效。正确做法是注册路径**不带尾斜杠**（`/api/paperreader`），拼 URL 时再用带斜杠的 base（`/api/paperreader/`）。自测 harness 现在复刻了这段匹配逻辑，不再直连 handler，避免同类问题再次被绕过。

**启动竞态**：Host 入口如果静态 import 2 MB 的 pdf.js，会把「注册路由」推迟 1–2 秒；这段时间里兜底处理器对 `/api/*` 回 404。Host 已改成**首次抽取时才动态 import**（入口加载 66 ms），客户端也对「**非 JSON** 的 404/503」按 250/500/1000 ms 重试三次——真正的业务 404 是 JSON，不会重试。

新增的能力（不在原文里，但被实际需求顶出来的）：

- **文本回退**：pdf.js 不可用或论文只有元数据时，阅读器用 `pages.json` 的块渲染成单栏纸面，仍可选段提问，只是不能高亮（没有页坐标）。
- **PDF 三级回退**：直连 worker → 同一文件转 blob worker → 主线程解析（`globalThis.pdfjsWorker`）；三级都失败才进文本视图，并给出原因与「重试预览」按钮。
- **读到哪记到哪**：`lastRead` 每次翻页写入，重开回到上次那页；工作区另外按标签记住滚动位置。
- **键盘**：← / → 翻页，Esc 收起工具条与气泡，Ctrl/⌘+F 聚焦搜索。
- **工作区标签（新增）**：顶栏固定「论文库」标签 + 每篇打开的论文一个标签；关闭标签只是关视图。
  实现上**只挂一个 Reader**，切换标签时用标签快照（页码/滚动/缩放/布局）重建，PDF 文档按
  `paperId|fileUrl` 做 LRU 4 的缓存，所以切回来不重新下载解析。没有把所有标签的 Reader 都隐藏挂着：
  N 份 window 键盘/选区监听、隐藏容器 `ResizeObserver` 宽 0 的几何问题、缩略图画布内存都会成倍增长。
- **对话流在工作区层（新增）**：`lib/chat-store.ts` 按论文持有会话投影与进行中的 SSE；切标签卸载 Reader
  不会中止 host 端的回答，切回来重新订阅同一段流。
- **左栏标题（新增）**：优先用 pdf.js `getOutline()` 的目录（按 dest 解析页码），没有书签时逐页取首行文字，
  两者都按需解析并缓存；文本回退模式只显示页码。

---

## 12. 分期与验收

### P0 原型（已完成）

- [x] 侧边栏入口 → 整页
- [x] 库/阅读/关联三态
- [x] 选段工具条、六色高亮、选段常驻
- [x] 边注气泡 + 副驾流式
- [x] 导入双入口对话框 + 队列抽屉
- [x] PDF / 文件夹批量导入、DOI / arXiv / PMID 标识符导入
- [x] 自动抓取标题、作者、期刊、年份、摘要与参考文献
- [x] 认证墙识别、仅元数据入库、上传 PDF 合并原记录
- [x] 缩放 60–200% + 适应宽度
- [x] 深色模式全链路

### P1 MVP（已完成）

- [x] 监控文件夹扫描 + 去重 + 库实时更新（路径 / 文件指纹 / DOI / arXiv 四路去重）
- [x] pdf.js 真实渲染（canvas + 文本层 + 缩放重绘）
- [x] 文本抽取与 PageText 缓存
- [x] 导入管线 ①–⑧（解析 + 元数据 + 摘要），进度 SSE
- [x] 选段解释/翻译（真实模型）、批注持久化
- [x] 副驾对话（含上下文组装与引用）

**验收**：
- 50 篇库首次加载 < 400ms；
- 单页渲染 < 120ms，翻页无白屏；
- 选中到工具条出现 < 50ms；
- 导入一篇 20 页论文端到端 < 60s；
- 关闭再打开，批注位置误差 < 2pt；并发写入不丢批注，主文件损坏时从 `.bak` 恢复。

> 实测（本机、21 页论文）：解析 0.9s、77 个检索块、端到端导入含 4 次模型调用约 35s；
> 翻页先画到离屏画布再整体替换（不闪白），缩放只变换图层、位图在手势停下后补一次。

### P2 记忆（已完成）

- [x] Chunk 索引与 BM25 检索
- [x] 关联生成 + 关系视图
- [x] 跨库提问（带出处跳转）
- [x] 批注 → 笔记 → 笔记可检索（批注上的笔记直接进 BM25）
- [x] 关联图谱：三层算法（引用 / 耦合 / 概念）+ AI 判定 + 反馈 + 聚类 + AI 综述

**验收**：
- 1000 篇库检索 < 200ms；
- 关联理由人工抽检 20 条，≥ 15 条成立；
- 12 篇真实测试库：Attention 的引用边召回 ≥ 3 条，跨域（NLP × 光电子）无置信度 > 0.6 的误报；
- 关联页首屏 < 150ms（12 篇），200 篇 < 400ms；图谱交互 ≥ 55fps；
- 全量重建 12 篇（含模型）< 90s，进度按步骤可见；无模型时只产出确定性边并在页面明示。

### P3 阅读工作区（已完成）

- [x] 顶栏：返回 · 标签栏 · 工具栏；「论文库」固定首标签
- [x] 标签即工作区：打开顺序、关闭、中键关闭、溢出滚动、刷新恢复、失效论文剔除
- [x] 每个标签记住页码 / 滚动 / 缩放 / 布局 / AI 页签；PDF 文档 LRU 缓存
- [x] 左栏预览图 ↔ 标题（PDF 书签优先，无书签回退页面首行）
- [x] 单面 / 双面 / 连续三种阅读模式；连续模式只渲染视口附近页面
- [x] 对话流提升到工作区，切换标签不中断回答

**验收**：
- 打开 3 篇：顶栏 3 个论文标签 + 论文库；来回切换位置/缩放/模式不丢；
- 关闭激活标签 → 相邻标签，全部关闭 → 论文库；
- 刷新页面恢复标签与阅读位置，回收站里的论文标签自动消失；
- 200 页文档连续滚动只挂载视口 ±1 页；三种模式下选区/高亮坐标一致。

### P4 扩展

- [ ] Agent 工具：`paper_search` / `paper_read` / `paper_note`
- [x] 自定义翻译来源（实验性）：DSH / 本地 / OpenAI 兼容 API / DeepL / Google / Azure / LibreTranslate / 浏览器内置 / 在线机器翻译
- [ ] 批量导入队列
- [ ] 引用导出（BibTeX）
- [ ] embedding 检索层
- [ ] 标签拖拽排序、Alt+1..9 切换

---

## 13. 明确不做的事

| 不做 | 原因 |
|---|---|
| PDF 重排 / HTML 化 | 与「保留原始排版」的核心承诺冲突 |
| 全屏力导向图 | 节点一多不可读；局部小图 + 列表更有效 |
| 通用聊天入口 | AI 必须绑定到论文/段落，否则退化为聊天窗 |
| 自动删除缺失文件 | 用户可能只是换了挂载盘，删除是破坏性操作 |
| 首版向量检索 | 当前环境无保证可用的 embedding provider，先 BM25 + LLM 重排 |
| 第二个侧边栏入口 | 一个入口 + 页面内三态，避免侧边栏膨胀 |

---

## 附：文案词表

| 场景 | 用词 | 不用 |
|---|---|---|
| 库 | 论文库 | 文献库、资料库 |
| 导读 | 导读、一句话结论 | 摘要（指原文 abstract 时才用） |
| AI | AI 副驾、边注 | 助手、机器人、Chat |
| 批注 | 高亮、批注、笔记 | 标注（作为动词可用，名词统一「批注」） |
| 关联 | 关联、相关文献 | 知识图谱 |
| 导入 | 导入、链接导入 | 上传、添加 |
