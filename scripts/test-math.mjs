/**
 * Inline formula protection checks: a translated paragraph must keep its math
 * verbatim, and a reply that drops a placeholder must be rejected so the block
 * is retried rather than committed with a corrupted equation.
 */
import assert from 'node:assert/strict'
import { glossaryPrompt, protectMath, restoreMath } from '../dist/shared/math.js'

// 1. A formula becomes a placeholder and comes back untouched.
{
  const text = '输出为 w⊤φ(x) 的线性组合，其中 [12] 给出该结论。'
  const protectedText = protectMath(text)
  assert.ok(protectedText.spans.length >= 1, `expected a span in ${protectedText.text}`)
  assert.ok(protectedText.text.includes('⟦0⟧'))
  const restored = restoreMath(protectedText.text, protectedText.spans)
  assert.equal(restored, text)
}

// 2. Citations are protected too, so the model cannot renumber them.
{
  const { text, spans } = protectMath('As shown in [12, 13], the effect holds.')
  assert.equal(spans.length, 1)
  assert.equal(spans[0].text, '[12, 13]')
  assert.ok(text.includes('⟦0⟧'))
}

// 3. A dropped, duplicated, reordered or invented placeholder invalidates the block.
{
  const { spans } = protectMath('结论见 [1]，方法见 [2]。')
  assert.equal(spans.length, 2)
  assert.equal(restoreMath('结论已在别处讨论。', spans), null)
  assert.equal(restoreMath('⟦0⟧ 与 ⟦0⟧', spans), null)
  assert.equal(restoreMath('⟦1⟧ 与 ⟦0⟧', spans), null)
  assert.equal(restoreMath('⟦0⟧ 与 ⟦1⟧ 与 ⟦2⟧', spans), null)
  assert.match(restoreMath('结论见 ⟦0⟧，方法见 ⟦1⟧。', spans) ?? '', /\[1\].*\[2\]/s)
}

// 4. Prose that merely contains a multiplication sign is left alone.
{
  const { text, spans } = protectMath('推理速度提升 2× faster，显存占用不变。')
  assert.equal(spans.length, 0)
  assert.equal(text, '推理速度提升 2× faster，显存占用不变。')
}

// 5. Plain prose is a no-op, and placeholders in a no-math block are suspicious.
{
  const plain = '本节介绍方法。'
  assert.deepEqual(protectMath(plain), { text: plain, spans: [] })
  assert.equal(restoreMath('译文里冒出 ⟦0⟧', []), null)
  assert.equal(restoreMath('正常译文', []), '正常译文')
}

// 6. The glossary is a stable, bounded prompt block.
{
  const entries = Array.from({ length: 80 }, (_, index) => ({ en: `term${index}`, zh: `术语${index}` }))
  const prompt = glossaryPrompt(entries)
  assert.ok(prompt.startsWith('术语表'))
  assert.ok(prompt.split('\n').length <= 61)
  assert.equal(glossaryPrompt([]), '')
}

console.log('test-math: ok')
