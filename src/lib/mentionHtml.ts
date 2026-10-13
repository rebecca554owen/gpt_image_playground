import { getSelectedTextMentionLabel } from './promptImageMentions'

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 胶囊数据可能来自导入的备份，属性值和显示文本都需要转义。
export function getMentionTagHtml(text: string, mentionText = getSelectedTextMentionLabel(text)) {
  return `<span contenteditable="false" class="mention-tag" data-mention-text="${escapeHtml(mentionText)}">${escapeHtml(text)}</span>`
}
