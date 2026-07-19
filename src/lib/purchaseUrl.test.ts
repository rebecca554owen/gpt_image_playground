import { describe, expect, it } from 'vitest'
import { getPurchaseUrl, getPurchaseUrlLabel } from './purchaseUrl'

describe('purchase URL helpers', () => {
  it('derives the service URL from an OpenAI-compatible API base URL', () => {
    expect(getPurchaseUrl('https://api.example.com/v1')).toBe('https://api.example.com')
    expect(getPurchaseUrl('https://api.example.com/api/v1/')).toBe('https://api.example.com/api')
    expect(getPurchaseUrl('https://api.llm-token.cn/v1')).toBe('https://llm-token.cn')
    expect(getPurchaseUrl('https://hk.gpt-agent.cc/v1')).toBe('https://llm-token.cn')
    expect(getPurchaseUrl('https://eu.gpt-agent.cc/v1')).toBe('https://llm-token.cn')
    expect(getPurchaseUrl('https://gpt-agent.cc/v1')).toBe('https://llm-token.cn')
    expect(getPurchaseUrl('https://img.llm-token.cn/v1')).toBe('https://llm-token.cn')
  })

  it('formats a compact label for visible support links', () => {
    expect(getPurchaseUrlLabel('https://api.example.com/v1')).toBe('api.example.com')
    expect(getPurchaseUrlLabel('https://api.example.com/api/v1')).toBe('api.example.com/api')
    expect(getPurchaseUrlLabel('https://api.llm-token.cn/v1')).toBe('llm-token.cn')
  })
})
