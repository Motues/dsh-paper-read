# 更新日志 · Changelog

本文件按版本倒序记录每次发布的内容。中文版在前，英文版紧随其后；本次发布没有内容的分区整块省略。

版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)，并与 `package.json` 的 `version` 一致；日期使用 `YYYY-MM-DD`。


## [0.1.0] - 2026-11-11

### 新增功能

- 首页外壳与多标签阅读工作区：最近阅读、文献库、关联、系统设置，刷新后恢复页码、滚动位置、缩放与页签。@Motues
- 论文导入：监控文件夹、拖入 PDF 或整个文件夹、粘贴 DOI / arXiv / PMID / PubMed 与出版社链接；按 DOI/arXiv 补全元数据，识别认证墙并支持后续补传 PDF。@Motues
- 文献库与归类：多级文件夹、多标签、作者 / 年份 / 期刊筛选，软删除回收站可逐篇还原或清空。@Motues
- 保真阅读器：pdf.js 单面 / 双面 / 连续三种模式，缩略图与书签目录，六色批注与笔记，文内查找，缩放锚定阅读位置，跟随宿主主题。@Motues
- 导读与边注助手：分节导读、选区解释 / 翻译 / 高亮，每篇论文一个独立的 DSH 会话，带上下文压缩、历史对话与模型切换。@Motues
- 关联图谱：引用匹配、AI 画像与成对判定，图谱 / 列表双视图，主题簇、最短路与待确认反馈。@Motues
- 全文翻译（实验性）：按页并发、断点续翻、内容哈希缓存，支持原文 / 左右对照 / 仅译文 / 重排与多种翻译来源。@Motues
- 检索与用量：BM25 检索正文、批注与笔记，token 用量账本与任务列表。@Motues

### 体验优化

- PDF 文档按 LRU 缓存，缩放时取消上一帧并按画布串行渲染；栏宽变化期间延后文本层重绘，翻页与缩放更顺滑。@Motues
- 对话请求前缀保持稳定以命中 provider 前缀缓存；关联重建复用任务队列与 SSE 进度。@Motues

### 其他变更

- 首个公开版本，采用 MIT 许可证；npm 包名与插件 id 均为 `dsh-paper-read`。@Motues
- 使用 pnpm 管理依赖，提供中英双语 README、doc/ 编号设计文档、贡献指南与更新日志。@Motues

### English

#### Added

- Home shell and multi-tab reading workspace: recent, library, relations and settings, restoring page, scroll position, zoom and tabs after a reload. @Motues
- Paper import: watched folders, dragging PDFs or whole folders, DOI / arXiv / PMID / PubMed and publisher links; metadata backfill by DOI/arXiv, auth-wall detection and later PDF upload. @Motues
- Library and organisation: nested folders, tags, author / year / venue filters, and a soft-delete trash with per-paper restore or empty. @Motues
- Faithful reader: pdf.js single, spread and continuous modes, thumbnails and bookmark outline, six highlight colours with notes, in-document search, zoom anchored to the reading position, and host theme following. @Motues
- Guide and margin assistant: sectioned digest, explain / translate / highlight on selection, and one DSH session per paper with compaction, history and model switching. @Motues
- Relation graph: citation matching, AI profiles and pairwise adjudication, graph and list views, topic clusters, shortest paths and pending-review feedback. @Motues
- Full-text translation (experimental): per-page streaming, resumable blocks, content-hash caching, original / side-by-side / translation-only / reflowed layouts, and multiple translation sources. @Motues
- Search and usage: BM25 over full text, annotations and notes, a token usage ledger and a task list. @Motues

#### Improved

- PDF documents are cached with an LRU; zoom cancels the previous frame and renders serially per canvas, and text-layer repaint is deferred while panes resize for smoother paging and zooming. @Motues
- Chat requests keep a stable prefix to hit the provider's prefix cache, and relation rebuilds reuse the job queue and SSE progress. @Motues

#### Other changes

- First public release under the MIT license; the npm package name and plugin id are both `dsh-paper-read`. @Motues
- Dependencies managed with pnpm; bilingual README, numbered design docs under doc/, contributing guide and changelog. @Motues

## 格式说明

条目格式：

- 每条形如 `- 一句话描述做了什么。@GitHub 用户名（可选的一句话补充）`。
- 修改者与括注都不是必填项；接手他人改动时补上 `@用户名`。
- 写「做了什么」而不是「改了哪个文件」；面向使用者的行为变化优先。

```markdown
## [版本号] - YYYY-MM-DD

### 新增功能

- 功能描述。@修改者

### 体验优化

- 体验改进。@修改者

### 问题修复

- 修复内容。@修改者

### 其他变更

- 文档、构建或依赖调整。@修改者

### English

#### Added

- Feature description. @author

#### Improved

- Experience improvement. @author

#### Fixed

- Bug fix. @author

#### Other changes

- Docs, build or dependency changes. @author
```

英文分区标题固定为 `Added` / `Improved` / `Fixed` / `Other changes`，与上面四类一一对应。
