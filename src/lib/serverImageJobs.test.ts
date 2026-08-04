import { afterEach, describe, expect, it, vi } from 'vitest'

const origin = 'https://image.example.com'

async function loadModule(enabled = true) {
  vi.resetModules()
  vi.stubEnv('VITE_IMAGE_JOBS_AVAILABLE', String(enabled))
  vi.stubGlobal('window', { location: { origin } })
  return import('./serverImageJobs')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('server image jobs', () => {
  it('submits once and polls until the stored upstream response is ready', async () => {
    const states = [
      { id: 'job-1', status: 'running' },
      { id: 'job-1', status: 'succeeded', hasResult: true, upstreamStatus: 200 },
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') return new Response(null, { status: 202 })
      if (url.endsWith('/result')) return new Response('{"data":[{"b64_json":"image"}]}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      return Response.json(states.shift())
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob } = await loadModule()
    const created: unknown[] = []

    const response = await fetchWithServerImageJob('/api-proxy/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: '{"prompt":"test"}',
    }, {
      pollIntervalMs: 0,
      onJobCreated: (job) => {
        created.push(job)
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [{ b64_json: 'image' }] })
    expect(created).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
  })

  it('checks the idempotent job after a lost submit response instead of creating another id', async () => {
    let putCount = 0
    let stateCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') {
        putCount += 1
        throw new TypeError('Load failed')
      }
      if (url.endsWith('/result')) return new Response('ok', { status: 200 })
      stateCount += 1
      return Response.json(stateCount === 1
        ? { id: 'job-1', status: 'running' }
        : { id: 'job-1', status: 'succeeded', hasResult: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob } = await loadModule()

    const response = await fetchWithServerImageJob('/api-proxy/images/generations', {
      method: 'POST',
      body: '{}',
    }, { pollIntervalMs: 0 })

    expect(await response.text()).toBe('ok')
    expect(putCount).toBe(1)
  })

  it('resumes an existing job without submitting the upstream request again', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      expect(init?.method).not.toBe('PUT')
      if (url.endsWith('/result')) return new Response('done', { status: 200 })
      return Response.json({ id: 'saved-job', status: 'succeeded', hasResult: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob } = await loadModule()

    const response = await fetchWithServerImageJob('/api-proxy/images/generations', {
      method: 'POST',
      body: '{}',
    }, {
      existingJob: { jobId: 'saved-job', token: 'saved-token', requestIndex: 0 },
      pollIntervalMs: 0,
    })

    expect(await response.text()).toBe('done')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('always resumes an existing job even if the runtime flag and request URL changed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      expect(init?.method).not.toBe('POST')
      expect(init?.method).not.toBe('PUT')
      expect(url).toContain('/task-api/v1/jobs/saved-job')
      if (url.endsWith('/result')) return new Response('saved-result', { status: 200 })
      return Response.json({ id: 'saved-job', status: 'succeeded', hasResult: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob } = await loadModule(false)

    const response = await fetchWithServerImageJob('https://changed.example.com/v1/images/generations', {
      method: 'POST',
      body: '{"prompt":"must-not-resubmit"}',
    }, {
      existingJob: { jobId: 'saved-job', token: 'saved-token', requestIndex: 0 },
      pollIntervalMs: 0,
    })

    expect(await response.text()).toBe('saved-result')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps polling the same job while the server is still receiving its request body', async () => {
    const states = [
      { id: 'saved-job', status: 'receiving' },
      { id: 'saved-job', status: 'queued' },
      { id: 'saved-job', status: 'succeeded', hasResult: true },
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).not.toBe('PUT')
      if (String(input).endsWith('/result')) return new Response('received-result', { status: 200 })
      return Response.json(states.shift())
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob } = await loadModule(false)

    const response = await fetchWithServerImageJob('https://changed.example.com/v1/images/generations', {
      method: 'POST',
    }, {
      existingJob: { jobId: 'saved-job', token: 'saved-token', requestIndex: 0 },
      pollIntervalMs: 0,
    })

    expect(await response.text()).toBe('received-result')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('never resubmits a job whose execution state is unknown', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).not.toBe('PUT')
      return Response.json({ id: 'saved-job', status: 'unknown' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob, isServerImageJobTerminalError } = await loadModule()

    const request = fetchWithServerImageJob('/api-proxy/images/generations', { method: 'POST' }, {
      existingJob: { jobId: 'saved-job', token: 'saved-token', requestIndex: 0 },
      pollIntervalMs: 0,
    })

    await expect(request).rejects.toSatisfy((err: unknown) =>
      isServerImageJobTerminalError(err)
      && err instanceof Error
      && err.message.includes('不会自动重试'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps direct and disabled proxy requests on the original fetch path', async () => {
    const fetchMock = vi.fn(async () => new Response('direct', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob } = await loadModule(false)

    const response = await fetchWithServerImageJob('https://api.example.com/v1/images/generations', { method: 'POST' })

    expect(await response.text()).toBe('direct')
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/images/generations', { method: 'POST' })
  })

  it.each([429, 503])('classifies task service HTTP %s as recoverable', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('temporary', { status })))
    const { fetchWithServerImageJob, isServerImageJobRecoverableError } = await loadModule()

    const request = fetchWithServerImageJob('/api-proxy/images/generations', { method: 'POST' }, {
      existingJob: { jobId: 'saved-job', token: 'saved-token', requestIndex: 0 },
      pollIntervalMs: 0,
    })

    await expect(request).rejects.toSatisfy((err: unknown) => isServerImageJobRecoverableError(err))
  })

  it.each([400, 401, 403])('classifies permanent task service HTTP %s as terminal', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('permanent', { status })))
    const { fetchWithServerImageJob, isServerImageJobTerminalError } = await loadModule()

    const request = fetchWithServerImageJob('/api-proxy/images/generations', { method: 'POST' }, {
      existingJob: { jobId: 'saved-job', token: 'saved-token', requestIndex: 0 },
      pollIntervalMs: 0,
    })

    await expect(request).rejects.toSatisfy((err: unknown) => isServerImageJobTerminalError(err))
  })

  it.each([
    [503, 'queue_full'],
    [429, 'key_active_limit_reached'],
    [429, 'ip_active_limit_reached'],
    [507, 'disk_watermark_reached'],
    [413, 'body_too_large'],
  ])('treats an explicit unsubmitted PUT rejection (%s %s) as terminal', async (status, code) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('PUT')
      return Response.json({ error: code }, { status })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob, isServerImageJobTerminalError } = await loadModule()

    const request = fetchWithServerImageJob('/api-proxy/images/generations', {
      method: 'POST',
      body: '{}',
    }, { pollIntervalMs: 0 })

    await expect(request).rejects.toSatisfy((err: unknown) => isServerImageJobTerminalError(err))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps an ambiguous submit HTTP failure recoverable and checks the same job id', async () => {
    const states = [
      { id: 'saved-job', status: 'receiving' },
      { id: 'saved-job', status: 'succeeded', hasResult: true },
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response('temporary gateway error', { status: 503 })
      if (String(input).endsWith('/result')) return new Response('same-job-result', { status: 200 })
      return Response.json(states.shift())
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob } = await loadModule()

    const response = await fetchWithServerImageJob('/api-proxy/images/generations', {
      method: 'POST',
      body: '{}',
    }, { pollIntervalMs: 0 })

    expect(await response.text()).toBe('same-job-result')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
  })

  it('classifies task service network and abort failures as recoverable', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => {
      controller.abort(new DOMException('Aborted', 'AbortError'))
      throw controller.signal.reason
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob, isServerImageJobRecoverableError } = await loadModule()

    const request = fetchWithServerImageJob('/api-proxy/images/generations', { method: 'POST' }, {
      existingJob: { jobId: 'saved-job', token: 'saved-token', requestIndex: 0 },
      signal: controller.signal,
      pollIntervalMs: 0,
    })

    await expect(request).rejects.toSatisfy((err: unknown) => isServerImageJobRecoverableError(err))
  })

  it('marks a stored failed upstream response as terminal for downstream parsing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/result')) {
        return Response.json({ error: { message: 'upstream rejected' } }, { status: 503 })
      }
      return Response.json({ id: 'saved-job', status: 'failed', hasResult: true, upstreamStatus: 503 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchWithServerImageJob, isServerImageJobTerminalResponse } = await loadModule()

    const response = await fetchWithServerImageJob('/api-proxy/images/generations', { method: 'POST' }, {
      existingJob: { jobId: 'saved-job', token: 'saved-token', requestIndex: 0 },
      pollIntervalMs: 0,
    })

    expect(response.status).toBe(503)
    expect(isServerImageJobTerminalResponse(response)).toBe(true)
    expect(await response.json()).toEqual({ error: { message: 'upstream rejected' } })
  })

  it('removes the sleep abort listener after a normal polling interval', async () => {
    const controller = new AbortController()
    const addSpy = vi.spyOn(controller.signal, 'addEventListener')
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')
    const states = [
      { id: 'saved-job', status: 'running' },
      { id: 'saved-job', status: 'succeeded', hasResult: true },
    ]
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/result')) return new Response('done', { status: 200 })
      return Response.json(states.shift())
    }))
    const { fetchWithServerImageJob } = await loadModule()

    await fetchWithServerImageJob('/api-proxy/images/generations', { method: 'POST' }, {
      existingJob: { jobId: 'saved-job', token: 'saved-token', requestIndex: 0 },
      signal: controller.signal,
      pollIntervalMs: 1,
    })

    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
