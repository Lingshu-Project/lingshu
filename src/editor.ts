/// <reference types="vite/client" />

import { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core'
import { AllSelection, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Fragment, Slice } from '@milkdown/kit/prose/model'
import { lift, setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands'
import { liftListItem, sinkListItem, wrapInList } from '@milkdown/kit/prose/schema-list'
import { undo, redo } from '@milkdown/kit/prose/history'
import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip'
import { createTable, strikethroughSchema } from '@milkdown/kit/preset/gfm'
import { emphasisKeymap, inlineCodeSchema, listItemKeymap, strongKeymap, strongSchema, emphasisSchema } from '@milkdown/kit/preset/commonmark'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Command } from '@milkdown/kit/prose/state'
import type { NodeType } from '@milkdown/kit/prose/model'
import { $prose, replaceAll } from '@milkdown/kit/utils'
import { editorExtensions, highlightSchema, underlineSchema } from './editor-extensions'
import { editorFeatureConfigs, localizeGeneratedControls } from './editor-locale'

import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

import type { AppLanguage, EditorCommand, MarkdownEditor, OutlineHeading } from './contracts'

export async function createMarkdownEditor(
  root: HTMLElement,
  initialMarkdown: string,
  onChange: (markdown: string) => void,
  language: AppLanguage = 'zh-CN',
): Promise<MarkdownEditor> {
  let ready = false
  let destroyed = false
  let programmaticUpdates = 0
  let lastMarkdown = initialMarkdown
  let destroyPromise: Promise<void> | undefined

  const crepe = new Crepe({
    root,
    defaultValue: initialMarkdown,
    features: {
      [Crepe.Feature.AI]: false,
      // 使用标准 Markdown 图片，保留 alt；Crepe 图片块会将 alt 序列化为缩放比例。
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.Latex]: true,
    },
    featureConfigs: editorFeatureConfigs(language),
  })
  crepe.editor.use(editorExtensions)
  // Route consumed editor shortcuts through the same commands as the native menu.
  crepe.editor.config((ctx) => {
    ctx.set(strongKeymap.key, { ToggleBold: { shortcuts: [] } })
    ctx.set(emphasisKeymap.key, { ToggleEmphasis: { shortcuts: [] } })
    ctx.update(listItemKeymap.key, (keymap) => ({
      ...keymap,
      SinkListItem: { ...keymap.SinkListItem, shortcuts: ['Tab', 'Mod-['] },
      LiftListItem: { ...keymap.LiftListItem, shortcuts: ['Shift-Tab', 'Mod-]'] },
    }))
  })
  crepe.editor.use($prose((ctx) => new Plugin({
    key: new PluginKey('lingshu-context-shortcuts'),
    props: {
      handleKeyDown(_view, event) {
        if (destroyed || !ready) return false
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false
        const commands: Record<string, EditorCommand> = { b: 'bold', i: 'italic', u: 'underline', z: 'undo', y: 'redo' }
        const command = commands[event.key.toLowerCase()]
        if (!command) return false
        event.preventDefault()
        return runCommand(ctx, command)
      },
    },
  })))

  // 使用同步的视图更新通知，避免延迟的 Markdown listener 将加载误报为编辑。
  const changes = $prose((ctx) => new Plugin({
    key: new PluginKey('inkstone-document-changes'),
    view: () => ({
      update(view, previousState) {
        if (destroyed || previousState.doc.eq(view.state.doc)) return

        const markdown = ctx.get(serializerCtx)(view.state.doc)
        const changed = markdown !== lastMarkdown
        lastMarkdown = markdown
        if (ready && programmaticUpdates === 0 && changed) onChange(markdown)
      },
    }),
  }))
  crepe.editor.use(changes)

  try {
    await crepe.create()
    lastMarkdown = crepe.getMarkdown()
    ready = true
  } catch (error) {
    destroyed = true
    await crepe.destroy().catch(() => undefined)
    throw error
  }

  const headings = () => Array.from(root.querySelector('.ProseMirror')?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6') ?? [])
  const stopLocalization = localizeGeneratedControls(root, language)
  const t = (cn: string, en: string) => language === 'zh-CN' ? cn : en
  let imageDialog: HTMLDialogElement | undefined

  const image = (ctx: Ctx) => {
    const view = ctx.get(editorViewCtx)
    const savedSelection = view.state.selection
    imageDialog?.remove()
    const dialog = document.createElement('dialog')
    imageDialog = dialog
    dialog.className = 'editor-image-dialog'
    const form = document.createElement('form')
    form.method = 'dialog'
    const title = document.createElement('h2')
    title.textContent = t('插入图片', 'Insert image')
    form.append(title)
    const field = (label: string, placeholder: string) => {
      const wrapper = document.createElement('label')
      wrapper.textContent = label
      const input = document.createElement('input')
      input.placeholder = placeholder
      input.autocomplete = 'off'
      wrapper.append(input)
      form.append(wrapper)
      return input
    }
    const src = field(t('图片地址或本地相对路径', 'Image URL or relative local path'), 'images/example.png')
    src.required = true
    const alt = field(t('图片说明', 'Alternative text'), t('描述这张图片', 'Describe this image'))
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = t('取消', 'Cancel')
    cancel.onclick = () => dialog.close()
    const insert = document.createElement('button')
    insert.type = 'submit'
    insert.textContent = t('插入', 'Insert')
    form.append(cancel, insert)
    form.onsubmit = (event) => {
      event.preventDefault()
      if (!src.value.trim() || destroyed) return
      // Image URLs are node attributes; no HTML is evaluated.
      const node = view.state.schema.nodes.image.create({ src: src.value.trim(), alt: alt.value, title: null })
      view.dispatch(view.state.tr.setSelection(savedSelection).replaceSelectionWith(node).scrollIntoView())
      dialog.close()
      view.focus()
    }
    dialog.onclose = () => { dialog.remove(); imageDialog = undefined }
    dialog.append(form)
    document.body.append(dialog)
    dialog.showModal()
    src.focus()
    return true
  }

  function runCommand(ctx: Ctx, command: EditorCommand): boolean {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const { selection, schema } = state
    const execute = (action: Command) => action(view.state, view.dispatch, view)
    const markTypes = {
      bold: strongSchema.type(ctx), italic: emphasisSchema.type(ctx), underline: underlineSchema.type(ctx),
      strike: strikethroughSchema.type(ctx), inlineCode: inlineCodeSchema.type(ctx), highlight: highlightSchema.type(ctx),
    }
    if (command in markTypes) return execute(toggleMark(markTypes[command as keyof typeof markTypes]))
    const heading = /^heading([1-6])$/.exec(command)
    if (heading) return execute(setBlockType(schema.nodes.heading, { level: Number(heading[1]) }))
    if (command === 'paragraph') return execute(setBlockType(schema.nodes.paragraph))
    if (command === 'headingIncrease' || command === 'headingDecrease') {
      const current = selection.$from.parent.type === schema.nodes.heading ? Number(selection.$from.parent.attrs.level) : 0
      const level = Math.min(6, Math.max(0, current + (command === 'headingIncrease' ? 1 : -1)))
      return execute(level ? setBlockType(schema.nodes.heading, { level }) : setBlockType(schema.nodes.paragraph))
    }
    if (command === 'undo') return execute(undo)
    if (command === 'redo') return execute(redo)
    if (command === 'link') { ctx.get(linkTooltipAPI.key).addLink(selection.from, selection.to); return true }
    if (command === 'image') return image(ctx)
    if (command === 'clearFormat') {
      let tr = state.tr.removeMark(selection.from, selection.to).setStoredMarks([])
      if (selection.$from.parent.isTextblock) tr = tr.setBlockType(selection.from, selection.to, schema.nodes.paragraph)
      view.dispatch(tr.scrollIntoView())
      return true
    }
    if (command === 'codeBlock' || command === 'mathBlock') return execute(setBlockType(schema.nodes.code_block, { language: command === 'mathBlock' ? 'LaTeX' : '' }))
    if (command === 'table') {
      const tr = state.tr.replaceSelectionWith(createTable(ctx, 3, 3))
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(selection.from + 3, tr.doc.content.size))))
      view.dispatch(tr.scrollIntoView())
      return true
    }
    if (command === 'horizontalRule') { view.dispatch(state.tr.replaceSelectionWith(schema.nodes.hr.create()).scrollIntoView()); return true }
    if (command === 'quote') {
      for (let depth = selection.$from.depth; depth > 0; depth--) {
        if (selection.$from.node(depth).type === schema.nodes.blockquote) return execute(lift)
      }
      return execute(wrapIn(schema.nodes.blockquote))
    }
    const list = command === 'bulletList' || command === 'taskList' ? schema.nodes.bullet_list : command === 'orderedList' ? schema.nodes.ordered_list : undefined
    if (list) {
      let ancestor: { pos: number; type: NodeType; checked: unknown } | undefined
      for (let depth = selection.$from.depth; depth > 0; depth--) {
        const node = selection.$from.node(depth)
        if (node.type === schema.nodes.bullet_list || node.type === schema.nodes.ordered_list) { ancestor = { pos: selection.$from.before(depth), type: node.type, checked: selection.$from.node(depth + 1)?.attrs.checked }; break }
      }
      if (ancestor && ancestor.type === list && command !== 'taskList' && ancestor.checked == null) return execute(liftListItem(schema.nodes.list_item))
      if (!ancestor && !execute(wrapInList(list))) return false
      let tr = view.state.tr
      if (ancestor && ancestor.type !== list) tr = tr.setNodeMarkup(ancestor.pos, list, list === schema.nodes.ordered_list ? { order: 1 } : {})
      const { from, to } = tr.selection
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === schema.nodes.list_item) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: command === 'taskList' ? (ancestor?.checked != null ? null : false) : null })
      })
      view.dispatch(tr.scrollIntoView())
      return true
    }
    if (command === 'indent') {
      if (execute(sinkListItem(schema.nodes.list_item))) return true
      view.dispatch(state.tr.insertText('    ').scrollIntoView())
      return true
    }
    if (command === 'outdent') {
      if (execute(liftListItem(schema.nodes.list_item))) return true
      const start = selection.$from.start()
      const spaces = /^ {1,4}|^\t/.exec(selection.$from.parent.textContent)?.[0].length ?? 0
      if (!spaces) return false
      view.dispatch(state.tr.delete(start, start + spaces).scrollIntoView())
      return true
    }
    if (command === 'jumpSelection') { view.dispatch(state.tr.scrollIntoView()); return true }
    if (command === 'selectScope') {
      const $from = selection.$from
      for (let depth = $from.depth; depth > 0; depth--) {
        const from = $from.start(depth)
        const to = $from.end(depth)
        if (selection.from > from || selection.to < to) { view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to))); return true }
      }
      view.dispatch(state.tr.setSelection(new AllSelection(state.doc)))
      return true
    }
    if (command === 'selectLine' || command === 'selectWord' || command === 'deleteWord') {
      const $from = selection.$from
      const text = $from.parent.textBetween(0, $from.parent.content.size, '\n', '\ufffc')
      const offset = $from.parentOffset
      let from = 0
      let to = text.length
      if (command === 'selectLine') { from = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1; const next = text.indexOf('\n', offset); to = next < 0 ? text.length : next }
      else {
        const parts = [...new Intl.Segmenter(language, { granularity: 'word' }).segment(text)]
        const part = parts.find((value) => value.index <= offset && value.index + value.segment.length > offset) ?? parts.at(-1)
        if (!part) return false
        from = part.index
        to = from + part.segment.length
      }
      const start = $from.start()
      const tr = state.tr.setSelection(TextSelection.create(state.doc, start + from, start + to))
      if (command === 'deleteWord') tr.deleteSelection()
      view.dispatch(tr.scrollIntoView())
      return true
    }
    return false
  }

  const matches = (ctx: Ctx, query: string) => {
    const found: { from: number; to: number }[] = []
    if (!query) return found
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const expression = new RegExp(escaped, 'gu')
    ctx.get(editorViewCtx).state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true
      const text = node.textBetween(0, node.content.size, '\n', '\ufffc')
      for (const match of text.matchAll(expression)) found.push({ from: pos + 1 + match.index!, to: pos + 1 + match.index! + match[0].length })
      return false
    })
    return found
  }

  return {
    getMarkdown() {
      if (!destroyed) lastMarkdown = crepe.getMarkdown()
      return lastMarkdown
    },

    setMarkdown(markdown, resetHistory = false) {
      if (destroyed) throw new Error(t('编辑器已经关闭。', 'The editor has been closed.'))
      programmaticUpdates += 1
      try {
        // flush 会重建含 history 插件的 EditorState，清除前一文档的撤销历史。
        crepe.editor.action(replaceAll(markdown, resetHistory))
        lastMarkdown = crepe.getMarkdown()
      } finally {
        programmaticUpdates -= 1
      }
    },

    focus() {
      if (destroyed) return
      crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    },

    getOutline(): OutlineHeading[] {
      if (destroyed) return []
      return headings().map((heading, index) => ({
        index,
        level: Number(heading.tagName.slice(1)),
        text: heading.textContent?.trim() ?? '',
      }))
    },

    scrollToHeading(index) {
      if (destroyed || !Number.isInteger(index) || index < 0) return
      headings()[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },

    runCommand(command) {
      if (destroyed) return false
      return crepe.editor.action((ctx) => {
        ctx.get(editorViewCtx).focus()
        return runCommand(ctx, command)
      })
    },

    getSelectionMarkdown() {
      if (destroyed) return ''
      return crepe.editor.action((ctx) => {
        const { state } = ctx.get(editorViewCtx)
        if (state.selection.empty) return ''
        return ctx.get(serializerCtx)(state.doc.cut(state.selection.from, state.selection.to)).trimEnd()
      })
    },

    insertText(text) {
      if (destroyed || !text) return
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { state } = view
        let tr = state.tr
        if (!text.includes('\n') || state.selection.$from.parent.type.spec.code) tr = tr.insertText(text)
        else {
          const marks = state.storedMarks ?? state.selection.$from.marks()
          const blocks = text.replace(/\r\n?/g, '\n').split('\n').map((line) => state.schema.nodes.paragraph.create(null, line ? state.schema.text(line, marks) : undefined))
          tr = tr.replaceSelection(new Slice(Fragment.fromArray(blocks), 1, 1))
        }
        view.dispatch(tr.scrollIntoView())
        view.focus()
      })
    },

    find(query, backwards = false) {
      if (destroyed) return { current: 0, total: 0 }
      return crepe.editor.action((ctx) => {
        const found = matches(ctx, query)
        if (!found.length) return { current: 0, total: 0 }
        const view = ctx.get(editorViewCtx)
        const { selection } = view.state
        let index = backwards ? found.length - 1 - [...found].reverse().findIndex((match) => match.to <= selection.from) : found.findIndex((match) => match.from >= selection.to)
        if (backwards && index === found.length) index = -1
        if (index < 0) index = backwards ? found.length - 1 : 0
        const match = found[index]
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).scrollIntoView())
        return { current: index + 1, total: found.length }
      })
    },

    replace(query, replacement, all = false) {
      if (destroyed || !query) return 0
      return crepe.editor.action((ctx) => {
        let found = matches(ctx, query)
        if (!found.length) return 0
        const view = ctx.get(editorViewCtx)
        const { state } = view
        if (!all) {
          const selected = found.find((match) => match.from === state.selection.from && match.to === state.selection.to)
          found = [selected ?? found.find((match) => match.from >= state.selection.to) ?? found[0]]
        }
        const tr = state.tr
        // Descending ranges keep every original document position valid.
        for (const match of [...found].reverse()) {
          // At a mark boundary, marks() returns the preceding text's marks.
          // Replacement inherits the first matched character, including links.
          const start = state.doc.resolve(match.from)
          const marks = start.nodeAfter?.marks ?? start.marks()
          tr.replaceWith(match.from, match.to, replacement ? state.schema.text(replacement, marks) : Fragment.empty)
        }
        view.dispatch(tr.scrollIntoView())
        return found.length
      })
    },

    destroy() {
      if (!destroyPromise) {
        destroyed = true
        ready = false
        stopLocalization()
        imageDialog?.close()
        destroyPromise = crepe.destroy().then(() => undefined)
      }
      return destroyPromise
    },
  }
}
