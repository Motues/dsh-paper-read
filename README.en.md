# PaperReader

[中文](./README.md) | **English**

A paper management and reading plugin for the DeepSeek Harness Web UI: a permanent library, a layout-faithful reader, and cross-paper recall. Data lives in `$DSH_HOME/paperreader/`; PDFs are rendered by pdf.js in their original layout; each paper's chat is a real DSH session (`pr-<paperId>`) with its own compaction and persistent log.

## Features

- **Library** — folder watching, DOI / arXiv / PMID / link import, multi-level folders and tags, author / year / venue filters, and a soft-delete trash.
- **Faithful reader** — single, spread, and continuous modes, thumbnails and bookmark outline, six highlight colours with notes, in-document search, and host theme following.
- **Guide and chat** — sectioned digest, margin explanations and follow-ups; one DSH session per paper, and streaming answers survive tab switches.
- **Relation graph** — citation matching, AI profiles, pairwise adjudication, graph and list views, topic clusters, shortest paths, and pending-review feedback.
- **Full-text translation (experimental)** — per-page streaming, resumable blocks, content-hash caching, with original / side-by-side / translation-only / reflowed layouts.
- **Search and usage** — BM25 over full text, annotations, and notes; token usage ledger and a task list.

Importing, reading, annotating, and searching work without a model; only digests and answers need one.

## Requirements

- Node.js >= 20
- pnpm (version pinned by `packageManager`)
- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`

## Install

```bash
pnpm install
pnpm run build
```

Install this directory, or the npm package `dsh-paper-read`, from the DSH plugin manager (`plugin_manager install_bundle`, into the `desktop` profile), then refresh the Web page — a "Paper" entry appears in the sidebar.

- Host changes (routes, data layer) need a DSH restart; client changes only need a page refresh.
- `cordis.patch.yml` also mounts the `paper-reader` agent preset used by paper chats (persona + isolated compaction, no tools); restart or re-enable the plugin after upgrading.

## Development

```bash
pnpm run typecheck   # strict type check
pnpm test            # typecheck + build + all smoke / regression tests
pnpm run build       # tsc → dist/host, esbuild → dist/client, plus the pdf.js worker
```

Run the host without DSH: `node scripts/harness.mjs 4794`. More test and preview scripts are listed in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Documentation

- [Documentation index](./doc/README.md)
- [01 · Design](./doc/01-design.md)
- [02 · Relations design and algorithm](./doc/02-design-relations.md)
- [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md)

## License

MIT © 2026 Motues
