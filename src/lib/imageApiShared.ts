import type { AppSettings, TaskParams } from '../types'
import { blobToDataUrl } from './dataUrl'

export const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const MAX_MASK_EDIT_FILE_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_INPUT_PAYLOAD_BYTES = 512 * 1024 * 1024

export interface CallApiOptions {
  settings: AppSettings
  prompt: string
  params: TaskParams
  /** 输入图片的 data URL 列表 */
  inputImageDataUrls: string[]
  maskDataUrl?: string
  onFalRequestEnqueued?: (request: { requestId: string; endpoint: string }) => void
  onCustomTaskEnqueued?: (task: { taskId: string }) => void
  onPartialImage?: (partial: { image: string; partialImageIndex?: number; requestIndex?: number }) => void
}

export interface CallApiResult {
  /** base64 data URL 列表 */
  images: string[]
  /** API 返回的实际生效参数 */
  actualParams?: Partial<TaskParams>
  /** 每张图片对应的实际生效参数 */
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  /** 每张图片对应的 API 改写提示词 */
  revisedPrompts?: Array<string | undefined>
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 并发多图请求中失败的单张请求 */
  failedRequests?: Array<{ requestIndex: number; error: string }>
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

export function normalizeBase64Image(value: string, fallbackMime: string): string {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export function getDataUrlEncodedByteSize(dataUrl: string): number {
  return dataUrl.length
}

export function getDataUrlDecodedByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return dataUrl.length

  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  if (!/;base64/i.test(meta)) return decodeURIComponent(payload).length

  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function assertMaxBytes(label: string, bytes: number, maxBytes: number) {
  if (bytes > maxBytes) {
    throw new Error(`${label}过大：${formatMiB(bytes)}，上限为 ${formatMiB(maxBytes)}`)
  }
}

export function assertImageInputPayloadSize(bytes: number) {
  assertMaxBytes('图像输入有效负载总大小', bytes, MAX_IMAGE_INPUT_PAYLOAD_BYTES)
}

export function assertMaskEditFileSize(label: string, bytes: number) {
  assertMaxBytes(label, bytes, MAX_MASK_EDIT_FILE_BYTES)
}

export const IMAGE_FETCH_CORS_HINT = ' 可点链接按钮复制结果链接，或尝试开启「返回 Base64 图片数据」避免此问题。'
export const STREAMING_UNSUPPORTED_HINT = '提示：当前使用的 API 可能不支持流式传输，请尝试关闭「流式传输」功能。'
export const STREAMING_FORMAT_HINT = '提示：API 返回了无法解析的流式数据格式，请尝试关闭「流式传输」功能。'

export function appendStreamingUnsupportedHint(message: string): string {
  return message ? `${message}\n${STREAMING_UNSUPPORTED_HINT}` : STREAMING_UNSUPPORTED_HINT
}

export function appendStreamingFormatHint(message: string): string {
  return message ? `${message}\n${STREAMING_FORMAT_HINT}` : STREAMING_FORMAT_HINT
}

/** 排除明确与流式无关的状态码后追加提示 */
export function maybeAppendStreamingHint(message: string, status: number, streamImages?: boolean): string {
  if (!streamImages) return message
  if (status === 401 || status === 403 || status === 404 || status === 408 || status === 429 || status >= 500) {
    return message
  }
  return appendStreamingUnsupportedHint(message)
}

export const IMAGE_UNSAFE_ERROR_MESSAGE = '生成结果触发安全审核，请调整提示词或参考图后重试。'
export const UPSTREAM_NO_IMAGE_OUTPUT_ERROR_MESSAGE = '上游服务没有返回图片结果，请稍后重试或调整提示词。'
export const INVALID_IMAGE_SIZE_ERROR_MESSAGE = '图片尺寸超出服务商限制，请改小尺寸后重试。'

function payloadIncludes(value: unknown, pattern: RegExp): boolean {
  if (typeof value === 'string') return pattern.test(value)
  try {
    return pattern.test(JSON.stringify(value))
  } catch {
    return false
  }
}

function getInvalidImageSizeErrorMessage(message: string): string | undefined {
  if (!/Invalid size|longest edge.*less than or equal to/i.test(message)) return undefined

  const sizeMatch = message.match(/Invalid size\s*['"]?(\d+)\s*[xX×]\s*(\d+)['"]?/i)
  const maxEdgeMatch = message.match(/longest edge.*?less than or equal to\s*(\d+)/i)
  if (sizeMatch && maxEdgeMatch) {
    return `图片尺寸 ${sizeMatch[1]}x${sizeMatch[2]} 超出服务商限制，最长边需不超过 ${maxEdgeMatch[1]}px，请改小尺寸后重试。`
  }
  if (maxEdgeMatch) {
    return `图片尺寸超出服务商限制，最长边需不超过 ${maxEdgeMatch[1]}px，请改小尺寸后重试。`
  }
  return INVALID_IMAGE_SIZE_ERROR_MESSAGE
}

export function normalizeImageApiErrorMessage(message: string): string {
  if (payloadIncludes(message, /\bimage_unsafe\b|generated images appear to be unsafe/i)) {
    return IMAGE_UNSAFE_ERROR_MESSAGE
  }
  if (payloadIncludes(message, /upstream did not return image output/i)) {
    return UPSTREAM_NO_IMAGE_OUTPUT_ERROR_MESSAGE
  }
  const invalidSizeMessage = getInvalidImageSizeErrorMessage(message)
  if (invalidSizeMessage) return invalidSizeMessage
  return message
}

function getFriendlyImageApiErrorDisplayMessage(message: string): string {
  const normalizedMessage = normalizeImageApiErrorMessage(message)
  if (normalizedMessage !== message) return normalizedMessage

  const cleanMessage = message.replace(/\s*\(request[_ -]?id\s*[:：][^)]+\)/gi, '').trim()
  if (/signal is aborted|aborterror|operation was aborted|this operation was aborted/i.test(cleanMessage)) {
    return '本次生成已被中止。\n提示：请先检查任务记录和账户额度，确认没有生成成功后再重试，避免重复扣费。'
  }
  if (/\b401\b|unauthori[sz]ed|invalid (?:api )?(?:key|token)|incorrect api key|无效的令牌|令牌无效|api key.{0,8}(?:无效|错误|失效)/i.test(cleanMessage)) {
    return 'API Key 无效或已失效。\n提示：请重新填写购买时获得的 API Key；文本和图片共用同一 Key。'
  }
  if (/insufficient[_\s-]?quota|quota (?:exceeded|insufficient)|余额不足|额度不足|insufficient (?:balance|credit)|not enough (?:balance|credit)/i.test(cleanMessage)) {
    return '账户额度不足。\n提示：请先充值或更换有余额的 API Key，然后再重新生成。'
  }
  if (/\b429\b|rate limit|too many requests|请求过于频繁/i.test(cleanMessage)) {
    return '请求过于频繁。\n提示：请等待一会儿再重试，避免连续点击生成。'
  }
  if (/\b403\b|forbidden|permission denied|没有权限|无权限/i.test(cleanMessage)) {
    return '当前 API Key 没有访问该模型或图片功能的权限。\n提示：请更换可用模型；如果仍然失败，请复制完整报错并提交工单。'
  }
  if (/\b405\b|method not allowed|接口未开放|接口尚未开放/i.test(cleanMessage)) {
    return '当前功能的服务器接口尚未开放。\n提示：请稍后再试，或复制完整报错并提交工单。'
  }
  if (/\b404\b|model.{0,30}(?:not found|unsupported|unavailable)|unsupported model|模型不存在|不支持.{0,8}模型/i.test(cleanMessage)) {
    return '当前接口或模型不可用。\n提示：请检查 API 地址和模型选择，或切换到推荐模型后重试。'
  }
  if (/\b413\b|payload too large|request entity too large|content too large|图片过大|文件过大/i.test(cleanMessage)) {
    return '上传的图片过大。\n提示：请压缩图片或降低分辨率后再试。'
  }
  if (/\b451\b|content policy|moderation|safety (?:check|policy)|内容审核|安全审核/i.test(cleanMessage)) {
    return '提示词或参考图触发了安全审核。\n提示：请调整敏感内容、人物描述或参考图后再试。'
  }
  if (/\b408\b|\b504\b|gateway time-?out|request time-?out|timed out|timeout|deadline exceeded|请求超时/i.test(cleanMessage)) {
    return '生成等待时间过长，连接已超时。\n提示：请先检查任务记录和账户额度；确认没有生成成功后再重试，避免重复扣费。'
  }
  if (/\b499\b|client closed request|client disconnected|请求已取消|连接已取消/i.test(cleanMessage)) {
    return '生成请求已被中断。\n提示：请保持页面打开和网络稳定；确认任务未成功后再重试。'
  }
  if (/\b502\b|\b503\b|bad gateway|service unavailable|upstream (?:error|failed|unavailable)|上游服务异常|服务不可用/i.test(cleanMessage)) {
    return '图片服务暂时不稳定。\n提示：请稍后重试；如果多次失败，请复制完整报错并提交工单。'
  }
  if (/ssl|tls|certificate|证书错误|安全连接失败/i.test(cleanMessage)) {
    return '安全连接建立失败。\n提示：请检查本机时间和网络环境，或切换网络后重试。'
  }
  if (/failed to fetch|load failed|networkerror|network error|econnreset|socket hang up|unexpected eof|connection reset|网络连接失败|网络异常/i.test(cleanMessage)) {
    return '网络连接已中断。\n提示：请检查网络后重试；中国大陆用户建议使用大陆 API 地址。'
  }
  if (/\b500\b|internal server error|服务器内部错误/i.test(cleanMessage)) {
    return '图片服务暂时异常。\n提示：请稍后重试；如果多次失败，请复制完整报错并提交工单。'
  }
  if (/\b400\b|\b409\b|\b422\b|invalid request|unsupported parameter|invalid parameter|参数错误|参数不支持/i.test(cleanMessage)) {
    return '当前请求参数不被模型支持。\n提示：请恢复默认参数，或减少参考图后再试。'
  }
  if (/invalid json|unexpected token|无法解析|无法识别.{0,8}(?:响应|数据)/i.test(cleanMessage)) {
    return '服务返回了无法识别的数据。\n提示：请复制完整报错并提交工单，方便客服排查。'
  }
  if (!/[\u3400-\u9fff]/.test(cleanMessage)) {
    return '图片生成失败，服务返回了未识别的错误。\n提示：请复制完整报错并提交工单，方便客服排查。'
  }
  return cleanMessage || '图片生成失败，请稍后重试。'
}

export function normalizeImageApiErrorDisplayText(message: string): string {
  const requestFailurePrefix = '请求失败：'
  const prefix = message.startsWith(requestFailurePrefix) ? requestFailurePrefix : ''
  const body = prefix ? message.slice(requestFailurePrefix.length) : message
  const [mainMessage, ...hints] = body.split('\n提示：')
  const normalizedMainMessage = getFriendlyImageApiErrorDisplayMessage(mainMessage)

  if (hints.length === 0 || normalizedMainMessage.includes('\n提示：')) return `${prefix}${normalizedMainMessage}`
  return `${prefix}${normalizedMainMessage}\n提示：${hints.join('\n提示：')}`
}

async function probeNoCorsReachability(url: string, timeoutMs = 8000): Promise<'opaque' | 'reachable' | 'failed'> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.type === 'opaque' ? 'opaque' : 'reachable'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchImageUrlAsDataUrl(url: string, fallbackMime: string, signal?: AbortSignal): Promise<string> {
  if (isDataUrl(url)) return url

  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal,
    })
  } catch (err) {
    if (err instanceof TypeError) {
      const probe = await probeNoCorsReachability(url)
      if (probe === 'opaque') {
        throw new Error(`图片已生成，但因服务商未允许跨域，图片链接下载失败。${IMAGE_FETCH_CORS_HINT}`)
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error(`图片链接下载失败（网络不可用）。${IMAGE_FETCH_CORS_HINT}`)
      }
      throw new Error(`图片链接下载失败（可能因跨域限制、链接过期或网络异常）。${IMAGE_FETCH_CORS_HINT}`)
    }
    throw err
  }

