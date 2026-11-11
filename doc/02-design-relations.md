# 关联页重做：设计方案（已确认，已实现）

> 本文是 `DESIGN.md` §4.3 / §10.2 的展开说明。
> **确认结论（2026-11-06）**：A1 图谱为主 + 列表切换；B2 引入 `d3-force` + `motion`；
> C1 导入与重建时自动跑 AI；D1 用 9 篇 arXiv 高效注意力/状态空间论文做测试集。
>
> 实现与本文的差异（以代码为准）：
> - 候选门槛从 0.25 下调到 **0.18**：概念/文本余弦天然偏小，0.25 在 12 篇的小库里连近邻都筛不进来（实测 0.222）。
> - 连通分量打包：孤立论文与断开的小分量放到画布底部的 pod 条，否则一个孤儿会把主簇压成缩略图。
> - OpenAlex `related_works` 外部信号预留但默认关闭（避免额外限流与不确定性），`signals.external` 字段已留。
> - 图谱布局先同步跑 300 tick 再冻结；点击只改变高亮（邻居与一跳边点亮，其余节点/边淡出），拖拽只移动节点本身，不再重热模拟，避免每次点击都把整图越推越开。
> - 关联综述按需生成并缓存，不在导入时批量花调用。
>
> 目标：**好看、好找、关联可信**。现有实现只满足「有」，不满足这三点。

---

## 1. 现状与问题

| 现状 | 问题 |
|---|---|
| 四块平铺：标签胶囊 / 最近关联 / 5 节点静态图 / 跨库检索 | 没有视觉重点，也没有「从一篇论文出发」的探索路径 |
| 图节点固定 5 个、坐标写死 | 数据一变就失真；不能拖、不能缩、不能筛选 |
| 边来自导入时一次 LLM 判定，候选只取标签 + BM25 | 候选质量差；引用关系从未真正匹配（`references.json` 存了但没用） |
| 检索是独立一块，和关联列表不联动 | 「方便查找」没做到：找论文、找关系、找片段是三套东西 |
| 边只有 4 种、理由一句话、无置信度展示 | 「相反」「基于」缺少证据，用户无法判断可信度 |

`DESIGN.md` 原写「明确不做全屏力导向图」。本期改为**可交互图谱 + 列表双视图**（已确认），
用筛选、聚焦与连通分量打包解决可读性。

---

## 2. 目标与范围

### 做

1. 以图谱为主视图的关联页：可拖拽 / 缩放 / 聚焦 / 路径查找 / 主题分簇。
2. 三层关联算法：**确定性证据**（引用、共引、书目耦合）→ **语义相似**（AI 论文画像 + IDF 概念重叠 + 词法）→ **AI 判定**（类型、方向、一句理由、证据、置信度）。
3. AI 生成两类关联文本：每篇的「论文画像」、焦点论文的「关联综述」；主题簇由 AI 命名。
4. 统一查找：即时过滤（标题/作者/标签/理由/主题簇）+ 语法前缀 + 回车跨库语义检索，全部键盘可达。
5. 用户反馈进算法：接受 / 忽略 / 置顶一条关联，忽略的 pair 重建时不再出现。
6. 真实论文测试数据，保留在库里。

### 不做

- 不做 embedding 向量库（`ctx.llm` 不保证 embedding 能力；用 AI 画像 + IDF 概念重叠替代，后续可平滑接入）。
- 不做 3D、不做时间轴动画、不做全库导出（导出可留接口）。
- 不改动阅读器主流程；只在阅读器「关联」页签加一个「在关系图中查看」。

---

## 3. 信息架构与交互

### 3.1 布局

```
┌ 关联图谱 · 12 篇 / 18 条关联 / 待确认 4           [重建关联]   ┐
│ [⌘K 搜索论文、作者、标签、理由…        ] [全部▾] [关系▾] [图谱|列表] │
├───────────────────────────────────────────────┬──────────────────┤
│                                               │  焦点 / 概览       │
│         ○──────○                              │  ┌──────────────┐ │
│        ╱ ╲    ╱                               │  │ 论文卡 + 摘要  │ │
│   ○───○   ○──○        （可拖 / 滚轮缩放 / 平移） │  ├──────────────┤ │
│        ╲ ╱                                    │  │ AI 关联综述    │ │
│         ○                                     │  ├──────────────┤ │
│                                               │  │ 关联 N 条      │ │
│  [＋][－][适应][标签][箭头]                     │  │ 待确认 K 条    │ │
├───────────────────────────────────────────────┤  │ 跨库命中片段    │ │
│ ● 线性注意力 6   ● 状态空间 3   ● 光电子 2   ● 孤立 3 │  └──────────────┘ │
└───────────────────────────────────────────────┴──────────────────┘
```

