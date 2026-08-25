import { describe, expect, it } from 'vitest'
import {
  getApiErrorMessage,
  IMAGE_UNSAFE_ERROR_MESSAGE,
  INVALID_IMAGE_SIZE_ERROR_MESSAGE,
  isThirdPartySimilarityPolicyError,
  normalizeImageApiErrorDisplayText,
  normalizeImageApiErrorMessage,
  THIRD_PARTY_SIMILARITY_ERROR_HINT,
  THIRD_PARTY_SIMILARITY_ERROR_MESSAGE,
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

  it('shows a dedicated reminder for third-party similarity protection', () => {
    const upstreamMessage = 'status_code=400, 非常抱歉，生成的图片可能违反了关于与第三方内容相似性的防护限制。如果你认为此判断有误，请重试或修改提示语。 TraceId: test-trace'

    expect(isThirdPartySimilarityPolicyError(upstreamMessage)).toBe(true)
    expect(normalizeImageApiErrorDisplayText(upstreamMessage)).toBe(
      `${THIRD_PARTY_SIMILARITY_ERROR_MESSAGE}\n提示：${THIRD_PARTY_SIMILARITY_ERROR_HINT}`,
    )
    expect(isThirdPartySimilarityPolicyError('HTTP 500 Internal Server Error')).toBe(false)
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

  it('normalizes request failure display text while preserving hints', () => {
    expect(normalizeImageApiErrorDisplayText(
      '请求失败：status_code=503, poll failed: 451 {"error_code":"image_unsafe","message":"generated images appear to be unsafe. Try modifying the prompts or the seeds."}\n提示：请求立即失败，请检查 API 代理服务是否正常运行。',
    )).toBe(`请求失败：${IMAGE_UNSAFE_ERROR_MESSAGE}\n提示：请求立即失败，请检查 API 代理服务是否正常运行。`)
  })

  it.each([
    ['Signal is aborted without reason', '本次生成已被中止。', '避免重复扣费'],
    ['无效的令牌 (request id: req-test)', 'API Key 无效或已失效。', '文本和图片共用同一 Key'],
    ['HTTP 429 Too Many Requests', '请求过于频繁。', '等待一会儿'],
    ['504 Gateway Time-out', '生成等待时间过长，连接已超时。', '避免重复扣费'],
    ['HTTP 503 Service Unavailable', '图片服务暂时不稳定。', '提交工单'],
    ['HTTP 413 Payload Too Large', '上传的图片过大。', '压缩图片'],
    ['视频任务创建失败：HTTP 405', '当前功能的服务器接口尚未开放。', '提交工单'],
    ['model image-test not found', '当前接口或模型不可用。', '模型选择'],
    ['Something unexpected happened', '图片生成失败，服务返回了未识别的错误。', '复制完整报错'],
  ])('shows friendly Chinese guidance for %s', (error, main, hint) => {
    const display = normalizeImageApiErrorDisplayText(error)

    expect(display).toContain(main)
    expect(display).toContain(hint)
    expect(display).not.toContain('req-test')
  })

  it('keeps an unknown Chinese error readable', () => {
    expect(normalizeImageApiErrorDisplayText('图片数量超过当前模型限制')).toBe('图片数量超过当前模型限制')
  })
})
