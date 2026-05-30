import { describe, expect, it } from 'vitest'
import {
  getApiErrorMessage,
  IMAGE_UNSAFE_ERROR_MESSAGE,
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
})
