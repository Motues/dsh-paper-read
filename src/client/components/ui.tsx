import React from 'react'
import katex from 'katex'

type IconProps = { size?: number; className?: string }

const base = (size: number | undefined, className: string | undefined) => ({
  width: size ?? 16,
  height: size ?? 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: `pr-svg-icon ${className ?? ''}`,
  'aria-hidden': true,
})

export const IconSearch = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 13.5 13.5" />
  </svg>
)

/** A question mark in a circle: opens the in-app guide. */
export const IconHelp = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.5.3-.8.7-.8 1.3v.3" />
    <circle cx="8" cy="11.6" r=".85" fill="currentColor" stroke="none" />
  </svg>
)

export const IconPlus = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
)

export const IconMinus = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3.5 8h9" />
  </svg>
)

/** Four corner brackets: fit the graph to the canvas. */
export const IconFit = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.8 6V2.8H6M10 2.8h3.2V6M13.2 10v3.2H10M6 13.2H2.8V10" />
  </svg>
)

/** A small spark + link: the "AI is writing this" affordance. */
export const IconSparkLink = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 2.4 9.1 5.6 12.3 6.7 9.1 7.8 8 11 6.9 7.8 3.7 6.7 6.9 5.6Z" />
    <path d="M12.2 10.4l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5Z" />
  </svg>
)

export const IconGrid = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="2.5" y="2.5" width="4.4" height="4.4" rx="1" />
    <rect x="9.1" y="2.5" width="4.4" height="4.4" rx="1" />
    <rect x="2.5" y="9.1" width="4.4" height="4.4" rx="1" />
    <rect x="9.1" y="9.1" width="4.4" height="4.4" rx="1" />
  </svg>
)

/** Four ascending bars: token usage / statistics. */
export const IconChart = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.8 13.2V9.6M6.2 13.2V6.4M9.6 13.2V8M13 13.2V3.4" />
  </svg>
)

export const IconList = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
    <circle cx="2.8" cy="4" r=".7" fill="currentColor" stroke="none" />
    <circle cx="2.8" cy="8" r=".7" fill="currentColor" stroke="none" />
    <circle cx="2.8" cy="12" r=".7" fill="currentColor" stroke="none" />
  </svg>
)

/** One page: single-page reading mode. */
export const IconLayoutSingle = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="4" y="2.4" width="8" height="11.2" rx="1.1" />
  </svg>
)

/** Two pages side by side: spread reading mode. */
export const IconLayoutSpread = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="1.9" y="2.9" width="5.3" height="10.2" rx="1" />
    <rect x="8.8" y="2.9" width="5.3" height="10.2" rx="1" />
  </svg>
)

/** A stack of pages: continuous scrolling mode. */
export const IconLayoutContinuous = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="3.4" y="1.9" width="9.2" height="3.4" rx=".9" />
    <rect x="3.4" y="6.3" width="9.2" height="3.4" rx=".9" />
    <rect x="3.4" y="10.7" width="9.2" height="3.4" rx=".9" />
  </svg>
)

/** A picture frame: the rail's preview (thumbnail) mode. */
export const IconImage = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="2.3" y="3" width="11.4" height="10" rx="1.6" />
    <circle cx="6" cy="6.4" r="1.1" />
    <path d="M3.2 11.6 6.5 8.6l2.1 1.8 1.9-1.5 2.3 2.1" />
  </svg>
)

export const IconSpark = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 2.2 9.3 6.1 13.2 7.4 9.3 8.7 8 12.6 6.7 8.7 2.8 7.4 6.7 6.1Z" />
    <path d="M12.4 11.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5Z" />
  </svg>
)

/** A beaker: 设置 → 实验性功能. */
export const IconFlask = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M6.2 2.4h3.6M6.9 2.4v3.1L3.4 11.6c-.4.7.1 1.6.9 1.6h7.4c.8 0 1.3-.9.9-1.6L9.1 5.5V2.4" />
    <path d="M5.2 9.6h5.6" />
    <circle cx="7.1" cy="11.6" r=".6" />
    <circle cx="9.2" cy="10.7" r=".4" />
  </svg>
)

/** A pulse line: 侧栏 → 任务列表. */
export const IconActivity = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M1.8 8.4h2.6L6.2 4l2.1 8 2-5.2h1.9" />
    <path d="M12.9 8.4h1.3" />
  </svg>
)

