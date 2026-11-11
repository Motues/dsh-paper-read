/** The harness model as a translation engine: the original, structured path. */

import type { Summoner } from '../summoner.js'
import type { TranslationEngine } from './types.js'

export function createDshEngine(summoner: Summoner): TranslationEngine {
  return {
    id: 'dsh',
    label: 'dsh',
    mode: 'llm',
    billing: 'dsh',
    limits: {
      concurrency: 2,
      batch: 40,
      charsPerItem: 6000,
      charsPerRequest: 12_000,
    },
    async available() {
      return summoner.available()
    },
    async *stream({ system, user, maxTokens, signal }) {
      for await (const delta of summoner.streamText({
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
        temperature: 0,
        ...(maxTokens ? { maxTokens } : {}),
        signal,
        purpose: 'translate',
      })) {
        yield delta
      }
    },
  }
}
