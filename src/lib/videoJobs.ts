export type VideoJobStatus = 'running' | 'done' | 'error'

export interface VideoJobRequest {
  prompt: string
  imageUrl?: string
  ratio: string
  duration: number
  resolution: string
  model: string
}

export interface VideoJobResult {
  id?: string
  status: VideoJobStatus
  videoUrl?: string
  error?: string
  raw?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

export function normalizeVideoJobResult(payload: unknown): VideoJobResult {
  if (!isRecord(payload)) return { status: 'error', error: '后端返回格式错误', raw: payload }

  const rawStatus = getString(payload, ['status', 'state'])?.toLowerCase()
  const status = rawStatus === 'done' || rawStatus === 'succeeded' || rawStatus === 'success' || rawStatus === 'completed'
    ? 'done'
    : rawStatus === 'error' || rawStatus === 'failed' || rawStatus === 'failure'
      ? 'error'
      : 'running'

  return {
    id: getString(payload, ['id', 'jobId', 'taskId']),
    status,
    videoUrl: getString(payload, ['videoUrl', 'video_url', 'url', 'downloadUrl', 'download_url']),
    error: getString(payload, ['error', 'message', 'failReason', 'fail_reason']),
    raw: payload,
  }
}

async function getApiErrorMessage(response: Response) {
  try {
    const payload = await response.json()
    if (isRecord(payload)) {
      const message = getString(payload, ['error', 'message'])
      if (message) return message
    }
  } catch {
    // 非 JSON 错误体直接走状态码。
  }
  return `HTTP ${response.status}`
}

export async function createVideoJob(endpoint: string, request: VideoJobRequest): Promise<VideoJobResult> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw new Error(await getApiErrorMessage(response))
  return normalizeVideoJobResult(await response.json())
}

export async function getVideoJob(endpoint: string, id: string): Promise<VideoJobResult> {
  const response = await fetch(`${endpoint.replace(/\/+$/, '')}/${encodeURIComponent(id)}`)
  if (!response.ok) throw new Error(await getApiErrorMessage(response))
  return normalizeVideoJobResult(await response.json())
}
