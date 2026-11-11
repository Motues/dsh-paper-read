/** Paragraph → retrieval chunks (~380 estimated tokens, one-block overlap). */

import type { Block, PageText } from '../../shared/domain.js'
import { estimateTokens } from '../util/util.js'

const TARGET_TOKENS = 380
const MAX_TOKENS = 620
const OVERLAP_TOKENS = 60

export interface Chunk {
  id: string
  paperId: string
  page: number
  blockIds: string[]
  text: string
  tokens: number
  index: number
}

type BufferedBlock = Block & { __page: number; spaceAfter?: boolean }

export function chunkPages(paperId: string, pages: PageText[]): Chunk[] {
  const chunks: Chunk[] = []
  let buffer: BufferedBlock[] = []
  let tokens = 0
  let index = 0

  const push = (text: string, page: number, blockIds: string[]): void => {
    const body = text.trim()
    if (body.length <= 40) return
    chunks.push({
      id: `${paperId}#${index}`,
      paperId,
      page,
      blockIds,
      text: body,
      tokens: estimateTokens(body),
      index,
    })
    index += 1
  }

  /** Close the current buffer; keep the tail block for overlap unless final. */
  const flush = (final: boolean): void => {
    if (buffer.length === 0) return
    const page = buffer[0].__page
    push(buffer.map((block) => block.text).join('\n'), page, buffer.map((block) => block.id))
    const tail = buffer[buffer.length - 1]
    if (!final && tail && estimateTokens(tail.text) <= OVERLAP_TOKENS) {
      buffer = [tail]
      tokens = estimateTokens(tail.text)
    } else {
      buffer = []
      tokens = 0
    }
  }

  for (const pageData of pages) {
    for (const block of pageData.blocks) {
      if (block.kind === 'ref') continue
      if (block.text.length < 12) continue
      const blockTokens = estimateTokens(block.text)

      if (blockTokens > MAX_TOKENS) {
        flush(true)
        let piece = ''
        let first = true
        for (const sentence of block.text.split(/(?<=[.!?。！？])\s+/)) {
          if (!first && estimateTokens(piece + sentence) > TARGET_TOKENS) {
            push(piece, pageData.page, [block.id])
            piece = ''
          }
          piece += sentence
          first = false
        }
        push(piece, pageData.page, [block.id])
        continue
      }

      if (tokens > 0 && tokens >= TARGET_TOKENS * 0.55 && tokens + blockTokens > TARGET_TOKENS) flush(false)
      buffer.push({ ...block, __page: pageData.page })
      tokens += blockTokens
      if (tokens >= MAX_TOKENS) flush(false)
    }
  }
  flush(true)
  return chunks
}
