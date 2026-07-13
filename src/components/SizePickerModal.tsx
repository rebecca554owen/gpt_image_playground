import { useEffect, useMemo, useRef, useState } from 'react'
import { calculateImageSize, isFourKImageSize, normalizeImageSize, parseRatio, type SizeTier } from '../lib/size'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import ViewportTooltip from './ViewportTooltip'

const TIERS: SizeTier[] = ['1K', '2K', '4K']
const SIZE_LIMIT_TEXT = '当前尺寸规范：\n宽高都必须是 16 的倍数；最大边长 3840px；长边 / 短边不超过 3:1；总像素必须在 655,360 到 8,294,400 之间。超出后会自动调整到合法尺寸。'
const RATIOS = [
  { label: '1:1', value: '1:1' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9', value: '21:9' },
]

interface Props {
  currentSize: string
  onSelect: (size: string) => void
  onClose: () => void
  allowAuto?: boolean
  imageCount?: number
}

type Mode = 'auto' | 'ratio' | 'resolution'

function parseSize(size: string) {
  const match = size.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!match) return null
  return { width: match[1], height: match[2] }
}

function findPresetForSize(size: string) {
  const normalized = normalizeImageSize(size)
  for (const tier of TIERS) {
    for (const ratio of RATIOS) {
      if (calculateImageSize(tier, ratio.value) === normalized) {
        return { tier, ratio: ratio.value }
      }
    }
  }
  return null
}

