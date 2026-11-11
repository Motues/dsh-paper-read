/** Small shared helpers for the PaperReader host half. */

import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const nowIso = (): string => new Date().toISOString()

export function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

export function shortHash(value: string, length = 12): string {
  return sha1(value).slice(0, length)
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

/** Read JSON, returning `fallback` for a missing or corrupt file. */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(file, 'utf8')
    if (text.trim() === '') return fallback
    return JSON.parse(text) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    if (error instanceof SyntaxError) {
      // Keep the corrupt copy so a bad write never silently destroys annotations.
      try {
        await fs.rename(file, `${file}.corrupt-${Date.now()}`)
      } catch {
        /* ignore: the fallback is still safe */
      }
      return fallback
    }
    throw error
  }
}

/**
 * Read JSON with a last-known-good `.bak` fallback. A truncated write or a
 * corrupt file must never look like "the user has no annotations"; keep the
 * damaged copy for inspection and restore the previous snapshot instead.
 */
export async function readJsonBackup<T>(file: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(file, 'utf8')
    if (text.trim() !== '') return JSON.parse(text) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    if (error instanceof SyntaxError) {
      try {
        await fs.rename(file, `${file}.corrupt-${Date.now()}`)
      } catch {
        /* keep going: the backup is still readable */
      }
    }
  }
  try {
    const text = await fs.readFile(`${file}.bak`, 'utf8')
    if (text.trim() !== '') return JSON.parse(text) as T
  } catch {
    /* no backup yet */
  }
  return fallback
}

/** Write JSON atomically: temp file in the same directory, then rename. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file))
  const body = JSON.stringify(value, null, 2)
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temp, body, 'utf8')
  try {
    await fs.rename(temp, file)
  } catch {
    await fs.writeFile(file, body, 'utf8')
    await fs.rm(temp, { force: true })
  }
}

export async function readBytes(file: string): Promise<Buffer> {
  return fs.readFile(file)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function truncate(text: unknown, max: number): string {
  const value = String(text ?? '')
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function normalizeSpace(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

const LATIN_STOP = new Set(
  ('a an the of and or to in for on with we our this that these those is are was were be been it its as at by from '
    + 'can may not no but if then than so such which who whom whose what when where how why all any both each more most '
    + 'other some only own same too very s t just do does did done have has had will would should could about into over '
    + 'under between during before after above below up down out off again further once here there').split(' '),
)

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/

/** True when the text is mostly CJK. */
export function isCjkHeavy(text: unknown): boolean {
  const value = String(text ?? '')
  if (value.length === 0) return false
  let cjk = 0
  for (const char of value) if (CJK.test(char)) cjk += 1
  return cjk / value.length > 0.25
}

/**
 * Tokenizer for mixed Chinese/English text: latin words (light suffix folding)
 * plus CJK character bigrams. Used by BM25 and by nothing else.
 */
export function tokenize(text: unknown): string[] {
  const value = String(text ?? '').toLowerCase()
  const tokens: string[] = []
  for (const match of value.matchAll(/[a-z][a-z0-9+#.-]{1,}/g)) {
    let word = match[0].replace(/^[.-]+|[.-]+$/g, '')
    if (word.length < 2 || LATIN_STOP.has(word)) continue
    if (word.length > 4) {
      if (word.endsWith('ies')) word = `${word.slice(0, -3)}y`
      else if (word.endsWith('sses')) word = word.slice(0, -2)
      else if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) word = word.slice(0, -1)
    }
    tokens.push(word)
  }
  const cjkChars = [...value].filter((char) => CJK.test(char))
  for (let index = 0; index < cjkChars.length; index += 1) {
    tokens.push(cjkChars[index])
    if (index + 1 < cjkChars.length) tokens.push(cjkChars[index] + cjkChars[index + 1])
  }
  return tokens
}

/** Rough token estimate used for budgeting: latin chars/4, CJK chars/1.6. */
export function estimateTokens(text: unknown): number {
  const value = String(text ?? '')
  let cjk = 0
  for (const char of value) if (CJK.test(char)) cjk += 1
  const latin = value.length - cjk
  return Math.ceil(cjk / 1.6 + latin / 4)
}

/** Pull the first JSON object/array out of a model reply. */
export function extractJson(text: unknown): unknown {
  const value = String(text ?? '')
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : value
  const start = body.search(/[[{]/)
  if (start < 0) return null
  const open = body[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < body.length; index += 1) {
    const char = body[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, index + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}
