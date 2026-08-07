import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from './api'
import { isServerImageJobRecoverableError, isServerImageJobResultError, isServerImageJobTerminalError } from './serverImageJobs'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitForCondition(assertion: () => void) {
  let lastError: unknown
  for (let i = 0; i < 20; i += 1) {
    try {
      assertion()
      return
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  throw lastError
}

describe('callImageApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it.each([false, true])(
    'adds the prompt rewrite guard on Responses API when Codex CLI mode is %s',
    async (codexCli) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        output: [{
          type: 'image_generation_call',
          result: 'aW1hZ2U=',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

      await callImageApi({
        settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses', codexCli },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      })

      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.input).toBe('Use the following text as the complete prompt. Do not rewrite it:\nprompt')
      expect(body.tools).toHaveLength(1)
      expect(body.tool_choice).toBe(codexCli ? undefined : 'required')
    },
  )

  it('does not add the prompt rewrite guard on Responses API when prompt rewrite is allowed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        result: 'aW1hZ2U=',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses', codexCli: true, allowPromptRewrite: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.input).toBe('prompt')
  })

  it('does not add the prompt rewrite guard on Codex CLI Images API when prompt rewrite is allowed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true, allowPromptRewrite: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.prompt).toBe('prompt')
  })

  it('records actual params returned on Images API responses in Codex CLI mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
      data: [{
        b64_json: 'aW1hZ2U=',
        revised_prompt: '移除靴子',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    })
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    }])
    expect(result.revisedPrompts).toEqual(['移除靴子'])
  })

  it('extracts nested image urls from compatible Images API responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      size: '1024x1024',
      data: {
        data: {
          data: [{
            imageUrl: 'data:image/png;base64,aW1hZ2U=',
          }],
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        codexCli: false,
        streamImages: false,
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(result.actualParams).toEqual({ size: '1024x1024' })
  })

  it('extracts image data from completed image edit events returned as JSON', async () => {
    const b64 = `iVBORw0KGgo=${'A'.repeat(100)}`
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      type: 'image_edit.completed',
      b64_json: b64,
      output_format: 'png',
      quality: 'auto',
      size: 'auto',
      model: 'gpt-image-2-codex',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        codexCli: false,
        streamImages: false,
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.images).toEqual([`data:image/png;base64,${b64}`])
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'auto',
      size: 'auto',
    })
  })

  it('surfaces upstream messages from successful Images API responses without image data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [],
      message: 'upstream returned empty image output',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        codexCli: false,
        streamImages: false,
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toThrow('上游返回了成功状态，但没有返回图片数据：upstream returned empty image output')
  })

  it('does not synthesize actual quality in Codex CLI mode when the API omits it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      size: '1033x1522',
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.actualParams).toEqual({
      output_format: 'png',
      size: '1033x1522',
    })
    expect(result.actualParams?.quality).toBeUndefined()
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      size: '1033x1522',
    }])
  })

  it('streams Images API partial images and resolves the final completed image', async () => {
    const streamBody = [
      'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"cGFydGlhbA=="}',
      '',
      'data: {"type":"image_generation.completed","b64_json":"ZmluYWw=","size":"1024x1024","quality":"high","output_format":"png"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const partialImages: string[] = []

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        streamPartialImages: 3,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
          streamPartialImages: 3,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string }) => partialImages.push(partial.image),
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      stream: true,
      partial_images: 3,
    })
    expect(partialImages).toEqual(['data:image/png;base64,cGFydGlhbA=='])
    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: {
        output_format: 'png',
        quality: 'high',
        size: '1024x1024',
      },
      actualParamsList: [{
        output_format: 'png',
        quality: 'high',
        size: '1024x1024',
      }],
    })
  })

  it('resets the Images API timeout when the stream receives progress', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    let requestSignal: AbortSignal | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      requestSignal = init?.signal as AbortSignal
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          const partialTimer = setTimeout(() => {
            controller.enqueue(encoder.encode('data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"cGFydGlhbA=="}\n\n'))
          }, 750)
          const completedTimer = setTimeout(() => {
            controller.enqueue(encoder.encode('data: {"type":"image_generation.completed","b64_json":"ZmluYWw="}\n\ndata: [DONE]\n\n'))
            controller.close()
          }, 1500)
          requestSignal?.addEventListener('abort', () => {
            clearTimeout(partialTimer)
            clearTimeout(completedTimer)
            controller.error(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })

    const promise = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        timeout: 1,
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          timeout: 1,
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    await vi.advanceTimersByTimeAsync(750)
    await vi.advanceTimersByTimeAsync(750)

    await expect(promise).resolves.toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
    })
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(false)
  })

  it('suggests disabling streaming when a streaming request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid character \':\' looking for beginning of value', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    }))

    await expect(callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)).rejects.toThrow('invalid character \':\' looking for beginning of value\n提示：当前使用的 API 可能不支持流式传输，请尝试关闭「流式传输」功能。')
  })

  it('preserves malformed stream event text when suggesting disabling streaming', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('data: invalid character \':\' looking for beginning of value\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    await expect(callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)).rejects.toThrow('invalid character \':\' looking for beginning of value\n提示：API 返回了无法解析的流式数据格式，请尝试关闭「流式传输」功能。')
  })

  it('reports malformed event-stream responses without data events', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid character \':\' looking for beginning of value\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    await expect(callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)).rejects.toThrow('未从流式响应中解析到有效的 data 事件\n提示：API 返回了无法解析的流式数据格式，请尝试关闭「流式传输」功能。')
  })

  it('does not expect revised prompts on official Images API stream completed events', async () => {
    const streamBody = [
      'data: {"created_at":1779112721,"type":"image_generation.completed","b64_json":"ZmluYWw=","background":"opaque","output_format":"jpeg","quality":"medium","sequence_number":0,"size":"1448x1086","usage":{"total_tokens":1569}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: {
        output_format: 'jpeg',
        quality: 'medium',
        size: '1448x1086',
      },
      revisedPrompts: [undefined],
    })
  })

  it('parses Images API stream result events with data b64_json', async () => {
    const streamBody = [
      'data: {"object":"image.generation.chunk","created":1779551054,"model":"gpt-image-2"}',
      '',
      'data: {"object":"image.generation.result","created":1779551140,"model":"gpt-image-2","data":[{"b64_json":"ZmluYWw=","revised_prompt":"rewritten"}],"size":"1024x1536","quality":"medium","output_format":"png"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: {
        output_format: 'png',
        quality: 'medium',
        size: '1024x1536',
      },
      actualParamsList: [{
        output_format: 'png',
        quality: 'medium',
        size: '1024x1536',
      }],
      revisedPrompts: ['rewritten'],
    })
  })

  it('splits Images API streaming into concurrent single-image requests when n is greater than 1', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const streamBody = [
        'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"cGFydGlhbA=="}',
        '',
        'data: {"type":"image_generation.completed","b64_json":"ZmluYWw=","size":"1024x1024","quality":"high","output_format":"png"}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
      return new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })
    const partials: Array<{ image: string; requestIndex?: number }> = []

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        streamPartialImages: 1,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
          streamPartialImages: 1,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 2 },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string; requestIndex?: number }) => partials.push(partial),
    } as any)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.n).toBeUndefined()
      expect(body.stream).toBe(true)
      expect(body.partial_images).toBe(1)
    }
    expect(result.images).toHaveLength(2)
    expect(result.images).toEqual([
      'data:image/png;base64,ZmluYWw=',
      'data:image/png;base64,ZmluYWw=',
    ])
    expect(partials.map((partial) => partial.requestIndex).sort()).toEqual([0, 1])
    expect(partials.map((partial) => partial.image)).toEqual([
      'data:image/png;base64,cGFydGlhbA==',
      'data:image/png;base64,cGFydGlhbA==',
    ])
  })

  it('keeps successful Images API concurrent results when one request fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const callIndex = fetchMock.mock.calls.length
      if (callIndex === 2) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({
        data: [{ b64_json: `aW1hZ2Ut${callIndex}` }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.images).toEqual([
      'data:image/png;base64,aW1hZ2Ut1',
      'data:image/png;base64,aW1hZ2Ut3',
    ])
    expect(result.failedRequests).toEqual([{ requestIndex: 1, error: 'Failed to fetch' }])
    expect(result.actualParams).toMatchObject({ n: 2 })
  })

  it('streams Responses API partial images and resolves the completed response image', async () => {
    const streamBody = [
      'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"cGFydGlhbA=="}',
      '',
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"ZmluYWw=","revised_prompt":"rewritten","size":"1024x1024"}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const partialImages: string[] = []

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        streamImages: true,
        streamPartialImages: 1,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          apiMode: 'responses',
          streamImages: true,
          streamPartialImages: 1,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string }) => partialImages.push(partial.image),
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBe(true)
    expect(body.tools[0].partial_images).toBe(1)
    expect(partialImages).toEqual(['data:image/png;base64,cGFydGlhbA=='])
    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
      revisedPrompts: ['rewritten'],
    })
  })

  it('keeps successful Responses API concurrent results when one request fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const callIndex = fetchMock.mock.calls.length
      if (callIndex === 3) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({
        output: [{ type: 'image_generation_call', result: `aW1hZ2Ut${callIndex}` }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.images).toEqual([
      'data:image/png;base64,aW1hZ2Ut1',
      'data:image/png;base64,aW1hZ2Ut2',
    ])
    expect(result.failedRequests).toEqual([{ requestIndex: 2, error: 'Failed to fetch' }])
    expect(result.actualParams).toMatchObject({ n: 2 })
  })

  it('keeps a concurrent server job task recoverable when only one stored result download fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/job-b')) throw new TypeError('Load failed')
      if (url.endsWith('/result')) {
        return Response.json({ output: [{ type: 'image_generation_call', result: 'aW1hZ2UtYQ==' }] })
      }
      return Response.json({ id: 'job-a', status: 'succeeded', hasResult: true })
    })

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: '', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 2 },
      inputImageDataUrls: [],
      serverImageJobs: [
        { jobId: 'job-a', token: 'token-a', requestIndex: 0 },
        { jobId: 'job-b', token: 'token-b', requestIndex: 1 },
      ],
    })

    await expect(request).rejects.toSatisfy((err: unknown) => isServerImageJobRecoverableError(err))
  })

  it('downloads stored image URL results through the authenticated task service', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/result-images/0')) {
        return new Response(new Uint8Array([105, 109, 97, 103, 101]), { headers: { 'Content-Type': 'image/png' } })
      }
      if (url.endsWith('/result')) {
        return url.includes('job-b')
          ? Response.json({ data: [{ url: 'https://cdn.example.com/missing.png' }] })
          : Response.json({ data: [{ b64_json: 'aW1hZ2UtYQ==' }] })
      }
      return Response.json({ id: url.includes('job-b') ? 'job-b' : 'job-a', status: 'succeeded', hasResult: true })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: '', apiMode: 'images' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 2 },
      inputImageDataUrls: [],
      serverImageJobs: [
        { jobId: 'job-a', token: 'token-a', requestIndex: 0 },
        { jobId: 'job-b', token: 'token-b', requestIndex: 1 },
      ],
    })

    expect(result.images).toEqual([
      'data:image/png;base64,aW1hZ2UtYQ==',
      'data:image/png;base64,aW1hZ2U=',
    ])
    const imageCall = vi.mocked(globalThis.fetch).mock.calls.find(([input]) => String(input).endsWith('/result-images/0'))
    expect(imageCall?.[1]?.headers).toEqual({ 'X-Task-Token': 'token-b' })
  })

  it('downloads a stored top-level URL result through the task service without calling the CDN', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      expect(url).not.toBe('https://download1.bnq777.xyz/signed-4k.png')
      if (url.endsWith('/result-images/0')) {
        return new Response(new Uint8Array([52, 107]), { headers: { 'Content-Type': 'image/png' } })
      }
      if (url.endsWith('/result')) {
        return Response.json({ type: 'image_generation.completed', url: 'https://download1.bnq777.xyz/signed-4k.png' })
      }
      return Response.json({ id: 'top-url-job', status: 'succeeded', hasResult: true })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: '', apiMode: 'images' },
      prompt: '4k edit',
      params: { ...DEFAULT_PARAMS, size: '4096x4096' },
      inputImageDataUrls: [],
      serverImageJobs: [{ jobId: 'top-url-job', token: 'top-url-token', requestIndex: 0 }],
    })

    expect(result.images).toEqual(['data:image/png;base64,NGs='])
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/result-images/0'))).toHaveLength(1)
  })

  it('accepts a stored top-level Base64 result without an image download request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/result')) return Response.json({ b64_json: 'dG9wLWJhc2U2NA==' })
      return Response.json({ id: 'top-b64-job', status: 'succeeded', hasResult: true })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: '', apiMode: 'images' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      serverImageJobs: [{ jobId: 'top-b64-job', token: 'top-b64-token', requestIndex: 0 }],
    })

    expect(result.images).toEqual(['data:image/png;base64,dG9wLWJhc2U2NA=='])
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/result-images/'))).toBe(false)
  })

  it('stops automatic recovery when a completed Responses stream has no image result', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/result')) {
        return new Response('data: {"type":"response.completed","response":{"output":[]}}\n\ndata: [DONE]\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      return Response.json({ id: 'stream-job', status: 'succeeded', hasResult: true })
    })

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: '', apiMode: 'responses', streamImages: false },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      serverImageJobs: [{ jobId: 'stream-job', token: 'stream-token', requestIndex: 0 }],
    })

    await expect(request).rejects.toSatisfy((err: unknown) =>
      isServerImageJobResultError(err) && !err.retryable && err.message === '结果格式无法识别。',
    )
  })

  it('treats an empty saved-job list as a new Responses request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      output: [{ type: 'image_generation_call', result: 'aW1hZ2U=' }],
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      serverImageJobs: [],
    })

    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resumes only sparse persisted request indexes and never fills their gaps', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(init?.method).not.toBe('PUT')
      const url = String(input)
      const jobId = url.includes('job-2') ? 'job-2' : 'job-0'
      if (url.endsWith('/result')) {
        return Response.json({ output: [{ type: 'image_generation_call', result: jobId === 'job-2' ? 'aW1hZ2UtMg==' : 'aW1hZ2UtMA==' }] })
      }
      return Response.json({ id: jobId, status: 'succeeded', hasResult: true })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: '', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 4 },
      inputImageDataUrls: [],
      serverImageJobs: [
        { jobId: 'job-0', token: 'token-0', requestIndex: 0 },
        { jobId: 'job-2', token: 'token-2', requestIndex: 2 },
      ],
    })

    expect(result.images).toEqual([
      'data:image/png;base64,aW1hZ2UtMA==',
      'data:image/png;base64,aW1hZ2UtMg==',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes('job-1') && !String(input).includes('job-3'))).toBe(true)
  })

  it('lets one persisted Images API job return all requested images without creating sibling jobs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(init?.method).not.toBe('PUT')
      if (String(input).endsWith('/result')) {
        return Response.json({
          data: [
            { b64_json: 'aW1hZ2UtMQ==' },
            { b64_json: 'aW1hZ2UtMg==' },
            { b64_json: 'aW1hZ2UtMw==' },
            { b64_json: 'aW1hZ2UtNA==' },
          ],
        })
      }
      return Response.json({ id: 'single-job', status: 'succeeded', hasResult: true })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: '', apiMode: 'images', codexCli: true, streamImages: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 4 },
      inputImageDataUrls: [],
      serverImageJobs: [{ jobId: 'single-job', token: 'single-token', requestIndex: 0 }],
    })

    expect(result.images).toHaveLength(4)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('resumes an existing Images API job without rebuilding deleted input images or using an API key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(init?.method).not.toBe('POST')
      expect(init?.method).not.toBe('PUT')
      if (String(input).endsWith('/result')) {
        return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] })
      }
      return Response.json({ id: 'saved-job', status: 'succeeded', hasResult: true })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: '', apiMode: 'images' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['not-a-data-url'],
      maskDataUrl: 'also-not-a-data-url',
      serverImageJobs: [{ jobId: 'saved-job', token: 'saved-token', requestIndex: 0 }],
    })

    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('preserves the terminal marker on a stored upstream timeout response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/result')) {
        return Response.json({ error: { message: 'upstream timeout' } }, { status: 504 })
      }
      return Response.json({ id: 'saved-job', status: 'failed', hasResult: true, upstreamStatus: 504 })
    })

    const request = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: '', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      serverImageJobs: [{ jobId: 'saved-job', token: 'saved-token', requestIndex: 0 }],
    })

    await expect(request).rejects.toSatisfy((err: unknown) =>
      isServerImageJobTerminalError(err) && err instanceof Error && err.message.includes('upstream timeout'),
    )
  })

  it('parses Responses API image result objects in gallery mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        result: { b64_json: 'ZmluYWw=' },
        size: '1024x1024',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
    })
  })

  it('falls back to Images API payload parsing for compatible Responses API gateways', async () => {
    const b64 = `iVBORw0KGgo=${'A'.repeat(100)}`
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      type: 'image_edit.completed',
      b64_json: b64,
      output_format: 'png',
      quality: 'auto',
      size: 'auto',
      model: 'gpt-image-2-codex',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.images).toEqual([`data:image/png;base64,${b64}`])
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'auto',
      size: 'auto',
    })
  })

  it('limits concurrent Responses API multi-image requests', async () => {
    const pending: Array<ReturnType<typeof createDeferred<Response>>> = []
    let active = 0
    let maxActive = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const deferred = createDeferred<Response>()
      pending.push(deferred)
      try {
        return await deferred.promise
      } finally {
        active -= 1
      }
    })

    const resultPromise = callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 4 },
      inputImageDataUrls: [],
    })

    await waitForCondition(() => expect(pending).toHaveLength(2))
    expect(maxActive).toBe(2)

    pending[0].resolve(new Response(JSON.stringify({
      output: [{ type: 'image_generation_call', result: 'aW1hZ2UtMQ==', size: '1024x1024' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await waitForCondition(() => expect(pending).toHaveLength(3))
    expect(maxActive).toBe(2)

    pending[1].resolve(new Response(JSON.stringify({
      output: [{ type: 'image_generation_call', result: 'aW1hZ2UtMg==', size: '1024x1024' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await waitForCondition(() => expect(pending).toHaveLength(4))
    expect(maxActive).toBe(2)

    pending[2].resolve(new Response(JSON.stringify({
      output: [{ type: 'image_generation_call', result: 'aW1hZ2UtMw==', size: '1024x1024' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    pending[3].resolve(new Response(JSON.stringify({
      output: [{ type: 'image_generation_call', result: 'aW1hZ2UtNA==', size: '1024x1024' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await resultPromise
    expect(result.images).toHaveLength(4)
    expect(maxActive).toBe(2)
  })

  it('keeps Responses API stream output item images when completed response omits result', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.done","item":{"id":"img-call-1","type":"image_generation_call","status":"generating","action":"generate","result":"ZmluYWw=","size":"1024x1024"},"output_index":0}',
      '',
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","status":"completed","result":""}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          apiMode: 'responses',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
    })
  })

  it('falls back to Images API stream events for compatible Responses API gateways', async () => {
    const b64 = `iVBORw0KGgo=${'A'.repeat(100)}`
    const streamBody = [
      `data: ${JSON.stringify({
        type: 'image_edit.completed',
        b64_json: b64,
        output_format: 'png',
        quality: 'auto',
        size: 'auto',
      })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          apiMode: 'responses',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result.images).toEqual([`data:image/png;base64,${b64}`])
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'auto',
      size: 'auto',
    })
  })

  it('uses the same-origin API proxy path when API proxy is enabled', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses the same-origin API proxy path when API proxy is enabled and base URL is empty', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: '',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does not auto-retry billable Images API failures', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: { message: "invalid character 'e' looking for beginning of value" },
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toThrow("invalid character 'e'")

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends edit uploads with repeated image multipart fields', async () => {
    const realFetch = globalThis.fetch
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      if (url.startsWith('data:')) return realFetch(input, init)

      return new Response(JSON.stringify({
        data: [{ b64_json: 'ZWRpdA==' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        codexCli: false,
        streamImages: false,
      },
      prompt: 'edit prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['data:image/png;base64,aW1hZ2U='],
    })

    const apiCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/images/edits'))
    expect(apiCall).toBeDefined()
    const body = (apiCall?.[1] as RequestInit).body as FormData
    expect(body.getAll('image')).toHaveLength(1)
    expect(body.getAll('image[]')).toHaveLength(0)
  })

  it('uses the same-origin API proxy path for sync custom providers', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: '',
        apiKey: 'test-key',
        apiProxy: true,
        customProviders: [{
          id: 'custom-sync',
          name: 'Custom Sync',
          template: 'http-image',
          submit: {
            path: 'custom/images',
            method: 'POST',
            contentType: 'json',
            body: { model: '$profile.model', prompt: '$prompt' },
            result: { b64JsonPaths: ['data.*.b64_json'] },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom-sync',
          provider: 'custom-sync',
          baseUrl: '',
          apiKey: 'test-key',
          model: 'model',
          apiProxy: true,
        }],
        activeProfileId: 'profile-custom-sync',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/custom/images',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('rejects API proxy for async custom providers', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: '',
        apiKey: 'test-key',
        apiProxy: true,
        customProviders: [{
          id: 'custom-async-proxy',
          name: 'Custom Async Proxy',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 1,
            statusPath: 'status',
            successValues: ['done'],
            failureValues: ['failed'],
            result: { b64JsonPaths: ['data.*.b64_json'] },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom-async-proxy',
          provider: 'custom-async-proxy',
          baseUrl: '',
          apiKey: 'test-key',
          model: 'model',
          apiProxy: true,
        }],
        activeProfileId: 'profile-custom-async-proxy',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toThrow('异步任务的自定义服务商')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the same-origin API proxy path when API proxy is locked', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: false,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does not add cache request headers that require extra CORS allow-list entries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: false },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers).not.toHaveProperty('Pragma')
    expect(headers).not.toHaveProperty('Cache-Control')
    expect((init as RequestInit).cache).toBe('no-store')
  })

  it('ignores stored API proxy settings when the current deployment has no proxy', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.example.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('polls custom async tasks immediately and keeps polling after transient network errors', async () => {
    vi.useFakeTimers()
    const onCustomTaskEnqueued = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          status: 'SUCCESS',
          data: {
            data: [{ b64_json: 'aW1hZ2U=' }],
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const promise = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'https://api.example.com/v1',
        customProviders: [{
          id: 'custom-async',
          name: 'Custom Async',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            query: { async: 'true' },
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 1,
            statusPath: 'data.status',
            successValues: ['SUCCESS'],
            failureValues: ['FAILURE'],
            errorPath: 'data.fail_reason',
            result: {
              imageUrlPaths: ['data.data.data.*.url'],
              b64JsonPaths: ['data.data.data.*.b64_json'],
            },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom',
          provider: 'custom-async',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'model',
          timeout: 60,
        }],
        activeProfileId: 'profile-custom',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onCustomTaskEnqueued,
    })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(onCustomTaskEnqueued).toHaveBeenCalledWith({ taskId: 'task-1' })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.com/v1/images/tasks/task-1')
    await vi.advanceTimersByTimeAsync(1000)

    await expect(promise).resolves.toEqual({
      images: ['data:image/png;base64,aW1hZ2U='],
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not apply submit timeout to custom async polling after receiving a task id', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'IN_PROGRESS' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          status: 'SUCCESS',
          data: {
            data: [{ b64_json: 'aW1hZ2U=' }],
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const promise = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'https://api.example.com/v1',
        customProviders: [{
          id: 'custom-async',
          name: 'Custom Async',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            query: { async: 'true' },
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 5,
            statusPath: 'data.status',
            successValues: ['SUCCESS'],
            failureValues: ['FAILURE'],
            result: {
              b64JsonPaths: ['data.data.data.*.b64_json'],
            },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom',
          provider: 'custom-async',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'model',
          timeout: 1,
        }],
        activeProfileId: 'profile-custom',
        timeout: 1,
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    await vi.advanceTimersByTimeAsync(6000)

    await expect(promise).resolves.toEqual({
      images: ['data:image/png;base64,aW1hZ2U='],
    })
  })
})