export default function SizePickerModal({ currentSize, onSelect, onClose, allowAuto = true, imageCount = 1 }: Props) {
  usePreventBackgroundScroll(true)

  const modalRef = useRef<HTMLDivElement>(null)
  const mouseDownTargetRef = useRef<EventTarget | null>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownTargetRef.current = e.target
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    const mouseDownTarget = mouseDownTargetRef.current
    const mouseUpTarget = e.target

    if (
      modalRef.current &&
      mouseDownTarget &&
      !modalRef.current.contains(mouseDownTarget as Node) &&
      mouseUpTarget &&
      !modalRef.current.contains(mouseUpTarget as Node)
    ) {
      onClose()
    }
    mouseDownTargetRef.current = null
  }

  const currentPreset = findPresetForSize(currentSize)
  const currentParsedSize = parseSize(currentSize)
  const [mode, setMode] = useState<Mode>(() => {
    if (!currentSize || currentSize === 'auto') return allowAuto ? 'auto' : 'ratio'
    if (currentPreset) return 'ratio'
    return 'resolution'
  })

  // Ratio mode state
  const [tier, setTier] = useState<SizeTier>(currentPreset?.tier ?? '1K')
  const [ratio, setRatio] = useState(currentPreset?.ratio ?? (allowAuto ? '1:1' : '4:3'))
  const [customRatio, setCustomRatio] = useState('16:9')

  // Resolution mode state
  const [customW, setCustomW] = useState(currentParsedSize?.width ?? '1024')
  const [customH, setCustomH] = useState(currentParsedSize?.height ?? '1024')
  const [fourKAction, setFourKAction] = useState<'select' | 'apply' | null>(null)
  const [fourKConfirmed, setFourKConfirmed] = useState(false)

  const [hintVisible, setHintVisible] = useState(false)
  const hintTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current)
  }, [])

  const activeRatio = ratio === 'custom' ? customRatio : ratio
  const parsedCustomRatio = parseRatio(customRatio)
  const customRatioValid = ratio !== 'custom' || Boolean(parsedCustomRatio)
  const customRatioClamped = Boolean(
    ratio === 'custom' &&
    parsedCustomRatio &&
    Math.max(parsedCustomRatio.width, parsedCustomRatio.height) / Math.min(parsedCustomRatio.width, parsedCustomRatio.height) > 3,
  )

  const previewSize = useMemo(() => {
    if (mode === 'auto') return 'auto'
    
    if (mode === 'ratio') {
      const size = calculateImageSize(tier, activeRatio)
      return size ? normalizeImageSize(size) : ''
    }
    
    if (mode === 'resolution') {
      const w = parseInt(customW, 10)
      const h = parseInt(customH, 10)
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return normalizeImageSize(`${w}x${h}`)
      }
      return ''
    }
    
    return ''
  }, [mode, tier, activeRatio, customW, customH])

  const isClamped = useMemo(() => {
    if (!previewSize || previewSize === 'auto') return false
    if (mode === 'ratio' && ratio === 'custom') return customRatioClamped
    if (mode === 'resolution') {
      const w = parseInt(customW, 10)
      const h = parseInt(customH, 10)
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return `${w}x${h}` !== previewSize
      }
    }
    return false
  }, [mode, ratio, customRatioClamped, customW, customH, previewSize])

  const isFourKSelection = isFourKImageSize(previewSize)
  const billedImageCount = Math.max(1, Math.trunc(imageCount) || 1)

  const showHint = () => setHintVisible(true)
  const hideHint = () => {
    setHintVisible(false)
    clearHintTimer()
  }
  const clearHintTimer = () => {
    if (hintTimerRef.current != null) {
      window.clearTimeout(hintTimerRef.current)
      hintTimerRef.current = null
    }
  }
  const startHintTouch = () => {
    hintTimerRef.current = window.setTimeout(() => {
      setHintVisible(true)
      hintTimerRef.current = null
    }, 450)
  }

  const applySize = () => {
    if (!previewSize) return
    if (isFourKSelection && !fourKConfirmed) {
      setFourKAction('apply')
      return
    }
    onSelect(previewSize)
    onClose()
  }

  const selectTier = (item: SizeTier) => {
    if (item === '4K' && tier !== '4K') {
      setFourKAction('select')
      return
    }
    setTier(item)
    if (item !== '4K') setFourKConfirmed(false)
  }

  const confirmFourK = () => {
    setFourKConfirmed(true)
    if (fourKAction === 'select') {
      setTier('4K')
      setFourKAction(null)
      return
    }
    if (fourKAction === 'apply' && previewSize) {
      onSelect(previewSize)
      onClose()
    }
  }

  const buttonClass = (active: boolean) => {
    return `rounded-xl border px-3 py-2 text-sm transition ${active
      ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-300'
      : 'border-gray-200/70 bg-white/60 text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]'
    }`
  }

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        ref={modalRef}
        className="relative z-10 w-full max-w-md rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">设置图像尺寸</h3>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">当前：{currentSize || 'auto'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-6">
          <div className="flex rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.04]">
            {allowAuto && (
              <button
                onClick={() => setMode('auto')}
                className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${mode === 'auto' ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
              >
                自动
              </button>
            )}
            <button
              onClick={() => setMode('ratio')}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${mode === 'ratio' ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              按比例
            </button>
            <button
              onClick={() => setMode('resolution')}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${mode === 'resolution' ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              自定义宽高
            </button>
          </div>

          <div className="h-[380px] max-h-[55vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10 pr-1 -mr-1 pb-2">
            {mode === 'auto' && (
              <div className="flex h-full animate-fade-in items-center justify-center pt-8 pb-4 text-center">
                <div>
                  <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-500 dark:bg-blue-500/10">
                    <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">自动尺寸</h4>
                  <p className="mt-2 text-xs text-gray-400 leading-relaxed dark:text-gray-500">
                    不向模型传递具体的分辨率参数
                    <br />
                    由模型自己决定生成尺寸
                  </p>
                </div>
              </div>
            )}

            {mode === 'ratio' && (
              <div className="space-y-5 animate-fade-in">
                <section>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500">输出清晰度</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">尺寸自动匹配模型</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {TIERS.map((item) => {
                      const selected = tier === item
                      const isFourK = item === '4K'
                      return (
                        <button
                          key={item}
                          aria-pressed={selected}
                          onClick={() => selectTier(item)}
                          className={`relative min-h-[78px] overflow-hidden rounded-2xl border px-2 py-2.5 text-left outline-none transition ${isFourK
                            ? selected
                              ? 'border-amber-400 bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-100 text-amber-950 shadow-[0_8px_24px_rgba(245,158,11,0.18)] ring-1 ring-amber-300/70 dark:border-amber-400/70 dark:from-amber-400/20 dark:via-orange-400/10 dark:to-yellow-300/10 dark:text-amber-100 dark:ring-amber-400/20'
                              : 'border-amber-300/80 bg-gradient-to-br from-amber-50/90 via-white to-orange-50/80 text-amber-900 shadow-[0_6px_18px_rgba(245,158,11,0.10)] hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-[0_10px_28px_rgba(245,158,11,0.18)] focus-visible:ring-2 focus-visible:ring-amber-300 dark:border-amber-400/30 dark:from-amber-400/10 dark:via-white/[0.03] dark:to-orange-400/[0.08] dark:text-amber-200'
                            : selected
                              ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200/80 dark:border-blue-500/60 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20'
                              : 'border-gray-200/70 bg-white/60 text-gray-700 hover:border-blue-300 hover:bg-blue-50/40 focus-visible:ring-2 focus-visible:ring-blue-200 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-blue-500/40 dark:hover:bg-blue-500/[0.06]'
                          }`}
                        >
                          {isFourK && (
                            <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm dark:bg-amber-400 dark:text-amber-950">
                              10×
                            </span>
                          )}
                          <span className="block text-sm font-bold">{isFourK ? '4K 超清' : item}</span>
                          <span className={`mt-1 block text-[10px] leading-tight ${isFourK ? 'text-amber-700 dark:text-amber-300' : 'text-gray-400 dark:text-gray-500'}`}>
                            {item === '1K' ? '快速预览 · 1×' : item === '2K' ? '标准出图 · 1×' : '高精交付 · 推荐'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section>
                  <div className="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500">图像比例</div>
                  <div className="grid grid-cols-4 gap-2">
                    {RATIOS.map((item) => {
                      const [w, h] = item.value.split(':').map(Number)
                      const isHorizontal = w > h
                      const isSquare = w === h
                      return (
                        <button
                          key={item.value}
                          className={`${buttonClass(ratio === item.value)} flex flex-col items-center justify-center gap-1.5 !py-2.5`}
                          onClick={() => setRatio(item.value)}
                        >
                          <div className="flex h-5 w-5 items-center justify-center">
                            <div
                              className="border-[1.5px] border-current rounded-[3px] opacity-60"
                              style={{
                                width: isHorizontal || isSquare ? '100%' : `${(w / h) * 100}%`,
                                height: !isHorizontal || isSquare ? '100%' : `${(h / w) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs">{item.label}</span>
                        </button>
                      )
                    })}
                    <button className={`${buttonClass(ratio === 'custom')} col-span-4`} onClick={() => setRatio('custom')}>
                      自定义比例
                    </button>
                  </div>
                </section>

                {ratio === 'custom' && (
                  <label className="block animate-fade-in">
                    <span className="mb-2 block text-xs font-medium text-gray-400 dark:text-gray-500">输入自定义比例</span>
                    <input
                      value={customRatio}
                      onChange={(e) => setCustomRatio(e.target.value)}
                      placeholder="例如 5:4 / 2.39:1"
                      className={`w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
                        customRatioValid
                          ? 'border-gray-200/70 bg-white/60 text-gray-700 focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50'
                          : 'border-red-300 bg-white/60 text-gray-700 focus:border-red-400 dark:border-red-500/40 dark:bg-white/[0.03] dark:text-gray-200'
                      }`}
                    />
                  </label>
                )}
              </div>
            )}

            {mode === 'resolution' && (
              <div className="space-y-5 animate-fade-in">
                <section>
                  <div className="mb-4 text-xs font-medium text-gray-400 dark:text-gray-500">输入具体像素值</div>
                  <div className="flex items-center gap-4">
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400">宽度 (Width)</span>
                      <input
                        type="number"
                        value={customW}
                        onChange={(e) => setCustomW(e.target.value)}
                        className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                        placeholder="例如 1024"
                      />
                    </label>
                    <div className="mt-5 text-gray-300 dark:text-gray-600">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400">高度 (Height)</span>
                      <input
                        type="number"
                        value={customH}
                        onChange={(e) => setCustomH(e.target.value)}
                        className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                        placeholder="例如 1024"
                      />
                    </label>
                  </div>
                </section>
                <div className="rounded-xl border border-gray-200/80 bg-gray-50/80 p-3 text-xs text-gray-600 dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-gray-400">
                  <div className="flex items-start gap-2">
                    <svg className="mt-[2px] h-4 w-4 flex-shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="whitespace-pre-line leading-relaxed">{SIZE_LIMIT_TEXT}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={`rounded-2xl border px-4 py-3 transition ${isFourKSelection
            ? 'border-amber-300/80 bg-gradient-to-r from-amber-50 to-orange-50 shadow-[0_8px_28px_rgba(245,158,11,0.12)] dark:border-amber-400/25 dark:from-amber-400/10 dark:to-orange-400/[0.06]'
            : 'border-transparent bg-gray-50 dark:bg-white/[0.03]'
          }`}>
            <div className={`flex items-center justify-between gap-3 text-xs ${isFourKSelection ? 'text-amber-700 dark:text-amber-300' : 'text-gray-400 dark:text-gray-500'}`}>
              <span>将使用</span>
              {isFourKSelection && <span className="rounded-full bg-amber-500 px-2 py-0.5 font-bold text-white dark:bg-amber-400 dark:text-amber-950">4K · 单张 10×</span>}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className={`font-mono text-lg font-semibold ${isFourKSelection ? 'text-amber-950 dark:text-amber-100' : 'text-gray-800 dark:text-gray-100'}`}>
                {previewSize || '尺寸无效'}
              </span>
              {isClamped && (
                <div
                  className="relative flex items-center"
                  onMouseEnter={showHint}
                  onMouseLeave={hideHint}
                  onTouchStart={startHintTouch}
                  onTouchEnd={clearHintTimer}
                  onTouchCancel={hideHint}
                  onClick={showHint}
                >
                  <svg className="w-5 h-5 text-yellow-500 cursor-pointer" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <ViewportTooltip visible={hintVisible} className="w-56 whitespace-pre-line text-center">
                    {SIZE_LIMIT_TEXT}
                  </ViewportTooltip>
                </div>
              )}
            </div>
            {isFourKSelection && (
              <div className="mt-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                {billedImageCount > 1
                  ? `本次 ${billedImageCount} 张，每张按 10× 计费，约等于 ${billedImageCount * 10} 张标准图费用`
                  : '本次 1 张按 10× 计费，约等于 10 张标准图费用'}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
          >
            取消
          </button>
          <button
            onClick={applySize}
            disabled={!previewSize}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${isFourKSelection
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-[0_8px_20px_rgba(245,158,11,0.25)] hover:from-amber-600 hover:to-orange-600'
              : 'bg-blue-500 hover:bg-blue-600'
            }`}
          >
            {isFourKSelection ? '确认使用 4K（10×）' : '确定'}
          </button>
        </div>
      </div>

      {fourKAction && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center p-4"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={() => setFourKAction(null)}
        >
          <div className="absolute inset-0 bg-amber-950/45 backdrop-blur-md animate-overlay-in" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="four-k-warning-title"
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-amber-300/80 bg-white shadow-[0_24px_80px_rgba(120,53,15,0.34)] ring-1 ring-amber-950/10 animate-confirm-in dark:border-amber-400/30 dark:bg-gray-900 dark:ring-amber-300/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-br from-amber-400 via-orange-400 to-orange-500 px-6 pb-5 pt-6 text-white">
              <div className="flex items-center justify-between gap-4">
                <span className="rounded-full border border-white/30 bg-white/20 px-2.5 py-1 text-[11px] font-bold tracking-wide backdrop-blur-sm">4K PREMIUM</span>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-orange-600 shadow-sm">单张 10×</span>
              </div>
              <h4 id="four-k-warning-title" className="mt-5 text-xl font-black tracking-tight">确认使用 4K 超清出图？</h4>
              <p className="mt-1 text-sm font-medium text-white/90">高质量交付推荐使用，但费用明显更高</p>
            </div>

            <div className="px-6 py-5">
              <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-orange-950 dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-orange-100">
                <div className="text-sm font-bold">
                  {billedImageCount > 1 ? `本次将生成 ${billedImageCount} 张 4K 图片` : '本次将生成 1 张 4K 图片'}
                </div>
                <div className="mt-1 text-xs font-medium leading-relaxed text-orange-800 dark:text-orange-300">
                  {billedImageCount > 1
                    ? `每张都按 10× 计费，合计约等于 ${billedImageCount * 10} 张 1K–2K 标准图费用。`
                    : '按 10× 计费，约等于 10 张 1K–2K 标准图费用。'}
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                系统会自动切换到 <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px] text-gray-700 dark:bg-white/[0.06] dark:text-gray-300">gpt-image-2-4k</code>，无需手动配置模型。
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => setFourKAction(null)}
                  className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                >
                  先用 1K–2K
                </button>
                <button
                  onClick={confirmFourK}
                  className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(245,158,11,0.28)] transition hover:from-amber-600 hover:to-orange-600"
                >
                  确认 4K · 10×
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
