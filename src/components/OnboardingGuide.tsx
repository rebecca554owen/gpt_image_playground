import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowRight,
  ArrowSquareOut,
  Check,
  CursorClick,
  Key,
  MagnifyingGlassPlus,
  Palette,
  Sparkle,
  UploadSimple,
  X,
} from '@phosphor-icons/react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

const STORAGE_KEY = 'gpt-image-playground.onboarding-v1'
const PURCHASE_URL = 'https://llm-token.cn/'
const SAMPLE_PROMPT = '电影感夜景人像，墨绿色风衣，暖色逆光，细腻胶片质感'

const steps = [
  {
    badge: '新用户专享',
    title: '一个 Key，',
    accent: '直接开画',
    description: '在贵数智能算力平台、淘宝店或旺旺购买的 API Key 都能直接使用。文本模型和图片模型共享原有余额，无需重复付费。',
    target: null,
  },
  {
    badge: '作品胶片',
    title: '输入一句话，',
    accent: '开始生成',
    description: '描述主体、场景和风格就能出图。不会写提示词也没关系，先从一句简单的话开始。',
    target: 'prompt',
  },
  {
    badge: '图生图',
    title: '上传参考图，',
    accent: '复刻风格',
    description: '点击回形针上传人物、产品或构图参考图，再说清楚想保留和修改的部分。',
    target: 'upload',
  },
  {
    badge: '旧图焕新',
    title: '老照片改色，',
    accent: '自然又省钱',
    description: '上传旧图后描述想要的颜色，就能上色、修复和局部修改；每次生成价格都很低。',
    target: 'generate',
  },
] as const

const samples = [
  {
    src: '/onboarding/cinematic-portrait.webp',
    alt: '电影感夜景人像生成示例',
    label: '文字生图',
  },
  {
    src: '/onboarding/perfume-product.webp',
    alt: '香水产品图生成示例',
    label: '产品视觉',
  },
  {
    src: '/onboarding/photo-recolor.webp',
    alt: '黑白老照片自然上色前后对比',
    label: '旧图上色',
  },
] as const

interface TargetRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

interface OnboardingGuideProps {
  ready: boolean
}

function getVisibleTarget(name: string) {
  const elements = document.querySelectorAll<HTMLElement>(`[data-onboarding="${name}"]`)
  return Array.from(elements).find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(element).visibility !== 'hidden'
  }) ?? null
}

function saveSeen() {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'true')
  } catch {
    // 隐私模式下保留当前会话体验即可。
  }
}