- 内容区两栏：图谱 `flex:1` + 检查器 `344px`；`< 1100px` 检查器收成抽屉，`< 900px` 默认列表视图。
- 底部主题簇条常驻：颜色点 + AI 簇名 + 计数，点击隔离该簇。
- 顶部统计可点：论文 / 关联 / 待确认 / 孤立 / 覆盖率，点击即筛选。

### 3.2 图谱交互

| 操作 | 结果 |
|---|---|
| 拖节点 | 只移动该节点本身，不重排邻居、不重热模拟，松手即停 |
| 滚轮 | 以指针为中心缩放 0.35×–3×；拖空白平移 |
| 单击节点 | 选中 → 右侧检查器换成该论文；邻居与关联边高亮，其余节点淡出到 14%、边淡出到 6%，邻居标题常显 |
| 双击节点 | 打开阅读器 |
| 悬停节点 | 浮层：标题 / 年份 / 度数 / 簇 / 前 2 条理由；相邻边加粗 |
| 选中 A 后悬停 B | 高亮 A→B 最短路，顶部出现「2 跳 · A → C → B」可点 |
| 右键节点 | 菜单：只看它 / 从此开始查找路径 / 在文献库中打开 |
| 空白单击 | 取消选中，回到「全库概览」 |
| 键盘 | `Tab` 焦点环，`↑↓` 在邻居列表移动，`Enter` 打开，`Esc` 清除 |

- 节点大小 = 加权度（`sqrt` 归一），颜色 = 主题簇，空心 = 无 PDF / 缺失。
- 边：颜色区分关系类型，虚线 = 推断（置信度 < 0.62），箭头只给有方向的类型（引用 / 应用 / 基于）。
- 超过 200 节点时默认只渲染「聚集 + 焦点 2 跳」，并提示「已按相关度折叠」；筛选或搜索自动展开。

### 3.3 查找（「方便查找」的核心）

1. **即时过滤**：输入即筛（不请求），命中节点/边/理由，图谱里非命中淡出，列表里只剩命中；匹配片段用 accent 高亮。
2. **语法前缀**：`tag:光学`、`author:Wang`、`year:>2023`、`kind:builds-on`、`cluster:线性注意力`、`is:isolated`、`is:pending`；输入 `?` 弹出速查卡。
3. **回车语义检索**：走现有 `/search`（BM25 + LLM 重排），结果显示在检查器「命中片段」区，键盘 `↑↓` 选择、`Enter` 跳阅读器对应页。
4. **快捷动作**：`⌘K` 聚焦搜索；`/` 同；`G` / `L` 切图谱/列表；`R` 只在按钮聚焦时重建，避免误触。
5. **空结果**：给出「放宽筛选」与「重建关联」两个出口，并列出最接近的 3 篇。

### 3.4 检查器的两种状态

- **全库概览**（默认）：最高置信的 4 对关联、待确认列表、主题簇、孤立论文、跨库命中片段。
- **焦点论文**：论文卡（标题、作者、年份、标签、TLDR）→ **AI 关联综述**（2–3 句，说明它在库里的位置、与谁同源、与谁互补）→ 关联列表（按相关度，含理由、证据 chip、置信度细条、打开/忽略）→ 待确认 → 相关片段。

列表项示意：

```
[同方法]  Mamba: Linear-Time Sequence Modeling…            2023
         与 S4 同样是状态空间路线，但把参数做成输入相关。
         ● 共享概念 3  ● 共同引用 2  ● 相似度 0.71        ▁▁▁▁▁▁▁▂▃  0.83
```

### 3.5 列表视图

