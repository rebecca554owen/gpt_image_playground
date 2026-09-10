import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { getImageGenerationModel, getImageModelPatch, GPT_IMAGE_25_MODELS, IMAGE_MODEL_CHOICES } from './imageModels'
import { getImageModelForSize } from './imageModelSelection'

describe('image model picker', () => {
  it.each(GPT_IMAGE_25_MODELS)('selects the exact Images API model %s without changing the profile', (model) => {
    const profile = createDefaultOpenAIProfile()
    const updated = { ...profile, ...getImageModelPatch(profile, model) }
    expect(getImageModelPatch(profile, model)).toEqual({ model })
    expect(updated.apiMode).toBe(profile.apiMode)
    expect(updated.codexCli).toBe(profile.codexCli)
    expect(getImageModelForSize(updated, '3840x2160')).toBe(model)
  })

  it.each(GPT_IMAGE_25_MODELS)('keeps the Responses text model when choosing %s', (model) => {
    const profile = createDefaultOpenAIProfile({ apiMode: 'responses', model: 'gpt-5.5' })
    const updated = { ...profile, ...getImageModelPatch(profile, model) }
    expect(updated.model).toBe('gpt-5.5')
    expect(getImageGenerationModel(updated)).toBe(model)
  })

  it('restores API default without clearing the Responses text model', () => {
    const profile = createDefaultOpenAIProfile({ apiMode: 'responses', model: 'gpt-5.5', imageGenerationModel: 'gpt-image-2.5-flare' })
    expect(getImageModelPatch(profile, '')).toEqual({ imageGenerationModel: '' })
  })

  it('preserves custom model IDs without treating a gateway name as an official alias', () => {
    const profile = createDefaultOpenAIProfile()
    expect(getImageModelPatch(profile, '  vendor/custom-image  ')).toEqual({ model: 'vendor/custom-image' })
    expect(IMAGE_MODEL_CHOICES.map((model) => model.id)).not.toContain('gpt-image-2.5')
  })
})
