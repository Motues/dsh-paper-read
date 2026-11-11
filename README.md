# PaperReader

**中文** | [English](./README.en.md)

论文管理与阅读插件，为 DeepSeek Harness Web UI 提供常驻论文库、保真阅读器与跨论文记忆检索。数据存放在 `$DSH_HOME/paperreader/`，PDF 用 pdf.js 按原始排版渲染；每篇论文的对话都是一个真正的 DSH 会话（`pr-<paperId>`），自带压缩与持久日志。

## 特性

- **论文库**：监控文件夹、DOI / arXiv / PMID / 链接导入，多级文件夹与标签，按作者 / 年份 / 期刊筛选，回收站软删除。
- **保真阅读器**：单面 / 双面 / 连续三种模式，缩略图与书签目录，六色批注与笔记，文内查找，跟随宿主主题。
- **导读与对话**：分节导读、边注式解释与追问；每篇论文一个 DSH 会话，切标签不中断流式回答。
- **关联图谱**：引用匹配 + AI 画像 + 成对判定，图谱 / 列表双视图，主题簇、最短路径与待确认反馈。
- **全文翻译（实验性）**：按页并发、断点续翻、内容哈希缓存，支持原文 / 左右对照 / 仅译文 / 重排。
- **检索与用量**：BM25 检索正文、批注与笔记；token 用量账本与任务列表。

没有可用模型时仍可导入、阅读、批注与检索，只是不生成导读与回答。

## 环境要求

- Node.js >= 20
- pnpm（版本以 `package.json` 的 `packageManager` 为准）
- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`

## 安装

```bash
pnpm install
pnpm run build
```

在 DSH 的插件管理中安装本目录或 npm 包 `dsh-paper-read`（`plugin_manager install_bundle`，装入 `desktop` profile），刷新 Web 页面后侧边栏出现「论文」入口。

- Host 改动（路由、数据层）需要重启 DSH 才会加载；Client 改动刷新页面即可。
- `cordis.patch.yml` 会同时挂载论文会话使用的 `paper-reader` Agent preset（人设 + 独立压缩，无工具）；换版本后需重启或重新启用插件。

## 开发

```bash
pnpm run typecheck   # strict 类型检查
pnpm test            # typecheck + build + 全部冒烟 / 回归测试
pnpm run build       # tsc → dist/host，esbuild → dist/client，并复制 pdf.js worker
```

不经 DSH 的本地 Host：`node scripts/harness.mjs 4794`。更多测试与预览脚本见[贡献指南](./CONTRIBUTING.md)。

## 文档

- [文档索引](./doc/README.md)
- [01 · 设计稿](./doc/01-design.md)
- [02 · 关联页设计与算法](./doc/02-design-relations.md)
- [更新日志](./CHANGELOG.md) · [贡献指南](./CONTRIBUTING.md)

## 许可证

MIT © 2026 Motues