- 两段：左「论文」卡片网格，右「关系」分组（按类型分组、组内按相关度），点卡片即聚焦。
- 关系行支持就地「接受/忽略」，操作后乐观更新并回写。
- 列表与图谱共享同一份筛选状态，切换不丢上下文。

---

## 4. 视觉与动效

- **背景**：图区一层极淡的 accent 径向星云（6% → 透明）+ 12% 点阵网格；暗色自动减半，不铺满整页，避免喧宾夺主。
- **节点**：簇色实心 + 1px 高光内描边 + 选中时 accent 光环；标签在节点下方 9px，`paint-order: stroke` 保证压在边上也可读。
- **边**：默认 1px、55% 透明度；悬停/路径 2px 并加流动虚线（`stroke-dashoffset` 动画），方向语义用箭头。
- **卡片**：12px 圆角、1px `--pr-line`、hover 上移 1px + 柔和阴影；数字用 `tabular-nums`。
- **动效**：页面分节淡入上移（stagger 40ms）；图谱入场节点缩放 + 边 draw-in（600ms）；检查器切换 160ms 交叉淡入；统计数字 400ms 计数；筛选结果做 FLIP 位移。
- **降低动态**：`prefers-reduced-motion: reduce` 时关闭入场/流动/计数，只保留 100ms 透明度。
- **可访问性**：类型不只靠颜色（虚线/箭头/文本标签）；焦点环用 accent；所有按钮 `aria-label`；图谱提供 `<title>` 与列表等价视图。
- **配色**：全部走现有令牌；簇色在 `.pr-root[data-scheme=light|dark]` 各定义 6 个，避免暗色下过饱和。
- **依赖**：不新增运行时依赖，力导向、缩放、FLIP 全部自研（约 300 行）；动画用 CSS + rAF。

---

## 5. 关联算法

### 5.1 调研结论（用到的东西）

| 方法 | 用在哪 | 依据 |
|---|---|---|
| 书目耦合 Bibliographic coupling | 两篇共享参考文献 → 无向相关 | Kessler 1963，至今仍是引文推荐的基线 |
| 共被引 Co-citation | 同被库内第三篇引用 → 弱相关 | Small 1973 |
| IDF 加权概念重叠 | 替代 embedding 的语义相似 | 稀疏、可解释、无需模型服务 |
| RRF / 加权融合 | 多路信号合成一个分数 | Cormack et al. 2009；比分数直接相加更稳 |
| LLM 成对判定 + 结构化理由 | 关系类型、方向、证据、置信度 | 与现有 `judgeRelations` 同路线，补上证据与反馈 |
| 标签传播（加权） | 主题簇 | Raghavan et al. 2007；200 节点内比 Louvain 足够 |
| SPECTER2 类论文向量 | **本期不做**，留接口 | 需要 embedding 服务；画像 + 概念重叠是可解释的过渡 |

### 5.2 分层流程

```
导入 / 重建
 ① 画像：AI 读标题+摘要+导读+首页片段 → PaperProfile（问题/方法族/结论/概念/任务/局限）
 ② 引用解析：references[] 的 DOI/arXiv/PMID/标题 → 库内命中 = cites 边（确定性）
 ③ 候选：逐对算 4 路信号 → 归一 → 加权 → 每篇取 top 6（阈值 0.09）
 ④ AI 判定：一篇一次调用，判类型 + 方向 + 理由 + 证据 + 置信度；`none` 丢弃
 ⑤ 落库：边 + signals/evidence/status/model；用户忽略的 pair 写黑名单
 ⑥ 聚类：加权标签传播 → 簇；AI 一次性给簇命名
```

### 5.3 信号与打分

对论文 A、B（`N` = 活跃论文数）：

```
ref      = |R_A ∩ R_B| / sqrt(|R_A|·|R_B|)         书目耦合（引用键归一化）
concept  = 0.7 · cos(概念词元向量) + 0.3 · 精确短语重合   词元级匹配 + capped IDF
claim    = cos(question+method+approach+claims+fingerprint 的 TF-IDF)   画像文本相似
lexical  = cos(标题×2 + 摘要 + 导读 的 TF-IDF)              去掉学术泛词
external = OpenAlex related_works 交集（可选，默认关，结果缓存 30 天）

fused = .20·ref + .30·concept + .25·claim + .25·lexical  (+ .10·external，开启时重归一)
```

