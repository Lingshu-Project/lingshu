import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { MarkdownNode, RemarkPluginRaw } from '@milkdown/kit/transformer'
import { $inputRule, $markSchema, $remark, $shortcut } from '@milkdown/kit/utils'
import { markRule } from '@milkdown/kit/prose'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { Handle, Options } from 'mdast-util-to-markdown'
import { decodeString } from 'micromark-util-decode-string'

// These are the only HTML tags interpreted by this extension. Other HTML remains
// Milkdown's inert html node; neither raw HTML nor scripts are executed.
function markSchema(name: 'highlight' | 'underline', tag: 'mark' | 'u') {
  const astType = `inkstone${name}`
  return $markSchema(name, () => ({
    inclusive: true,
    parseDOM: [{ tag }],
    toDOM: () => [tag, 0],
    parseMarkdown: {
      match: (node) => node.type === astType,
      runner: (state, node, type) => {
        state.openMark(type)
        state.next(node.children)
        state.closeMark(type)
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === name,
      runner: (state, mark) => { state.withMark(mark, astType) },
    },
  }))
}

export const highlightSchema = markSchema('highlight', 'mark')
export const underlineSchema = markSchema('underline', 'u')

type InlineNode = MarkdownNode & { value?: string; children?: InlineNode[]; canOpen?: boolean; canClose?: boolean }

function textMarkerTokens(node: InlineNode, source: string): InlineNode[] {
  const value = node.value ?? ''
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (!value.includes('==') || start === undefined || end === undefined) return [node]

  // Remark has already decoded character references and backslash escapes in
  // text.value. Keep their original provenance instead of treating the decoded
  // `==` in `\==text==` or `&#61;&#61;text==` as Markdown delimiters.
  const rawLines = source.slice(start, end).split(/(\r\n|\n|\r)/)
  const characters: { literalEquals: boolean; sourceOffset: number }[] = []
  let sourceOffset = start
  let valueOffset = 0
  for (let line = 0; line < rawLines.length; line += 2) {
    const raw = rawLines[line]
    const newline = rawLines[line + 1] ?? ''
    let decoded = ''
    const mapping: typeof characters = []
    const pieces = /\\[!-/:-@[-`{-~]|&(?:#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});|[\s\S]/gi
    for (const match of raw.matchAll(pieces)) {
      const token = match[0]
      const text = decodeString(token)
      decoded += text
      for (let index = 0; index < text.length; index++) mapping.push({ literalEquals: token === '=', sourceOffset: sourceOffset + match.index! })
    }

    // A multiline text node's source range includes quote/list continuation
    // prefixes which are absent from text.value. Match only a removable line
    // prefix and retain an exact mapping for the actual content, including
    // references which themselves decode to newline characters.
    let prefix = -1
    for (let offset = 0; offset <= decoded.length; offset++) {
      if (offset && (line === 0 || !/^[\t >]*$/.test(decoded.slice(0, offset)))) break
      const content = decoded.slice(offset)
      const after = valueOffset + content.length
      if (value.startsWith(content, valueOffset) && (newline ? value.startsWith(newline, after) : after === value.length)) { prefix = offset; break }
    }
    if (prefix < 0) return [node]
    for (const character of mapping.slice(prefix)) characters.push(character)
    for (let index = 0; index < newline.length; index++) characters.push({ literalEquals: false, sourceOffset: sourceOffset + raw.length + index })
    valueOffset += decoded.length - prefix + newline.length
    sourceOffset += raw.length + newline.length
  }
  if (characters.length !== value.length) return [node]

  const tokens: InlineNode[] = []
  let from = 0
  for (let index = 0; index < value.length - 1; index++) {
    const first = characters[index]
    const second = characters[index + 1]
    if (value.slice(index, index + 2) !== '==' || !first.literalEquals || !second.literalEquals || second.sourceOffset !== first.sourceOffset + 1) continue
    if (index > from) tokens.push({ type: 'text', value: value.slice(from, index) })
    const before = source.charAt(first.sourceOffset - 1)
    const after = source.charAt(second.sourceOffset + 1)
    tokens.push({ type: 'inkstoneDelimiter', value: '==', canOpen: !!after && !/\s/u.test(after), canClose: !!before && !/\s/u.test(before) })
    from = index + 2
    index++
  }
  if (from < value.length) tokens.push({ type: 'text', value: value.slice(from) })
  return tokens.length ? tokens : [node]
}

function parseInlineMarks(parent: InlineNode, source: string) {
  if (!parent.children || parent.type === 'code' || parent.type === 'inlineCode' || parent.type === 'html') return
  parent.children.forEach((child) => parseInlineMarks(child, source))
  if (!['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'inkstonehighlight', 'inkstoneunderline'].includes(parent.type)) return

  const tokens: InlineNode[] = []
  for (const child of parent.children) {
    if (child.type !== 'text' || !child.value?.includes('==')) { tokens.push(child); continue }
    tokens.push(...textMarkerTokens(child, source))
  }
  const marker = (node: InlineNode) => node.type === 'inkstoneDelimiter' ? 'highlight'
    : node.type === 'html' && /^<u\s*>$/i.test(node.value ?? '') ? 'openUnderline'
      : node.type === 'html' && /^<\/u\s*>$/i.test(node.value ?? '') ? 'closeUnderline' : ''
  const result: InlineNode[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const kind = marker(token)
    if ((kind !== 'highlight' && kind !== 'openUnderline') || (kind === 'highlight' && !token.canOpen)) { result.push(token); continue }
    const closing = kind === 'highlight' ? 'highlight' : 'closeUnderline'
    const end = tokens.findIndex((node, at) => at > index && marker(node) === closing && (closing !== 'highlight' || node.canClose))
    if (end <= index + 1) { result.push(token.type === 'inkstoneDelimiter' ? { type: 'text', value: '==' } : token); continue }
    const marked: InlineNode = { type: kind === 'highlight' ? 'inkstonehighlight' : 'inkstoneunderline', children: tokens.slice(index + 1, end) }
    parseInlineMarks(marked, source)
    result.push(marked)
    index = end
  }
  parent.children = result.map((node) => node.type === 'inkstoneDelimiter' ? { type: 'text', value: '==' } : node)
}

function markHandler(open: string, close: string): Handle {
  return (node, _parent, state, info) => {
    const exit = state.enter('phrasing')
    let value = state.containerPhrasing(node as Parameters<typeof state.containerPhrasing>[0], { ...info, before: open, after: close })
    exit()
    // A rich-text selection may include edge whitespace. Encode it so the
    // delimiter's flanking rules preserve that selection after reopening.
    if (open === '==') value = value.replace(/^\s+|\s+$/gu, (spaces) => [...spaces].map((char) => `&#x${char.codePointAt(0)!.toString(16)};`).join(''))
    return `${open}${value}${close}`
  }
}

export const remarkInlineMarks: RemarkPluginRaw<undefined> = function () {
  const extensions = (this.data('toMarkdownExtensions') ?? []) as Options[]
  extensions.push({
    // Literal equals in a text node must never acquire mark syntax on save.
    // Code and inline-code handlers do not use phrasing text escaping.
    unsafe: [{ character: '=', inConstruct: 'phrasing' }],
    handlers: {
      inkstonehighlight: markHandler('==', '=='),
      inkstoneunderline: markHandler('<u>', '</u>'),
    } as Options['handlers'],
  })
  this.data('toMarkdownExtensions', extensions)
  return (tree, file) => { parseInlineMarks(tree as InlineNode, String(file)) }
}

export const inlineMarksRemark = $remark('inkstoneInlineMarks', () => remarkInlineMarks)
const highlightInput = $inputRule((ctx) => markRule(/(?<![\\=])(?:==)([^=]+)(?:==)$/, highlightSchema.type(ctx)))
const underlineInput = $inputRule((ctx) => markRule(/(?:<u>)(.+)(?:<\/u>)$/, underlineSchema.type(ctx)))

// CommonMark's fence input rules use a trailing space. Typora also accepts Enter.
// A priority keymap handles only a complete fence in an otherwise plain block.
const fenceEnter = $shortcut((ctx) => ({
  Enter: {
    key: 'Enter',
    priority: 100,
    onRun: () => (state, dispatch) => {
      const { $from, empty } = state.selection
      if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false
      const text = $from.parent.textContent
      const fence = /^```([\w+-]*)\s*$/.exec(text)
      if (!fence && text.trim() !== '$$') return false
      const start = $from.start()
      const tr = state.tr.delete(start, $from.end()).setBlockType(start, start, codeBlockSchema.type(ctx), { language: fence ? fence[1] : 'LaTeX' })
      tr.setSelection(TextSelection.create(tr.doc, start))
      dispatch?.(tr.scrollIntoView())
      return true
    },
  },
}))

export const editorExtensions: MilkdownPlugin[] = [highlightSchema, underlineSchema, inlineMarksRemark, highlightInput, underlineInput, fenceEnter].flat()
