import { describe, expect, it } from 'vitest'
import { getPurchaseUrl, getPurchaseUrlLabel } from './purchaseUrl'

describe('purchase URL helpers', () => {
  it('derives the service URL from an OpenAI-compatible API base URL', () => {
    expect(getPurchaseUrl('https://gpt-agent.cc/v1')).toBe('https://gpt-agent.cc')
    expect(getPurchaseUrl('https://gpt-agent.cc/api/v1/')).toBe('https://gpt-agent.cc/api')
  })

  it('formats a compact label for visible support links', () => {
    expect(getPurchaseUrlLabel('https://gpt-agent.cc/v1')).toBe('gpt-agent.cc')
    expect(getPurchaseUrlLabel('https://gpt-agent.cc/api/v1')).toBe('gpt-agent.cc/api')
  })
})
