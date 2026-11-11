# 贡献指南 · Contributing

感谢你愿意改进 PaperReader。本文面向人类贡献者；AI 编码代理请读仓库根目录的 `AGENTS.md`（本文件不入库）。

## 环境

- Node.js >= 20 与 pnpm（版本以 `package.json` 的 `packageManager` 为准）。
- 可选：DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`，用于真机联调。

## 开发流程

1. Fork 并从 `main` 开分支，分支名用 `feat/…`、`fix/…`、`docs/…`。
2. `pnpm install`。
3. 改代码：两端共享的类型只改 `src/shared/domain.ts`。
4. 提交前运行：

```bash
pnpm run typecheck
pnpm run build
pnpm test
```

5. 开 PR：说明动机、行为变化、影响的版本与测试结果；界面变化附截图。

## 代码约定

- TypeScript strict，`noUnusedLocals` / `noUnusedParameters` 打开；LF、两空格、文件末尾换行（见 `.editorconfig`）。
- 源码注释与标识符用英文；界面文案用简体中文，状态与标签的中文映射集中在 `src/shared/labels.ts`。
- 新增 HTTP 接口：先加 `src/shared/domain.ts` 的类型，再在 `src/host/http/routes/` 按功能落文件并在路由表注册。
- 客户端样式按功能放在 `src/client/theme/styles/`，由 `index.ts` 汇总后一次注入；不要写内联 `<style>`。
- `dist/` 是构建产物，不入库、不手改；改完源码先 `pnpm run build`。
- `cordis.patch.yml` 里 `paper-reader` preset 的 persona 必须与 `src/host/ai/persona.ts` 的 `PAPER_PERSONA` 逐字节一致，`scripts/test-chat.mjs` 会断言。
- 数据目录只通过 `app.ts` 给出的根拼接，不要写死绝对路径。

## 测试

`pnpm test` 会依次跑类型检查、构建和全部测试脚本；下面是最常用的单项：

| 脚本 | 覆盖 |
| --- | --- |
| `pnpm run test:store` | 批注并发写入、重启读取与 `.bak` 恢复 |
| `pnpm run test:relations` | 引用匹配、信号打分、判定、簇、边台账、图谱 |
| `pnpm run test:chat` | 会话映射、前缀不变、流式桥、压缩、侧栏开关、降级 |
| `pnpm run test:render` | jsdom 挂载库 / 阅读器 / 关联页 / 设置页 |
| `pnpm run test:pdf` | PDF 画布：离屏替换、取消、10MP 上限、文本坐标 |
| `pnpm run test:reader` | 阅读器几何：缩放只改变换、翻页立即重绘 |
| `pnpm run test:workspace` | 标签增删 / 切换、每标签状态、左栏双态、阅读模式 |
| `pnpm run test:translation` | 跳过规则、JSONL 截断、内容哈希缓存、取消 |
| `pnpm run test:typeset` | 译文回填排版：折行禁则、字号搜索、行距拟合 |
| `pnpm run test:math` | 行内公式 / 引用占位符保护与回包校验 |

本地 Host 与真实论文：

```bash
pnpm run build
node scripts/harness.mjs 4794
node scripts/test-api.mjs http://127.0.0.1:4794
node scripts/check-geometry.mjs [path/to/paper.pdf]
node scripts/preview-typeset.mjs
node scripts/preview-relations.mjs
```

## 文档与更新日志

- 设计文档按顺序放在 `doc/`，新增文档接续编号并在 `doc/README.md` 登记；已确认的决策用「增补」小节追加，不改写历史。
- 用户可见的变更写进 `CHANGELOG.md` 的「未发布」，中文在前、英文在后，没有内容的分区省略。
- README 保持简洁，细节放 `doc/`。

## 不要提交

- `dist/`、`node_modules/`、`.tmp/`、日志与 `*.tsbuildinfo`。
- 真实论文 PDF、`$DSH_HOME/paperreader/` 下的数据、任何 API Key。
- 与本次改动无关的格式化噪音。

## 发布

1. 更新 `package.json` 的 `version`，并把 `CHANGELOG.md` 的「未发布」整理成新的版本段（中文在前、英文在后，空分区省略）。
2. 运行 `pnpm install --frozen-lockfile && pnpm test`。
3. 提交版本变更（`pnpm publish` 默认要求工作区干净），再运行 `pnpm publish`；`prepack` 会先执行 `pnpm run build`，把 `dist/` 一起打进包。
4. 在 GitHub 打同名 tag（如 `v0.1.0`）并创建 Release，正文复用 CHANGELOG 中该版本的段落。

首次发布前需要 `pnpm login`（或提供 `NPM_TOKEN`）。确实要从未提交的工作区发布时，用 `pnpm publish --no-git-checks`。

## 报告问题

开 issue 时请给出：复现步骤、期望与实际、DSH 与插件版本、浏览器 / 系统，以及相关日志（去掉隐私信息）。

---

# Contributing

Thanks for improving PaperReader. This guide is for human contributors; AI agents should read `AGENTS.md` in the repository root (untracked).

## Setup

- Node.js >= 20 and pnpm (version pinned by `packageManager`).
- Optional: DeepSeek Harness `>=0.2.2-rc.1 <0.3.0` for end-to-end checks.

## Workflow

1. Fork and branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. `pnpm install`.
3. Change code: shared types live only in `src/shared/domain.ts`.
4. Before pushing, run:

```bash
pnpm run typecheck
pnpm run build
pnpm test
```

5. Open a PR describing the motivation, behaviour change, affected versions, and test results; attach screenshots for UI changes.

## Conventions

- TypeScript strict with `noUnusedLocals` / `noUnusedParameters`; LF, two spaces, final newline (see `.editorconfig`).
- Source comments and identifiers are English; UI copy is Simplified Chinese, with Chinese status and label mappings centralised in `src/shared/labels.ts`.
- New HTTP endpoints: add the type in `src/shared/domain.ts` first, then a per-feature route file under `src/host/http/routes/`, and register it in the route table.
- Client styles are per-feature modules under `src/client/theme/styles/`, aggregated and injected once by `index.ts`; do not inline `<style>`.
- `dist/` is build output: never edit or commit it. Run `pnpm run build` after changing sources.
- The `paper-reader` preset persona in `cordis.patch.yml` must stay byte-identical to `PAPER_PERSONA` in `src/host/ai/persona.ts`; `scripts/test-chat.mjs` asserts it.
- Build data paths from the root that `app.ts` provides; never hardcode absolute paths.

## Tests

`pnpm test` runs typecheck, build, and every test script; the most-used ones are:

| Script | Coverage |
| --- | --- |
| `pnpm run test:store` | concurrent annotation writes, restart reads, `.bak` recovery |
| `pnpm run test:relations` | citation matching, signal scoring, adjudication, clusters, edge ledger, graph |
| `pnpm run test:chat` | session mapping, stable prefix, streaming bridge, compaction, sidebar toggle, degradation |
| `pnpm run test:render` | jsdom mounts of library / reader / relations / settings |
| `pnpm run test:pdf` | PDF canvas: offscreen swap, cancellation, 10MP cap, text coordinates |
| `pnpm run test:reader` | reader geometry: zoom only transforms, immediate page repaint |
| `pnpm run test:workspace` | tab add/remove/switch, per-tab state, rail modes, reading modes |
| `pnpm run test:translation` | skip rules, JSONL truncation, content-hash cache, cancellation |
| `pnpm run test:typeset` | translated-page typesetting: line-breaking rules, font search, leading fit |
| `pnpm run test:math` | inline formula / citation placeholder protection and response validation |

Local host and real papers:

```bash
pnpm run build
node scripts/harness.mjs 4794
node scripts/test-api.mjs http://127.0.0.1:4794
node scripts/check-geometry.mjs [path/to/paper.pdf]
node scripts/preview-typeset.mjs
node scripts/preview-relations.mjs
```

## Docs and changelog

- Design docs are numbered in `doc/`; register new ones in `doc/README.md`. Append a dated "增补" (addendum) section instead of rewriting confirmed decisions.
- Record user-visible changes under `未发布` in `CHANGELOG.md`, Chinese first and English after; omit empty categories.
- Keep the README short and push detail into `doc/`.

## Do not commit

- `dist/`, `node_modules/`, `.tmp/`, logs, `*.tsbuildinfo`.
- Real paper PDFs, data under `$DSH_HOME/paperreader/`, or any API key.
- Formatting noise unrelated to the change.

## Release

1. Bump `version` in `package.json` and turn the "未发布" section of `CHANGELOG.md` into a new version section (Chinese first, English after; omit empty categories).
2. Run `pnpm install --frozen-lockfile && pnpm test`.
3. Commit the release changes (`pnpm publish` requires a clean tree), then run `pnpm publish`; `prepack` builds `dist/` first.
4. Tag the commit (e.g. `v0.1.0`) and create a GitHub Release using that changelog section as the body.

Log in with `pnpm login` (or provide `NPM_TOKEN`) before the first publish. Use `pnpm publish --no-git-checks` only when publishing from an uncommitted tree.

## Reporting issues

Include reproduction steps, expected vs actual, DSH and plugin versions, browser / OS, and relevant logs with private data removed.
