import { katex } from '@mdit/plugin-katex'
import MarkdownIt from 'markdown-it'
import mark from 'markdown-it-mark'
import hljs from 'highlight.js'

import type { ExportHeading } from './contracts'

export function renderMarkdownForExport(markdown: string): {
  contentHtml: string
  outline: ExportHeading[]
} {
  if (typeof markdown !== 'string') throw new TypeError('导出内容必须是 Markdown 文本。')

  const renderer = new MarkdownIt({ html: false, linkify: true, typographer: false,
    highlight(code, language) {
      if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value
      return ''
    },
  })
    .use(mark)
    .use((md) => {
      // Only the exact underline delimiters are recognized; arbitrary HTML remains text.
      md.inline.ruler.before('emphasis', 'safe_underline', (state, silent) => {
        if (!state.src.startsWith('<u>', state.pos)) return false
        const end = state.src.indexOf('</u>', state.pos + 3)
        if (end < 0 || end >= state.posMax) return false
        if (!silent) {
          state.push('safe_underline_open', 'u', 1)
          const children = md.parseInline(state.src.slice(state.pos + 3, end), state.env)[0]?.children ?? []
          state.tokens.push(...children)
          state.push('safe_underline_close', 'u', -1)
        }
        state.pos = end + 4
        return true
      })
      md.core.ruler.after('inline', 'task_list_symbols', (state) => {
        for (let i = 2; i < state.tokens.length; i++) {
          const token = state.tokens[i]
          if (token.type !== 'inline' || state.tokens[i - 1]?.type !== 'paragraph_open' || state.tokens[i - 2]?.type !== 'list_item_open') continue
          const first = token.children?.[0]
          const check = first?.type === 'text' && /^\[([ xX])\]\s+/.exec(token.content)
          if (!check || !first) continue
          first.content = first.content.slice(check[0].length)
          const marker = new state.Token('task_checkbox', 'span', 0)
          marker.content = check[1] === ' ' ? '☐ ' : '☑ '
          token.children!.unshift(marker)
        }
      })
      md.renderer.rules.task_checkbox = (tokens, index) => `<span class="task-checkbox">${tokens[index].content}</span>`
    })
    .use(katex, { trust: false, throwOnError: false, output: 'htmlAndMathml' })
  const environment = {}
  const tokens = renderer.parse(markdown, environment)
  const outline: ExportHeading[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'heading_open') continue

    const inline = tokens[index + 1]
    const id = `heading-${outline.length + 1}`
    const text = (inline?.children ?? []).map((child) => {
      if (child.type === 'softbreak' || child.type === 'hardbreak') return ' '
      return child.nesting === 0 ? child.content : ''
    }).join('').trim()
    token.attrSet('id', id)
    outline.push({ id, level: Number(token.tag.slice(1)), text })
  }

  return { contentHtml: renderer.renderer.render(tokens, renderer.options, environment), outline }
}
