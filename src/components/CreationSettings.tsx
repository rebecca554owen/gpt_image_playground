import { useState } from 'react'
import { CaretDown, CheckCircle, Info, Rectangle, Square } from '@phosphor-icons/react'
import type { ApiProfile } from '../types'
import { useStore } from '../store'
import { getImageGenerationModel, getImageModelPatch } from '../lib/imageModels'
import { isSizeManagedImageProfile } from '../lib/imageModelSelection'
import { calculateImageSize, findImageSizePreset, IMAGE_SIZE_RATIOS, IMAGE_SIZE_TIERS, isFourKImageSize, type SizeTier } from '../lib/size'
import ImageModelPicker from './ImageModelPicker'
import SizePickerModal from './SizePickerModal'

export default function CreationSettings({ profile }: { profile: ApiProfile }) {
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [showCustomSize, setShowCustomSize] = useState(false)
  const [showAllRatios, setShowAllRatios] = useState(false)
  const [lastRatio, setLastRatio] = useState<string>('1:1')
  const [lastTier, setLastTier] = useState<SizeTier>('1K')
  const preset = findImageSizePreset(params.size)
  const isAuto = params.size === 'auto'
  const ratio = preset?.ratio ?? lastRatio
  const tier = preset?.tier ?? lastTier
  const pixelLabel = (size: string) => size.replace('x', ' × ')
  const fourKBilling = isSizeManagedImageProfile(profile)

  const chooseSize = (size: string, nextRatio = ratio, nextTier = tier) => {
    const apply = () => {
      setLastRatio(nextRatio)
      setLastTier(nextTier)
      setParams({ size })
    }
    // 旧模型的 4K 确认继续保留，不套用到 Flare / Sunburst。
    if (fourKBilling && isFourKImageSize(size) && !isFourKImageSize(params.size)) {
      setConfirmDialog({
        title: '切换到 4K 尺寸',
        message: 'GPT Image 2 的 4K 尺寸将使用独立 4K 模型，每张按 10× 计费。是否继续？',
        confirmText: '使用 4K',
        action: apply,
      })
      return
    }
    apply()
  }
  const buttonClass = (selected: boolean) => `relative rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950 ${selected
    ? 'border-blue-500 bg-blue-50/70 text-blue-700 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-300'
    : 'border-gray-200 bg-white text-gray-900 hover:border-blue-300 hover:bg-blue-50/30 dark:border-white/10 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-white/[0.04]'}`

  return (
    <>
      <aside aria-label="创作设置" data-creation-settings data-no-drag-select className="creation-settings bg-white dark:bg-gray-950">
        <h2 className="mb-5 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 lg:mb-6 lg:text-2xl">创作设置</h2>
        <section aria-label="图像模型" className="mb-6">
          <h3 className="mb-2.5 text-base font-semibold text-gray-900 dark:text-gray-100">模型</h3>
          <ImageModelPicker
            key={profile.id}
            value={getImageGenerationModel(profile)}
            allowDefault={profile.apiMode === 'responses'}
            showSummary
            onChange={(model) => {
              const state = useStore.getState()
              state.setSettings({ profiles: state.settings.profiles.map((item) => item.id === profile.id ? { ...item, ...getImageModelPatch(item, model) } : item) })
            }}
          />
        </section>
        <section aria-labelledby="resolution-title">
          <h3 id="resolution-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">分辨率</h3>
          <p className="mb-3 mt-1 text-sm text-gray-500 dark:text-gray-400">选择图片的尺寸档位</p>
          <div className="grid grid-cols-4 gap-2 lg:grid-cols-2 lg:gap-3" role="group" aria-label="分辨率档位">
            <button type="button" aria-pressed={isAuto} onClick={() => chooseSize('auto')} className={`${buttonClass(isAuto)} min-h-16 px-2 py-3 sm:px-3 lg:min-h-24 lg:px-4`}>
              <span className="block text-base font-semibold lg:text-xl">自动</span>
              <span className="mt-2 hidden text-xs text-gray-500 dark:text-gray-400 lg:block">由模型决定尺寸</span>
              {isAuto && <CheckCircle weight="fill" size={18} className="absolute right-2 top-2 hidden text-blue-600 dark:text-blue-400 lg:block" />}
            </button>
            {IMAGE_SIZE_TIERS.map((item) => {
              const size = calculateImageSize(item, ratio)!
              const selected = preset?.tier === item
              return (
                <button key={item} type="button" aria-label={`${item}，${pixelLabel(size)}`} aria-pressed={selected} onClick={() => chooseSize(size, ratio, item)} className={`${buttonClass(selected)} min-h-16 px-2 py-3 sm:px-3 lg:min-h-24 lg:px-4`}>
                  <span className="block text-base font-semibold lg:text-xl">{item}</span>
                  <span className={`mt-2 hidden text-sm tabular-nums lg:block ${selected ? 'text-blue-600 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}>{pixelLabel(size)}</span>
                  {selected && <CheckCircle weight="fill" size={18} className="absolute right-2 top-2 hidden text-blue-600 dark:text-blue-400 lg:block" />}
                </button>
              )
            })}
          </div>
        </section>
        <section aria-labelledby="ratio-title" className="mt-6 lg:mt-8">
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="ratio-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">画面比例</h3>
            <button type="button" aria-expanded={showAllRatios} onClick={() => setShowAllRatios((value) => !value)} className="flex items-center gap-1 rounded text-xs text-gray-500 hover:text-blue-600 focus-visible:outline-blue-500 dark:text-gray-400">{showAllRatios ? '收起' : '更多比例'}<CaretDown size={13} className={showAllRatios ? 'rotate-180' : ''} /></button>
          </div>
          <p className="mb-3 mt-1 text-sm text-gray-500 dark:text-gray-400">{isAuto ? `选择比例时，将使用 ${tier} 档位` : '选择图片的宽高比例'}</p>
          <div role="group" aria-label="画面比例" className="grid grid-cols-3 gap-2">
            {IMAGE_SIZE_RATIOS.filter((item, idx) => showAllRatios || idx < 6 || item === preset?.ratio).map((item) => {
              const selected = !isAuto && preset?.ratio === item
              const [w, h] = item.split(':').map(Number)
              const RatioIcon = w === h ? Square : Rectangle
              return (
                <button key={item} type="button" aria-label={`比例 ${item}`} aria-pressed={selected} onClick={() => chooseSize(calculateImageSize(tier, item)!, item, tier)} className={`${buttonClass(selected)} flex min-h-11 flex-col items-center justify-center gap-1.5 px-2 py-2 text-sm lg:min-h-[72px]`}>
                  <RatioIcon size={24} className={`hidden lg:block ${h > w ? 'rotate-90' : ''}`} />
                  {item}
                </button>
              )
            })}
          </div>
        </section>
        <section aria-labelledby="request-size-title" className="mt-6 border-t border-gray-100 pt-5 dark:border-white/10 lg:mt-8 lg:pt-6">
          <h3 id="request-size-title" className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">请求尺寸</h3>
          <div className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-3 dark:bg-white/[0.04]">
            <div aria-live="polite" aria-atomic="true" data-size-summary>
              <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{isAuto ? '自动' : pixelLabel(params.size)}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{preset ? `${preset.tier} · ${preset.ratio}` : isAuto ? '由模型决定尺寸与比例' : '自定义尺寸'}</p>
            </div>
            <button type="button" onClick={() => setShowCustomSize(true)} className="shrink-0 rounded-md py-2 text-sm font-medium text-blue-600 hover:underline focus-visible:outline-blue-500 dark:text-blue-400">自定义像素</button>
          </div>
        </section>
        <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-gray-500 dark:text-gray-400 lg:mt-auto lg:pt-7"><Info size={16} className="mt-0.5 shrink-0" />档位为请求尺寸，实际输出与费用以当前渠道为准。</p>
      </aside>
      {showCustomSize && <SizePickerModal currentSize={params.size} initialMode="resolution" onSelect={(size) => setParams({ size })} onClose={() => setShowCustomSize(false)} imageCount={params.n} fourKBilling={fourKBilling} />}
    </>
  )
}
