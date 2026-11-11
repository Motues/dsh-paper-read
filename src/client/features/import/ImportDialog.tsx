import { useEffect, useMemo, useRef, useState } from 'react'
import { watchJob } from '../../lib/api.js'
import type { Folder, Job } from '../../types.js'
import {
  IconCheck,
  IconClose,
  IconFile,
  IconFolder,
  IconLink,
  IconSpark,
  IconUpload,
} from '../../components/ui.js'

export type ImportRequest =
  | { kind: 'pdf'; files: File[] }
  | { kind: 'link'; url: string }

export type ImportProgress = (done: number, total: number, label: string) => void

const isPdf = (file: File): boolean =>
  file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf'

const fileKey = (file: File): string => {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  return relative || `${file.name}:${file.size}:${file.lastModified}`
}

/** Three ways in: local PDFs (including whole folders), or an identifier/link. */
export function ImportDialog({
  targetFolder = null,
  onClose,
  onStart,
}: {
  /** When opened from a folder's import icon, the new papers land here. */
  targetFolder?: Folder | null
  onClose: () => void
  onStart: (request: ImportRequest, onProgress: ImportProgress) => Promise<void>
}) {
  const [mode, setMode] = useState<'pdf' | 'link'>('pdf')
  const [files, setFiles] = useState<File[]>([])
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement | null>(null)
  const urlInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  useEffect(() => {
    if (mode === 'link') urlInput.current?.focus()
  }, [mode])

  const folderLabel = useMemo(() => {
    const relative = (files[0] as File & { webkitRelativePath?: string } | undefined)?.webkitRelativePath
    return relative ? relative.split('/')[0] || null : null
  }, [files])

  const canStart = mode === 'pdf' ? files.length > 0 : url.trim().length > 4

  const addFiles = (list: FileList | File[] | null) => {
    if (busy || !list) return
    const incoming = Array.from(list)
    const pdfs = incoming.filter(isPdf)
    if (pdfs.length === 0) {
      setError(incoming.length > 0 ? '只支持 PDF 文件' : '没有找到 PDF 文件')
      return
    }
    const known = new Set(files.map(fileKey))
    const fresh = pdfs.filter((file) => {
      const key = fileKey(file)
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    if (fresh.length === 0) {
      setError('这些 PDF 已经在列表里')
      return
    }
    setFiles([...files, ...fresh])
    setError(null)
  }

  const addDropped = async (transfer: DataTransfer) => {
    if (busy) return
    const entries = Array.from(transfer.items ?? [])
      .map((item) => item.webkitGetAsEntry?.() ?? null)
      .filter((entry): entry is FileSystemEntry => Boolean(entry))
    if (entries.length === 0) {
      addFiles(transfer.files)
      return
    }

    const found: File[] = []
    const walk = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          (entry as FileSystemFileEntry).file(resolve, reject)
        })
        if (isPdf(file)) found.push(file)
        return
      }
      if (!entry.isDirectory) return
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject)
        })
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }

    try {
      for (const entry of entries) await walk(entry)
    } catch (dropError) {
      setError(`读取文件夹失败：${(dropError as Error).message}`)
      return
    }
    if (found.length === 0) {
      setError('没有找到 PDF 文件')
      return
    }
    addFiles(found)
  }

  const start = async () => {
    if (!canStart || busy) return
    setBusy(true)
    setError(null)
    setProgress(null)
    try {
      await onStart(
        mode === 'pdf' ? { kind: 'pdf', files } : { kind: 'link', url: url.trim() },
        (done, total, label) => setProgress({ done, total, label }),
      )
      setBusy(false)
    } catch (startError) {
      setError((startError as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="pr-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <div className="pr-dialog" role="dialog" aria-modal="true" aria-label="导入论文">
        <div className="pr-dlg-head">
          <div className="pr-dlg-icon">
            <IconUpload size={15} />
          </div>
          <div style={{ minWidth: 0 }}>
            <b>导入论文</b>
            <div className="pr-dlg-sub">导入后会自动解析全文、抓取元数据与参考文献，并生成导读。</div>
            {targetFolder ? (
              <div className="pr-dlg-target" title={targetFolder.name}>
                导入到
                <IconFolder size={12} />
                <b>{targetFolder.name}</b>
              </div>
            ) : null}
          </div>
          <div className="pr-spacer" />
          <button className="pr-btn" data-icon data-ghost title="关闭" onClick={onClose} disabled={busy}>
            <IconClose size={15} />
          </button>
        </div>

        <div className="pr-dlg-tabs">
          <button data-on={mode === 'pdf' || undefined} onClick={() => setMode('pdf')} disabled={busy}>
            <IconFile size={13} />
            PDF 文件
          </button>
          <button data-on={mode === 'link' || undefined} onClick={() => setMode('link')} disabled={busy}>
            <IconLink size={13} />
            标识符 / 链接
          </button>
        </div>

        <div className="pr-dlg-body">
          {mode === 'pdf' ? (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                hidden
                onChange={(event) => {
                  addFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <input
                ref={(element) => {
                  folderInput.current = element
                  if (element) {
                    element.setAttribute('webkitdirectory', '')
                    element.setAttribute('directory', '')
                  }
                }}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  addFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <div
                className="pr-drop"
                data-drag={dragging}
                data-filled={files.length > 0}
                role="button"
                tabIndex={0}
                aria-disabled={busy}
                onClick={() => {
                  if (!busy) fileInput.current?.click()
                }}
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ' ') && !busy) fileInput.current?.click()
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={(event) => {
                  const next = event.relatedTarget as Node | null
                  if (next && event.currentTarget.contains(next)) return
                  setDragging(false)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  void addDropped(event.dataTransfer)
                }}
              >
                <div className="pr-drop-icon">
                  <IconFile size={20} />
                </div>
                {files.length > 0 ? (
                  <>
                    <b className="pr-drop-title">
                      {files.length === 1 ? files[0].name : `已选 ${files.length} 个 PDF`}
                    </b>
                    <span className="pr-drop-hint">
                      {folderLabel
                        ? `文件夹「${folderLabel}」· 点击可继续添加`
                        : files.length > 1
                          ? `${files.slice(0, 2).map((file) => file.name).join(' · ')}${files.length > 2 ? ` 等 ${files.length} 个` : ''}`
                          : '点击可继续添加 · 也可以把整个文件夹拖到这里'}
                    </span>
                  </>
                ) : (
                  <>
                    <b className="pr-drop-title">把 PDF 或文件夹拖到这里</b>
                    <span className="pr-drop-hint">或点击选择文件 · 支持多选与整个文件夹</span>
                  </>
                )}
              </div>
              <div className="pr-drop-actions">
                <button
                  type="button"
                  className="pr-btn"
                  data-sm
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <IconFile size={13} />
                  选择 PDF
                </button>
                <button
                  type="button"
                  className="pr-btn"
                  data-sm
                  disabled={busy}
                  onClick={() => folderInput.current?.click()}
                >
                  <IconFolder size={13} />
                  选择文件夹
                </button>
                {files.length > 0 ? (
                  <button
                    type="button"
                    className="pr-btn"
                    data-sm
                    data-ghost
                    disabled={busy}
                    onClick={() => {
                      setFiles([])
                      setError(null)
                    }}
                  >
                    清空
                  </button>
                ) : null}
              </div>
              <div className="pr-dlg-note">
                <IconFile size={11} />
                整个文件夹（含子文件夹）里的 PDF 会批量上传并依次入库。
              </div>
            </>
          ) : (
            <>
              <label className="pr-field">
                <span className="pr-field-label">论文标识符 / 链接</span>
                <div className="pr-field-input" data-invalid={url.length > 0 && url.trim().length <= 4}>
                  <IconLink size={14} />
                  <input
                    ref={urlInput}
                    value={url}
                    placeholder="粘贴 DOI、arXiv ID、PMID 或论文链接"
                    onChange={(event) => setUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void start()
                    }}
                  />
                  {url ? (
                    <button className="pr-field-clear" title="清空" onClick={() => setUrl('')}>
                      <IconClose size={12} />
                    </button>
                  ) : null}
                </div>
              </label>
              <div className="pr-examples">
                <span>试试：</span>
                {['10.1038/nature14539', 'arXiv:1706.03762', 'PMID: 26017442'].map(
                  (example) => (
                    <button key={example} onClick={() => setUrl(example)}>
                      {example}
                    </button>
                  ),
                )}
              </div>
              <div className="pr-dlg-note">
                <IconSpark size={11} />
                自动抓取标题、作者、期刊、年份、摘要与参考文献；需要登录的 PDF 只导入基本信息，可稍后上传。
              </div>
            </>
          )}
          {error ? <div className="pr-dlg-error">{error}</div> : null}
          {busy && progress ? (
            <div className="pr-upload-progress" aria-hidden>
              <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
          ) : null}
        </div>

        <div className="pr-dlg-foot">
          <span className="pr-dlg-hint">
            {busy
              ? progress
                ? `正在上传 ${progress.done}/${progress.total} · ${progress.label}`
                : '正在提交…'
              : mode === 'pdf'
                ? '一次可导入多篇；文件夹会递归读取其中的 PDF'
                : 'DOI / arXiv / PMID 与页面链接均可直接粘贴'}
          </span>
          <button className="pr-btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="pr-btn" data-primary disabled={!canStart || busy} onClick={() => void start()}>
            <IconUpload size={13} />
            {busy ? '导入中…' : '开始导入'}
          </button>
        </div>
      </div>
    </div>
  )
}

const STATE_GLYPH: Record<Job['state'], string> = {
  queued: '排队',
  running: '处理中',
  done: '完成',
  failed: '失败',
}

export function JobQueue({
  jobIds,
  onClose,
  onFinished,
}: {
  jobIds: string[]
  onClose: () => void
  onFinished: (paperId: string) => void
}) {
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const finishedRef = useRef(false)

  useEffect(() => {
    const stops = jobIds.map((id) => watchJob(id, (job) => {
      setJobs((previous) => ({ ...previous, [job.id]: job }))
    }))
    return () => stops.forEach((stop) => stop())
  }, [jobIds])

  const list = useMemo(
    () => jobIds.map((id) => jobs[id]).filter(Boolean),
    [jobIds, jobs],
  )
  const settled = list.length === jobIds.length
    && list.every((job) => job.state === 'done' || job.state === 'failed')

  useEffect(() => {
    if (!settled || finishedRef.current) return
    finishedRef.current = true
    const imported = list.find((job) => job.state === 'done' && job.paperId)
    if (imported?.paperId) onFinished(imported.paperId)
  }, [list, onFinished, settled])

  return (
    <div className="pr-queue" role="status" aria-live="polite">
      <div className="pr-queue-head">
        <b>{settled ? '导入完成' : '导入队列'}</b>
        <span className="pr-queue-sub">
          {list.filter((job) => job.state === 'done').length} / {jobIds.length}
        </span>
        <div className="pr-spacer" />
        <button className="pr-btn" data-icon data-ghost title="收起" onClick={onClose}>
          <IconClose size={13} />
        </button>
      </div>
      <div className="pr-queue-list">
        {list.map((job) => (
          <div className="pr-queue-item" key={job.id}>
            <div className="pr-queue-title">
              <span className="pr-queue-name" title={job.sourceLabel}>{job.sourceLabel}</span>
              <span className="pr-queue-state" data-s={job.state}>{STATE_GLYPH[job.state]}</span>
            </div>
            <div className="pr-queue-steps">
              {job.steps.map((step) => (
                <span className="pr-step" data-s={step.state} key={step.key} title={step.detail ?? step.label}>
                  {step.state === 'done' ? <IconCheck size={10} /> : <i />}
                  {step.label}
                  {step.state === 'running' && step.detail ? <b>{step.detail}</b> : null}
                </span>
              ))}
            </div>
            {job.duplicate ? <div className="pr-queue-note">库里已经有这篇，已跳过。</div> : null}
            {job.error ? <div className="pr-queue-note" data-error>{job.error}</div> : null}
            {job.warnings?.length ? (
              <div className="pr-queue-note">{job.warnings.join('；')}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
