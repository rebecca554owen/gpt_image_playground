export function getPurchaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return baseUrl
    if (url.hostname === 'api.llm-token.cn') return 'https://llm-token.cn'
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
