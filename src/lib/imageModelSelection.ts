import type { ApiProfile } from '../types'
import { DEFAULT_IMAGES_MODEL, FOUR_K_IMAGES_MODEL } from './apiProfiles'
import { isFourKImageSize } from './size'

export function getImageModelForSize(profile: ApiProfile, size: string) {
  if (profile.provider !== 'openai' || profile.apiMode !== 'images') return profile.model
  return isFourKImageSize(size) ? FOUR_K_IMAGES_MODEL : DEFAULT_IMAGES_MODEL
}
