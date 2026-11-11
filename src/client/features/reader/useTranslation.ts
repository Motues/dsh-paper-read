/**
 * Full-text translation state for one paper.
 *
 * The host owns the cache and the background run; this hook mirrors the status,
 * polls while a host run is in flight, and drives the browser-source loop when
 * the configured engine can only run in the page.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import {
  BrowserTranslationError,
  checkBrowserTranslator,
  detectBrowserTranslator,
  getBrowserSession,
  translateBrowserBlock,
  type BrowserTranslatorSupport,
} from '../../lib/browser-translate.js'
import type { Block, TranslationPagePayload, TranslationSource, TranslationStatus } from '../../types.js'

export interface TranslationProgress {
  done: number
  total: number
  page: number
}

export interface TranslationActions {
  status: TranslationStatus | null
  busy: boolean
  error: string | null
  running: boolean
  start: (input?: { pages?: number[]; force?: boolean }) => Promise<void>
  cancel: () => Promise<void>
  refresh: () => Promise<void>
  loadPage: (page: number) => Promise<TranslationPagePayload>
  source: TranslationStatus['source'] | undefined
  sourceLabel: string
  mode: TranslationStatus['mode'] | undefined
  available: boolean
  browser: BrowserTranslatorSupport | null
  /** Language-pack download percent while the browser model is fetched. */
  download: number | null
  progress: TranslationProgress | null
}