- **为什么不是 BM25 的 IDF**：BM25 的 idf 会把「两篇论文共享的常见词」压到接近 0（12 篇的小库里几乎必然发生），
  而共享词正是这里要的信号。概念与文本一律用 `1 + 0.45·ln(1+N/df)` 的 capped IDF。
- **为什么概念按词元比**：模型两次生成的措辞几乎不会逐字相同（"自注意力" vs "self-attention（自注意力）"），
  按短语精确比会全成 0；改成词元向量 + 短语命中加成后，真实的同族论文才进得来。
- **profile 提示词要求英文规范术语**：`method` 用 4 词内的英文方法族，`concepts` 用英文术语（可括注中文），
  跨语言、跨模型生成的画像才有可比的词表。提示词版本写进 contentHash，改版即自动重算。
- **画像失败不再丢论文**：模型连续三次不可用时退化为标题/摘要词表画像（`model: 'fallback'`），
  并在下次重建时自动重试模型；实测 S4 用 fallback 画像仍能与 Mamba 进入候选（fused 0.087）。
- 候选门槛：`fused ≥ 0.08` 且至少两路信号 ≥ 0.06；每篇最多 6 个候选，按 fused 降序。
- 引用边不参与 fused 排序，直接入库（conf 0.99 / 0.90 / 0.80，按 DOI / 标题精确 / 标题模糊）。

### 5.4 AI 判定

- 输入：新论文画像 + 候选的「画像摘要 + 标签 + 共同引用」，一次 ≤ 8 对。
- 输出 JSON：`{index, kind, direction, reason, evidenceA, evidenceB, confidence}`。
- 类型与判据（写进 system prompt，含反例）：

| kind | 判据 | 方向 |
|---|---|---|
| `cites` | 明确引用（确定性层已覆盖，模型只补漏） | A→B |
| `builds-on` | 同一问题，A 直接改进/替换 B 的方法 | A→B |
| `uses` | A 借用 B 的方法/数据去解决别的问题 | A→B |
| `same-method` | 同一方法族，独立工作 | 无 |
| `same-problem` | 同一问题，不同路线 | 无 |
| `contradicts` | 结论或假设冲突 | 无 |
| `none` | 只是主题词相同 | — |

- 理由必须点名「方法/假设/结论」，禁写「主题相关」「都属于」。`confidence < 0.45` 丢弃。
- 最终 `confidence = 0.70·LLM + 0.30·fused`；`≥ 0.62` 记为「已确认」，否则进「待确认」。
  （确定性 fused 负责召回，类型与证据由模型给出；因此模型判断占七成，实测 Mamba→S4 的 builds-on 落在 0.69。）
- 缓存：按 `(from,to,contentHash)` 存判定结果，内容没变不重复调用。

### 5.5 主题簇与解释

- 加权标签传播：无向投影，权重 = confidence；按度降序确定性初始化，最多 20 轮，平票按 id。单点簇归入「未关联」。
- 簇名：一次调用让模型从各簇的高 idf 概念里起名（≤ 8 个字）；失败则用「概念 A · 概念 B」。
- **个性化相关度**（检查器的排序与「发现」）：

```
r(A,X) = conf(A,X) + 0.25·AdamicAdar(A,X)/maxAA + 0.15·conceptSim(A,X)
```

- 解释 chip 由信号直接生成：「共同引用 3 篇」「共享概念：线性注意力、长上下文」「2 篇共同邻居」——不额外花模型调用。

### 5.6 反馈与增量

- `POST /relations/feedback`：`accept` / `reject` / `pin` / `delete`。
- 忽略的 pair 留在 `relations.json`（`status:'rejected'`），默认不显示；重建跳过。
- 导入新论文只算「新论文 × 全库」的候选与判定，不全量重算；全量重建是显式动作。
- 重建时：重新生成画像（内容哈希变了才调模型）、重算信号、保留 `origin:'user'` 的边；旧 auto 边若不再被推导则删除。

---

## 6. 数据契约与接口

### 6.1 新增/扩展类型（`src/shared/domain.ts`）

