import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { DEFAULT_RECENT_LIMIT } from '../../../shared/constants.js'
import type { AppConfig, ModelCatalog, Paper } from '../../types.js'
import {
  IconChart,
  IconCheck,
  IconClose,
  IconCopy,
  IconFlask,
  IconFolder,
  IconGear,
  IconLayoutSingle,
  IconNote,
  IconPlus,
  IconSpark,
  IconTrash,
  IconTranslate,
} from '../../components/ui.js'
import { UsagePanel } from './UsagePanel.js'
import { TranslationPanel } from './TranslationPanel.js'
import { Select } from '../../components/Select.js'

const MB = 1024 * 1024
const RECENT_LIMIT_OPTIONS = [10, 20, 30, 50]

type SettingsSectionId = 'import' | 'model' | 'translation' | 'ui' | 'experimental' | 'chat' | 'usage' | 'maintenance'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type NoticeTone = 'info' | 'error'
type NavGroup = '通用' | '数据'

function SettingsSection({ show, title, description, children }: {
  show: boolean
  title: string
  description: string
  children: ReactNode
}) {
  if (!show) return null
  return (
    <section className="pr-settings-section">
      <div className="pr-settings-section-head">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="pr-settings-rows">{children}</div>
    </section>
  )
}

function SettingRow({ title, description, control, wide, children }: {
  title: ReactNode
  description?: ReactNode
  control?: ReactNode
  wide?: boolean
  children?: ReactNode
}) {
  return (
    <div className="pr-setting">
      <div className="pr-setting-line">
        <div className="pr-setting-text">
          <b>{title}</b>
          {description ? <div className="pr-setting-desc">{description}</div> : null}
        </div>
        {control ? <div className="pr-setting-control" data-wide={wide || undefined}>{control}</div> : null}
      </div>
      {children ? <div className="pr-setting-body">{children}</div> : null}
    </div>
  )
}

