/**
 * Preview harness for the re-typeset translated page.
 *
 * Renders `TranslatedPage` against a fabricated page payload (no PDF, so the
 * text is drawn straight on white) to check how the source geometry maps onto
 * the Chinese paragraph: font size, leading, line breaks and the ragged last
 * line. Run through `scripts/preview-typeset.mjs`.
 */
import { createRoot } from 'react-dom/client'
import { TranslatedPage } from '../../src/client/features/reader/TranslatedPage.js'
import { tokens } from '../../src/client/theme/styles/tokens.js'
import { translation } from '../../src/client/theme/styles/translation.js'
import type { Block, TranslationPagePayload } from '../../src/client/types.js'

const X = 50
const WIDTH = 500

function blockLines(top: number, count: number, leading: number, indent = 0): Block['lines'] {
  return Array.from({ length: count }, (_, index) => ({
    box: [X + (index === 0 ? indent : 0), top + index * leading, WIDTH - (index === 0 ? indent : 0), leading - 2],
    baseline: top + index * leading + leading * 0.8,
  }))
}

const blocks: Block[] = [
  {
    id: 'b0',
    bbox: [X, 40, WIDTH, 24],
    text: 'Sparse Attention for Long Documents',
    kind: 'title',
    size: 17,
    leading: 24,
    lines: blockLines(40, 1, 24),
  },
  {
    id: 'b1',
    bbox: [X, 84, WIDTH, 75],
    text: 'Abstract: long documents ...',
    kind: 'para',
    size: 10,
    leading: 12.5,
    indent: 20,
    lines: blockLines(84, 6, 12.5, 20),
  },
  {
    id: 'b2',
    bbox: [X, 206, WIDTH, 63],
    text: 'We propose a sparse attention ...',
    kind: 'para',
    size: 10,
    leading: 12.6,
    indent: 20,
    lines: blockLines(206, 5, 12.6, 20),
  },
  {
    id: 'b3',
    bbox: [X, 292, WIDTH, 60],
    text: 'Figure 1: attention patterns ...',
    kind: 'caption',
    size: 9,
    leading: 11.5,
    lines: blockLines(292, 5, 11.5),
  },
]

const abstract = '长文档建模的核心矛盾在于注意力机制的二次复杂度。随着序列长度增长，全注意力所需的显存与计算量迅速超出预算，'
  + '因此稀疏化成为一条自然的技术路线。本文提出一种可学习的稀疏注意力：它以固定大小的块为单位估计重要性，'
  + '只对被选中的块计算精确注意力，其余位置用低秩近似补偿。这样既保留了长程依赖，又把复杂度降到线性。'
  + '与固定模式的稀疏注意力不同，块的重要性由一层轻量的打分网络在线预测，因此可以随输入内容自适应地调整。'

const body = '我们在四个长文本基准上评估该方法，包括摘要、问答与检索。实验表明，在同等显存预算下，'
  + '该方法的困惑度比滑动窗口注意力低一点八，检索召回率提升三点二个百分点；在十六万 token 的输入上，'
  + '推理吞吐是对照组的两倍。消融实验进一步显示，块重要性估计与低秩补偿各自贡献了约一半的收益，'
  + '去掉任意一项都会让长距离检索明显退化。我们还分析了不同块大小的影响，发现块过小时估计噪声变大，'
  + '块过大时稀疏粒度不足，二者之间存在一个稳定的折中区间。最后，我们讨论了将该方法推广到多模态输入的可行性，'
  + '并指出其在流式推理场景下的潜在优势。'

const payload: TranslationPagePayload = {
  page: { page: 1, width: 600, height: 800, blocks },
  status: 'done',
  order: blocks.map((block) => block.id),
  blocks: {
    b0: '面向长文档的可学习稀疏注意力',
    b1: abstract,
    b2: body,
    b3: '图 1：不同层的注意力模式。颜色越深表示权重越大。',
  },
  skipped: {},
}

globalThis.fetch = async () => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <div className="pr-root" data-scheme="light">
    <style>{`${tokens}\n${translation}`}</style>
    <div style={{ padding: 24, background: '#e8e8ea', display: 'flex', justifyContent: 'center' }}>
      <TranslatedPage paperId="preview" pageNumber={1} width={600} zoom={1} version="preview" />
    </div>
  </div>,
)
