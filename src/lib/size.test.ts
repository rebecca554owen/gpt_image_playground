import { describe, expect, it } from 'vitest'
import { calculateImageSize, findImageSizePreset, IMAGE_SIZE_RATIOS, IMAGE_SIZE_TIERS, isFourKImageSize } from './size'

describe('findImageSizePreset', () => {
  it('restores every resolution and aspect ratio from persisted pixel dimensions', () => {
    for (const tier of IMAGE_SIZE_TIERS) {
      for (const ratio of IMAGE_SIZE_RATIOS) {
        expect(findImageSizePreset(calculateImageSize(tier, ratio)!)).toEqual({ tier, ratio })
      }
    }
  })

  it('recognizes normalized dimensions without labeling custom or auto as a preset', () => {
    expect(findImageSizePreset('3840 × 2160')).toEqual({ tier: '4K', ratio: '16:9' })
    expect(findImageSizePreset('auto')).toBeNull()
    expect(findImageSizePreset('1600x1200')).toBeNull()
    expect(findImageSizePreset('invalid')).toBeNull()
  })
})

describe('calculateImageSize', () => {
  it('uses common 16:9 display resolutions for the built-in tiers', () => {
    expect(calculateImageSize('1K', '16:9')).toBe('1280x720')
    expect(calculateImageSize('2K', '16:9')).toBe('2560x1440')
    expect(calculateImageSize('4K', '16:9')).toBe('3840x2160')
  })

  it('uses matching portrait presets for common ratios', () => {
    expect(calculateImageSize('2K', '9:16')).toBe('1440x2560')
    expect(calculateImageSize('2K', '2:3')).toBe('1440x2160')
    expect(calculateImageSize('2K', '3:4')).toBe('1536x2048')
  })

  it('falls back to budget-based sizing for custom ratios', () => {
    expect(calculateImageSize('2K', '5:4')).toBe('2288x1824')
  })
})

describe('isFourKImageSize', () => {
  it('keeps 1K and 2K sizes on the standard model', () => {
    expect(isFourKImageSize('1024x1024')).toBe(false)
    expect(isFourKImageSize('2048x2048')).toBe(false)
    expect(isFourKImageSize('2560x1440')).toBe(false)
  })

  it('routes 4K and oversized custom dimensions to the 4K model', () => {
    expect(isFourKImageSize('3840x2160')).toBe(true)
    expect(isFourKImageSize('2880x2880')).toBe(true)
    expect(isFourKImageSize('2560x2048')).toBe(true)
  })

  it('does not classify auto or invalid sizes as 4K', () => {
    expect(isFourKImageSize('auto')).toBe(false)
    expect(isFourKImageSize('invalid')).toBe(false)
  })
})
