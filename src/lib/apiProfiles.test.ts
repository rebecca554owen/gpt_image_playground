import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CUSTOM_PROFILE_ID,
  DEFAULT_CUSTOM_PROVIDER_ID,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_SETTINGS,
  createDefaultOpenAIProfile,
  mergeImportedSettings,
  normalizeSettings,
} from './apiProfiles'

describe('OpenAI-only API profiles', () => {
  it('default settings use only the built-in OpenAI-compatible provider', () => {
    expect(DEFAULT_SETTINGS.customProviders).toEqual([])
    expect(DEFAULT_SETTINGS.profiles).toHaveLength(1)
    expect(DEFAULT_SETTINGS.profiles[0]).toMatchObject({
      id: DEFAULT_OPENAI_PROFILE_ID,
      provider: 'openai',
      model: DEFAULT_IMAGES_MODEL,
      codexCli: true,
    })
    expect(DEFAULT_SETTINGS.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
  })

  it('normalizes fal profiles to OpenAI-compatible profiles', () => {
    const settings = normalizeSettings({
      profiles: [{
        id: 'legacy-fal',
        name: 'Legacy fal',
        provider: 'fal',
        baseUrl: 'https://fal.run',
        apiKey: 'fal-key',
        model: 'openai/gpt-image-2',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
      activeProfileId: 'legacy-fal',
    })

    expect(settings.customProviders).toEqual([])
    expect(settings.activeProfileId).toBe('legacy-fal')
    expect(settings.profiles[0]).toMatchObject({
      id: 'legacy-fal',
      name: 'Legacy fal',
      provider: 'openai',
      baseUrl: 'https://fal.run',
      apiKey: 'fal-key',
    })
  })

  it('migrates the legacy default custom provider to OpenAI-compatible defaults', () => {
    const settings = normalizeSettings({
      customProviders: [{
        id: DEFAULT_CUSTOM_PROVIDER_ID,
        name: '默认服务商',
        submit: {
          path: 'images/generations',
          method: 'POST',
          contentType: 'json',
          body: {
            model: '$profile.model',
            prompt: '$prompt',
            size: '$params.size',
            quality: '$params.quality',
            output_format: '$params.output_format',
            moderation: '$params.moderation',
            output_compression: '$params.output_compression',
            n: '$params.n',
          },
        },
        editSubmit: {
          path: 'images/edits',
          method: 'POST',
          contentType: 'multipart',
          body: {
            model: '$profile.model',
            prompt: '$prompt',
            size: '$params.size',
            quality: '$params.quality',
            output_format: '$params.output_format',
            moderation: '$params.moderation',
            output_compression: '$params.output_compression',
            n: '$params.n',
          },
        },
      }],
      profiles: [{
        id: DEFAULT_CUSTOM_PROFILE_ID,
        name: '默认配置',
        provider: DEFAULT_CUSTOM_PROVIDER_ID,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'key',
        model: 'gpt-image-2',
        timeout: 600,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
      activeProfileId: DEFAULT_CUSTOM_PROFILE_ID,
    })

    expect(settings.customProviders).toEqual([])
    expect(settings.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
    expect(settings.profiles[0]).toMatchObject({
      id: DEFAULT_OPENAI_PROFILE_ID,
      name: '默认',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key',
    })
  })

  it('imports custom provider profiles as OpenAI-compatible profiles and drops provider manifests', () => {
    const settings = normalizeSettings({
      customProviders: [{
        id: 'custom-json',
        name: 'Custom JSON',
        submit: { path: 'images/generations' },
      }],
      profiles: [{
        id: 'custom-profile',
        name: 'Custom Profile',
        provider: 'custom-json',
        baseUrl: 'https://custom.example.com/v1',
        apiKey: 'custom-key',
        model: 'custom-model',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
      activeProfileId: 'custom-profile',
    })

    expect(settings.customProviders).toEqual([])
    expect(settings.profiles).toHaveLength(1)
    expect(settings.profiles[0]).toMatchObject({
      id: 'custom-profile',
      provider: 'openai',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
    })
  })
})

describe('mergeImportedSettings', () => {
  it('replaces untouched defaults with imported OpenAI-compatible settings', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
      timeout: 120,
      apiMode: 'responses',
      codexCli: true,
      apiProxy: true,
    })

    expect(merged.customProviders).toEqual([])
    expect(merged.profiles).toHaveLength(1)
    expect(merged.profiles[0]).toMatchObject({
      id: DEFAULT_OPENAI_PROFILE_ID,
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
      apiMode: 'responses',
    })
  })

  it('appends imported profiles as OpenAI-compatible profiles when current settings are customized', () => {
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [createDefaultOpenAIProfile({
        id: 'current-openai',
        baseUrl: 'https://current.example.com/v1',
        apiKey: 'current-key',
        model: 'current-model',
      })],
      activeProfileId: 'current-openai',
    })
    const merged = mergeImportedSettings(current, {
      profiles: [{
        id: 'imported-custom',
        name: 'Imported Custom',
        provider: 'custom-json',
        baseUrl: 'https://custom.example.com/v1',
        apiKey: 'custom-key',
        model: 'custom-model',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
    })

    expect(merged.customProviders).toEqual([])
    expect(merged.profiles).toHaveLength(2)
    expect(merged.profiles[1]).toMatchObject({
      name: 'Imported Custom',
      provider: 'openai',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'custom-key',
    })
  })
})
