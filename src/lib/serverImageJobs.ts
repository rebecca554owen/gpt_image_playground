import type { ServerImageJobRef } from '../types'
import { readRuntimeEnv } from './runtimeEnv'

const SERVER_IMAGE_JOB_API = '/task-api/v1/jobs'
const API_PROXY_PREFIX = '/api-proxy/'
const SERVER_IMAGE_JOBS_AVAILABLE = readRuntimeEnv(import.meta.env.VITE_IMAGE_JOBS_AVAILABLE) === 'true'
const DEFAULT_POLL_INTERVAL_MS = 2_000
const SERVER_IMAGE_JOB_RESULT_HEADER = 'X-Server-Image-Job-Result'
const SAFE_UNSUBMITTED_ERROR_CODES = new Set([
  'authorization_required',
  'body_too_large',
  'disk_watermark_reached',
  'invalid_forward_header',
  'ip_active_limit_reached',
  'job_id_conflict',
  'key_active_limit_reached',
  'queue_full',
  'task_token_required',
  'unsupported_query_parameter',
  'unsupported_upstream_path',
])

const SERVER_JOB_ERROR_MESSAGES: Record<string, string> = {
  body_too_large: '请求内容过大，任务尚未提交到上游。请减少参考图数量或图片大小后重试。',
  disk_watermark_reached: '任务服务存储空间不足，任务尚未提交到上游，请稍后重试。',
  invalid_task_token: '服务端任务的本地查询凭证无效。为避免重复扣费，本站不会自动重新提交。',
  ip_active_limit_reached: '当前设备正在生成的任务较多，请等待已有任务完成后再试。',
  job_waiter_limit_reached: '同一任务的查询连接过多，请稍后继续查看任务结果。',
  key_active_limit_reached: '当前 API Key 正在生成的任务较多，请等待已有任务完成后再试。',
  outcome_unknown_after_restart: '任务服务重启后无法确认上游最终结果，任务可能已经产生扣费。本站不会自动重试，请先检查账户记录。',
  outcome_unknown_response_too_large: '上游已经响应，但结果过大而无法安全保存，任务可能已经产生扣费。本站不会自动重试。',
  outcome_unknown_result_storage_full: '上游可能已经完成并产生扣费，但任务服务没有足够空间保存结果。本站不会自动重试。',
  outcome_unknown_upstream_network: '任务发出后与上游的连接中断，无法确认最终结果，且可能已经产生扣费。本站不会自动重试，请先检查账户记录。',
  outcome_unknown_upstream_timeout: '任务发出后等待上游超过服务端最长时间，无法确认最终结果，且可能已经产生扣费。本站不会自动重试，请先检查账户记录。',
  queue_full: '当前生成队列已满，任务尚未提交到上游，请稍后重试。',
  request_storage_error: '任务请求未能安全保存，尚未提交到上游，请重试。',
}

type ServerImageJobStatus = 'receiving' | 'queued' | 'dispatch_reserved' | 'running' | 'succeeded' | 'failed' | 'unknown'

interface ServerImageJobState {
  id: string
  status: ServerImageJobStatus
  hasResult?: boolean
  upstreamStatus?: number | null
  error?: string | null
}

export class ServerImageJobRecoverableError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ServerImageJobRecoverableError'
    this.cause = cause
  }
}

export class ServerImageJobTerminalError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ServerImageJobTerminalError'
    this.cause = cause
  }
}

export interface ServerImageJobRequestRef {
  jobId: string
  token: string
  requestIndex: number
}

interface FetchWithServerImageJobOptions {
  existingJob?: ServerImageJobRequestRef
  requestIndex?: number
  signal?: AbortSignal
  pollIntervalMs?: number
  onJobCreated?: (job: ServerImageJobRequestRef) => void | Promise<void>
  onActivity?: () => void
}

function createRandomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function createRequestRef(requestIndex: number): ServerImageJobRequestRef {
  return {
    jobId: crypto.randomUUID(),
    token: createRandomToken(),
    requestIndex,
  }
}

function getUpstreamPath(url: string) {
  if (typeof window === 'undefined') return null
  const parsed = new URL(url, window.location.origin)
  if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith(API_PROXY_PREFIX)) return null
  const path = parsed.pathname.slice(API_PROXY_PREFIX.length)
  return `${path}${parsed.search}`
}

function getJobUrl(jobId: string, suffix = '') {
  return `${SERVER_IMAGE_JOB_API}/${encodeURIComponent(jobId)}${suffix}`
}

function getJobHeaders(token: string) {
  return { 'X-Task-Token': token }
}

async function readServerJobError(response: Response, fallback: string) {
  const text = await response.text().catch(() => '')
  try {
    const code = (JSON.parse(text) as { error?: unknown }).error
    if (typeof code === 'string') {
      return { code, message: SERVER_JOB_ERROR_MESSAGES[code] || fallback }
    }
  } catch {}
  return { code: null, message: text || fallback }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ServerImageJobRecoverableError('服务端任务查询已中断，可稍后继续查看原任务。', signal.reason))
      return
    }

    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new ServerImageJobRecoverableError('服务端任务查询已中断，可稍后继续查看原任务。', signal?.reason))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function isRecoverableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

async function createJobHttpError(response: Response, fallback: string, submitting = false) {
  const error = await readServerJobError(response, fallback)
  if (submitting && error.code && SAFE_UNSUBMITTED_ERROR_CODES.has(error.code)) {
    return new ServerImageJobTerminalError(error.message)
  }
  if (isRecoverableStatus(response.status)) return new ServerImageJobRecoverableError(error.message)
  return new ServerImageJobTerminalError(error.message)
}

