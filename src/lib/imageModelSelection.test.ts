import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile, DEFAULT_IMAGES_MODEL, FOUR_K_IMAGES_MODEL } from './apiProfiles'
import { getImageModelForSize } from './imageModelSelection'

describe('getImageModelForSize', () => {
  it('uses the standard model for 1K and 2K output', () => {
    const profile = createDefaultOpenAIProfile({ model: FOUR_K_IMAGES_MODEL })

    expect(getImageModelForSize(profile, '1024x1024')).toBe(DEFAULT_IMAGES_MODEL)
    expect(getImageModelForSize(profile, '2560x1440')).toBe(DEFAULT_IMAGES_MODEL)
  })

  it('uses the fixed 4K model for 4K output', () => {
    const profile = createDefaultOpenAIProfile()

    expect(getImageModelForSize(profile, '3840x2160')).toBe(FOUR_K_IMAGES_MODEL)
    expect(getImageModelForSize(profile, '2880x2880')).toBe(FOUR_K_IMAGES_MODEL)
  })

  it('does not override non-Images API profiles', () => {
    const profile = createDefaultOpenAIProfile({ apiMode: 'responses', model: 'gpt-custom' })

    expect(getImageModelForSize(profile, '3840x2160')).toBe('gpt-custom')
  })
})
