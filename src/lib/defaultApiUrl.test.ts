import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDefaultApiUrl } from './defaultApiUrl'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('Responses tool model configuration', () => {
  it.each(['gpt-image-2.5-sunburst', ''])('preserves an explicit imageGenerationModel=%s', (model) => {
    const params = new URLSearchParams({ apiMode: 'responses', model: 'text-model', imageGenerationModel: model })
    expect(parseDefaultApiUrl(`https://example.com/v1?${params}`)).toMatchObject({
      apiMode: 'responses', model: 'text-model', imageGenerationModel: model,
    })
  })

  it('applies deployment tool model defaults only to new configurations', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_DEFAULT_API_URL', 'https://example.com/v1?apiMode=responses&imageGenerationModel=gpt-image-2.5-flare')
    const api = await import('./apiProfiles')
    expect(api.DEFAULT_SETTINGS.profiles[0].imageGenerationModel).toBe('gpt-image-2.5-flare')
    expect(api.createDefaultOpenAIProfile().imageGenerationModel).toBe('gpt-image-2.5-flare')
    expect(api.normalizeApiProfile({ apiMode: 'responses', model: 'old-text-model' }).imageGenerationModel).toBe('')
  })
})
