/**
 * The two pieces of paper context a conversation ever needs.
 *
 * Both are plain text so they can be appended to a DSH session as ordinary user
 * messages: a *digest* written once per conversation (title, abstract, section
 * skeleton — byte-stable, so it sits in the cached prefix) and a *retrieval*
 * block appended per question (never rewritten, so it can only extend the
 * prefix). Nothing here knows about sessions or models.
 */

import type { PageText, PaperRecord, Summary } from '../../shared/domain.js'
import type { Indexer } from '../search/indexer.js'
import type { Store } from '../library/store.js'
import { truncate } from '../util/util.js'

export interface RetrievalHit {
  page: number
  text: string
}

export interface PaperSnapshot {
  paper: PaperRecord
  summary: Summary | null
  pages: PageText[] | null
  /** Fallback paragraphs from `chunks.json`, used when the index has no hit. */
  fallback: RetrievalHit[]
}

const SURFACE_KEYWORDS = /figure|fig\.|table|algorithm|theorem|lemma|experiment|evaluation|ablation|result|method|approach|dataset|conclusion|limitation/i

export async function readPaperSnapshot(store: Store, indexer: Indexer, paperId: string): Promise<PaperSnapshot | null> {
  await indexer.ensureIndex()
  const paper = store.getPaper(paperId)
  if (!paper) return null
  const [summary, pages, chunks] = await Promise.all([
    store.readSummary(paperId),
    store.readPages(paperId),
    store.readChunks(paperId),
  ])
  return {
    paper,
    summary,
    pages,
    fallback: chunks.slice(0, 3).map((chunk) => ({ page: chunk.page, text: chunk.text })),
  }
}

/** Top paragraphs for this question, always restricted to the paper in hand. */
export function retrieve(indexer: Indexer, paperId: string, question: string, limit = 4): RetrievalHit[] {
  const hits = indexer.index.search(question, { limit, paperId })
  return hits.map((hit) => ({ page: hit.doc.page, text: hit.doc.text }))
}

/**
 * One page's own opening lines, used as the section skeleton.
 *
 * Pages are cheap to read and stable across a session, which is the whole point
 * of putting this in the digest instead of re-sending full text every turn.
 */
function skeletonOf(pages: PageText[] | null): string[] {
  if (!pages) return []
  const lines: string[] = []
  for (const page of pages.slice(0, 12)) {
    const paragraphs = page.blocks.filter((block) => block.kind === 'para' || block.kind === 'title')
    const first = paragraphs[0]?.text ?? page.blocks[0]?.text ?? ''
    if (!first) continue
    lines.push(`第 ${page.page} 页 · ${truncate(first, 60)}`)
  }
  return lines
}

function keyParagraphs(pages: PageText[] | null): string[] {
  if (!pages) return []
  const picked: string[] = []
  for (const page of pages.slice(0, 6)) {
    for (const block of page.blocks) {
      if (block.kind !== 'para') continue
      const text = block.text.trim()
      if (text.length < 80) continue
      if (SURFACE_KEYWORDS.test(text)) {
        picked.push(`第 ${page.page} 页：${truncate(text, 320)}`)
      }
      if (picked.length >= 3) return picked
    }
  }
  return picked
}

/**
 * The opening context block of a paper session.
 *
 * Written exactly once per conversation, before the first question, and never
 * touched again: every later turn appends after it, so the provider sees the
 * same bytes in the same order.
 */
export function buildDigest({ paper, summary, pages }: PaperSnapshot): string {
  const facts = [paper.year ? `${paper.year}` : '', paper.venue ?? ''].filter(Boolean).join(' · ')
  const lines = [
    `【论文】${paper.title}`,
    paper.authors?.length ? `【作者】${paper.authors.slice(0, 6).join(', ')}${paper.authors.length > 6 ? ' 等' : ''}` : '',
    facts ? `【出处】${facts}` : '',
    summary?.tldr ? `【一句话结论】${truncate(summary.tldr, 240)}` : '',
    paper.abstract ? `【摘要】${truncate(paper.abstract, 1100)}` : '',
    summary?.problem ? `【问题】${truncate(summary.problem, 400)}` : '',
    summary?.method ? `【方法】${truncate(summary.method, 600)}` : '',
    summary?.findings?.length ? `【发现】${summary.findings.slice(0, 4).map((item) => truncate(item, 160)).join('；')}` : '',
    summary?.limitations?.length ? `【局限】${summary.limitations.slice(0, 3).map((item) => truncate(item, 160)).join('；')}` : '',
  ].filter(Boolean)

  const skeleton = skeletonOf(pages)
  if (skeleton.length > 0) lines.push(`【页首骨架】\n${skeleton.join('\n')}`)
  const key = keyParagraphs(pages)
  if (key.length > 0) lines.push(`【关键段落】\n${key.join('\n\n')}`)

  lines.push('以上是这篇论文的固定资料。之后我会就具体位置提问，请只依据论文内容回答。')
  return lines.join('\n\n')
}

/** Per-turn retrieval block: page-labelled excerpts plus the pages they cite. */
export function buildRetrieval(question: string, hits: RetrievalHit[]): { text: string; citations: number[] } {
  const seen = new Set<number>()
  const blocks: string[] = []
  for (const hit of hits) {
    const text = hit.text.trim()
    if (text === '') continue
    blocks.push(`【第 ${hit.page} 页】\n${truncate(text, 1200)}`)
    seen.add(hit.page)
  }
  const citations = [...seen].sort((a, b) => a - b)
  if (blocks.length === 0) return { text: '', citations }
  return {
    text: [`与「${truncate(question, 80)}」相关的原文片段：`, ...blocks].join('\n\n'),
    citations,
  }
}