```ts
export type EdgeKind = 'cites' | 'builds-on' | 'same-method' | 'same-problem' | 'uses' | 'contradicts'
export type EdgeStatus = 'confirmed' | 'suggested' | 'rejected'

export interface RelationSignals { ref?: number; concept?: number; claim?: number; lexical?: number; external?: number }
export interface RelationEvidence { sharedConcepts?: string[]; sharedRefs?: string[]; refIndex?: number }

export interface RelationEdge {
  from: string; to: string; kind: EdgeKind; reason: string
  origin: 'auto' | 'user'; confidence: number
  status?: EdgeStatus            // 缺省视为 confirmed（旧数据）
  signals?: RelationSignals
  evidence?: RelationEvidence
  model?: string; at?: string
}

export interface PaperProfile {
  paperId: string
  question: string; method: string; approach: string
  claims: string[]; concepts: string[]; tasks: string[]
  limitations: string[]; fingerprint: string
  contentHash: string; model: string; createdAt: string
}

export interface RelationGraphNode {
  id: string; title: string; year?: number; venue?: string; tldr?: string
  tags: string[]; cluster: string; degree: number; weight: number
  isolated: boolean; missing?: boolean; hasProfile: boolean
}
export interface RelationGraphEdge {
  id: string; from: string; to: string; kind: EdgeKind; reason: string
  confidence: number; status: EdgeStatus; direction?: 'a2b' | 'b2a'
  signals?: RelationSignals; evidence?: RelationEvidence; origin: 'auto' | 'user'
}
export interface RelationCluster { id: string; label: string; paperIds: string[]; color: number; aiNamed: boolean }
export interface RelationGraph {
  generatedAt: string; nodes: RelationGraphNode[]; edges: RelationGraphEdge[]
  clusters: RelationCluster[]
  stats: { papers: number; edges: number; confirmed: number; suggested: number; isolated: number; coverage: number }
}
export interface RelationInsight { paperId: string; text: string; bullets: string[]; model: string; createdAt: string; stale: boolean }
```

### 6.2 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/relations/graph` | 图谱数据；可选 `focus`、`depth=1|2`、`limit`（>200 篇时折叠） |
| GET | `/relations/insights/:paperId` | 缓存的 AI 关联综述；`?refresh=1` 重生成 |
| POST | `/relations/rebuild` | 入队重建任务 `{scope?: 'all' | paperId}` → `{ jobId }` |
| POST | `/relations/feedback` | `{from,to,kind,action}` → 更新后的边 |
| GET | `/relations/paper/:id` | 保留旧单篇视图（阅读器页签用） |
| POST | `/relations/remove` | 兼容旧调用，等价于 `delete` |
| GET | `/relations/export` | 可选：`json` / `csv` / `graphml` |

- 重建复用 `jobs` 基础设施：新增 job kind `relations`，步骤 `画像 → 引用 → 候选 → AI 判定 → 聚类`，进度走现有 SSE。
- 客户端兼容：`/relations/graph` 404（宿主未重启）时，从 `/papers` + `/relations` 在前端拼一个退化图，AI 功能显示「宿主更新后可用」。

### 6.3 落盘

```
$DSH_HOME/paperreader/
  relations.json                   # 边（新增 status/signals/evidence/model/at）
  relations-meta.json              # 上次重建时间、簇命名缓存、黑名单
  papers/<id>/profile.json         # PaperProfile
  papers/<id>/rel-insight.json     # RelationInsight
```

---

## 7. AI 生成什么、花多少

| 生成物 | 触发 | 输入 | 规模 |
|---|---|---|---|
| 论文画像 | 导入 / 重建（内容哈希变化） | 标题 + 摘要 + 导读 + 首页 ≤3k 字 | 1 次/篇，~1.2k tokens |
| 关联判定 | 导入 / 重建 | 本文画像 + 最多 8 个候选画像摘要 | 1 次/篇，~1.5k tokens |
| 关联综述 | 首次点开焦点论文（缓存） | 该论文画像 + 邻居边理由 | 1 次/篇，按需 |
| 簇命名 | 重建结束时一次 | 各簇 top 概念 | 1 次/库 |

