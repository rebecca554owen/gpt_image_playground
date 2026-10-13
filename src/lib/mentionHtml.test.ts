import { describe, expect, it } from 'vitest'
import { getMentionTagHtml } from './mentionHtml'
import { getSelectedTextMentionLabel } from './promptImageMentions'

describe('mention HTML', () => {
  it('preserves the default mention marker', () => {
    expect(getMentionTagHtml('@图1')).toContain(`data-mention-text="${getSelectedTextMentionLabel('@图1')}"`)
  })

  it('escapes imported mention data without creating an image or event attribute', () => {
    const html = getMentionTagHtml('<img src=x>', '"><img src=x onerror=alert(1)>&')
    expect(html).toBe('<span contenteditable="false" class="mention-tag" data-mention-text="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&amp;">&lt;img src=x&gt;</span>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('data-mention-text="">')
  })
})