export const IconBack = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M9.8 3.6 5.4 8l4.4 4.4" />
  </svg>
)

export const IconClock = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 4.8V8l2.2 1.4" />
  </svg>
)

export const IconLibrary = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.8 3.4v9.2M5.6 3.4v9.2" />
    <rect x="7.9" y="3.4" width="2.6" height="9.2" rx=".7" />
    <path d="M12.4 4.2l2.1 8" />
  </svg>
)

export const IconFolder = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.4 4.6c0-.6.5-1.1 1.1-1.1h2.6l1.2 1.4h4.2c.6 0 1.1.5 1.1 1.1v5c0 .6-.5 1.1-1.1 1.1H3.5c-.6 0-1.1-.5-1.1-1.1Z" />
  </svg>
)

/** Open folder: an expanded branch reads differently from a collapsed one. */
export const IconFolderOpen = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.4 4.6c0-.6.5-1.1 1.1-1.1h2.6l1.2 1.4h4.2c.6 0 1.1.5 1.1 1.1v1.2" />
    <path d="M2.6 12.5 3.9 7c.1-.4.5-.7.9-.7h8.5c.6 0 1 .5.9 1.1l-1.1 4.4c-.1.4-.5.7-.9.7H3.5c-.6 0-1-.5-.9-1Z" />
  </svg>
)

/** Folder with a plus: "new subfolder". */
export const IconFolderPlus = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.4 4.6c0-.6.5-1.1 1.1-1.1h2.6l1.2 1.4h4.2c.6 0 1.1.5 1.1 1.1v5c0 .6-.5 1.1-1.1 1.1H3.5c-.6 0-1.1-.5-1.1-1.1Z" />
    <path d="M8 7.2v3M6.5 8.7h3" />
  </svg>
)

/** Collapse every branch: two chevrons pointing at each other. */
export const IconCollapseAll = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4.2 3.4 8 7.2l3.8-3.8" />
    <path d="M4.2 12.6 8 8.8l3.8 3.8" />
  </svg>
)

/** Counter-clockwise arrow: restore from the recycle bin. */
export const IconRestore = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3.2 7.2a5 5 0 1 0 1.3-3.5" />
    <path d="M3.1 3.3v4h4" />
  </svg>
)

/** Cog: the system-settings entry. */
export const IconGear = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="8" cy="8" r="4.2" />
    <circle cx="8" cy="8" r="1.6" />
    <path d="M8 3.5V1.9M8 12.5v1.6M3.5 8H1.9M12.5 8h1.6M4.8 4.8 3.7 3.7M11.2 11.2l1.1 1.1M11.2 4.8l1.1-1.1M4.8 11.2l-1.1 1.1" />
  </svg>
)

export const IconTrash = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3 4.5h10" />
    <path d="M6.2 4.5V3.2h3.6v1.3" />
    <path d="M4.4 4.5 5.1 13h5.8l.7-8.5" />
    <path d="M6.7 6.8v4M9.3 6.8v4" />
  </svg>
)

export const IconPencil = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M10.9 2.6 13.4 5.1 6.1 12.4 3.1 13.1l.7-3Z" />
    <path d="M9.7 3.8 12.2 6.3" />
    <path d="m4 10.2 1.8 1.8" />
  </svg>
)

export const IconTag = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.6 7.6V3.4c0-.4.4-.8.8-.8h4.2l5.8 5.8-5 5Z" />
    <circle cx="5.4" cy="5.4" r="1" fill="currentColor" stroke="none" />
  </svg>
)

export const IconChevronDown = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3.8 6.2 8 10.2l4.2-4" />
  </svg>
)

export const IconMoreDots = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="3.2" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="12.8" cy="8" r="1" fill="currentColor" stroke="none" />
  </svg>
)

export const IconStar = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 2.6l1.7 3.5 3.8.55-2.75 2.68.65 3.8L8 11.35 4.6 13.1l.65-3.8L2.5 6.65l3.8-.55Z" />
  </svg>
)

export const IconMore = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="3.4" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="12.6" cy="8" r="1" fill="currentColor" stroke="none" />
  </svg>
)

export const IconNote = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3 3.4h10v6.2L9.6 13H3Z" />
    <path d="M9.4 13v-3.2H13" />
    <path d="M5.2 6h5.6M5.2 8.2h3.4" />
  </svg>
)