12 篇全量重建 ≈ 25 次调用；单篇导入 ≈ 2 次。无模型时：确定性层（引用 + 耦合 + 词法）照常出图，只缺 AI 类型/理由/综述，UI 明示「未配置模型」。

---

## 8. 性能与降级

- 200 篇以内：候选 O(N²) 在 40k 对以内，Node 端 < 100ms；BM25/画像都在内存。
- 图谱渲染：一次 React 渲染节点，tick 用 ref 直接改 `transform`，不触发 re-render；60fps 目标。
- 降级顺序：无模型 → 确定性边 + 标签；无 `/graph`（旧宿主）→ 前端退化图；PDF 缺失 → 空心节点，不影响关系。
- 重建串行（与导入共用队列），避免模型并发打满。

---

## 9. 测试

### 9.1 自动化

- 新增 `scripts/test-relations.mjs`：构造 4 篇夹具（共享引用 / 共享概念 / 无关），断言引用解析（DOI / 标题 / 模糊）、耦合与概念打分顺序、候选截断、`none` 丢弃、反馈黑名单、聚类结果、旧边迁移、`/graph` 形状。
- 更新 `scripts/smoke-render.mjs`：新页面骨架、图谱节点数、筛选即时性、焦点切换、列表视图、接受/忽略请求、空态与无模型提示。
- `pnpm test` 串上 `test:relations`。
- 保留现有渲染/阅读器/API 测试全绿。

### 9.2 真实论文（保留，不删除）

导入以下 9 篇 arXiv OA 论文（已验证可下载），与现有 3 篇组成 12 篇：

| # | arXiv | 期望关系 |
|---|---|---|
| 1 | 1706.03762 Attention Is All You Need | 被后 8 篇引用 |
| 2 | 2006.04768 Linformer | 同方法 / 引用 #1 |
| 3 | 2009.14794 Performer | 同方法 / 引用 #1 |
| 4 | 2004.05150 Longformer | 同问题 / 引用 #1 |
| 5 | 2205.14135 FlashAttention | 同问题 / 引用 #1 |
| 6 | 2307.08621 RetNet | 同方法 / 引用 #1 |
| 7 | 2305.13048 RWKV | 同方法 / 引用 #1 |
| 8 | 2111.00396 S4 | 引用 #1 |
| 9 | 2312.00752 Mamba | 基于 #8 / 引用 #1、#8 |

> 首次整理时 `2307.09288`（Llama 2）与 `2110.09813`（Physics-Informed Loss Balancing）被误当成 RetNet / S4，
> 已从库中彻底删除并用上表 ID 重新导入；`scripts/import-test-papers.mjs` 已改正，重复执行会跳过已存在的标题。

- 断言：至少 3 条 `cites` 命中 #1；Mamba→S4 出现 `builds-on`；线性注意力几篇之间至少 2 条 `same-method`。
- 离线实跑（无模型、库的副本）：解析出 **7 条引用边**，其中 4 条指向 Attention；跨域 3 篇没有误报；
  剩余 7 篇因 PDF 未抽到参考文献而孤立（等模型层补判定），符合降级预期。
- 新 Host 在真实库副本上（stub 模型）跑通全量重建与单篇重建：12 篇画像 → 7 条引用 → 31 对候选 →
  27 条判定 → 34 条边，任务五步全部 done；单篇重建后边数 34→35，未涉及该论文的边一条没丢。
  （stub 的画像对每篇都一样，所以跨域边是假模型产物，只验证机制，不代表真实判定质量。）
- 重复记录（两条同标题的嗅觉芯片）不生成语义边，只标「疑似重复」；历史 auto 边也会被图过滤。
- **线上实跑（12 篇，真实模型，最终版）**：
  - 画像 12/12（S4、Longformer、FlashAttention 等原先 fallback 的 4 篇在重试后全部补成模型画像）
  - 7 条引用 → 25 对候选 → 4 条 AI 判定（`0.70·LLM + 0.30·fused`）
  - `Mamba --builds-on--> S4` 置信度 **0.678 已确认**，理由：“Mamba 将 S4 的时不变 SSM 参数改为输入相关，直接扩展其方法”
  - 另 3 条待确认：Mamba↔RetNet、RWKV↔Mamba（同问题），RWKV↔RetNet（同方法），理由均点名具体路线
  - AI 簇名：**长序列线性注意力**（5 篇）、**无注意力循环序列**（3 篇）、未关联（4 篇）
  - 跨域零边；两条同名嗅觉记录不产生语义边，只显示「疑似重复」
  - `GET /relations/insights/:id` 返回 2–4 句的具体综述（Mamba 一条准确点出“延续 S4 / 与 RetNet、RWKV 并行”）
