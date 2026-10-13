import { describe, expect, it } from 'vitest'
import {
  getApiErrorMessage,
  IMAGE_TOOL_DROPPED_HINT,
  IMAGE_UNSAFE_ERROR_MESSAGE,
  INVALID_IMAGE_SIZE_ERROR_MESSAGE,
  isThirdPartySimilarityPolicyError,
  maybeAppendStreamingHint,
  normalizeImageApiErrorDisplayText,
  normalizeImageApiErrorMessage,
  RESULT_IMAGE_HOST_NOT_ALLOWED_ERROR_HINT,
  RESULT_IMAGE_HOST_NOT_ALLOWED_ERROR_MESSAGE,
  THIRD_PARTY_SIMILARITY_ERROR_HINT,
  THIRD_PARTY_SIMILARITY_ERROR_MESSAGE,
  UPSTREAM_NO_IMAGE_OUTPUT_ERROR_MESSAGE,
} from './imageApiShared'

describe('image API error messages', () => {
  it.each([false, true])('identifies a stripped image tool without suggesting a streaming change: %s', (streamImages) => {
    const raw = "HTTP 400: Tool choice 'required' must be specified with 'tools' parameter. (request id: req-tool-test)"
    const message = maybeAppendStreamingHint(raw, 400, streamImages)

    expect(message).toContain(raw)
    expect(message).toContain(IMAGE_TOOL_DROPPED_HINT)
    expect(message).not.toContain('关闭流式')
    expect(maybeAppendStreamingHint(message, 400, streamImages)).toBe(message)
    expect(normalizeImageApiErrorDisplayText(message)).toContain('当前接口未能使用图像生成功能')
    expect(normalizeImageApiErrorDisplayText(message)).not.toContain('req-tool-test')
  })

  it('does not mistake a different tool validation error for a stripped image tool', () => {
    expect(maybeAppendStreamingHint('Invalid tools parameter', 400, false)).not.toContain(IMAGE_TOOL_DROPPED_HINT)
  })

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

  it('keeps a result host rejection distinct from a client network failure', () => {
    const expected = `${RESULT_IMAGE_HOST_NOT_ALLOWED_ERROR_MESSAGE}\n提示：${RESULT_IMAGE_HOST_NOT_ALLOWED_ERROR_HINT}`

    expect(normalizeImageApiErrorMessage('HTTP 502: result_image_host_not_allowed')).toBe(expected)
    expect(normalizeImageApiErrorDisplayText('图片域名未获允许。')).toBe(expected)
    expect(normalizeImageApiErrorDisplayText('HTTP 502: result_image_host_not_allowed')).not.toContain('网络连接已中断')
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

  it.each([
    'HTTP 400 request_failed: We’re unable to generate a result for this request at this time. This may be due to a content policy violation, invalid parameters, or an unknown issue.',
    'This may be due to a content policy violation, invalid parameters, or an unknown issue.',
    'HTTP 400：这可能是由于违反内容政策、参数无效或未知问题。',
  ])('does not turn an ambiguous upstream failure into a policy rejection: %s', (error) => {
    const display = normalizeImageApiErrorDisplayText(error)

    expect(display).toContain('具体原因尚不明确')
    expect(display).not.toContain('触发了安全审核')
    expect(display).not.toContain('被服务商的内容审核拒绝')
    expect(display).toContain('先查看任务记录')
  })

  it.each([
    'HTTP 403 content_policy_violation: The request was rejected.',
    'request_failed: content_policy_violation',
    'Your request was rejected as a result of our safety system.',
    '本次请求未通过内容审核。',
  ])('still identifies an explicit content rejection: %s', (error) => {
    expect(normalizeImageApiErrorDisplayText(error)).toContain('本次请求被服务商的内容审核拒绝')
  })

  it('retains the structured failure code and request ID for display and support', async () => {
    const message = await getApiErrorMessage(Response.json({
      error: { code: 'request_failed', message: 'Generation failed (request id: req-support-test)' },
    }, { status: 400 }))

    expect(message).toContain('request_failed')
    expect(message).toContain('req-support-test')
    expect(normalizeImageApiErrorDisplayText(message)).toContain('具体原因尚不明确')
    expect(normalizeImageApiErrorDisplayText(message)).not.toContain('req-support-test')
  })

  it('uses a structured policy code even when the error text is generic', async () => {
    const message = await getApiErrorMessage(Response.json({
      error: { code: 'content_policy_violation', message: 'Unable to process the request' },
    }, { status: 400 }))

    expect(normalizeImageApiErrorDisplayText(message)).toContain('被服务商的内容审核拒绝')
  })

  it('explains missing channel capacity separately from missing model configuration', () => {
    const display = normalizeImageApiErrorDisplayText('HTTP 503 model_not_found: No available channel for model gpt-image-2.5-sunburst under group default (distributor) (request id: req-channel-test)')

    expect(display).toContain('当前模型暂时没有可用服务通道')
    expect(display).toContain('切换其他图像模型')
    expect(display).not.toContain('API Key 无效')
  })

  it.each([403, 404, 504])('keeps image download HTTP %s separate from generation failure', (status) => {
    const display = normalizeImageApiErrorDisplayText(`图片 URL 下载失败：HTTP ${status}`)

    expect(display).toContain('图片结果暂时未能取回')
    expect(display).toContain('重新读取已有结果')
    expect(display).not.toContain('当前接口或模型不可用')
    expect(display).not.toContain('API Key 没有访问')
  })

  it('gives upload guidance for invalid image format without alleging a policy violation', () => {
    const display = normalizeImageApiErrorDisplayText('HTTP 400 {"detail":"We couldn\'t process this image. Error code: invalid_image_format."}')

    expect(display).toContain('参考图无法被服务商读取')
    expect(display).toContain('重新导出为 PNG 或 JPEG')
  })

  it('does not treat a moderation parameter validation error as a content rejection', () => {
    const display = normalizeImageApiErrorDisplayText('HTTP 400 invalid parameter: moderation must be auto or low')

    expect(display).toContain('当前请求参数不被模型支持')
    expect(display).not.toContain('内容审核拒绝')
  })

  it.each([
    ['request_failed: HTTP 401 Unauthorized', 'API Key 无效或已失效'],
    ['request_failed: insufficient_quota', '账户额度不足'],
  ])('keeps explicit account failures actionable: %s', (error, expected) => {
    expect(normalizeImageApiErrorDisplayText(error)).toContain(expected)
  })
})
