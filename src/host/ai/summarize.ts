/**
 * 导读生成：分节 map → 合并 reduce → Summary。
 *
 * The prompts are the ones written down in DESIGN §9.2; keep them in sync with
 * the document rather than tuning in place.
 *
 * Two failure modes have burned us in practice, so both are handled here:
 *   - a reasoning model can spend the whole per-window budget before emitting
 *     any visible text; an empty window is retried once with a larger budget
 *     instead of being silently dropped;
 *   - a model can answer with an empty JSON object. That must never overwrite
 *     a good on-disk summary, so a content check gates the write.
 */

import type {
  PageText,
  PaperRecord,
  Summary,
} from '../../shared/domain.js'
import { pagesToText } from '../pdf/extract.js'
import { estimateTokens, normalizeSpace, truncate } from '../util/util.js'
import type { Summoner } from './summoner.js'

const MAP_SYSTEM = [
  'You extract section-level facts for a paper digest. Read one stretch of a paper body and pull out factual points.',
  'State only what the paper itself says: problem, method, key findings, limitations, reusable pieces.',
  'Keep each point under 40 Chinese characters. Do not evaluate, do not quote whole sentences, and do not write "this paper".',
  'Output plain text, one point per line, prefixed with [Problem] [Method] [Finding] [Limitation] [Reusable].',
  'Write every point in Simplified Chinese.',
].join('\n')

const REDUCE_SYSTEM = [
  'You write a digest of one paper for researchers. No popular-science framing.',
  'Output JSON only, without explanation: {"tldr","problem","method","findings","limitations","reusable","title","authors","year","venue"}',
  'tldr: at most 60 Chinese characters; state what it did and on what grounds.',
  'findings: each at most 40 Chinese characters; they must be the conclusions of the paper itself, not your evaluation.',
  'reusable: what the reader can take away (dataset / trick / counterexample / assumption).',
  'title/authors/year/venue: fill them only when the material makes them certain; otherwise null.',
  'Leave unknown fields as empty arrays or null; never invent.',
  'Write every human-readable value in Simplified Chinese; keep technical terms, names and venues in their original form.',
].join('\n')

/** A window that fills the budget before producing text is retried with this. */
const MAP_MAX_TOKENS = 2400
const MAP_RETRY_TOKENS = 3200
const REDUCE_MAX_TOKENS = 2600

/** Split text into at most `maxParts` windows on paragraph boundaries. */
function splitWindows(text: string, maxParts: number): string[] {
  if (text.length === 0) return []
  const target = Math.ceil(text.length / maxParts)
  const paragraphs = text.split(/\n{2,}/)
  const windows: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current.length > 0 && current.length + paragraph.length > target && windows.length < maxParts - 1) {
      windows.push(current)
      current = ''
    }
    current += `${paragraph}\n\n`
  }
  if (current.trim()) windows.push(current)
  // Do not drop short windows: a short paper is still a paper. The old filter
  // could leave `windows` empty and report "模型没有返回分节结果" even though
  // there was usable body text.
  return windows.filter((window) => window.trim().length > 0)
}

function asList(value: unknown, max: number): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|[；;]\s*/)
      : []
  return raw
    .map((item) => normalizeSpace(
      typeof item === 'string'
        ? item.replace(/^\s*[-*•]\s*/, '')
        : (item as { text?: string })?.text ?? '',
    ))
    .filter((item) => item.length > 0)
    .slice(0, max)
    .map((item) => truncate(item, 80))
}

function asRecord(value: unknown): Record<string, unknown> {
  // Arrays are objects in JavaScript. Treating a top-level array as a summary
  // object was the reason a valid `[{...}]` reply produced an all-empty guide.
  if (Array.isArray(value)) {
    const first = value.length === 1 ? value[0] : null
    return first && typeof first === 'object' && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : {}
  }
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asAuthors(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .map((name) => normalizeSpace(name))
      .filter(Boolean)
      .slice(0, 10)
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，;；]\s*/)
      .map((name) => normalizeSpace(name))
      .filter(Boolean)
      .slice(0, 10)
  }
  return undefined
}