function SettingSwitch({ on, onChange, label, disabled }: {
  on: boolean
  onChange: (on: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="pr-switch"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-on={on || undefined}
      data-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  )
}

export function SettingsPage({ ctx, onToast, onChanged, onConfig }: {
  ctx?: any
  onToast: (text: string) => void
  onChanged: () => void
  /** Mirror every loaded/saved config to the shell (feature flags, defaults). */
  onConfig?: (config: AppConfig) => void
}) {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [maxMb, setMaxMb] = useState(80)
  const [scanning, setScanning] = useState(false)
  const [picking, setPicking] = useState(false)
  const [maintaining, setMaintaining] = useState<string | null>(null)
  const [missing, setMissing] = useState<Paper[] | null>(null)
  const [confirmClean, setConfirmClean] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageTone, setMessageTone] = useState<NoticeTone>('info')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('import')

  const pageRef = useRef<HTMLDivElement>(null)
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())
  const savedTimerRef = useRef<number | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const noticeToneRef = useRef<NoticeTone>('info')
  const mountedRef = useRef(true)

  const sections: Array<{
    id: SettingsSectionId
    label: string
    hint: string
    group: NavGroup
    icon: ReactNode
  }> = [
    { id: 'import', label: '存储', hint: '文件夹、体积与数据目录', group: '通用', icon: <IconFolder size={15} /> },
    { id: 'model', label: '模型', hint: '导读、解释与问答', group: '通用', icon: <IconSpark size={15} /> },
    {
      id: 'translation',
      label: '翻译',
      hint: '来源、引擎与测试',
      group: '通用',
      icon: <IconTranslate size={15} />,
    },
    { id: 'ui', label: '界面', hint: '默认视图与显示', group: '通用', icon: <IconLayoutSingle size={15} /> },
    { id: 'experimental', label: '实验性功能', hint: '仍在打磨的功能开关', group: '通用', icon: <IconFlask size={15} /> },
    { id: 'chat', label: '对话', hint: '会话与侧栏', group: '数据', icon: <IconNote size={15} /> },
    { id: 'usage', label: '用量', hint: '按天用量与区间', group: '数据', icon: <IconChart size={15} /> },
    { id: 'maintenance', label: '维护', hint: '索引与文件检查', group: '数据', icon: <IconGear size={15} /> },
  ]
  const navGroups: NavGroup[] = ['通用', '数据']
  const translationSourcesEnabled = config?.experimentalTranslationSources === true
  const visibleSections = sections.filter((section) => (
    section.id !== 'translation' || translationSourcesEnabled
  ))

  const selectSection = (id: SettingsSectionId) => {
    setActiveSection(id)
    if (pageRef.current) pageRef.current.scrollTop = 0
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => () => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
  }, [])

  const notify = useCallback((text: string, tone: NoticeTone = 'info') => {
    noticeToneRef.current = tone
    setMessage(text)
    setMessageTone(tone)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    if (tone === 'info') {
      noticeTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) setMessage(null)
      }, 5000)
    }
  }, [])

  const load = useCallback(async () => {
    setMessage(null)
    noticeToneRef.current = 'info'
    try {
      const next = await api.config()
      setConfig(next)
      onConfig?.(next)
      setFolders(next.watchFolders)
      setProvider(next.provider)
      setModel(next.model)
      setMaxMb(Math.round(next.maxImportBytes / MB))
      setSaveState('idle')
    } catch (error) {
      notify((error as Error).message, 'error')
    }
    try {
      setCatalog(await api.models())
    } catch {
      setCatalog(null)
    }
  }, [notify, onConfig])

  useEffect(() => {
    void load()
  }, [load])

  // Turning the experiment off removes its nav entry; never leave the content
  // pane on a section the sidebar no longer offers.
  useEffect(() => {
    if (activeSection === 'translation' && config && config.experimentalTranslationSources !== true) {
      setActiveSection('model')
    }
  }, [activeSection, config?.experimentalTranslationSources, config])

  /**
   * Every change goes through one serial chain: two settings changed in quick
   * succession cannot overwrite each other, and a stale response can never
   * clobber the newer local value.
   */
  const commit = (patch: Partial<AppConfig>) => {
    setSaveState('saving')
    const run = chainRef.current
      .catch(() => undefined)
      .then(async () => {
        const next = await api.saveConfig(patch)
        onConfig?.(next)
        if (mountedRef.current) {
          setConfig((current) => (current ? { ...current, ...next } : next))
          if (noticeToneRef.current === 'error') {
            noticeToneRef.current = 'info'
            setMessage(null)
          }
        }
        return next
      })
    chainRef.current = run
    run.then(() => {
      if (!mountedRef.current || chainRef.current !== run) return
      setSaveState('saved')
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current)
      savedTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) setSaveState('idle')
      }, 2400)
    }).catch((error) => {
      if (!mountedRef.current || chainRef.current !== run) return
      setSaveState('error')
      notify((error as Error).message, 'error')
    })
    return run
  }

  /** Folder edits are their own action: save, then rescan in the same step. */
  const persistFolders = async (next: string[]) => {
    const previous = folders
    setFolders(next)
    try {
      await commit({ watchFolders: next })
    } catch {
      setFolders(previous)
      return
    }
    try {
      const result = await api.scan()
      onChanged()
      notify(
        next.length === 0
          ? '文件夹已清空'
          : `扫描到 ${result.scanned} 个 PDF，新增 ${result.added} 篇`,
      )
    } catch (error) {
      notify((error as Error).message, 'error')
    }
  }

  const addDraft = () => {
    const value = draft.trim()
    if (!value) return
    setDraft('')
    if (folders.includes(value)) {
      notify('这个文件夹已经在列表里了')
      return
    }
    void persistFolders([...folders, value])
  }

  /** Native folder picker through the workspace service. */
  const pickFolder = async () => {
    let service
    try {
      service = ctx?.get?.('uiWorkspace') ?? ctx?.uiWorkspace
    } catch {
      service = undefined
    }
    if (typeof service?.pickDirectory !== 'function') {
      notify('这个版本的宿主没有目录选择器，请用下面的输入框粘贴路径')
      return
    }
    setPicking(true)
    try {
      const picked = await service.pickDirectory()
      if (!picked) return
      const normalized = String(picked).replace(/[\\/]+$/, '')
      if (folders.includes(normalized)) {
        notify('这个文件夹已经在列表里了')
        return
      }
      await persistFolders([...folders, normalized])
    } catch (error) {
      notify((error as Error).message, 'error')
    } finally {
      setPicking(false)
    }
  }

  const scanNow = async () => {
    setScanning(true)
    try {
      const result = await api.scan()
      onChanged()
      notify(`扫描到 ${result.scanned} 个 PDF，新增 ${result.added} 篇`)
    } catch (error) {
      notify((error as Error).message, 'error')
    } finally {
      setScanning(false)
    }
  }

  const selectedKey = provider && model ? `${provider}::${model}` : ''
  const knownSelection = Boolean(
    (catalog?.providers ?? []).some((entry) => (
      entry.id === provider && (entry.models ?? []).some((item) => item.id === model)
    )),
  )
  const modelOptions = [
    { value: '', label: '跟随 DSH 默认' },
    ...(catalog?.providers ?? []).flatMap((entry) => (
      (entry.models ?? []).map((item) => ({
        value: `${entry.id}::${item.id}`,
        label: item.name === item.id ? item.id : `${item.name} · ${item.id}`,
        title: `${entry.name} / ${item.id}`,
        group: entry.name,
      }))
    )),
    ...(selectedKey && !knownSelection
      ? [{
          value: selectedKey,
          label: `${provider} / ${model}（已配置，当前不可发现）`,
          group: '当前配置',
        }]
      : []),
  ]

  const chooseModel = (value: string) => {
    const previousProvider = provider
    const previousModel = model
    if (!value) {
      setProvider('')
      setModel('')
      void commit({ provider: '', model: '' }).catch(() => {
        setProvider(previousProvider)
        setModel(previousModel)
      })
      return
    }
    const [nextProvider, ...rest] = value.split('::')
    const nextModel = rest.join('::')
    setProvider(nextProvider)
    setModel(nextModel)
    void commit({ provider: nextProvider, model: nextModel }).catch(() => {
      setProvider(previousProvider)
      setModel(previousModel)
    })
  }

  const toggleAi = (on: boolean) => {
    setConfig((current) => (current ? { ...current, aiEnabled: on } : current))
    void commit({ aiEnabled: on }).catch(() => {
      setConfig((current) => (current ? { ...current, aiEnabled: !on } : current))
    })
  }

  const toggleAuto = (on: boolean) => {
    setConfig((current) => (current ? { ...current, autoSummarize: on } : current))
    void commit({ autoSummarize: on }).catch(() => {
      setConfig((current) => (current ? { ...current, autoSummarize: !on } : current))
    })
  }

  const toggleSidebar = (on: boolean) => {
    setConfig((current) => (current ? { ...current, paperSessionInSidebar: on } : current))
    void commit({ paperSessionInSidebar: on }).catch(() => {
      setConfig((current) => (current ? { ...current, paperSessionInSidebar: !on } : current))
    })
  }

  const toggleRelationsModel = (on: boolean) => {
    setConfig((current) => (current ? { ...current, relationsUseModel: on } : current))
    void commit({ relationsUseModel: on }).catch(() => {
      setConfig((current) => (current ? { ...current, relationsUseModel: !on } : current))
    })
  }

  const toggleFullTextTranslation = (on: boolean) => {
    setConfig((current) => (current ? { ...current, experimentalFullTextTranslation: on } : current))
    void commit({ experimentalFullTextTranslation: on }).catch(() => {
      setConfig((current) => (current ? { ...current, experimentalFullTextTranslation: !on } : current))
    })
  }

  const toggleTaskCenter = (on: boolean) => {
    setConfig((current) => (current ? { ...current, experimentalTaskCenter: on } : current))
    void commit({ experimentalTaskCenter: on }).catch(() => {
      setConfig((current) => (current ? { ...current, experimentalTaskCenter: !on } : current))
    })
  }

  const toggleTranslationSources = (on: boolean) => {
    setConfig((current) => (current ? { ...current, experimentalTranslationSources: on } : current))
    void commit({ experimentalTranslationSources: on }).catch(() => {
      setConfig((current) => (current ? { ...current, experimentalTranslationSources: !on } : current))
    })
  }

  const chooseDefaultView = (value: 'list' | 'grid') => {
    setConfig((current) => (current ? { ...current, libraryDefaultView: value } : current))
    void commit({ libraryDefaultView: value }).catch(() => {
      void load()
    })
  }

  const chooseRecentLimit = (value: number) => {
    setConfig((current) => (current ? { ...current, recentLimit: value } : current))
    void commit({ recentLimit: value }).catch(() => {
      void load()
    })
  }

  const commitMax = () => {
    if (!config) return
    const previous = Math.round(config.maxImportBytes / MB)
    const value = Math.max(1, Math.round(Number(maxMb) || 1))
    setMaxMb(value)
    if (value === previous) return
    if (value <= 1) {
      notify('单篇上限需要大于 1 MB', 'error')
      setMaxMb(previous)
      return
    }
    void commit({ maxImportBytes: value * MB }).catch(() => setMaxMb(previous))
  }

  const copyHome = () => {
    if (!config?.home) return
    void navigator.clipboard?.writeText(config.home)
    onToast('已复制数据目录路径')
  }

  const reindex = async () => {
    setMaintaining('reindex')
    try {
      const result = await api.reindex()
      notify(`索引已重建：${result.papers} 篇 / ${result.chunks} 块 / ${result.notes} 条笔记`)
    } catch (error) {
      notify((error as Error).message, 'error')
    } finally {
      setMaintaining(null)
    }
  }

  const checkMissing = async () => {
    setMaintaining('check')
    try {
      const result = await api.missing()
      setMissing(result.papers)
      setConfirmClean(false)
      notify(result.papers.length === 0 ? '所有论文的原文件都在' : `有 ${result.papers.length} 篇找不到原文件`)
    } catch (error) {
      notify((error as Error).message, 'error')
    } finally {
      setMaintaining(null)
    }
  }

  const cleanMissing = async () => {
    setMaintaining('clean')
    try {
      const result = await api.cleanMissing()
      setMissing([])
      setConfirmClean(false)
      notify(`已彻底移除 ${result.count} 篇`)
      onChanged()
    } catch (error) {
      notify((error as Error).message, 'error')
    } finally {
      setMaintaining(null)
    }
  }

  const defaultRoute = catalog?.default
    ? `${catalog.default.provider} / ${catalog.default.model}`
    : config?.route
      ? `${config.route.provider} / ${config.route.model}`
      : ''
  const aiEnabled = config?.aiEnabled !== false
  const modelState = !aiEnabled
    ? 'AI 功能已关闭'
    : config?.available
      ? provider && model
        ? `已指定 ${provider} / ${model}`
        : `跟随 DSH 默认${defaultRoute ? `（${defaultRoute}）` : ''}`
      : '没有可用模型：导读、解释与提问会暂时跳过'

  const modelHints = !catalog
    ? null
    : !catalog.available
      ? <div className="pr-settings-hint">模型服务还没就绪：可能是没有登录，或所有 provider 都还没配置。</div>
      : (catalog.providers ?? []).length === 0
        ? <div className="pr-settings-hint">宿主当前没有注册任何模型 provider。</div>
        : (catalog.providers ?? []).every((entry) => (entry.models ?? []).length === 0)
          ? (
            <div className="pr-settings-hint">
              拉不到模型列表：{(catalog.providers ?? []).map((entry) => `${entry.name}${entry.error ? `（${entry.error}）` : ''}`).join('；')}
            </div>
          )
          : null

  return (
    <div className="pr-page pr-settings-page">
      <header className="pr-settings-top">
        <div className="pr-settings-heading">
          <h1>系统设置</h1>
        </div>
        {config ? (
          <div
            className="pr-settings-save"
            data-state={saveState}
            aria-live="polite"
            title="所有更改都会自动保存"
          >
            {saveState === 'saving' ? <span className="pr-settings-save-dot" /> : null}
            {saveState === 'saved' ? <IconCheck size={13} /> : null}
            <span>
              {saveState === 'saving'
                ? '保存中…'
                : saveState === 'saved'
                  ? '已保存'
                  : saveState === 'error'
                    ? '保存失败'
                    : '所有更改自动保存'}
            </span>
          </div>
        ) : null}
      </header>

      {config && message ? (
        <div
          className="pr-settings-notice"
          data-tone={messageTone}
          role={messageTone === 'error' ? 'alert' : 'status'}
        >
          <span>{message}</span>
          <button
            type="button"
            className="pr-settings-notice-close"
            aria-label="关闭提示"
            onClick={() => setMessage(null)}
          >
            <IconClose size={12} />
          </button>
        </div>
      ) : null}

      <div className="pr-settings-layout">
        <aside className="pr-settings-nav" aria-label="设置分类">
          {navGroups.map((group) => (
            <div className="pr-settings-nav-group" key={group}>
              <div className="pr-settings-nav-title">{group}</div>
              {visibleSections.filter((section) => section.group === group).map((section) => (
                <button
                  type="button"
                  key={section.id}
                  className="pr-settings-nav-item"
                  data-on={activeSection === section.id || undefined}
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  title={section.hint}
                  onClick={() => selectSection(section.id)}
                >
                  <span className="pr-settings-nav-icon">{section.icon}</span>
                  <span className="pr-settings-nav-label">{section.label}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        <div className="pr-settings-scroll" data-scroll ref={pageRef}>
          <div className="pr-settings-main">
            {!config ? (
              <section className="pr-settings-section">
                <div className="pr-settings-section-head">
                  <h2>读取设置失败</h2>
                  <p>{message ?? '宿主可能刚重启或接口暂时不可用。'}</p>
                </div>
                <div className="pr-settings-rows">
                  <SettingRow
                    title="无法读取配置"
                    description="检查宿主是否在线，然后重新加载。"
                    control={<button className="pr-btn" onClick={() => void load()}>重新加载</button>}
                  />
                </div>
              </section>
            ) : (
              <>
                <SettingsSection
                  show={activeSection === 'import'}
                  title="存储"
                  description="管理论文来源、导入上限与数据目录。这里的 PDF 会被扫描进文献库；库中保存原文件路径，不复制文件。"
                >
                  <SettingRow
                    title="论文存放文件夹"
                    description="新增的论文会走同一套解析与导读流程。移除文件夹不会删除文献库里的论文。"
                    control={
                      <>
                        <button className="pr-btn" data-primary disabled={picking} onClick={() => void pickFolder()}>
                          <IconFolder size={13} />
                          {picking ? '选择中…' : '添加文件夹'}
                        </button>
                        <button className="pr-btn" data-ghost disabled={scanning} onClick={() => void scanNow()}>
                          {scanning ? '扫描中…' : '立即扫描'}
                        </button>
                      </>
                    }
                  >
                    <div className="pr-settings-folder-list">
                      {folders.length === 0 ? <div className="pr-settings-empty">还没有文件夹，添加一个开始。</div> : null}
                      {folders.map((folder) => (
                        <div className="pr-settings-folder" key={folder}>
                          <IconFolder size={13} />
                          <span className="pr-settings-folder-path" title={folder}>{folder}</span>
                          {folder === config.inbox ? <span className="pr-tag" data-accent>默认</span> : null}
                          <button
                            type="button"
                            className="pr-settings-folder-remove"
                            title="移除文件夹"
                            aria-label={`移除文件夹 ${folder}`}
                            onClick={() => void persistFolders(folders.filter((item) => item !== folder))}
                          >
                            <IconClose size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="pr-settings-folder-add">
                      <input
                        value={draft}
                        placeholder="或手动粘贴路径，例如 D:\Papers"
                        aria-label="手动输入文件夹路径"
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return
                          event.preventDefault()
                          addDraft()
                        }}
                      />
                      <button className="pr-btn" onClick={addDraft}>
                        <IconPlus size={12} />
                        添加
                      </button>
                    </div>
                  </SettingRow>
                  <SettingRow
                    title="单篇 PDF 上限"
                    description="超过这个大小的文件会被拒绝，避免一次导入拖住队列。"
                    control={
                      <div className="pr-settings-number">
                        <input
                          type="number"
                          min={1}
                          max={1024}
                          value={maxMb}
                          aria-label="单篇 PDF 上限（MB）"
                          onChange={(event) => setMaxMb(Number(event.target.value) || 1)}
                          onBlur={commitMax}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur()
                          }}
                        />
                        <span>MB</span>
                      </div>
                    }
                  />
                  <SettingRow
                    title="数据目录"
                    description={
                      <>
                        <span className="pr-settings-path" title={config.home}>{config.home ?? '…'}</span>
                        <span>论文索引、批注、导读都在这里；删掉这个目录等于清空文献库。</span>
                      </>
                    }
                    control={
                      <button className="pr-btn" onClick={copyHome}>
                        <IconCopy size={13} />
                        复制
                      </button>
                    }
                  />
                </SettingsSection>

                <SettingsSection
                  show={activeSection === 'model'}
                  title="模型"
                  description="论文导读、解释与问答使用这里的模型；不指定时跟随 DSH 默认模型。"
                >
                  <SettingRow
                    title="启用 AI 功能"
                    description="总开关。关闭后，导读生成、关联页 AI、检索重排、对话、解释，以及使用 DSH 模型或在线大模型 API 的翻译都不会调用模型；本地模型、浏览器内置翻译、在线机器翻译和按字符计费的专用翻译 API 仍可使用。"
                    control={
                      <SettingSwitch
                        on={aiEnabled}
                        onChange={toggleAi}
                        label="启用 AI 功能"
                      />
                    }
                  />
                  {!aiEnabled ? (
                    <div className="pr-settings-hint">
                      当前已关闭 AI 调用。需要生成导读或提问时，先在这里打开总开关；本地、浏览器与在线机器翻译不受影响。
                    </div>
                  ) : null}
                  <SettingRow
                    title="模型"
                    description={modelState}
                    wide
                    control={
                      <>
                        <div className="pr-settings-select">
                          <Select
                            value={selectedKey}
                            options={modelOptions}
                            ariaLabel="选择模型"
                            searchable
                            searchPlaceholder="搜索 provider 或模型…"
                            menuMinWidth={280}
                            onChange={chooseModel}
                          />
                        </div>
                        <button
                          className="pr-btn"
                          data-ghost
                          disabled={!provider && !model}
                          onClick={() => chooseModel('')}
                        >
                          用默认
                        </button>
                      </>
                    }
                  >
                    {modelHints}
                  </SettingRow>
                  <SettingRow
                    title="关联页面使用模型"
                    description="关闭后关联页只保留引用与文本信号，不再生成 AI 画像、判定、主题名或综述；已保存的 AI 结果不会删除。"
                    control={
                      <SettingSwitch
                        on={config.relationsUseModel !== false}
                        onChange={toggleRelationsModel}
                        label="关联页面使用模型"
                        disabled={!aiEnabled}
                      />
                    }
                  />
                  <SettingRow
                    title="导入后自动生成导读"
                    description="关闭后只解析全文，之后可以在阅读器右上角手动生成。"
                    control={
                      <SettingSwitch
                        on={config.autoSummarize !== false}
                        onChange={toggleAuto}
                        label="导入后自动生成导读"
                        disabled={!aiEnabled}
                      />
                    }
                  />
                </SettingsSection>

                <SettingsSection
                  show={activeSection === 'translation'}
                  title="翻译"
                  description="全文翻译与选段翻译共用一个来源。默认跟随 DSH 模型；本地、API、浏览器和在线机器翻译在这里配置。"
                >
                  <TranslationPanel
                    config={config}
                    commit={commit}
                    notify={notify}
                    onOpenModel={() => selectSection('model')}
                  />
                </SettingsSection>

                <SettingsSection
                  show={activeSection === 'ui'}
                  title="界面"
                  description="文献库与阅读器的默认显示。这里之后会集中放更多界面选项。"
                >
                  <SettingRow
                    title="默认视图"
                    description="文献库与最近阅读打开时默认用表格或卡片展示；页面工具栏里的切换只影响当前会话。"
                    control={
                      <div className="pr-settings-select">
                        <Select
                          value={config.libraryDefaultView ?? 'list'}
                          ariaLabel="默认视图"
                          options={[
                            { value: 'list', label: '表格（列表）' },
                            { value: 'grid', label: '卡片' },
                          ]}
                          onChange={(next) => chooseDefaultView(next === 'grid' ? 'grid' : 'list')}
                        />
                      </div>
                    }
                  />
                  <SettingRow
                    title="最近阅读展示数量"
                    description="最近阅读页最多展示多少篇论文，默认 20 篇。"
                    control={
                      <div className="pr-settings-select">
                        <Select
                          value={String(config.recentLimit ?? DEFAULT_RECENT_LIMIT)}
                          ariaLabel="最近阅读展示数量"
                          options={[
                            ...(RECENT_LIMIT_OPTIONS.includes(config.recentLimit ?? DEFAULT_RECENT_LIMIT)
                              ? []
                              : [{
                                  value: String(config.recentLimit ?? DEFAULT_RECENT_LIMIT),
                                  label: `${config.recentLimit} 篇`,
                                }]),
                            ...RECENT_LIMIT_OPTIONS.map((value) => ({
                              value: String(value),
                              label: `${value} 篇`,
                            })),
                          ]}
                          onChange={(next) => chooseRecentLimit(Number(next) || DEFAULT_RECENT_LIMIT)}
                        />
                      </div>
                    }
                  />
                </SettingsSection>

                <SettingsSection
                  show={activeSection === 'experimental'}
                  title="实验性功能"
                  description="这些功能仍在打磨，可能调整或移除；关闭开关不会删除已经生成的数据。"
                >
                  <SettingRow
                    title="全文翻译"
                    description="在阅读工具栏显示「全文翻译」入口。关闭后图标隐藏；已翻译的页面和每个标签记住的译文视图都会保留。"
                    control={
                      <SettingSwitch
                        on={config.experimentalFullTextTranslation === true}
                        onChange={toggleFullTextTranslation}
                        label="全文翻译"
                      />
                    }
                  />
                  <SettingRow
                    title="自定义翻译来源"
                    description="打开后设置里出现「翻译」页：全文与选段翻译都可以切到本地模型、API、浏览器内置 Translator 或在线机器翻译。关闭后隐藏该页并恢复 DSH 模型；已保存的选择和密钥不会删除。"
                    control={
                      <SettingSwitch
                        on={config.experimentalTranslationSources === true}
                        onChange={toggleTranslationSources}
                        label="自定义翻译来源"
                      />
                    }
                  />
                  <SettingRow
                    title="任务列表页面"
                    description="在侧栏显示「任务列表」，汇总进行中的导入、关联、翻译、导读与对话，并保留完成后的历史耗时与 token 消耗。"
                    control={
                      <SettingSwitch
                        on={config.experimentalTaskCenter === true}
                        onChange={toggleTaskCenter}
                        label="任务列表页面"
                      />
                    }
                  />
                </SettingsSection>

                <SettingsSection
                  show={activeSection === 'chat'}
                  title="对话"
                  description="每篇论文的对话都是一个独立的 DSH 会话，可续聊、回放、压缩，日志由 harness 持久化。"
                >
                  <SettingRow
                    title="对话出现在侧栏"
                    description="打开后，会建一个「论文阅读」根分组，每篇论文一个子分组；侧栏分组方式选「按工作区树」时可见层级。关闭只是归档隐藏，不会删除任何日志。"
                    control={
                      <SettingSwitch
                        on={config.paperSessionInSidebar === true}
                        onChange={toggleSidebar}
                        label="对话出现在侧栏"
                      />
                    }
                  >
                    {config.sessionsAvailable === false ? (
                      <div className="pr-settings-hint">
                        这个 profile 没有挂载 agents / agentPresets：对话会退化成一次性的单轮问答，不进会话，也没有自动压缩。
                      </div>
                    ) : null}
                  </SettingRow>
                </SettingsSection>

                <SettingsSection
                  show={activeSection === 'usage'}
                  title="用量"
                  description="PaperReader 调用模型产生的 token 用量，按天汇总；导读、关联、检索与对话都会记录。"
                >
                  <UsagePanel />
                </SettingsSection>

                <SettingsSection
                  show={activeSection === 'maintenance'}
                  title="维护"
                  description="索引异常、原文件被移动或删除时，从这里重建与检查。"
                >
                  <SettingRow
                    title="重建检索索引"
                    description="从每篇论文的分块重建 BM25；索引异常、搜不到内容时用。"
                    control={
                      <button className="pr-btn" disabled={maintaining !== null} onClick={() => void reindex()}>
                        {maintaining === 'reindex' ? '重建中…' : '重建'}
                      </button>
                    }
                  />
                  <SettingRow
                    title="检查缺失文件"
                    description="原文件被移动或删除的论文会被标出来，不会自动删除。"
                    control={
                      <button className="pr-btn" disabled={maintaining !== null} onClick={() => void checkMissing()}>
                        {maintaining === 'check' ? '检查中…' : '检查'}
                      </button>
                    }
                  >
                    {missing && missing.length > 0 ? (
                      <div className="pr-settings-missing">
                        <div className="pr-settings-missing-list">
                          {missing.map((paper) => (
                            <div className="pr-settings-missing-row" key={paper.id}>
                              <span className="pr-dot" data-s="missing" />
                              <span className="pr-settings-missing-title" title={paper.title}>{paper.title}</span>
                              <span className="pr-settings-missing-year">{paper.year ?? ''}</span>
                            </div>
                          ))}
                        </div>
                        <div className="pr-settings-missing-actions">
                          {confirmClean ? (
                            <>
                              <span className="pr-settings-hint">彻底删除，不经过回收站；批注、笔记、导读一起消失。</span>
                              <button
                                className="pr-btn"
                                data-danger
                                disabled={maintaining !== null}
                                onClick={() => void cleanMissing()}
                              >
                                {maintaining === 'clean' ? '清理中…' : '确认清理'}
                              </button>
                              <button className="pr-btn" data-ghost onClick={() => setConfirmClean(false)}>取消</button>
                            </>
                          ) : (
                            <button className="pr-btn" data-danger onClick={() => setConfirmClean(true)}>
                              <IconTrash size={13} />
                              彻底移除这些论文
                            </button>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </SettingRow>
                </SettingsSection>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
