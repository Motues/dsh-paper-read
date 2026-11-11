import { useRef, useState } from 'react'
import { IconCheck, IconChevronDown, IconChevronRight } from '../../../components/ui.js'
import type { ChatModelCatalog, ChatModelOption, ChatRoute } from '../../../types.js'
import { useDismiss } from './shared.js'

/**
 * Model switch, following DSH's two-level selector.
 *
 * The root pane is two rows — `模型` and `思考强度` — each showing its current
 * value and drilling into its own list; the model list is grouped by provider.
 * The trigger names the live route (model + effective effort).
 */
export function ModelSelect({
  route,
  catalog,
  busy,
  onOpen,
  onPick,
}: {
  route: ChatRoute | null
  catalog: ChatModelCatalog | null
  busy: boolean
  onOpen: () => void
  onPick: (route: ChatRoute) => void
}) {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<'root' | 'model' | 'effort'>('root')
  const rootRef = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  useDismiss(open, rootRef, close)

  const current = catalog?.options.find(
    (option) => option.provider === route?.provider && option.model === route?.model,
  )
  // The effort actually in force: an explicit choice wins, else the adapter default.
  const effectiveEffort = route?.reasoningEffort ?? current?.defaultEffort
  const effortLabel = effectiveEffort
    ? current?.efforts.find((effort) => effort.id === effectiveEffort)?.name ?? effectiveEffort
    : ''
  /** Provider order is the host's; the heading carries the display name. */
  const groups = (() => {
    const ordered: Array<{ id: string; name: string; options: ChatModelOption[] }> = []
    for (const option of catalog?.options ?? []) {
      let group = ordered.find((entry) => entry.id === option.provider)
      if (!group) {
        group = { id: option.provider, name: option.providerName, options: [] }
        ordered.push(group)
      }
      group.options.push(option)
    }
    return ordered
  })()
  // DSH offers an explicit "provider default" row only when the adapter has none.
  const efforts = (current?.efforts ?? []).map((effort) => ({ id: effort.id, name: effort.name, description: effort.description }))
  const choices: Array<{ id?: string; name: string; description?: string }> = [
    ...(current && current.defaultEffort === undefined ? [{ name: '模型默认' }] : []),
    ...efforts,
  ]

  const chooseModel = (option: ChatModelOption) => {
    onPick({
      provider: option.provider,
      model: option.model,
      ...(option.defaultEffort ? { reasoningEffort: option.defaultEffort } : {}),
    })
    setOpen(false)
  }

  const chooseEffort = (effort?: string) => {
    if (!current) return
    onPick({
      provider: current.provider,
      model: current.model,
      ...(effort ? { reasoningEffort: effort } : {}),
    })
    setOpen(false)
  }

  return (
    <div className="pr-model" ref={rootRef}>
      <button
        type="button"
        className="pr-model-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={route
          ? `${route.provider}/${route.model}${effortLabel ? ` · ${effortLabel}` : ''}，点击切换`
          : '切换模型'}
        onClick={() => {
          if (open) setOpen(false)
          else {
            setPane('root')
            setOpen(true)
            onOpen()
          }
        }}
      >
        <span className="pr-model-name">{route?.model ?? '未连接'}</span>
        {effortLabel ? <span className="pr-model-effort">{effortLabel}</span> : null}
        <IconChevronDown size={11} className={open ? 'pr-model-chev pr-model-chev-open' : 'pr-model-chev'} />
      </button>
      {open ? (
        <div className="pr-model-menu" role="dialog" aria-label="模型设置">
          {!catalog || catalog.options.length === 0 ? (
            <div className="pr-model-empty">
              {busy ? '读取模型列表…' : (catalog && !catalog.available ? '这个 profile 没有模型服务' : '没有可用的模型')}
            </div>
          ) : pane === 'root' ? (
            <>
              <button type="button" className="pr-cell" onClick={() => setPane('model')}>
                <span className="pr-cell-label">模型</span>
                <span className="pr-cell-value">{route?.model ?? current?.name ?? '未选择'}</span>
                <IconChevronRight size={12} className="pr-cell-chevron" />
              </button>
              {efforts.length > 0 ? (
                <button type="button" className="pr-cell" onClick={() => setPane('effort')}>
                  <span className="pr-cell-label">思考强度</span>
                  <span className="pr-cell-value">{effortLabel || '模型默认'}</span>
                  <IconChevronRight size={12} className="pr-cell-chevron" />
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button type="button" className="pr-cell pr-cell-back" onClick={() => setPane('root')}>
                <IconChevronRight size={12} className="pr-cell-chevron pr-cell-chevron-back" />
                <span className="pr-cell-label">{pane === 'model' ? '模型' : '思考强度'}</span>
              </button>
              {pane === 'model' ? (
                <div className="pr-menu-groups">
                  {groups.map((group) => (
                    <div className="pr-menu-group" key={group.id}>
                      <div className="pr-menu-group-label">{group.name}</div>
                      {group.options.map((option) => {
                        const on = option.provider === route?.provider && option.model === route?.model
                        return (
                          <button
                            key={`${option.provider}/${option.model}`}
                            type="button"
                            className="pr-option"
                            role="menuitemradio"
                            aria-checked={on}
                            title={option.description ?? `${option.providerName}/${option.model}`}
                            onClick={() => chooseModel(option)}
                          >
                            <span className="pr-option-name">{option.name}</span>
                            <span className="pr-option-check">{on ? <IconCheck size={12} /> : null}</span>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pr-menu-groups">
                  {choices.map((choice) => {
                    const on = effectiveEffort === choice.id
                    return (
                      <button
                        key={choice.id ?? 'default'}
                        type="button"
                        className="pr-option"
                        role="menuitemradio"
                        aria-checked={on}
                        title={choice.description ?? choice.name}
                        onClick={() => chooseEffort(choice.id)}
                      >
                        <span className="pr-option-name">{choice.name}</span>
                        <span className="pr-option-check">{on ? <IconCheck size={12} /> : null}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