function normalizeSummary(raw: unknown, paper: Pick<PaperRecord, 'id'>): Summary {
  const data = asRecord(raw)
  const problem = truncate(normalizeSpace(data.problem ?? ''), 260)
  const method = truncate(normalizeSpace(data.method ?? ''), 420)
  const findings = asList(data.findings, 6)
  const limitations = asList(data.limitations, 4)
  const reusable = asList(data.reusable, 4)
  // A digest without a tldr renders as a blank card. Derive one from the
  // material the model did return; this is still the paper's own content.
  const tldr = normalizeSpace(data.tldr ?? '')
    || problem
    || method
    || findings[0]
    || ''
  const year = Number(data.year)
  return {
    paperId: paper.id,
    tldr: truncate(tldr, 80),
    problem,
    method,
    findings,
    limitations,
    reusable,
    related: [],
    refined: {
      title: typeof data.title === 'string' ? normalizeSpace(data.title) || undefined : undefined,
      authors: asAuthors(data.authors),
      year: Number.isInteger(year) && year > 0 ? year : undefined,
      venue: typeof data.venue === 'string' ? normalizeSpace(data.venue) || undefined : undefined,
    },
    createdAt: new Date().toISOString(),
    model: '',
  }
}

/** True when the digest has something worth showing and keeping. */
export function summaryHasContent(summary: Summary): boolean {
  return Boolean(
    summary.tldr.trim()
    || summary.problem.trim()
    || summary.method.trim()
    || summary.findings.length > 0
    || summary.limitations.length > 0
    || summary.reusable.length > 0,
  )
}

export interface SummaryProgress {
  (step: string): void
}

/**
 * Build one paper's summary from its parsed pages.
 */
export async function buildSummary({
  summoner,
  paper,
  pages,
  budgetChars = 60_000,
  onProgress,
  signal,
}: {
  summoner: Summoner
  paper: Pick<PaperRecord, 'id' | 'title' | 'abstract'>
  pages: PageText[]
  budgetChars?: number
  onProgress?: SummaryProgress
  signal?: AbortSignal
}): Promise<Summary> {
  const fullText = pagesToText(pages, { maxChars: budgetChars })
  if (estimateTokens(fullText) < 60) throw new Error('没有可用的正文，无法生成导读')

  const windows = splitWindows(fullText, 3)
  if (windows.length === 0) windows.push(fullText)
  const parts: string[] = []
  let lastMapError: unknown = null
  for (let index = 0; index < windows.length; index += 1) {
    onProgress?.(`分节阅读 ${index + 1}/${windows.length}`)
    const user = `论文标题：${paper.title}\n\n这是正文的第 ${index + 1}/${windows.length} 部分：\n\n${windows[index]}`
    let text = ''
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt === 1) onProgress?.(`重新阅读 ${index + 1}/${windows.length}`)
      try {
        text = await summoner.complete({
          system: MAP_SYSTEM,
          user,
          temperature: attempt === 0 ? 0.2 : 0.1,
          maxTokens: attempt === 0 ? MAP_MAX_TOKENS : MAP_RETRY_TOKENS,
          signal,
          purpose: 'summary',
          reasoningEffort: 'low',
        })
        if (text.trim().length > 0) break
      } catch (error) {
        // Retry once; one bad window should not discard the other two.
        lastMapError = error
      }
    }
    if (text.trim().length > 0) parts.push(`### 第 ${index + 1} 部分\n${text}`)
  }
  if (parts.length === 0) {
    if (lastMapError) throw lastMapError
    throw new Error('模型没有返回分节内容，请重试或换一个模型')
  }

  onProgress?.('合并成导读')
  const reduceUser = [
    `论文标题：${paper.title}`,
    paper.abstract ? `原文摘要：${truncate(paper.abstract, 900)}` : '',
    '',
    '分节提取结果：',
    parts.join('\n\n'),
    '',
    '据此写出导读 JSON。',
  ]
    .filter(Boolean)
    .join('\n')

  let summary: Summary | null = null
  let lastReduceError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 1) onProgress?.('重新生成导读')
    try {
      const parsed = await summoner.json({
        system: REDUCE_SYSTEM,
        user: reduceUser,
        temperature: attempt === 0 ? 0.2 : 0.1,
        maxTokens: REDUCE_MAX_TOKENS,
        signal,
        purpose: 'summary',
        reasoningEffort: 'low',
      })
      const candidate = normalizeSummary(parsed, paper)
      if (summaryHasContent(candidate)) {
        summary = candidate
        break
      }
      lastReduceError = new Error('模型只返回了空导读')
    } catch (error) {
      lastReduceError = error
    }
  }
  if (!summary) {
    if (lastReduceError instanceof Error && /空导读/.test(lastReduceError.message)) {
      throw new Error('模型只返回了空导读，请重试或换一个模型')
    }
    throw lastReduceError instanceof Error
      ? lastReduceError
      : new Error('模型没有返回可用的导读')
  }

  const target = await summoner.target()
  summary.model = target ? `${target.provider}/${target.model}` : ''
  return summary
}
