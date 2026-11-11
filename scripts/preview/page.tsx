/**
 * Real-page preview: the original PDF page rasterised by pdf.js, with the
 * re-typeset Chinese translation painted over it — the same code path the
 * reader uses, so the screenshot shows masks, fonts and line fitting for real.
 *
 * Served by `scripts/preview-page.mjs` (an HTTP server, so the pdf.js worker
 * module loads normally).
 */
import { createRoot } from 'react-dom/client'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { TranslatedPage } from '../../src/client/features/reader/TranslatedPage.js'
import { tokens } from '../../src/client/theme/styles/tokens.js'
import { translation } from '../../src/client/theme/styles/translation.js'
import type { TranslationPagePayload } from '../../src/client/types.js'

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs'

async function main(): Promise<void> {
  const payload: TranslationPagePayload = await fetch('/payload.json').then((response) => response.json())
  const pageNumber = payload.page.page
  const realFetch = globalThis.fetch.bind(globalThis)

  // Only the translation endpoint is faked; pdf.js still fetches /paper.pdf.
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/translation/pages/')) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return realFetch(input as RequestInfo, init)
  }

  const doc = await pdfjs.getDocument({ url: '/paper.pdf', isEvalSupported: false }).promise
  const width = Number(new URLSearchParams(location.search).get('width') ?? 600)

  const root = createRoot(document.getElementById('root') as HTMLElement)
  root.render(
    <div className="pr-root" data-scheme="light">
      <style>{`${tokens}\n${translation}\nbody{margin:0;background:#e8e8ea}`}</style>
      <div style={{ padding: 20, display: 'flex', justifyContent: 'center' }}>
        <TranslatedPage
          paperId="preview"
          pageNumber={pageNumber}
          doc={doc}
          width={width}
          zoom={1}
          version="preview"
        />
      </div>
    </div>,
  )
}

void main()