function createJobNetworkError(err: unknown, fallback: string) {
  if (isServerImageJobRecoverableError(err) || isServerImageJobTerminalError(err)) return err
  return new ServerImageJobRecoverableError(fallback, err)
}

async function readJobState(ref: ServerImageJobRequestRef, signal?: AbortSignal) {
  const response = await fetch(getJobUrl(ref.jobId), {
    headers: getJobHeaders(ref.token),
    cache: 'no-store',
    signal,
  }).catch((err) => {
    throw createJobNetworkError(err, '无法连接任务服务，可稍后继续查看原任务。')
  })
  if (response.status === 404) return null
  if (!response.ok) throw await createJobHttpError(response, `任务状态查询失败：HTTP ${response.status}`)
  try {
    return await response.json() as ServerImageJobState
  } catch (err) {
    throw new ServerImageJobRecoverableError('任务服务返回了无法识别的状态，可稍后继续查看原任务。', err)
  }
}

async function submitJob(
  upstreamPath: string,
  ref: ServerImageJobRequestRef,
  init: RequestInit,
  signal?: AbortSignal,
) {
  const headers = new Headers(init.headers)
  headers.set('X-Task-Token', ref.token)
  const response = await fetch(`${getJobUrl(ref.jobId)}?path=${encodeURIComponent(upstreamPath)}`, {
    method: 'PUT',
    headers,
    body: init.body,
    cache: 'no-store',
    signal,
  }).catch((err) => {
    throw createJobNetworkError(err, '任务提交连接中断，可稍后继续查看原任务。')
  })
  if (!response.ok) {
    throw await createJobHttpError(response, `任务提交失败：HTTP ${response.status}`, true)
  }
}

async function getJobResult(ref: ServerImageJobRequestRef, storedFailure: boolean, signal?: AbortSignal) {
  const response = await fetch(getJobUrl(ref.jobId, '/result'), {
    headers: getJobHeaders(ref.token),
    cache: 'no-store',
    signal,
  }).catch((err) => {
    throw createJobNetworkError(err, '任务结果下载中断，可稍后继续查看原任务。')
  })
  if (response.status === 409 || response.status === 425) return null
  if (storedFailure) {
    const headers = new Headers(response.headers)
    headers.set(SERVER_IMAGE_JOB_RESULT_HEADER, 'terminal')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
  if (!response.ok) throw await createJobHttpError(response, `任务结果读取失败：HTTP ${response.status}`)
  return response
}

export function isServerImageJobsAvailable() {
  return SERVER_IMAGE_JOBS_AVAILABLE
}

export function shouldUseServerImageJobs(url: string) {
  return SERVER_IMAGE_JOBS_AVAILABLE && Boolean(getUpstreamPath(url))
}

export function isServerImageJobTerminalError(err: unknown) {
  return err instanceof Error && err.name === 'ServerImageJobTerminalError'
}

export function isServerImageJobRecoverableError(err: unknown) {
  return err instanceof Error && err.name === 'ServerImageJobRecoverableError'
}

export function isServerImageJobTerminalResponse(response: Response) {
  return response.headers.get(SERVER_IMAGE_JOB_RESULT_HEADER) === 'terminal'
}

export async function fetchWithServerImageJob(
  url: string,
  init: RequestInit,
  options: FetchWithServerImageJobOptions = {},
): Promise<Response> {
  const signal = options.signal ?? init.signal ?? undefined
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const existingRef = options.existingJob
  const upstreamPath = existingRef ? null : getUpstreamPath(url)
  if (!existingRef && (!SERVER_IMAGE_JOBS_AVAILABLE || !upstreamPath)) return fetch(url, init)

  const ref = existingRef ?? createRequestRef(options.requestIndex ?? 0)

  if (!existingRef) {
    await options.onJobCreated?.(ref)
    try {
      await submitJob(upstreamPath!, ref, init, signal)
    } catch (err) {
      if (isServerImageJobTerminalError(err)) throw err
      if (signal?.aborted) throw createJobNetworkError(err, '任务提交已中断，可稍后继续查看原任务。')
      const existing = await readJobState(ref, signal)
      if (!existing) throw createJobNetworkError(err, '任务提交结果无法确认，可稍后继续查看原任务。')
    }
  }

  while (true) {
    const state = await readJobState(ref, signal)
    options.onActivity?.()

    if (!state) {
      throw new ServerImageJobTerminalError('服务端任务记录不存在。为避免重复扣费，本站不会自动重新提交，请先检查账户记录。')
    }
    if (state.status === 'unknown') {
      throw new ServerImageJobTerminalError(
        (state.error && SERVER_JOB_ERROR_MESSAGES[state.error])
          || '服务器无法确认任务的最终状态，任务可能已经提交并产生扣费。本站不会自动重试，请先检查账户记录。',
      )
    }
    if (state.status === 'succeeded' || (state.status === 'failed' && state.hasResult)) {
      const result = await getJobResult(ref, state.status === 'failed', signal)
      if (result) return result
    } else if (state.status === 'failed') {
      throw new ServerImageJobTerminalError(
        (state.error && SERVER_JOB_ERROR_MESSAGES[state.error]) || '服务端图片任务失败',
      )
    }

    await sleep(pollIntervalMs, signal)
  }
}

export async function deleteServerImageJob(ref: Pick<ServerImageJobRef, 'jobId' | 'token'>) {
  const response = await fetch(getJobUrl(ref.jobId), {
    method: 'DELETE',
    headers: getJobHeaders(ref.token),
    cache: 'no-store',
  })
  if (!response.ok && response.status !== 404) throw new Error(`任务清理失败：HTTP ${response.status}`)
}
