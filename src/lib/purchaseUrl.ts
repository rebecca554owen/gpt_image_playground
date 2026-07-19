const FIRST_PARTY_API_HOSTNAMES = new Set([
  'api.llm-token.cn',
  'hk.gpt-agent.cc',
  'eu.gpt-agent.cc',
  'gpt-agent.cc',
  'img.llm-token.cn',
])

export function getPurchaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return baseUrl
    if (FIRST_PARTY_API_HOSTNAMES.has(url.hostname)) return 'https://llm-token.cn'
    url.pathname = url.pathname.replace(/\/v1\/?$/, '') || '/'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return baseUrl
  }
}

export function getPurchaseUrlLabel(baseUrl: string): string {
  const purchaseUrl = getPurchaseUrl(baseUrl)

  try {
    const url = new URL(purchaseUrl)
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return purchaseUrl
  }
}
