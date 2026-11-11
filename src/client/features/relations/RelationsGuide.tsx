/**
 * The in-app guide for the relation page.
 *
 * It opens by itself the first time the page is visited and can be reopened from
 * the header (or with `?`) forever after. The content is deliberately about
 * *reading* the graph — what a node, an edge and a number mean — because the
 * page's failure mode is not missing features, it is a user who does not know
 * that the layout encodes similarity rather than citation.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { IconClose, IconHelp } from '../../components/ui.js'

export interface RelationsGuideProps {
  open: boolean
  /** Whether the guide should keep opening on every visit. */
  auto: boolean
  onClose: () => void
  onAutoChange: (next: boolean) => void
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="pr-kbd">{children}</kbd>
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pr-guide-card">
      <h4>{title}</h4>
      {children}
    </section>
  )
}

export function RelationsGuide({ open, auto, onClose, onAutoChange }: RelationsGuideProps) {
  const startRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    startRef.current?.focus()
    // Capture phase: Esc must close the guide without also clearing the graph
    // selection behind it (the page listens for Esc on window). Tab stays inside
    // the modal, otherwise the "dialog" is only visually modal.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const items = [...root.querySelectorAll<HTMLElement>('button, input, [href]')]
        .filter((element) => !element.hasAttribute('disabled'))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
  }, [onClose, open])

  if (!open) return null

  return (
    <div
      className="pr-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="pr-dialog pr-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pr-guide-title"
      >
        <div className="pr-dlg-head">
          <div className="pr-dlg-icon">
            <IconHelp size={15} />
          </div>
          <div style={{ minWidth: 0 }}>
            <b id="pr-guide-title">关联图谱 · 使用指南</b>
            <div className="pr-dlg-sub">
              位置表示关联强度，不是引用树。第一次进入会自动打开；之后点右上角「指南」或按 <Kbd>?</Kbd> 随时查看。
            </div>
          </div>
          <div className="pr-spacer" />
          <button type="button" className="pr-btn" data-icon data-ghost title="关闭" onClick={onClose}>
            <IconClose size={15} />
          </button>
        </div>

        <div className="pr-dlg-body">
          <div className="pr-guide-grid">
            <Card title="① 读这张图">
              <ul>
                <li>每个点是一篇论文，<b>距离由关联强度决定</b>；边的颜色是关系类型。</li>
                <li>实线 = 已确认，虚线 = 待确认，空心 = 还没有 PDF；箭头只出现在有方向的关系上（引用 / 基于 / 应用）。</li>
                <li>底部单独排开的是还没连上的论文，不是错误。</li>
              </ul>
            </Card>

            <Card title="② 从一篇论文出发">
              <ul>
                <li>单击节点 → 右侧「焦点」：AI 综述、最相关 5 篇、来路与去向、逐条理由与证据。</li>
                <li>双击节点 → 打开阅读器；「全库概览」或 <Kbd>Esc</Kbd> 回到全库。</li>
                <li>选中一篇后再悬停另一篇，会显示两者之间的最短路径。</li>
              </ul>
            </Card>

            <Card title="③ 找得到、缩得小">
              <ul>
                <li>搜索框输入即过滤，前缀可以叠加：</li>
              </ul>
              <div className="pr-guide-prefixes">
                <Kbd>tag:</Kbd>
                <Kbd>author:</Kbd>
                <Kbd>year:&gt;2023</Kbd>
                <Kbd>kind:</Kbd>
                <Kbd>cluster:</Kbd>
                <Kbd>is:pending</Kbd>
              </div>
              <ul>
                <li>回车 → 跨库全文检索，命中片段列在检查器里，点一条直接跳到对应页。</li>
                <li>关系类型、主题簇、「待确认」都能叠加；「焦点 2 跳」只看选中论文两跳内的邻居。</li>
              </ul>
            </Card>

            <Card title="④ 手势与快捷键">
              <ul>
                <li>拖节点、滚轮缩放、拖空白平移；右上角 HUD 是放大 / 缩小 / 适应 / 标题 / 年份着色。</li>
                <li><Kbd>Ctrl F</Kbd> 或 <Kbd>/</Kbd> 搜索，<Kbd>G</Kbd> 图谱，<Kbd>L</Kbd> 列表，<Kbd>Esc</Kbd> 清除选中。</li>
                <li>「年」把节点颜色从主题换成发表年份，右下角色带是年份区间。</li>
              </ul>
            </Card>

            <Card title="⑤ 让关系变准">
              <ul>
                <li>「重建关联」跑五步：画像 → 引用 → 候选 → AI 判定 → 主题；进度显示在按钮上。</li>
                <li>待确认里的边可以「接受」或「忽略」；忽略过的组合，重建时不会再出现。</li>
                <li>导入新论文只算它和全库的关系；全量重算只在点「重建关联」时发生。</li>
              </ul>
            </Card>

            <Card title="⑥ 没有模型 / 常见疑问">
              <ul>
                <li>没配模型时只剩引用、概念、文本信号：有边，但没有类型、理由和 AI 综述。</li>
                <li>两篇很像却没有边：候选要过阈值且每篇最多 6 条，先去「待确认」找。</li>
                <li>边上的数字是<b>证据强度</b>（0.7×模型判断 + 0.3×信号分），不是概率。</li>
              </ul>
            </Card>
          </div>
        </div>

        <div className="pr-dlg-foot">
          <label className="pr-guide-auto">
            <input
              type="checkbox"
              checked={auto}
              onChange={(event) => onAutoChange(event.target.checked)}
            />
            以后进入关联页时自动打开
          </label>
          <div className="pr-spacer" />
          <button ref={startRef} type="button" className="pr-btn pr-guide-start" data-primary onClick={onClose}>
            开始使用
          </button>
        </div>
      </div>
    </div>
  )
}