export const IconSend = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 12.6V3.6" />
    <path d="M4.3 7.1 8 3.4l3.7 3.7" />
  </svg>
)

/** Paper plane: the composer's send affordance. */
export const IconPaperPlane = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M13.9 2.5 2.3 7.5l4.9 2.1 2.2 4.9z" />
    <path d="M13.9 2.5 7.2 9.6" />
  </svg>
)

/** Compress: pull the transcript back into its summary. */
export const IconCompress = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.9 6.1h3.9V2.2" />
    <path d="M13.1 9.9H9.2v3.9" />
    <path d="M2.9 2.2 6.8 6.1" />
    <path d="M13.1 13.8 9.2 9.9" />
  </svg>
)

/** Eraser: drop the conversation and start a clean one. */
export const IconEraser = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M9.7 2.6 3.1 9.2a1.5 1.5 0 0 0 0 2.1l1.5 1.5a1.5 1.5 0 0 0 2.1 0l6.6-6.6a1.5 1.5 0 0 0 0-2.1l-1.5-1.5a1.5 1.5 0 0 0-2.1 0Z" />
    <path d="M7.1 6.2 9.9 9" />
    <path d="M3.4 13.4h9.2" />
  </svg>
)

/** Clock with a back arrow: the paper's conversation history. */
export const IconHistory = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.6 7.2a5.4 5.4 0 1 1 1.4 4.1" />
    <path d="M2.5 3.2v4h4" />
    <path d="M8 5.2V8l2.2 1.3" />
  </svg>
)

/** Archive box: hide a conversation from the normal list, keep the log. */
export const IconArchive = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="2.4" y="3.2" width="11.2" height="2.8" rx=".8" />
    <path d="M3.4 6.4v5.1c0 .7.5 1.2 1.2 1.2h6.8c.7 0 1.2-.5 1.2-1.2V6.4" />
    <path d="M6.5 8.8h3" />
  </svg>
)

/** Two overlapping A/文 cards: full-text translation. */
export const IconTranslate = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.6 3.4h5.2M5.2 3.4v1.1c0 1.9-1 3.5-2.6 4.5" />
    <path d="M3.4 6.1c.5 1.3 1.7 2.3 3.2 2.8" />
    <path d="M8.4 13.1l2.2-5.6 2.2 5.6" />
    <path d="M9.2 11.2h2.8" />
  </svg>
)

export const IconClose = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)

export const IconCheck = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3.2 8.4 6.4 11.6 12.8 4.8" />
  </svg>
)

export const IconCircle = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="8" cy="8" r="5.7" />
  </svg>
)

export const IconCircleCheck = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="8" cy="8" r="5.7" />
    <path d="m5.2 8.2 1.9 1.9 3.7-4.2" />
  </svg>
)

export const IconCopy = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="5.4" y="5.4" width="7.4" height="7.4" rx="1.4" />
    <path d="M10.6 5.4V4.2A1.2 1.2 0 0 0 9.4 3H4.2A1.2 1.2 0 0 0 3 4.2v5.2A1.2 1.2 0 0 0 4.2 10.6h1.2" />
  </svg>
)

export const IconChevronRight = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M6.2 3.6 10.6 8l-4.4 4.4" />
  </svg>
)

export const IconEnter = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12.8 3.6v4.2a2 2 0 0 1-2 2H3.8" />
    <path d="M6.4 6.6 3.4 9.8l3 3.2" />
  </svg>
)

export const IconFile = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 2.4h5.2L12.6 6v7.6H4Z" />
    <path d="M9 2.6V6.2h3.4" />
  </svg>
)

export const IconUpload = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 10.4V2.6" />
    <path d="M5.1 5.3 8 2.4l2.9 2.9" />
    <path d="M2.8 9.6v2.2a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4V9.6" />
  </svg>
)

export const IconLink = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M6.4 9.6 9.6 6.4" />
    <path d="M7.1 4.4 8.3 3.2a2.4 2.4 0 0 1 3.4 3.4l-1.2 1.2" />
    <path d="M8.9 11.6 7.7 12.8a2.4 2.4 0 0 1-3.4-3.4l1.2-1.2" />
  </svg>
)

