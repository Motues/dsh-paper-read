/**
 * In-memory BM25 over chunk text.
 *
 * No embeddings in v1: mixed Chinese/English tokenization (CJK bigrams + folded
 * latin words) is enough to find "那篇讲过 X 的", and the model reranks the top
 * hits for the UI.
 */

import { tokenize } from '../util/util.js'

const K1 = 1.45
const B = 0.72

export interface IndexDoc {
  id: string
  paperId: string
  page: number
  kind: string
  text: string
}

export interface IndexedDoc extends IndexDoc {
  len: number
  tf: Map<string, number>
}

export interface SearchOptions {
  limit?: number
  paperId?: string
  minScore?: number
}

export interface SearchResult {
  doc: IndexedDoc
  score: number
}

export class Bm25Index {
  docs: IndexedDoc[] = []
  df = new Map<string, number>()
  totalLen = 0
  byId = new Map<string, IndexedDoc>()

  addDocs(docs: IndexDoc[]): this {
    for (const doc of docs) this.addDoc(doc)
    return this
  }

  addDoc(doc: IndexDoc): void {
    const tokens = tokenize(doc.text)
    if (tokens.length === 0) return
    const tf = new Map<string, number>()
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
    const record: IndexedDoc = {
      id: doc.id,
      paperId: doc.paperId,
      page: doc.page,
      kind: doc.kind,
      text: doc.text,
      len: tokens.length,
      tf,
    }
    this.docs.push(record)
    this.byId.set(record.id, record)
    this.totalLen += tokens.length
    for (const token of tf.keys()) this.df.set(token, (this.df.get(token) ?? 0) + 1)
  }

  removePaper(paperId: string): void {
    const kept: IndexedDoc[] = []
    for (const doc of this.docs) {
      if (doc.paperId === paperId) {
        this.totalLen -= doc.len
        for (const token of doc.tf.keys()) {
          const next = (this.df.get(token) ?? 0) - 1
          if (next <= 0) this.df.delete(token)
          else this.df.set(token, next)
        }
        this.byId.delete(doc.id)
      } else {
        kept.push(doc)
      }
    }
    this.docs = kept
  }

  get size(): number {
    return this.docs.length
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const limit = options.limit ?? 20
    const terms = [...new Set(tokenize(query))]
    if (terms.length === 0 || this.docs.length === 0) return []
    const total = this.docs.length
    const avg = this.totalLen / total || 1
    const scored: SearchResult[] = []
    for (const doc of this.docs) {
      if (options.paperId && doc.paperId !== options.paperId) continue
      let score = 0
      for (const term of terms) {
        const freq = doc.tf.get(term)
        if (!freq) continue
        const df = this.df.get(term) ?? 0
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5))
        const norm = freq * (K1 + 1) / (freq + K1 * (1 - B + B * (doc.len / avg)))
        score += idf * norm
      }
      if (score > 0) scored.push({ doc, score })
    }
    scored.sort((a, b) => b.score - a.score)
    const floor = options.minScore ?? 0
    return scored
      .filter((item) => item.score >= floor)
      .slice(0, limit)
      .map((item) => ({ ...item }))
  }

  toJSON(): { docs: Array<Omit<IndexedDoc, 'tf'> & { tf: Array<[string, number]> }> } {
    return { docs: this.docs.map((doc) => ({ ...doc, tf: [...doc.tf] })) }
  }

  static fromJSON(
    json: { docs?: Array<Omit<IndexedDoc, 'tf'> & { tf: Array<[string, number]> }> } | null,
  ): Bm25Index {
    const index = new Bm25Index()
    if (!json?.docs) return index
    index.docs = json.docs.map((doc) => ({ ...doc, tf: new Map(doc.tf) }))
    for (const doc of index.docs) {
      index.byId.set(doc.id, doc)
      index.totalLen += doc.len
      for (const token of doc.tf.keys()) index.df.set(token, (index.df.get(token) ?? 0) + 1)
    }
    return index
  }
}
