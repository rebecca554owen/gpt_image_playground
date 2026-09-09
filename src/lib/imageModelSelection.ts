import type { ApiProfile } from '../types'
import { DEFAULT_IMAGES_MODEL, FOUR_K_IMAGES_MODEL } from './apiProfiles'
import { isFourKImageSize } from './size'

export function getImageModelForSize(profile: ApiProfile, size: string) {
  if (!isSizeManagedImageProfile(profile)) return profile.model
  return isFourKImageSize(size) ? FOUR_K_IMAGES_MODEL : DEFAULT_IMAGES_MODEL
}

export function isSizeManagedImageProfile(profile: ApiProfile) {
  return profile.provider === 'openai' && profile.apiMode === 'images'
    && (profile.model === DEFAULT_IMAGES_MODEL || profile.model === FOUR_K_IMAGES_MODEL)
}
