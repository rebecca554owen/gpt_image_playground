import { describe, expect, it } from 'vitest'
import {
  getApiErrorMessage,
  IMAGE_UNSAFE_ERROR_MESSAGE,
  INVALID_IMAGE_SIZE_ERROR_MESSAGE,
  normalizeImageApiErrorMessage,
  UPSTREAM_NO_IMAGE_OUTPUT_ERROR_MESSAGE,
} from './imageApiShared'

describe('image API error messages', () => {
  it('normalizes image safety poll failures', () => {
    expect(normalizeImageApiErrorMessage(
      'status_code=503, poll failed: 451 {"error_code":"image_unsafe","message":"generated images appear to be unsafe. Try modifying the prompts or the seeds."}',
    )).toBe(IMAGE_UNSAFE_ERROR_MESSAGE)
  })

  it('normalizes image safety JSON API errors', async () => {
    const message = await getApiErrorMessage(new Response(JSON.stringify({
      error_code: 'image_unsafe',
      message: 'generated images appear to be unsafe. Try modifying the prompts or the seeds.',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(message).toBe(IMAGE_UNSAFE_ERROR_MESSAGE)
  })

  it('normalizes missing upstream image output errors', () => {
    expect(normalizeImageApiErrorMessage(
      'status_code=502, upstream did not return image output',
    )).toBe(UPSTREAM_NO_IMAGE_OUTPUT_ERROR_MESSAGE)
  })

  it('normalizes invalid image size errors with limit details', () => {
    expect(normalizeImageApiErrorMessage(
      "status_code=400, Invalid size '4096x4096'. The longest edge must be less than or equal to 3840.",
    )).toBe('图片尺寸 4096x4096 超出服务商限制，最长边需不超过 3840px，请改小尺寸后重试。')
  })

  it('normalizes generic invalid image size errors', () => {
    expect(normalizeImageApiErrorMessage(
      "status_code=400, Invalid size '4096x4096'.",
    )).toBe(INVALID_IMAGE_SIZE_ERROR_MESSAGE)
  })
})
