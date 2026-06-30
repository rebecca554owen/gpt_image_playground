import { describe, expect, it } from 'vitest'
import { normalizeVideoJobResult } from './videoJobs'

describe('videoJobs', () => {
  it('normalizes common backend status fields', () => {
    expect(normalizeVideoJobResult({ jobId: 'job-1', status: 'succeeded', video_url: 'https://example.com/a.mp4' })).toMatchObject({
      id: 'job-1',
      status: 'done',
      videoUrl: 'https://example.com/a.mp4',
    })

    expect(normalizeVideoJobResult({ taskId: 'job-2', state: 'failed', fail_reason: 'quota' })).toMatchObject({
      id: 'job-2',
      status: 'error',
      error: 'quota',
    })
  })
})