export function usePaperTranslation(
  paperId: string,
  sourceHint?: TranslationSource,
  languageHint?: string,
): TranslationActions {
  const [status, setStatus] = useState<TranslationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [browser, setBrowser] = useState<BrowserTranslatorSupport | null>(null)
  const [download, setDownload] = useState<number | null>(null)
  const [progress, setProgress] = useState<TranslationProgress | null>(null)
  const [browserRunning, setBrowserRunning] = useState(false)
  const alive = useRef(true)
  const wasRunning = useRef(false)
  const browserAbort = useRef<AbortController | null>(null)
  const statusRef = useRef<TranslationStatus | null>(null)

  statusRef.current = status

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      browserAbort.current?.abort()
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await api.translation(paperId)
      if (!alive.current) return
      setStatus(next)
      setError(null)
    } catch (cause) {
      if (alive.current) setError((cause as Error).message)
    }
  }, [paperId])

  useEffect(() => {
    setStatus(null)
    setError(null)
    setBrowser(null)
    setDownload(null)
    setProgress(null)
    setBrowserRunning(false)
    void refresh()
  }, [paperId, refresh])

  // Browser capability is per page (and can differ between the Electron shell
  // and the same URL opened in Chrome/Edge), so probe it whenever the source
  // becomes/browser stays the browser engine.
  useEffect(() => {
    const source = status?.source ?? sourceHint
    if (source !== 'browser') {
      setBrowser(null)
      return undefined
    }
    let cancelled = false
    const language = languageHint ?? status?.sourceLanguage ?? 'en'
    void checkBrowserTranslator(language).then((next) => {
      if (!cancelled) setBrowser(next)
    })
    return () => {
      cancelled = true
    }
  }, [languageHint, sourceHint, status?.source, status?.sourceLanguage])

  const running = status?.running === true || browserRunning

  useEffect(() => {
    if (!running || browserRunning) return undefined
    const timer = window.setInterval(() => {
      void refresh()
    }, 1400)
    return () => window.clearInterval(timer)
  }, [running, browserRunning, refresh])

  // The last poll can land just before the host flips `running` off; one final
  // read makes the completion state exact.
  useEffect(() => {
    if (wasRunning.current && !running) void refresh()
    wasRunning.current = running
  }, [running, refresh])

  /** Browser loop: pull the parsed document, translate missing blocks, commit page by page. */
  const startBrowser = useCallback(async (force = false): Promise<void> => {
    const snapshot = statusRef.current
    const language = languageHint ?? snapshot?.sourceLanguage ?? 'en'
    setBusy(true)
    setError(null)
    setProgress(null)
    setDownload(null)
    // detect() is synchronous; create the model session immediately so the
    // click that started the run is still the user activation the browser may
    // require for the first language-pack download.
    const support = detectBrowserTranslator()
    if (!alive.current) return
    setBrowser(support)
    if (!support.supported) {
      setError(support.detail ?? '当前浏览器不支持内置翻译')
      setBusy(false)
      return
    }

    const controller = new AbortController()
    browserAbort.current = controller
    setBrowserRunning(true)
    setBusy(false)
    let failure: string | null = null

    try {
      await getBrowserSession({
        sourceLanguage: language,
        signal: controller.signal,
        onDownload: (event) => {
          if (alive.current) setDownload(event.percent)
        },
      })
      if (alive.current) setDownload(null)
      const doc = await api.translationDocument(paperId)
      const jobs: Array<{ page: TranslationPagePayload; blocks: Block[] }> = []
      let total = 0
      for (const payload of doc.pages) {
        const byId = new Map(payload.page.blocks.map((block) => [block.id, block]))
        const order = payload.order ?? payload.page.blocks.map((block) => block.id)
        const ids = order.filter((id) => {
          if (!force && payload.blocks[id]) return false
          if (payload.skipped && payload.skipped[id]) return false
          const block = byId.get(id)
          return Boolean(block) && (block?.text.trim().length ?? 0) >= 2
        })
        const blocks = ids
          .map((id) => byId.get(id))
          .filter((block): block is Block => Boolean(block))
        if (blocks.length > 0) {
          jobs.push({ page: payload, blocks })
          total += blocks.length
        }
      }
      if (jobs.length === 0) {
        setProgress({ done: 0, total: 0, page: 0 })
        return
      }

      let done = 0
      for (const job of jobs) {
        if (controller.signal.aborted) break
        const results: Array<{ id: string; t: string }> = []
        for (const block of job.blocks) {
          if (controller.signal.aborted) break
          try {
            const t = await translateBrowserBlock(block.text, {
              sourceLanguage: language,
              signal: controller.signal,
              onDownload: (event) => {
                if (alive.current) setDownload(event.percent)
              },
            })
            if (t.trim() !== '') results.push({ id: block.id, t })
          } catch (cause) {
            if (controller.signal.aborted) break
            if (cause instanceof BrowserTranslationError && cause.reason === 'aborted') break
            // Keep the blocks this page already produced instead of throwing
            // the whole page away with the failed block.
            if (results.length > 0) {
              await api.commitTranslation(paperId, job.page.page.page, results).catch(() => undefined)
              await refresh()
            }
            throw cause
          }
          done += 1
          if (alive.current) setProgress({ done, total, page: job.page.page.page })
        }
        if (results.length > 0 && !controller.signal.aborted) {
          const committed = await api.commitTranslation(paperId, job.page.page.page, results)
          if (committed.rejected.length > 0) {
            failure = `第 ${job.page.page.page} 页有 ${committed.rejected.length} 段未能写回（公式占位符不完整），已跳过`
            if (alive.current) setError(failure)
          }
          await refresh()
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && alive.current) {
        failure = (cause as Error)?.message ?? String(cause)
        setError(failure)
      }
    } finally {
      browserAbort.current = null
      if (alive.current) {
        setBrowserRunning(false)
        setDownload(null)
      }
      // `refresh` clears the transient host error; restore the browser failure
      // so the panel does not silently look idle after a model/download error.
      await refresh()
      if (failure && alive.current) setError(failure)
    }
  }, [paperId, refresh, languageHint])

  const start = useCallback(async (input: { pages?: number[]; force?: boolean } = {}): Promise<void> => {
    setError(null)
    // Do not await status before a browser run: the first model download needs
    // the click's activation, so the create() call must stay on that path.
    if ((statusRef.current?.source ?? sourceHint) === 'browser') {
      await startBrowser(input.force === true)
      return
    }
    if (!statusRef.current) {
      try {
        const current = await api.translation(paperId)
        statusRef.current = current
        if (alive.current) setStatus(current)
      } catch {
        /* the host start below will report the real failure */
      }
    }
    if (statusRef.current?.source === 'browser') {
      await startBrowser(input.force === true)
      return
    }
    setBusy(true)
    try {
      const next = await api.startTranslation(paperId, input)
      if (alive.current) setStatus(next)
    } catch (cause) {
      if (alive.current) setError((cause as Error).message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [paperId, sourceHint, startBrowser])

  const cancel = useCallback(async (): Promise<void> => {
    if (browserRunning || browserAbort.current) {
      browserAbort.current?.abort()
      browserAbort.current = null
      setBrowserRunning(false)
      await refresh()
      return
    }
    try {
      const next = await api.cancelTranslation(paperId)
      if (alive.current) setStatus(next)
    } catch (cause) {
      if (alive.current) setError((cause as Error).message)
    }
  }, [browserRunning, paperId, refresh])

  const loadPage = useCallback((page: number) => api.translationPage(paperId, page), [paperId])

  const effectiveSource = status?.source ?? sourceHint
  const available = effectiveSource === 'browser'
    ? browser?.supported === true
    : status?.available === true

  return {
    status,
    busy,
    error,
    running,
    start,
    cancel,
    refresh,
    loadPage,
    source: effectiveSource,
    sourceLabel: status?.sourceLabel ?? '',
    mode: status?.mode,
    available,
    browser,
    download,
    progress,
  }
}
