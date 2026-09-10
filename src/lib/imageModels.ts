import type { ApiProfile } from '../types'

export const GPT_IMAGE_25_MODELS = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'] as const
export const IMAGE_MODEL_GUIDE_URL = 'https://developers.openai.com/api/docs/guides/image-prompting'

// 官方模型定位；渠道可用性和实际计费不能由前端选项推断。
export const IMAGE_MODEL_CHOICES = [
  { id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', shortName: 'Flare', badge: '速度优先', description: '小型模型，快速生成，画质接近 GPT Image 2。' },
  { id: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst', shortName: 'Sunburst', badge: '质量优先', description: '基础模型，更高画质，适合复杂创作与精细编辑。' },
  { id: 'gpt-image-2', name: 'GPT Image 2', shortName: 'GPT Image 2', badge: '', description: '保留原有出图方式；Images API 按尺寸自动匹配。' },
] as const

export function getImageModelPatch(profile: ApiProfile, model: string): Partial<ApiProfile> {
  return profile.provider === 'openai' && profile.apiMode === 'responses'
    ? { imageGenerationModel: model.trim() }
    : { model: model.trim() }
}

export function getImageGenerationModel(profile: ApiProfile) {
  return profile.provider === 'openai' && profile.apiMode === 'responses'
    ? profile.imageGenerationModel?.trim() ?? ''
    : profile.model
}

export function isGptImage25Model(model: string) {
  return model.trim().toLowerCase().includes('gpt-image-2.5')
}