export default function OnboardingGuide({ ready }: OnboardingGuideProps) {
  const appMode = useStore((s) => s.appMode)
  const taskCount = useStore((s) => s.tasks.length)
  const setPrompt = useStore((s) => s.setPrompt)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null)
  const [activePreview, setActivePreview] = useState<(typeof samples)[number] | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null)
  const activePreviewRef = useRef(activePreview)
  const visible = open && appMode === 'gallery'
  const modalStep = steps[step].target === null

  const close = useCallback(() => {
    saveSeen()
    setActivePreview(null)
    setOpen(false)
  }, [])

  useEffect(() => {
    const showGuide = () => {
      setStep(0)
      setActivePreview(null)
      setOpen(true)
    }

    window.addEventListener('open-image-onboarding', showGuide)
    if (!ready || appMode !== 'gallery' || taskCount > 0) return () => window.removeEventListener('open-image-onboarding', showGuide)

    try {
      if (window.localStorage.getItem(STORAGE_KEY) === 'true') {
        return () => window.removeEventListener('open-image-onboarding', showGuide)
      }
    } catch {
      // localStorage 不可用时仍展示一次当前会话引导。
    }

    const timer = window.setTimeout(showGuide, 450)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('open-image-onboarding', showGuide)
    }
  }, [appMode, ready, taskCount])

  useLayoutEffect(() => {
    if (!visible || !steps[step].target) {
      setTargetRect(null)
      return
    }

    const targetName = steps[step].target
    const update = () => {
      const target = getVisibleTarget(targetName)
      if (!target) {
        setTargetRect(null)
        return
      }

      const rect = target.getBoundingClientRect()
      const padding = targetName === 'prompt' ? 9 : 10
      const top = Math.max(6, rect.top - padding)
      const left = Math.max(6, rect.left - padding)
      const right = Math.min(window.innerWidth - 6, rect.right + padding)
      const bottom = Math.min(window.innerHeight - 6, rect.bottom + padding)
      setTargetRect({
        top,
        right,
        bottom,
        left,
        width: right - left,
        height: bottom - top,
      })
    }

    const frame = window.requestAnimationFrame(update)
    const target = getVisibleTarget(targetName)
    const observer = target ? new ResizeObserver(update) : null
    if (target && observer) observer.observe(target)

    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)

    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [step, visible])

  useEffect(() => {
    activePreviewRef.current = activePreview
  }, [activePreview])

  useEffect(() => {
    if (!visible || !modalStep) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus())

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || activePreviewRef.current) return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', trapFocus)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', trapFocus)
      previousFocus?.focus()
    }
  }, [modalStep, visible])

  useEffect(() => {
    if (!activePreview) return
    const frame = window.requestAnimationFrame(() => previewRef.current?.focus())

    const trapPreviewFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = previewRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === previewRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === previewRef.current)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', trapPreviewFocus)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', trapPreviewFocus)
      previewTriggerRef.current?.focus()
    }
  }, [activePreview])

  useCloseOnEscape(visible && !activePreview, close)
  useCloseOnEscape(Boolean(activePreview), () => setActivePreview(null))
  usePreventBackgroundScroll(visible, panelRef)

  if (!visible) return null

  const currentStep = steps[step]
  const pointerLabel = currentStep.target === 'prompt'
    ? '在这里输入图片描述'
    : currentStep.target === 'upload'
    ? '点击这里上传参考图'
    : '点击这里开始生成'

  return createPortal(
    <div data-no-drag-select className="pointer-events-none fixed inset-0 z-[160]">
      {targetRect ? (
        <>
          <div className="pointer-events-auto fixed left-0 right-0 top-0 bg-slate-950/55 backdrop-blur-[6px] onboarding-overlay-in" style={{ height: targetRect.top }} />
          <div className="pointer-events-auto fixed bottom-0 left-0 right-0 bg-slate-950/55 backdrop-blur-[6px] onboarding-overlay-in" style={{ top: targetRect.bottom }} />
          <div className="pointer-events-auto fixed left-0 bg-slate-950/55 backdrop-blur-[6px] onboarding-overlay-in" style={{ top: targetRect.top, width: targetRect.left, height: targetRect.height }} />
          <div className="pointer-events-auto fixed right-0 bg-slate-950/55 backdrop-blur-[6px] onboarding-overlay-in" style={{ top: targetRect.top, left: targetRect.right, height: targetRect.height }} />
          <div
            className="fixed rounded-[1.6rem] border-2 border-white/90 shadow-[0_0_0_1px_rgba(49,87,234,0.55),0_0_38px_12px_rgba(91,115,255,0.5)] onboarding-target-glow"
            style={{ top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.height }}
          />
          <div
            className="fixed z-20 flex items-center gap-2 rounded-xl bg-[#3157ea] px-3 py-2 text-xs font-semibold text-white shadow-[0_12px_34px_rgba(49,87,234,0.42)] onboarding-pointer-motion"
            style={{
              top: Math.max(8, targetRect.top - 48),
              left: Math.max(10, Math.min(window.innerWidth - 210, targetRect.left + Math.min(34, targetRect.width / 4))),
            }}
          >
            <CursorClick className="h-5 w-5" weight="fill" />
            {pointerLabel}
          </div>
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-0 bg-slate-950/55 backdrop-blur-[7px] onboarding-overlay-in" />
      )}

      <div className="onboarding-guide-shell absolute inset-0 z-10 flex items-start justify-center px-3 sm:px-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal={modalStep ? true : undefined}
          aria-hidden={activePreview ? true : undefined}
          aria-labelledby="onboarding-title"
          inert={activePreview ? true : undefined}
          tabIndex={-1}
          className="pointer-events-auto w-full max-w-5xl overflow-y-auto rounded-[1.8rem] outline-none onboarding-panel-in"
          style={{
            maxHeight: targetRect
              ? 'calc(100vh - var(--input-bar-clearance, 220px) - var(--onboarding-panel-top) - 1rem)'
              : 'calc(100vh - var(--onboarding-panel-top) - 0.75rem)',
          }}
        >
          <section className="relative overflow-hidden rounded-[1.8rem] border border-white/65 bg-white/90 p-5 shadow-[0_28px_90px_rgba(15,23,42,0.32)] ring-1 ring-black/5 backdrop-blur-2xl dark:border-white/[0.1] dark:bg-gray-950/90 dark:ring-white/[0.08] sm:p-8">
            <button
              type="button"
              onClick={close}
              className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200/80 bg-white/80 text-gray-400 shadow-sm transition hover:scale-105 hover:bg-white hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-gray-400 dark:hover:text-white"
              aria-label="跳过新手引导"
            >
              <X className="h-5 w-5" weight="bold" />
            </button>

            <div className="grid items-center gap-7 sm:grid-cols-[0.93fr_1.07fr] sm:gap-9">
              <div className="min-w-0 pr-8 sm:border-r sm:border-gray-200/80 sm:pr-9 dark:sm:border-white/[0.08]">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#3157ea] px-3.5 py-2 text-xs font-semibold text-white shadow-[0_8px_24px_rgba(49,87,234,0.3)]">
                  {step === 0 ? <Key className="h-4 w-4" weight="bold" /> : null}
                  {step === 1 ? <Sparkle className="h-4 w-4" weight="fill" /> : null}
                  {step === 2 ? <UploadSimple className="h-4 w-4" weight="bold" /> : null}
                  {step === 3 ? <Palette className="h-4 w-4" weight="fill" /> : null}
                  {currentStep.badge}
                </div>

                <h2 id="onboarding-title" className="text-[1.75rem] font-bold leading-tight tracking-tight text-gray-900 dark:text-white sm:text-[2.1rem]">
                  {currentStep.title}<span className="text-[#3157ea] dark:text-blue-400">{currentStep.accent}</span>
                </h2>
                <p className="mt-4 text-[15px] leading-7 text-gray-600 dark:text-gray-300">
                  {currentStep.description}
                </p>

                <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 dark:bg-white/[0.06]"><Check className="h-3.5 w-3.5 text-emerald-500" weight="bold" />共享原有额度</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 dark:bg-white/[0.06]"><Check className="h-3.5 w-3.5 text-emerald-500" weight="bold" />无需额外付费</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"><Check className="h-3.5 w-3.5" weight="bold" />生图价格很低</span>
                </div>

                {step === 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPrompt(SAMPLE_PROMPT)
                      window.setTimeout(() => getVisibleTarget('prompt')?.focus(), 0)
                    }}
                    className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-white dark:text-gray-900"
                  >
                    <Sparkle className="h-4 w-4" weight="fill" />
                    写入示例提示词
                  </button>
                ) : null}
              </div>

              <div className="min-w-0">
                <div className="mb-3 pr-10">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">看看大家都在生成什么</p>
                    <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">点击图片可放大查看</p>
                  </div>
                </div>

                <div className="grid h-36 grid-cols-3 items-center gap-2 sm:h-64 sm:gap-3">
                  {samples.map((sample, index) => (
                    <button
                      key={sample.src}
                      type="button"
                      onClick={(event) => {
                        previewTriggerRef.current = event.currentTarget
                        setActivePreview(sample)
                      }}
                      className={`group relative overflow-hidden rounded-2xl border-2 border-white bg-gray-100 text-left shadow-[0_18px_38px_rgba(15,23,42,0.2)] transition duration-300 hover:z-10 hover:-translate-y-2 hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/10 dark:bg-white/[0.04] ${index === 1 ? 'h-36 sm:h-64' : 'h-28 sm:h-52'}`}
                      aria-label={`放大查看${sample.label}示例`}
                    >
                      <img
                        src={sample.src}
                        alt={sample.alt}
                        width="1122"
                        height="1402"
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-2.5 py-2 text-[11px] font-semibold text-white backdrop-blur-md sm:px-3 sm:text-xs">
                        {sample.label}
                        <MagnifyingGlassPlus className="h-4 w-4" weight="bold" />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="px-2 pb-2 pt-4 sm:px-8 sm:pt-5">
            <ol className="mx-auto flex max-w-2xl items-center justify-center gap-1 text-[11px] font-medium text-white/55 sm:gap-3 sm:text-sm" aria-label="新手引导进度">
              {steps.map((item, index) => (
                <li key={item.badge} className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(index)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-current={index === step ? 'step' : undefined}
                    aria-label={`第 ${index + 1} 步：${item.badge}`}
                  >
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold transition ${index === step ? 'border-white bg-[#3157ea] text-white shadow-[0_0_24px_rgba(91,115,255,0.8)]' : index < step ? 'border-white/50 bg-white/15 text-white' : 'border-white/30 bg-black/10 text-white/60'}`}>
                      {index < step ? <Check className="h-3.5 w-3.5" weight="bold" /> : index + 1}
                    </span>
                  </button>
                  <span className={`hidden whitespace-nowrap sm:inline ${index === step ? 'font-semibold text-white' : ''}`}>{item.badge}</span>
                  {index < steps.length - 1 ? <span className="mx-0.5 h-px w-3 bg-white/25 sm:mx-1 sm:w-8" /> : null}
                </li>
              ))}
            </ol>

            <div className="mt-4 flex items-center justify-center gap-3">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={() => setStep((value) => value - 1)}
                  className="min-h-11 rounded-xl border border-white/35 bg-white/10 px-5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  上一步
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (step < steps.length - 1) {
                    setStep((value) => value + 1)
                    return
                  }
                  close()
                  window.setTimeout(() => getVisibleTarget('prompt')?.focus(), 0)
                }}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#3157ea] px-6 text-sm font-semibold text-white shadow-[0_12px_34px_rgba(49,87,234,0.42)] transition hover:-translate-y-0.5 hover:bg-[#2447d9] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {step === steps.length - 1 ? '开始创作' : step === 0 ? '已有 Key，继续了解' : '下一步'}
                <ArrowRight className="h-4 w-4" weight="bold" />
              </button>
            </div>

            <a
              href={PURCHASE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={saveSeen}
              className="group mx-auto mt-4 flex min-h-[4.5rem] w-full max-w-xl items-center justify-between gap-4 rounded-2xl border border-white/25 bg-[#3157ea] px-4 py-3 text-white shadow-[0_20px_55px_rgba(49,87,234,0.52)] transition hover:-translate-y-1 hover:bg-[#2447d9] hover:shadow-[0_24px_65px_rgba(49,87,234,0.62)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-5"
            >
              <span className="min-w-0 text-left">
                <span className="block text-base font-bold sm:text-lg">还没有 API Key？立即购买</span>
                <span className="mt-0.5 block text-xs text-blue-100 sm:text-sm">前往 llm-token.cn · 低成本生图 · 无需额外付费</span>
              </span>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#3157ea] shadow-lg transition group-hover:scale-105 group-hover:rotate-3">
                <ArrowSquareOut className="h-5 w-5" weight="bold" />
              </span>
            </a>

            <button
              type="button"
              onClick={() => {
                saveSeen()
                setOpen(false)
                setShowSettings(true, 'api')
              }}
              className="mx-auto mt-3 block min-h-10 rounded-lg px-4 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              已有 Key？打开 API 设置
            </button>
          </div>
        </div>
      </div>

      {activePreview ? (
        <div
          ref={previewRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${activePreview.label}大图预览`}
          tabIndex={-1}
          className="pointer-events-auto fixed inset-0 z-[180] flex items-center justify-center bg-black/75 p-5 backdrop-blur-xl onboarding-overlay-in"
          onClick={() => setActivePreview(null)}
        >
          <button
            type="button"
            onClick={() => setActivePreview(null)}
            className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/30 text-white transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="关闭大图预览"
          >
            <X className="h-5 w-5" weight="bold" />
          </button>
          <figure className="max-w-3xl" onClick={(event) => event.stopPropagation()}>
            <img
              src={activePreview.src}
              alt={activePreview.alt}
              width="1122"
              height="1402"
              className="max-h-[80vh] w-auto rounded-3xl border border-white/20 object-contain shadow-[0_40px_120px_rgba(0,0,0,0.65)] onboarding-preview-in"
            />
            <figcaption className="mt-4 text-center text-sm font-medium text-white/80">{activePreview.label} · 点击空白处返回</figcaption>
          </figure>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
