/**
 * One-shot prompt construction — the fallback path.
 *
 * The primary path is `PaperChat` (a real DSH session per paper). This module
 * stays for three cases: profiles where `agents`/`agentPresets` are absent,
 * selection **translation** (deliberately stateless, never enters a session),
 * and recovery when a session cannot be created. It uses the same digest and
 * retrieval blocks as the session path, so answers read the same either way.
 */

import type { Indexer } from '../search/indexer.js'
import type { Store } from '../library/store.js'
import type { ChatMessage } from './summoner.js'
import { buildDigest, buildRetrieval, readPaperSnapshot, retrieve, type RetrievalHit } from './context.js'
import { PAPER_PERSONA } from './persona.js'
import { truncate } from '../util/util.js'

export type AskKind = 'ask' | 'explain' | 'translate'

export interface AskInput {
  paperId: string
  question: string
  quote?: string
  page?: number
  kind?: AskKind
}

export interface AskPlan {
  temperature: number
  maxTokens: number
  system: string
  messages: ChatMessage[]
  citations: Array<{ page: number }>
}

export interface AskService {
  buildAsk(input: AskInput): Promise<AskPlan | null>
}

const text = (value: string): ChatMessage => ({ role: 'user', content: [{ type: 'text', text: value }] })

function questionLine(question: string, quote: string, page: number | undefined): string {
  const where = page ? `第 ${page} 页` : '当前页'
  if (quote) return `我在读${where}这一段：\n"${truncate(quote, 1500)}"\n\n问题：${question}`
  return `问题：${question}`
}

function citationPages(hits: RetrievalHit[]): Array<{ page: number }> {
  return [...new Set(hits.map((hit) => hit.page))].sort((a, b) => a - b).map((page) => ({ page }))
}

export function createAskService({ store, indexer }: { store: Store; indexer: Indexer }): AskService {
  async function buildAsk({
    paperId,
    question,
    quote = '',
    page,
    kind = 'ask',
  }: AskInput): Promise<AskPlan | null> {
    if (kind === 'translate') {
      return {
        temperature: 0,
        maxTokens: 900,
        system: 'You translate an excerpt from a research paper for a reader. Keep terminology precise, preserve formulas and symbols exactly, and output only the translation in Simplified Chinese.',
        messages: [text(`翻译成中文：\n\n${quote}`)],
        citations: [],
      }
    }

    const snapshot = await readPaperSnapshot(store, indexer, paperId)
    if (!snapshot) return null
    const hits = retrieve(indexer, paperId, question || quote)
    const retrieval = buildRetrieval(question || quote, hits.length > 0 ? hits : snapshot.fallback)

    return {
      temperature: 0.3,
      maxTokens: 1000,
      system: PAPER_PERSONA,
      messages: [
        text(buildDigest(snapshot)),
        ...(retrieval.text ? [text(retrieval.text)] : []),
        text(questionLine(question, quote, page)),
      ],
      citations: citationPages(hits.length > 0 ? hits : snapshot.fallback),
    }
  }

  return { buildAsk }
}
