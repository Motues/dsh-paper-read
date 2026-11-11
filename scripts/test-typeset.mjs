/**
 * Re-typesetting checks.
 *
 * The engine is pure and takes its metrics from the caller, so a fake font is
 * enough to pin the behaviour the reader depends on: never start a line with
 * closing punctuation, keep the source leading, prefer the source size, and
 * only shrink when the paragraph really cannot fit the box plus the gap below.
 */
import assert from 'node:assert/strict'
import { fitText, wrapTokens } from '../dist/shared/typeset.js'

const CJK = /[\u3400-\u9fff]/
const measure = (text, size) => {
  let em = 0
  for (const char of text) {
    if (/\s/.test(char)) em += 0.28
    else if (CJK.test(char)) em += 1
    else if (/[A-Z]/.test(char)) em += 0.65
    else if (/[il.,;:'|!]/.test(char)) em += 0.28
    else em += 0.52
  }
  return em * size
}

// 1. A short paragraph keeps the source size and uses the source leading.
{
  const box = { width: 400, height: 60 }
  const result = fitText({
    text: '这是一段简短的中文译文。',
    width: box.width,
    height: box.height,
    baseSize: 10,
    leading: 12,
  }, measure)
  assert.equal(result.scale, 1, 'short paragraph must not shrink')
  assert.ok(result.lineHeight >= 12, `leading must not be tighter than the source: ${result.lineHeight}`)
  assert.ok(result.lineHeight <= 12 * 1.201, `leading must not balloon: ${result.lineHeight}`)
  assert.ok(result.height <= box.height + 0.5, 'paragraph must fit the box')
  assert.equal(result.overflow, false)
}

// 2. A longer paragraph shrinks, but never below the floor, and says so.
{
  const text = '注意力机制通过查询与键的点积计算权重，再对值加权求和。'.repeat(6)
  const result = fitText({ text, width: 200, height: 60, baseSize: 10, leading: 12 }, measure)
  assert.ok(result.scale < 1 && result.scale >= 0.62, `scale out of range: ${result.scale}`)
  assert.ok(result.fontSize >= 6.2 - 0.01)

  const tiny = fitText({ text, width: 40, height: 10, baseSize: 10, leading: 12 }, measure)
  assert.equal(tiny.overflow, true)
  assert.ok(tiny.scale >= 0.619)
}

// 3. Closing punctuation never opens a line.
{
  const tokens = [...'中文。中文'].map((char) => ({ text: char, space: false }))
  const widths = tokens.map(() => 10)
  const lines = wrapTokens(tokens, widths, 21)
  assert.equal(lines[0], '中文。', `punctuation was pushed to the next line: ${JSON.stringify(lines)}`)
  assert.ok(lines.every((line) => !/^[。，、；：！？]/.test(line)))
}

// 4. Latin words stay whole and spaces are not turned into line starts.
{
  const tokens = [
    { text: 'transformer', space: false },
    { text: ' ', space: true },
    { text: 'attention', space: false },
    { text: ' ', space: true },
    { text: 'is', space: false },
  ]
  const widths = [55, 3, 45, 3, 5]
  const lines = wrapTokens(tokens, widths, 60)
  assert.deepEqual(lines, ['transformer', 'attention is'])
}

// 5. Blank space below the box lets a paragraph keep the source size.
{
  const text = '偏置漂移是推荐系统中普遍存在的现象。'
  const tight = fitText({ text, width: 120, height: 22, baseSize: 10, leading: 12 }, measure)
  const roomy = fitText({ text, width: 120, height: 22, baseSize: 10, leading: 12, grow: 20 }, measure)
  assert.ok(roomy.scale >= tight.scale, 'growing the box must not shrink the text further')
  assert.ok(roomy.height <= 42.5)
}

// 6. Empty text keeps the source size and costs nothing.
{
  const result = fitText({ text: '   ', width: 100, height: 20, baseSize: 11 }, measure)
  assert.equal(result.scale, 1)
  assert.equal(result.overflow, false)
  assert.deepEqual(result.lines, [])
}

console.log('test-typeset: ok')
