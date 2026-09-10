import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowSquareOut, CaretDown, Circle, Cube, ImageSquare, Info, RadioButton, X } from '@phosphor-icons/react'
import { IMAGE_MODEL_CHOICES, IMAGE_MODEL_GUIDE_URL } from '../lib/imageModels'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { dismissAllTooltips } from '../lib/tooltipDismiss'

interface Props {
  value: string
  onChange: (model: string) => void
  allowDefault?: boolean
  compact?: boolean
}

export default function ImageModelPicker({ value, onChange, allowDefault = false, compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [position, setPosition] = useState({ left: 0, top: 0, width: 520, maxHeight: 600 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const customRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const selectedId = !allowDefault && value === 'gpt-image-2-4k' ? 'gpt-image-2' : value
  const selected = IMAGE_MODEL_CHOICES.find((model) => model.id === selectedId)
  const label = selected?.shortName || (value ? value : 'API 默认')

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])
  useCloseOnEscape(open, () => close())

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (!trigger || !panel) return
      const rect = trigger.getBoundingClientRect()
      const viewport = window.visualViewport
      const viewportTop = viewport?.offsetTop ?? 0
      const viewportLeft = viewport?.offsetLeft ?? 0
      const width = Math.min(520, (viewport?.width ?? window.innerWidth) - 24)
      const bottom = viewportTop + (viewport?.height ?? window.innerHeight)
      // 输入栏菜单放在整个编辑器上方，避免挡住正在写的提示词。
      const anchorTop = compact ? (trigger.closest('[data-input-bar]')?.getBoundingClientRect().top ?? rect.top) + 12 : rect.top
      const above = anchorTop - viewportTop - 20
      const below = bottom - rect.bottom - 20
      const upwards = above >= Math.min(panel.scrollHeight, 580) || above > below
      const maxHeight = Math.max(120, Math.min(600, upwards ? above : below))
      const height = Math.min(panel.scrollHeight, maxHeight)
      setPosition({
        left: Math.max(viewportLeft + 12, Math.min(rect.left, viewportLeft + (viewport?.width ?? window.innerWidth) - width - 12)),
        top: upwards ? Math.max(viewportTop + 12, anchorTop - height - 10) : rect.bottom + 10,
        width,
        maxHeight,
      })
    }
    place()
    const observer = new ResizeObserver(place)
    if (panelRef.current) observer.observe(panelRef.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [open, editing, compact])

  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    if (editing) customRef.current?.focus()
    else (panelRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? panelRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus()
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
    }
  }, [open, editing, close])

  const choose = (model: string) => {
    onChange(model)
    close()
  }

  const row = (model: { id: string; name: string; description: string; badge?: string }) => {
    const checked = selectedId === model.id
    return (
      <button
        key={model.id}
        type="button"
        role="menuitemradio"
        aria-checked={checked}
        onClick={() => choose(model.id)}
        className={`flex w-full items-start gap-3 rounded-xl px-3 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${checked ? 'bg-blue-50/90 dark:bg-blue-500/15' : 'hover:bg-gray-50 dark:hover:bg-white/[0.05]'}`}
      >
        {checked ? <RadioButton weight="fill" size={23} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" /> : <Circle size={23} className="mt-0.5 shrink-0 text-gray-400" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-semibold leading-6 text-gray-900 dark:text-gray-100">{model.name}</span>
            {model.badge && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${model.id.endsWith('flare') ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-blue-100/70 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'}`}>{model.badge}</span>}
          </span>
          <span className="mt-1 block text-sm leading-5 text-gray-500 dark:text-gray-400">{model.description}</span>
          {model.id && <span className="mt-1 block break-all font-mono text-xs leading-5 text-gray-500 dark:text-gray-400">{model.id}</span>}
        </span>
      </button>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`图像模型：${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open) { close(); return }
          dismissAllTooltips()
          setDraft(selected ? '' : value)
          setEditing(false)
          setOpen(true)
        }}
        className={`flex w-full min-w-0 items-center gap-2 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${compact ? 'px-3 py-2 text-sm' : 'px-3.5 py-3 text-sm'} ${open ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/50 dark:bg-blue-500/15 dark:text-blue-300' : 'border-gray-200/80 bg-white/70 text-gray-700 hover:border-blue-300 hover:bg-blue-50/50 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-blue-500/10'}`}
      >
        <ImageSquare size={18} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{compact ? label : selected?.name || label}</span>
        <CaretDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label="选择图像模型"
          className="fixed z-[180] overflow-y-auto overscroll-contain rounded-2xl border border-gray-200/80 bg-white p-2 shadow-[0_16px_48px_-12px_rgba(15,23,42,0.25)] dark:border-white/10 dark:bg-gray-900 dark:shadow-black/40"
          style={position}
        >
          <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">图像模型</h3>
            <div className="flex items-center gap-2">
              <a href={IMAGE_MODEL_GUIDE_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded text-xs font-medium text-blue-600 hover:underline focus-visible:outline-blue-500 dark:text-blue-400">模型指南 <ArrowSquareOut size={14} /></a>
              <button type="button" aria-label="关闭模型选择" onClick={() => close()} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 focus-visible:outline-blue-500 dark:hover:bg-white/10"><X size={16} /></button>
            </div>
          </div>
          <div
            role="menu"
            aria-label="图像模型选项"
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
              const idx = items.indexOf(document.activeElement as HTMLButtonElement)
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (idx + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
              event.preventDefault()
              items[next]?.focus()
            }}
          >
            {allowDefault && row({ id: '', name: 'API 默认', description: '不指定图像工具模型，由 API 决定。' })}
            {IMAGE_MODEL_CHOICES.slice(0, 2).map(row)}
            <div className="mx-3 my-1 border-t border-gray-100 dark:border-white/[0.06]" />
            {row(IMAGE_MODEL_CHOICES[2])}
          </div>
          <div className="mx-3 my-1 border-t border-gray-100 dark:border-white/[0.06]" />
          <button type="button" aria-expanded={editing} onClick={() => setEditing((current) => !current)} className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-gray-50 focus-visible:outline-blue-500 dark:hover:bg-white/[0.05]">
            <Cube size={23} className="mt-0.5 shrink-0 text-gray-600 dark:text-gray-300" />
            <span className="min-w-0"><span className="block text-sm font-semibold text-gray-800 dark:text-gray-200">自定义模型…</span><span className="mt-1 block break-all text-xs leading-5 text-gray-500 dark:text-gray-400">{!selected && value ? `当前：${value}` : '输入模型 ID，使用其他兼容模型'}</span></span>
          </button>
          {editing && (
            <form className="px-3 pb-3" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) choose(draft.trim()) }}>
              <label htmlFor={`${id}-custom`} className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400">自定义图像模型 ID</label>
              <div className="flex gap-2">
                <input ref={customRef} id={`${id}-custom`} value={draft} onChange={(event) => setDraft(event.target.value)} autoComplete="off" spellCheck={false} placeholder="输入服务商提供的完整模型 ID" className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-transparent px-3 py-2 font-mono text-xs text-gray-800 outline-none focus:border-blue-500 dark:border-white/15 dark:text-gray-100" />
                <button type="submit" disabled={!draft.trim()} className="rounded-lg bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">使用</button>
              </div>
            </form>
          )}
          <div className="mx-3 border-t border-gray-100 pb-2 pt-3 dark:border-white/[0.06]">
            <p className="mb-2 text-xs leading-5 text-gray-500 dark:text-gray-400">2.5 官方能力：生成、编辑与透明背景；更好地保留主体。</p>
            <p className="flex gap-2 text-xs leading-5 text-gray-500 dark:text-gray-400"><Info size={16} className="mt-0.5 shrink-0" />需当前 API 渠道支持；费用以服务商计费为准。</p>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
