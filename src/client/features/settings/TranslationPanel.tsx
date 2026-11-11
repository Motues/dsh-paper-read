/**
 * 设置 → 翻译。
 *
 * One panel, five source families. The panel only edits configuration; the host
 * decides how each engine is driven (LLM JSONL vs plain machine translation).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { Select } from '../../components/Select.js'
import {
  checkBrowserTranslator,
  detectBrowserTranslator,
  translateBrowserText,
  type BrowserTranslatorSupport,
} from '../../lib/browser-translate.js'
import {
  normalizeTranslationSettings,
  TRANSLATION_API_BASE_URLS,
  TRANSLATION_API_KINDS,
  TRANSLATION_API_LABELS,
  TRANSLATION_LOCAL_BASE_URLS,
  TRANSLATION_LOCAL_KINDS,
  TRANSLATION_LOCAL_LABELS,
  TRANSLATION_NATIVE_LABELS,
  TRANSLATION_NATIVE_PROVIDERS,
  TRANSLATION_SOURCE_LABELS,
  TRANSLATION_SOURCES,
  TRANSLATION_TARGET_LANG,
  type TranslationKeyProvider,
} from '../../../shared/translation.js'
import type {
  AppConfig,
  TranslationApiKind,
  TranslationLocalKind,
  TranslationModelList,
  TranslationNativeProvider,
  TranslationRuntime,
  TranslationSettings,
  TranslationSource,
  TranslationTestResult,
} from '../../types.js'

const BROWSER_LANGUAGES = [
  { value: 'en', label: '英语 en' },
  { value: 'ja', label: '日语 ja' },
  { value: 'ko', label: '韩语 ko' },
  { value: 'de', label: '德语 de' },
  { value: 'fr', label: '法语 fr' },
  { value: 'es', label: '西班牙语 es' },
  { value: 'ru', label: '俄语 ru' },
]

const SOURCE_DESCRIPTIONS: Record<TranslationSource, string> = {
  dsh: '跟随设置 → 模型，结构化 JSONL，质量最好',
  local: 'Ollama / LM Studio / llama.cpp，或 LibreTranslate',
  api: 'OpenAI 兼容、DeepL、Google、Azure、LibreTranslate',
  browser: 'Chrome/Edge 内置模型，零 token，仅页面内可用',
  native: 'Bing / Google，宿主侧免费机器翻译',
}

function Row({
  title,
  description,
  control,
  children,
  wide,
}: {
  title: ReactNode
  description?: ReactNode
  control?: ReactNode
  children?: ReactNode
  wide?: boolean
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

function KeyField({
  provider,
  configured,
  busy,
  onSave,
  onClear,
}: {
  provider: TranslationKeyProvider
  configured: boolean
  busy: boolean
  onSave: (value: string) => void
  onClear: () => void
}) {
  const [value, setValue] = useState('')
  useEffect(() => {
    setValue('')
  }, [provider])
  return (
    <div className="pr-translate-key">
      <input
        type="password"
        value={value}
        autoComplete="off"
        aria-label="翻译 API key"
        placeholder={configured ? '已配置；输入新值可覆盖' : '未配置'}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value.trim()) onSave(value.trim())
        }}
      />
      <span className="pr-tag" data-accent={configured || undefined}>
        {configured ? '已配置' : '未配置'}
      </span>
      <button
        type="button"
        className="pr-btn"
        data-sm
        disabled={busy || value.trim() === ''}
        onClick={() => {
          onSave(value.trim())
          setValue('')
        }}
      >
        保存
      </button>
      <button
        type="button"
        className="pr-btn"
        data-sm
        data-ghost
        disabled={busy || !configured}
        onClick={onClear}
      >
        清除
      </button>
    </div>
  )
}

export function TranslationPanel({
  config,
  commit,
  notify,
  onOpenModel,
}: {
  config: AppConfig
  commit: (patch: Partial<AppConfig>) => Promise<AppConfig>
  notify: (text: string, tone?: 'info' | 'error') => void
  onOpenModel: () => void
}) {
  const [draft, setDraft] = useState<TranslationSettings>(() => normalizeTranslationSettings(config.translation))
  const [runtime, setRuntime] = useState<TranslationRuntime | null>(null)
  const [models, setModels] = useState<TranslationModelList | null>(null)
  const [modelBusy, setModelBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TranslationTestResult | null>(null)
  const [browser, setBrowser] = useState<BrowserTranslatorSupport | null>(null)
  const [download, setDownload] = useState<number | null>(null)
  const [keyBusy, setKeyBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const lastSaved = useRef(JSON.stringify(normalizeTranslationSettings(config.translation)))

  const refreshRuntime = useCallback(async (): Promise<void> => {
    try {
      const next = await api.translationSources()
      setRuntime(next)
    } catch {
      setRuntime(null)
    }
  }, [])

  useEffect(() => {
    void refreshRuntime()
  }, [refreshRuntime])

  useEffect(() => {
    // Browser support is independent of the selected source; probing it up
    // front lets the card explain "Electron / no Translator API" without the
    // user selecting the source first.
    let cancelled = false
    void checkBrowserTranslator(draft.browser.sourceLanguage).then((next) => {
      if (!cancelled) setBrowser(next)
    })
    return () => {
      cancelled = true
    }
  }, [draft.browser.sourceLanguage])

  useEffect(() => {
    setModels(null)
    setTestResult(null)
  }, [draft.source, draft.local.kind, draft.api.kind])

  const persist = useCallback(async (next: TranslationSettings): Promise<void> => {
    setDraft(next)
    const key = JSON.stringify(next)
    if (key === lastSaved.current) return
    setSaving(true)
    try {
      const saved = await commit({ translation: next })
      const normalized = normalizeTranslationSettings(saved.translation)
      lastSaved.current = JSON.stringify(normalized)
      setDraft(normalized)
      await refreshRuntime()
    } catch (error) {
      notify((error as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }, [commit, notify, refreshRuntime])

  const patch = (mutate: (current: TranslationSettings) => TranslationSettings): void => {
    setDraft(mutate)
  }

  const saveNow = (): void => {
    void persist(draft)
  }

  const chooseSource = (source: TranslationSource): void => {
    if (source === draft.source) return
    void persist({ ...draft, source })
  }

  const keyProvider: TranslationKeyProvider | null = useMemo(() => {
    if (draft.source === 'local') {
      return draft.local.kind === 'libretranslate' ? 'libretranslate' : 'local'
    }
    if (draft.source === 'api') return draft.api.kind
    return null
  }, [draft.source, draft.local.kind, draft.api.kind])

  const apiBasePlaceholder = draft.api.kind === 'deepl'
    ? '留空使用 api.deepl.com（:fx key 自动用 free 端点）'
    : draft.api.kind === 'google'
      ? '留空使用 translation.googleapis.com'
      : draft.api.kind === 'azure'
        ? '留空使用 api.cognitive.microsofttranslator.com'
        : draft.api.kind === 'libretranslate'
          ? '例如 http://127.0.0.1:5000'
          : '例如 https://api.deepseek.com/v1'

  const setLocal = (patchLocal: Partial<TranslationSettings['local']>): void => {
    patch((current) => ({ ...current, local: { ...current.local, ...patchLocal } }))
  }
  const setApi = (patchApi: Partial<TranslationSettings['api']>): void => {
    patch((current) => ({ ...current, api: { ...current.api, ...patchApi } }))
  }

  const saveKey = async (value: string): Promise<void> => {
    if (!keyProvider) return
    setKeyBusy(true)
    try {
      await api.setTranslationKey(keyProvider, value)
      await refreshRuntime()
      notify(value ? '密钥已保存到 DSH 凭据' : '已清除密钥')
    } catch (error) {
      notify((error as Error).message, 'error')
    } finally {
      setKeyBusy(false)
    }
  }

  const loadModels = async (): Promise<void> => {
    setModelBusy(true)
    setModels(null)
    try {
      // The host probes the saved config, so flush pending text edits first.
      await persist(draft)
      const target = draft.source === 'local' ? 'local' : 'api'
      const result = await api.translationModels(target)
      setModels(result)
      if (result.error) notify(result.error, 'error')
      else if (result.models.length === 0) notify('接口没有返回模型列表', 'error')
    } catch (error) {
      setModels({ models: [], error: (error as Error).message })
      notify((error as Error).message, 'error')
    } finally {
      setModelBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    const started = Date.now()
    try {
      if (draft.source !== 'browser') await persist(draft)
      if (draft.source === 'browser') {
        // Keep the click as the activation for the first model download:
        // detect() is synchronous and the translate call follows immediately.
        const support = detectBrowserTranslator()
        setBrowser(support)
        if (!support.supported) {
          setTestResult({
            ok: false,
            ms: Date.now() - started,
            engine: `browser/${draft.browser.sourceLanguage}-${TRANSLATION_TARGET_LANG}`,
            error: support.detail ?? '当前浏览器不支持内置翻译',
          })
          return
        }
        const output = await translateBrowserText(
          'The proposed method improves accuracy by 3.2% on the benchmark.',
          {
            sourceLanguage: draft.browser.sourceLanguage,
            signal: AbortSignal.timeout(300_000),
            onDownload: (event) => setDownload(event.percent),
          },
        )
        setTestResult({
          ok: true,
          ms: Date.now() - started,
          engine: `browser/${draft.browser.sourceLanguage}-${TRANSLATION_TARGET_LANG}`,
          output: output.slice(0, 400),
        })
        return
      }
      const result = await api.testTranslation()
      setTestResult(result)
      if (!result.ok) notify(result.error ?? '测试失败', 'error')
      else notify(`测试通过：${result.ms} ms`)
      await refreshRuntime()
    } catch (error) {
      if (draft.source === 'browser') {
        setBrowser({
          supported: false,
          reason: 'error',
          detail: (error as Error).message,
        })
      }
      setTestResult({
        ok: false,
        ms: Date.now() - started,
        engine: draft.source,
        error: (error as Error).message,
      })
      notify((error as Error).message, 'error')
    } finally {
      setTesting(false)
      setDownload(null)
    }
  }

  const currentKeys = runtime?.keys ?? config.translationKeys ?? {}
  const browserStatus = browser
    ? browser.supported
      ? browser.availability === 'downloadable'
        ? '可用，首次翻译会下载语言包'
        : '可用'
      : browser.detail ?? '不可用'
    : '检测中…'

  return (
    <div className="pr-translation-panel">
      {runtime && !runtime.allowed && (runtime.source === 'dsh' || runtime.source === 'api') ? (
        <div className="pr-settings-hint" data-tone="warn">
          AI 总开关已关闭：DSH 模型与在线大模型 API 暂不可用；本地、浏览器与在线翻译服务仍可使用。
        </div>
      ) : null}

      <div className="pr-translate-sources" role="radiogroup" aria-label="翻译来源">
        {TRANSLATION_SOURCES.map((source) => (
          <button
            key={source}
            type="button"
            role="radio"
            aria-checked={draft.source === source}
            className="pr-translate-source-card"
            data-on={draft.source === source || undefined}
            disabled={saving}
            onClick={() => chooseSource(source)}
          >
            <b>{TRANSLATION_SOURCE_LABELS[source]}</b>
            <span>{SOURCE_DESCRIPTIONS[source]}</span>
            <i>
              {source === 'browser'
                ? browserStatus
                : source === 'dsh' && runtime?.source === 'dsh' && runtime.engine.error
                  ? runtime.engine.error
                  : source === 'native' && runtime?.engine.id.startsWith('native')
                    ? runtime.engine.available ? '可用' : '未挂载'
                    : draft.source === source && runtime
                      ? runtime.engine.available ? '可用' : '待配置'
                      : ''}
            </i>
          </button>
        ))}
      </div>

      <div className="pr-translate-config">
        {draft.source === 'dsh' ? (
          <>
            <Row
              title="当前路由"
              description="跟随 DSH 的模型选择；需要更换模型时去「模型」页。"
              control={<button type="button" className="pr-btn" onClick={onOpenModel}>去模型设置</button>}
            />
            <div className="pr-settings-hint">
              当前：{runtime?.engine.label ?? '读取中…'}
              {runtime && !runtime.engine.available ? `（${runtime.engine.error ?? '不可用'}）` : ''}
            </div>
          </>
        ) : null}

        {draft.source === 'local' ? (
          <>
            <Row
              title="本地引擎"
              description="大模型走 OpenAI 兼容的 /v1/chat/completions；专用翻译走 LibreTranslate 协议。"
              control={
                <div className="pr-settings-select">
                  <Select
                    value={draft.local.kind}
                    ariaLabel="本地引擎类型"
                    options={TRANSLATION_LOCAL_KINDS.map((kind) => ({
                      value: kind,
                      label: TRANSLATION_LOCAL_LABELS[kind],
                    }))}
                    onChange={(value) => {
                      const kind = value as TranslationLocalKind
                      void persist({
                        ...draft,
                        local: {
                          ...draft.local,
                          kind,
                          // The URL is protocol-specific; carrying the old
                          // endpoint into a different engine would be wrong.
                          baseUrl: TRANSLATION_LOCAL_BASE_URLS[kind],
                          model: kind === 'libretranslate' ? '' : draft.local.model,
                        },
                      })
                    }}
                  />
                </div>
              }
            />
            <Row
              title="Base URL"
              description={draft.local.kind === 'llm'
                ? '需要包含版本路径，例如 http://127.0.0.1:11434/v1。'
                : 'LibreTranslate 根地址，例如 http://127.0.0.1:5000。'}
              wide
              control={
                <input
                  className="pr-settings-input"
                  value={draft.local.baseUrl}
                  placeholder={TRANSLATION_LOCAL_BASE_URLS[draft.local.kind]}
                  aria-label="本地 Base URL"
                  onChange={(event) => setLocal({ baseUrl: event.target.value })}
                  onBlur={saveNow}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
              }
            />
            {draft.local.kind === 'llm' ? (
              <>
                <Row
                  title="模型"
                  description="本地模型 id，例如 qwen2.5:7b 或 llama-3.1-8b-instruct。"
                  wide
                  control={
                    <>
                      <input
                        className="pr-settings-input"
                        value={draft.local.model}
                        placeholder="模型 id"
                        aria-label="本地模型"
                        onChange={(event) => setLocal({ model: event.target.value })}
                        onBlur={saveNow}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                        }}
                      />
                      <button type="button" className="pr-btn" disabled={modelBusy} onClick={() => void loadModels()}>
                        {modelBusy ? '获取中…' : '获取模型'}
                      </button>
                    </>
                  }
                >
                  {models ? <ModelPicker models={models} onPick={(id) => { setLocal({ model: id }); void persist({ ...draft, local: { ...draft.local, model: id } }) }} /> : null}
                </Row>
                <Row
                  title="并发"
                  description="本地模型通常一次只能处理一个请求，建议 1。"
                  control={
                    <div className="pr-settings-select">
                      <Select
                        value={String(draft.local.concurrency)}
                        ariaLabel="本地并发"
                        options={[1, 2, 3, 4].map((value) => ({ value: String(value), label: `${value}` }))}
                        onChange={(value) => {
                          const concurrency = Number(value) || 1
                          void persist({ ...draft, local: { ...draft.local, concurrency } })
                        }}
                      />
                    </div>
                  }
                />
                <Row
                  title="输出上限"
                  description="单次请求的最大输出 token；本地长文可调高。"
                  control={
                    <input
                      className="pr-settings-input pr-settings-number-input"
                      type="number"
                      min={256}
                      max={8192}
                      value={draft.local.maxTokens}
                      aria-label="本地输出上限"
                      onChange={(event) => setLocal({ maxTokens: Number(event.target.value) || 2048 })}
                      onBlur={saveNow}
                    />
                  }
                />
              </>
            ) : null}
            <Row
              title="本地密钥"
              description="可选；LibreTranslate 开启了 API key 或本地模型需要鉴权时填写。"
              wide
              control={
                keyProvider ? (
                  <KeyField
                    provider={keyProvider}
                    configured={currentKeys[keyProvider] === true}
                    busy={keyBusy}
                    onSave={(value) => void saveKey(value)}
                    onClear={() => void saveKey('')}
                  />
                ) : null
              }
            />
          </>
        ) : null}

        {draft.source === 'api' ? (
          <>
            <Row
              title="API 类型"
              description="OpenAI 兼容走大模型协议；其余是专用翻译 API，按字符计费。"
              control={
                <div className="pr-settings-select">
                  <Select
                    value={draft.api.kind}
                    ariaLabel="API 类型"
                    options={TRANSLATION_API_KINDS.map((kind) => ({
                      value: kind,
                      label: TRANSLATION_API_LABELS[kind],
                    }))}
                    onChange={(value) => {
                      const kind = value as TranslationApiKind
                      void persist({
                        ...draft,
                        api: {
                          ...draft.api,
                          kind,
                          // Each provider has its own endpoint shape; do not
                          // point DeepL at the OpenAI base URL.
                          baseUrl: TRANSLATION_API_BASE_URLS[kind],
                          model: kind === 'openai' ? draft.api.model : '',
                        },
                      })
                    }}
                  />
                </div>
              }
            />
            <Row
              title="Base URL"
              description={draft.api.kind === 'openai'
                ? '必须包含版本路径，例如 https://api.deepseek.com/v1。'
                : '可选；留空使用官方地址。自建 LibreTranslate 需要填写。'}
              wide
              control={
                <input
                  className="pr-settings-input"
                  value={draft.api.baseUrl}
                  placeholder={apiBasePlaceholder}
                  aria-label="API Base URL"
                  onChange={(event) => setApi({ baseUrl: event.target.value })}
                  onBlur={saveNow}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
              }
            />
            {draft.api.kind === 'openai' ? (
              <Row
                title="模型"
                description="例如 deepseek-chat、gpt-4o-mini，或任意兼容模型 id。"
                wide
                control={
                  <>
                    <input
                      className="pr-settings-input"
                      value={draft.api.model}
                      placeholder="模型 id"
                      aria-label="API 模型"
                      onChange={(event) => setApi({ model: event.target.value })}
                      onBlur={saveNow}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                    <button type="button" className="pr-btn" disabled={modelBusy} onClick={() => void loadModels()}>
                      {modelBusy ? '获取中…' : '获取模型'}
                    </button>
                  </>
                }
              >
                {models ? <ModelPicker models={models} onPick={(id) => { setApi({ model: id }); void persist({ ...draft, api: { ...draft.api, model: id } }) }} /> : null}
              </Row>
            ) : null}
            {draft.api.kind === 'azure' ? (
              <Row
                title="资源区域"
                description="Azure 门户里的 resource region，例如 eastasia。"
                control={
                  <input
                    className="pr-settings-input"
                    value={draft.api.region}
                    placeholder="eastasia"
                    aria-label="Azure 区域"
                    onChange={(event) => setApi({ region: event.target.value })}
                    onBlur={saveNow}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                }
              />
            ) : null}
            <Row
              title="API key"
              description={
                draft.api.kind === 'google'
                  ? 'Google Cloud Translation API key；建议同时限制 key 的 API 范围。'
                  : draft.api.kind === 'azure'
                    ? 'Azure Translator subscription key；区域在上面填写。'
                    : '保存在 DSH 凭据里，不会写入 config.json，也不会回传到页面。'
              }
              wide
              control={
                keyProvider ? (
                  <KeyField
                    provider={keyProvider}
                    configured={currentKeys[keyProvider] === true}
                    busy={keyBusy}
                    onSave={(value) => void saveKey(value)}
                    onClear={() => void saveKey('')}
                  />
                ) : null
              }
            />
          </>
        ) : null}

        {draft.source === 'browser' ? (
          <>
            <Row
              title="源语言"
              description={`目标语言固定为简体中文（${TRANSLATION_TARGET_LANG}）。`}
              control={
                <div className="pr-settings-select">
                  <Select
                    value={draft.browser.sourceLanguage}
                    ariaLabel="浏览器翻译源语言"
                    options={BROWSER_LANGUAGES}
                    onChange={(value) => {
                      void persist({ ...draft, browser: { sourceLanguage: value } })
                    }}
                  />
                </div>
              }
            />
            <Row
              title="模型状态"
              description="浏览器内置 Translator 需要 Chrome 138+ 或较新的 Edge；模型按语言对首次下载。"
              wide
              control={
                <button
                  type="button"
                  className="pr-btn"
                  disabled={testing}
                  onClick={() => void test()}
                >
                  {testing ? '检测中…' : '检测并试译'}
                </button>
              }
            >
              <div className="pr-settings-hint" data-tone={browser && !browser.supported ? 'warn' : undefined}>
                {browserStatus}
                {download !== null ? `（语言包 ${download}%）` : ''}
              </div>
              <div className="pr-settings-hint">
                当前窗口是 Electron 时不可用；用 Chrome/Edge 打开同一地址即可。
              </div>
            </Row>
          </>
        ) : null}

        {draft.source === 'native' ? (
          <>
            <Row
              title="服务"
              description="宿主内置的匿名机器翻译端点；不需要 key，不消耗 token。"
              control={
                <div className="pr-settings-select">
                  <Select
                    value={draft.native.provider}
                    ariaLabel="在线机器翻译服务"
                    options={TRANSLATION_NATIVE_PROVIDERS.map((provider) => ({
                      value: provider,
                      label: TRANSLATION_NATIVE_LABELS[provider],
                    }))}
                    onChange={(value) => {
                      void persist({ ...draft, native: { provider: value as TranslationNativeProvider } })
                    }}
                  />
                </div>
              }
            />
            <div className="pr-settings-hint">
              {runtime?.engine.id.startsWith('native') && !runtime.engine.available
                ? runtime.engine.error ?? '当前运行时没有挂载 translator 服务'
                : '免费端点为非官方接口，可能限流或受网络区域影响。'}
            </div>
          </>
        ) : null}
      </div>

      <div className="pr-translate-test-row">
        <button type="button" className="pr-btn" data-primary disabled={testing || saving} onClick={() => void test()}>
          {testing ? '测试中…' : '测试当前来源'}
        </button>
        {testResult ? (
          <div className="pr-translate-test-result" data-ok={testResult.ok || undefined}>
            <b>{testResult.ok ? '通过' : '失败'}</b>
            <span>{testResult.engine} · {testResult.ms} ms</span>
            {testResult.error ? <span>{testResult.error}</span> : null}
            {testResult.output ? <span className="pr-translate-sample">{testResult.output}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="pr-settings-hint">
        切换来源不会自动重译已有页面：缓存按原文哈希复用，阅读器会标注当前译文来自哪个引擎；点「重新翻译」才会用新来源覆盖。
      </div>
    </div>
  )
}

function ModelPicker({
  models,
  onPick,
}: {
  models: TranslationModelList
  onPick: (id: string) => void
}) {
  if (models.error) return <div className="pr-settings-hint" data-tone="warn">{models.error}</div>
  if (models.models.length === 0) return <div className="pr-settings-hint">没有发现模型。</div>
  return (
    <div className="pr-translate-models">
      {models.models.slice(0, 80).map((model) => (
        <button key={model.id} type="button" className="pr-btn" data-sm data-ghost onClick={() => onPick(model.id)}>
          {model.name || model.id}
        </button>
      ))}
    </div>
  )
}
