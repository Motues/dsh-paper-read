/**
 * Import the arXiv test set into the running PaperReader host.
 *
 * The PDFs are cached under `.tmp/test-papers/` (they are test fixtures, not
 * part of the package); the host copies them into its inbox. Safe to re-run:
 * papers already in the library (same arXiv id or title) are skipped.
 *
 * Usage: node scripts/import-test-papers.mjs [apiBase]
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const API = (process.argv[2] ?? 'http://127.0.0.1:5199/api/paperreader').replace(/\/$/, '')
const cacheDir = path.resolve('.tmp/test-papers')

const papers = [
  ['1706.03762', 'Attention Is All You Need'],
  ['2006.04768', 'Linformer: Self-Attention with Linear Complexity'],
  ['2009.14794', 'Rethinking Attention with Performers'],
  ['2004.05150', 'Longformer: The Long-Document Transformer'],
  ['2205.14135', 'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness'],
  ['2307.08621', 'Retentive Network: A Successor to Transformer for Large Language Models'],
  ['2305.13048', 'RWKV: Reinventing RNNs for the Transformer Era'],
  ['2111.00396', 'Efficiently Modeling Long Sequences with Structured State Spaces'],
  ['2312.00752', 'Mamba: Linear-Time Sequence Modeling with Selective State Spaces'],
]

await fs.mkdir(cacheDir, { recursive: true })

async function fetchJson(pathname, init) {
  const response = await fetch(`${API}${pathname}`, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
  return body
}

const library = await fetchJson('/papers')
const existing = library.papers ?? []
const normalize = (value) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

async function download(arxivId) {
  const file = path.join(cacheDir, `${arxivId}.pdf`)
  try {
    const stat = await fs.stat(file)
    if (stat.size > 10_000) return file
  } catch {
    /* download below */
  }
  const url = `https://arxiv.org/pdf/${arxivId}`
  console.log(`download ${url}`)
  const response = await fetch(url, { headers: { 'user-agent': 'paperreader-test/1.0' } })
  if (!response.ok) throw new Error(`download failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(file, bytes)
  return file
}

const imported = []
for (const [arxivId, title] of papers) {
  const key = normalize(title)
  const duplicate = existing.some((paper) => {
    const paperKey = normalize(paper.title)
    if (paperKey === key) return true
    if (key.length < 24 || paperKey.length < 24) return false
    return paperKey.startsWith(key.slice(0, 40)) || key.startsWith(paperKey.slice(0, 40))
  })
  if (duplicate) {
    console.log(`skip (already in library): ${title}`)
    continue
  }
  const file = await download(arxivId)
  const bytes = await fs.readFile(file)
  const name = `${arxivId} - ${title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 90)}.pdf`
  const response = await fetch(`${API}/import/pdf?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body: bytes,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    console.error(`FAILED ${title}: ${body?.error?.message ?? response.status}`)
    continue
  }
  console.log(`queued ${title} -> ${body.jobId}`)
  imported.push({ jobId: body.jobId, title })
}

async function waitJob(jobId) {
  const deadline = Date.now() + 5 * 60_000
  for (;;) {
    const job = await fetchJson(`/jobs/${jobId}`)
    if (job.state === 'done' || job.state === 'failed') return job
    if (Date.now() > deadline) return job
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}

for (const item of imported) {
  const job = await waitJob(item.jobId)
  const failed = job.steps?.filter((step) => step.state === 'failed').map((step) => step.label) ?? []
  const warnings = job.warnings ?? []
  console.log(`${job.state === 'done' ? 'ok  ' : 'FAIL'} ${item.title}${failed.length ? ` (failed: ${failed.join(',')})` : ''}${warnings.length ? ` warnings: ${warnings.slice(0, 2).join(' / ')}` : ''}`)
}

const after = await fetchJson('/papers')
console.log(`library now has ${after.papers.length} papers`)