  if (!response.ok) {
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  }

  const blob = await response.blob()
  return blobToDataUrl(blob, fallbackMime)
}

export async function getApiErrorMessage(response: Response): Promise<string> {
  let errorMsg = `HTTP ${response.status}`
  const textResponse = response.clone()
  try {
    const errJson = await response.json()
    if (errJson.error?.message) errorMsg = errJson.error.message
    else if (typeof errJson.detail === 'string') errorMsg = errJson.detail
    else if (Array.isArray(errJson.detail)) errorMsg = errJson.detail.map((item: unknown) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
    else if (typeof errJson.error === 'string') errorMsg = errJson.error
    else if (errJson.message) errorMsg = errJson.message
    if (payloadIncludes(errJson, /\bimage_unsafe\b|generated images appear to be unsafe/i)) {
      return IMAGE_UNSAFE_ERROR_MESSAGE
    }
  } catch {
    try {
      errorMsg = await textResponse.text()
    } catch {
      /* ignore */
    }
  }
  return normalizeImageApiErrorMessage(errorMsg)
}

export function pickActualParams(source: unknown): Partial<TaskParams> {
  if (!source || typeof source !== 'object') return {}
  const record = source as Record<string, unknown>
  const actualParams: Partial<TaskParams> = {}

  if (typeof record.size === 'string') actualParams.size = record.size
  if (record.quality === 'auto' || record.quality === 'low' || record.quality === 'medium' || record.quality === 'high') {
    actualParams.quality = record.quality
  }
  if (record.output_format === 'png' || record.output_format === 'jpeg' || record.output_format === 'webp') {
    actualParams.output_format = record.output_format
  }
  if (typeof record.output_compression === 'number') actualParams.output_compression = record.output_compression
  if (record.moderation === 'auto' || record.moderation === 'low') actualParams.moderation = record.moderation
  if (typeof record.n === 'number') actualParams.n = record.n

  return actualParams
}

export function mergeActualParams(...sources: Array<Partial<TaskParams> | undefined>): Partial<TaskParams> | undefined {
  const merged = Object.assign({}, ...sources.filter((source) => source && Object.keys(source).length))
  return Object.keys(merged).length ? merged : undefined
}
