import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyImageSourceToClipboard } from './clipboard'

class FakeClipboardItem {
  static supports = (type: string) => type === 'image/png'
  constructor(public items: Record<string, Blob | Promise<Blob>>) {}
}

describe('copyImageSourceToClipboard', () => {
  const write = vi.fn()
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', { clipboard: { write } })
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    vi.stubGlobal('fetch', fetchMock)
    write.mockImplementation(async (items: FakeClipboardItem[]) => {
      await items[0].items['image/png']
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts the clipboard write before a slow image source resolves', async () => {
    let resolveSource!: (source: string) => void
    const source = new Promise<string>((resolve) => { resolveSource = resolve })
    const png = new Blob(['image'], { type: 'image/png' })
    fetchMock.mockResolvedValue({ blob: async () => png })

    const done = copyImageSourceToClipboard(source)
    expect(write).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    const item = write.mock.calls[0][0][0] as FakeClipboardItem
    expect(Object.keys(item.items)).toEqual(['image/png'])

    resolveSource('blob:image')
    await done
    await expect(item.items['image/png']).resolves.toBe(png)
  })

  it('reports a non-image response through the pending clipboard write', async () => {
    fetchMock.mockResolvedValue({ blob: async () => new Blob(['bad gateway'], { type: 'text/html' }) })
    await expect(copyImageSourceToClipboard('https://example.com/image')).rejects.toThrow('Clipboard item is not an image')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing source without fetching it', async () => {
    await expect(copyImageSourceToClipboard(Promise.resolve(undefined))).rejects.toThrow('Image source is not available')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a permission rejection even if the source also fails later', async () => {
    write.mockRejectedValue(new Error('permission denied'))
    let rejectSource!: (reason: Error) => void
    const source = new Promise<string>((_, reject) => { rejectSource = reject })
    await expect(copyImageSourceToClipboard(source)).rejects.toThrow('permission denied')
    rejectSource(new Error('download failed'))
    await Promise.resolve()
  })
})
