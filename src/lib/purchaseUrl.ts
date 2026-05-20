export function getPurchaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return baseUrl
    url.pathname = url.pathname.replace(/\/v1\/?$/, '') || '/'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return baseUrl
  }
}
