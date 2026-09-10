import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile, DEFAULT_IMAGES_MODEL, LEGACY_IMAGES_MODEL, FOUR_K_IMAGES_MODEL } from './apiProfiles'
import { getImageModelForSize, isSizeManagedImageProfile } from './imageModelSelection'

describe('getImageModelForSize', () => {
  it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'vendor/gpt-image-2.5-custom'])('preserves explicitly selected model %s at every resolution', (model) => {
    const profile = createDefaultOpenAIProfile({ model })
    expect(getImageModelForSize(profile, '1024x1024')).toBe(model)
    expect(getImageModelForSize(profile, '3840x2160')).toBe(model)
  })

  it('uses the standard model for 1K and 2K output', () => {
    const profile = createDefaultOpenAIProfile({ model: FOUR_K_IMAGES_MODEL })

    expect(getImageModelForSize(profile, '1024x1024')).toBe(LEGACY_IMAGES_MODEL)
    expect(getImageModelForSize(profile, '2560x1440')).toBe(LEGACY_IMAGES_MODEL)
  })

  it('uses the fixed 4K model for 4K output', () => {
    const profile = createDefaultOpenAIProfile({ model: LEGACY_IMAGES_MODEL })

    expect(getImageModelForSize(profile, '3840x2160')).toBe(FOUR_K_IMAGES_MODEL)
    expect(getImageModelForSize(profile, '2880x2880')).toBe(FOUR_K_IMAGES_MODEL)
  })

  it('keeps the default Flare model at 4K without enabling legacy fixed-price routing', () => {
    const profile = createDefaultOpenAIProfile()
    expect(profile.model).toBe('gpt-image-2.5-flare')
    expect(getImageModelForSize(profile, '3840x2160')).toBe(DEFAULT_IMAGES_MODEL)
    expect(isSizeManagedImageProfile(profile)).toBe(false)
  })

  it('does not override non-Images API profiles', () => {
    const profile = createDefaultOpenAIProfile({ apiMode: 'responses', model: 'gpt-custom' })

    expect(getImageModelForSize(profile, '3840x2160')).toBe('gpt-custom')
  })
})