export const IconPanelCollapse = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="2.4" y="3" width="11.2" height="10" rx="1.6" />
    <path d="M9.6 3v10" />
    <path d="M6.8 6.6 5.2 8l1.6 1.4" />
  </svg>
)

export const IconPanelExpand = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="2.4" y="3" width="11.2" height="10" rx="1.6" />
    <path d="M9.6 3v10" />
    <path d="M5.2 6.6 6.8 8l-1.6 1.4" />
  </svg>
)

type InlineToken = { kind: 'text'; value: string } | { kind: 'math'; value: string }
type RichBlock = { kind: 'paragraph'; tokens: InlineToken[] } | { kind: 'math'; value: string }

function findDollarEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '\n') return -1
    if (text[index] === '$' && text[index - 1] !== '\\') return index
  }
  return -1
}

/** Split one paragraph into text / inline-math tokens. */
function parseInline(text: string): InlineToken[] {
  const out: InlineToken[] = []
  let start = 0
  let index = 0
  const pushText = (to: number) => {
    const value = text.slice(start, to).replace(/\\\$/g, '$')
    if (value.length > 0) out.push({ kind: 'text', value })
  }
  while (index < text.length) {
    if (text.startsWith('\\(', index)) {
      const end = text.indexOf('\\)', index + 2)
      if (end > index + 2) {
        pushText(index)
        out.push({ kind: 'math', value: text.slice(index + 2, end) })
        index = end + 2
        start = index
        continue
      }
    }
    if (text[index] === '$' && text[index - 1] !== '\\') {
      const end = findDollarEnd(text, index + 1)
      if (end > index + 1) {
        const body = text.slice(index + 1, end)
        // Reject "$5 and $10"-style currency runs: no edge whitespace.
        if (body.length > 0 && body === body.trim()) {
          pushText(index)
          out.push({ kind: 'math', value: body })
          index = end + 1
          start = index
          continue
        }
      }
    }
    index += 1
  }
  pushText(text.length)
  return out
}

function parseBlocks(text: string): RichBlock[] {
  const blocks: RichBlock[] = []
  const pushText = (raw: string) => {
    const trimmed = raw.replace(/^\n+|\n+$/g, '')
    if (!trimmed.trim()) return
    for (const part of trimmed.split(/\n{2,}/)) {
      const value = part.replace(/^\n+|\n+$/g, '')
      if (!value.trim()) continue
      blocks.push({ kind: 'paragraph', tokens: parseInline(value) })
    }
  }
  const display = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = display.exec(text)) !== null) {
    pushText(text.slice(cursor, match.index))
    const value = (match[1] ?? match[2] ?? '').trim()
    if (value) blocks.push({ kind: 'math', value })
    cursor = match.index + match[0].length
  }
  pushText(text.slice(cursor))
  return blocks
}

function renderMath(expression: string, display: boolean): React.ReactNode {
  try {
    const html = katex.renderToString(expression, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      trust: false,
      output: 'html',
    })
    return (
      <span
        className={display ? 'pr-math-display' : 'pr-math-inline'}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  } catch {
    return <code>{display ? `$$${expression}$$` : `$${expression}$`}</code>
  }
}

function renderInline(tokens: InlineToken[]): React.ReactNode[] {
  return tokens.map((token, index) => {
    if (token.kind === 'math') return <React.Fragment key={index}>{renderMath(token.value, false)}</React.Fragment>
    return (
      <React.Fragment key={index}>
        {token.value.split(/(\*\*[^*]+\*\*)/g).map((piece, pieceIndex) => (
          piece.startsWith('**') && piece.endsWith('**') ? (
            <b key={pieceIndex}>{piece.slice(2, -2)}</b>
          ) : (
            <React.Fragment key={pieceIndex}>{piece}</React.Fragment>
          )
        ))}
      </React.Fragment>
    )
  })
}

/**
 * Render model / summary text: paragraphs, `**bold**`, inline `$...$` and
 * `\(...\)`, plus display `$$...$$` and `\[...\]`. KaTeX output is trusted
 * markup generated with `trust: false`; everything else stays React-escaped.
 */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {parseBlocks(text).map((block, index) => (
        block.kind === 'math' ? (
          <div className="pr-math-block" key={index}>{renderMath(block.value, true)}</div>
        ) : (
          <p className="pr-para" key={index}>{renderInline(block.tokens)}</p>
        )
      ))}
    </>
  )
}
