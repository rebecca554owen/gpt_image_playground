import { describe, expect, it } from 'vitest'
import { calculateImageSize, isFourKImageSize } from './size'

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