- 自动化：`pnpm test` 全绿（含 `test:relations` 的引用匹配、打分、判定、单篇重建、HTTP 路由、反馈与图谱断言）。
- 第一次线上重建暴露的问题（已修）：概念只做字面匹配 + 阈值 0.18，真实画像里 4 路信号最高只有 0.2 左右，
  结果 0 个候选；同时 12 次画像调用在第 6 次后被 provider 限流，6 篇没有画像。
  现在改为词元级概念、capped IDF、画像相似加权，阈值 0.09，并在画像调用间加 350ms 间隔、失败重试 3 次、
  连续失败退化为标题词表画像。
- 精度检查：现有 3 篇（嗅觉芯片、TFLN 综述、补充材料）不与 NLP 簇产生置信度 > 0.6 的边；重复标题（两篇同名）提示「疑似重复」。
- 记录重建耗时、边数、理由抽检 10 条。

### 9.3 视觉验证

- 新增 `scripts/preview-relations.mjs`：用夹具数据把页面打包成静态预览（含亮/暗两套），headless Edge 截图到 `.tmp/preview/`。
- 交付时附截图，供确认视觉；同时给一份「宿主重启后核对清单」。

---

## 10. 阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | 类型/存储迁移、引用解析、打分、图谱接口、页面骨架 + 图谱/列表 + 搜索 | `pnpm test` 绿；12 节点可拖拽/缩放；筛选 < 16ms |
| P1 | AI 画像、判定、反馈、重建任务、关联综述、簇命名 | 重建 12 篇 < 90s；每条边有具体理由 |
| P2 | 动效打磨、空态、预览截图、真实论文测试与记录 | 截图确认；地面真值断言通过 |

整体验收：
- 首屏 < 150ms（12 篇），200 篇首屏 < 400ms；
- 图谱交互稳定 55fps+；
- 引用召回 ≥ 80%（地面真值），跨域误报 0（>0.6）；
- 旧测试全绿，阅读器关联页签不受影响。

---

## 11. 已确认的选择

1. **A1 图谱为主 + 列表切换**：可交互力导向图居左，右侧检查器；列表是第二视图。
2. **B2 `d3-force` + `motion`**：物理用 d3-force，列表布局与页面分节用 motion；其余动画仍走 CSS/rAF。
3. **C1 AI 自动跑**：导入时生成画像并判定新论文的候选；全库重建只由「重建关联」触发。
4. **D1 9 篇 arXiv**：见 §9.2 的表；测试论文保留。

另：Host 改动需要重启 DSH 才生效；Client 改完刷新页面即可。测试论文已导入 `$DSH_HOME/paperreader/`，
重启后点一次「重建关联」即可生成画像、AI 判定与主题簇。

---

## 12. 2026-11 增补：引用补录、焦点排序与年份视图（已实现）

对照 Connected Papers 的调研补的几件事，全部不新增运行时依赖。

### 12.1 引用补录（`src/host/pdf/references.ts`）

- **问题**：12 篇测试论文里 7 篇孤立，因为 PDF 没抽到参考文献、元数据源也没给出。实测 OpenAlex 对
  `10.48550/arXiv.2312.00752` 返回 0 条 references，Semantic Scholar 被 429，外部回填这条路走不通。
- **做法**：从已解析的正文里抓「References / 参考文献」之后出现的**显式标识符**（arXiv 号、DOI），
  每条带一段可读的 raw 摘要。只认标识符，不做标题猜测——匹配失败就是没匹配上，不会制造假引用。
- **接入**：`service.ensureReferences()`，参考文献为空的论文在 `analyzePaper` / `rebuild` 时自动补录并落盘，
  重建的 citations 步骤显示「PDF 补 N 篇参考文献」。已有 provider 参考文献的论文不覆盖。
- **实测**（真实库副本，无模型）：引用边 7 → 14，孤立 7 → 3。

### 12.2 信号缺失不按 0 计（`signals.ts`）

`PairSignals` 增加 `available` 四位；融合只在双方都可算的信号上取加权平均，缺失信号的权重被重新分配。
`signalsRecord` 不再把缺失写成 0（`RelationSignals` 字段本来就是可选的）。
候选门槛改为「可用信号里至少两路 ≥0.06；只有一路可用时，一路即可」。

### 12.3 焦点排序与来路/去向（客户端）

`client/features/relations/relevance.ts`：

```
r(A,X) = conf(A,X) + 0.25 · AdamicAdar(A,X)/max + 0.15 · concept(A,X)
prior(X)      = 焦点与邻居共同引用的论文（按被引次数）
derivative(X) = 库内引用焦点的论文（只算直接引用，避免把同辈当成后续）
```

- 「最相关 5 篇」显示相对值（该组最强 = 100），不冒充概率。
- 关联列表在同一状态内按 `r` 排序，状态（已确认/待确认）优先。
- 全部在浏览器里算，选一篇论文不产生请求。

### 12.4 折叠可见化与「焦点 2 跳」

- `RelationGraph.stats.hidden` 记录被 `limit` 截断的篇数；header 变成「显示 X / 全库 Y · 折叠 N 篇」。
- 顶部新增「焦点 2 跳」开关，选中论文后按 `{focus, depth: 2}` 取子图；关闭时回到全库。
- 静默刷新（重建完成、反馈回写）沿用当前焦点，不会把子图刷回全库。

### 12.5 年份视图与证据强度

- 图谱 HUD 的「年」在簇色与年份色之间切换，右下角色带给出年份区间；`--pr-y1..5` 在亮/暗各一套。
- `ConfidenceBar` 的 tooltip 明确写成「证据强度 = 0.7×模型判断 + 0.3×信号分，不是概率」。

### 12.6 未做

- 库外幽灵节点（OpenAlex `related_works` / 被引）：数据源在本机限流，等能稳定访问再做。
- 多原点、BibTeX/GraphML 导出、信号解释卡：仍是 P2。

---

## 13. 2026-11 增补：关联页使用指南（已实现）

首次进入关联页会弹出一次指南；之后从页头「指南」按钮或按 `?` 随时打开。

### 13.1 行为

| 场景 | 行为 |
|---|---|
| 从未看过（无 localStorage 键） | 进入页面自动打开 |
| 关闭指南 | 写入偏好 `off`，以后不再自动打开 |
| 勾选「以后进入关联页时自动打开」 | 写入 `on`，每次进入都打开 |
| 点页头「指南」/ 按 `?` | 任何时候手动打开（与偏好无关） |
| 按 Esc / 点遮罩 / 右上角 × | 关闭；Esc 在捕获阶段处理，不会顺带清掉图谱选中 |

偏好键：`paperreader.relations.guide`（`on` / `off`），只存在本浏览器，不进文献库；
存储不可用时按 `off` 处理，指南本身照常可用（`client/features/relations/guide.ts`）。

### 13.2 内容结构

六张卡片，回答"这张图怎么读"而不是"有哪些按钮"：

1. 读这张图 —— 距离=关联强度、实线/虚线/空心、箭头方向、底部孤立节点；
2. 从一篇论文出发 —— 单击焦点面板（AI 综述 / 最相关 / 来路与去向）、双击进阅读器、最短路径；
3. 找得到、缩得小 —— 前缀语法、回车跨库检索、chips 叠加、焦点 2 跳；
4. 手势与快捷键 —— 拖拽缩放平移、HUD、`⌘K` `G` `L` `Esc`、年份着色；
5. 让关系变准 —— 重建五步、接受/忽略、增量导入；
6. 没有模型 / 常见疑问 —— 降级表现、为什么没边、证据强度不是概率。

### 13.3 测试与截图

- `scripts/smoke-render.mjs`：首次进入自动打开 → 关闭 → 页头按钮重新打开 → 关闭；
- `scripts/preview-relations.mjs` 新增 `guide-light` / `guide-dark` 两张截图（其余截图会把偏好预置为 `off`，
  否则每张都是弹窗）。
