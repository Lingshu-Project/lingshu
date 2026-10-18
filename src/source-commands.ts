import type { EditorCommand } from './contracts'
import { t } from './i18n'

interface SourceSnapshot { text: string; start: number; end: number }

/** Commands operate on the visible source, without a Markdown parse/serialize round trip. */
export class SourceCommands {
  private history: SourceSnapshot[] = []
  private position = -1
  private restoring = false
  constructor(private readonly area: HTMLTextAreaElement) {
    this.area.addEventListener('beforeinput', () => {
      if (this.position >= 0 && !this.restoring) this.history[this.position] = this.snapshot()
    })
    this.area.addEventListener('input', () => { if (!this.restoring) this.record() })
    this.reset()
  }
  private snapshot(): SourceSnapshot { return { text: this.area.value, start: this.area.selectionStart, end: this.area.selectionEnd } }
  reset(): void { this.history = [this.snapshot()]; this.position = 0 }
  private record(): void {
    const next = this.snapshot()
    if (this.history[this.position]?.text === next.text) return
    this.history.splice(this.position + 1)
    this.history.push(next)
    if (this.history.length > 200) this.history.shift()
    this.position = this.history.length - 1
  }
  private changed(): void { this.area.dispatchEvent(new Event('input', { bubbles: true })) }
  private replaceRange(text: string, start: number, end: number, select = false): void {
    if (this.position >= 0) this.history[this.position] = this.snapshot()
    this.area.setRangeText(text, start, end, select ? 'select' : 'end')
    this.changed()
    this.area.focus()
  }
  insert(text: string): void { this.replaceRange(text, this.area.selectionStart, this.area.selectionEnd) }
  private wrap(marker: string, closing = marker): void {
    const { selectionStart: start, selectionEnd: end, value } = this.area
    const selected = value.slice(start, end)
    if (value.slice(start - marker.length, start) === marker && value.slice(end, end + closing.length) === closing) {
      this.replaceRange(selected, start - marker.length, end + closing.length, true)
    } else if (selected.startsWith(marker) && selected.endsWith(closing) && selected.length >= marker.length + closing.length) {
      this.replaceRange(selected.slice(marker.length, -closing.length), start, end, true)
    } else {
      this.replaceRange(`${marker}${selected}${closing}`, start, end)
      this.area.setSelectionRange(start + marker.length, start + marker.length + selected.length)
    }
  }
  private lines(transform: (line: string, index: number) => string): void {
    const { value, selectionStart, selectionEnd } = this.area
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1
    const selectedEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === '\n' ? selectionEnd - 1 : selectionEnd
    const nextBreak = value.indexOf('\n', selectedEnd)
    const end = nextBreak < 0 ? value.length : nextBreak
    this.replaceRange(value.slice(start, end).split('\n').map(transform).join('\n'), start, end, true)
  }
  private block(open: string, close = open): void {
    const start = this.area.selectionStart
    const end = this.area.selectionEnd
    const selected = this.area.value.slice(start, end)
    const before = start > 0 && this.area.value[start - 1] !== '\n' ? '\n' : ''
    const after = end < this.area.value.length && this.area.value[end] !== '\n' ? '\n' : ''
    this.replaceRange(`${before}${open}\n${selected}\n${close}${after}`, start, end)
    this.area.setSelectionRange(start + before.length + open.length + 1, start + before.length + open.length + 1 + selected.length)
  }
  private wordRange(): [number, number] {
    const { value, selectionStart: caret } = this.area
    const word = /[\p{L}\p{N}_]+/gu
    for (const match of value.matchAll(word)) {
      const start = match.index!
      if (start <= caret && start + match[0].length >= caret) return [start, start + match[0].length]
      if (start > caret) break
    }
    return [caret, caret]
  }
  run(command: EditorCommand): boolean {
    const area = this.area
    if (command === 'undo' || command === 'redo') {
      const next = this.position + (command === 'undo' ? -1 : 1)
      const snapshot = this.history[next]
      if (!snapshot) return false
      this.position = next
      this.restoring = true
      area.value = snapshot.text
      area.setSelectionRange(snapshot.start, snapshot.end)
      this.changed()
      this.restoring = false
      area.focus()
      return true
    }
    if (command === 'bold') this.wrap('**')
    else if (command === 'italic') this.wrap('*')
    else if (command === 'underline') this.wrap('<u>', '</u>')
    else if (command === 'strike') this.wrap('~~')
    else if (command === 'inlineCode') this.wrap('`')
    else if (command === 'highlight') this.wrap('==')
    else if (/^heading[1-6]$/.test(command)) this.lines((line) => `${'#'.repeat(Number(command.slice(-1)))} ${line.replace(/^\s{0,3}#{1,6}\s+/, '')}`)
    else if (command === 'paragraph') this.lines((line) => line.replace(/^\s{0,3}#{1,6}\s+/, ''))
    else if (command === 'headingIncrease' || command === 'headingDecrease') this.lines((line) => {
      const heading = /^(#{1,6})\s+/.exec(line)
      const level = heading?.[1]?.length ?? 0
      const next = Math.max(0, Math.min(6, level + (command === 'headingIncrease' ? 1 : -1)))
      return `${next ? `${'#'.repeat(next)} ` : ''}${line.replace(/^#{1,6}\s+/, '')}`
    })
    else if (command === 'quote') this.lines((line) => `> ${line}`)
    else if (command === 'orderedList') this.lines((line, index) => `${index + 1}. ${line.replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')}`)
    else if (command === 'bulletList') this.lines((line) => `- ${line.replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')}`)
    else if (command === 'taskList') this.lines((line) => `- [ ] ${line.replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')}`)
    else if (command === 'indent') this.lines((line) => `  ${line}`)
    else if (command === 'outdent') this.lines((line) => line.replace(/^(?: {1,2}|\t)/, ''))
    else if (command === 'codeBlock') this.block('```')
    else if (command === 'mathBlock') this.block('$$')
    else if (command === 'horizontalRule') this.insert('\n\n---\n\n')
    else if (command === 'table') this.insert(`\n| ${t('tableHeading')} | ${t('tableHeading')} |\n| --- | --- |\n| ${t('tableCell')} | ${t('tableCell')} |\n`)
    else if (command === 'link' || command === 'image') {
      const selected = area.value.slice(area.selectionStart, area.selectionEnd)
      const start = area.selectionStart
      const label = selected || t(command === 'image' ? 'imageAlt' : 'linkText')
      const text = `${command === 'image' ? '!' : ''}[${label}]()`
      this.insert(text)
      area.setSelectionRange(start + text.length - 1, start + text.length - 1)
    } else if (command === 'clearFormat') {
      const selected = area.value.slice(area.selectionStart, area.selectionEnd)
      const plain = selected.replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1').replace(/(\*\*|__|~~|==|`)([\s\S]*?)\1/g, '$2').replace(/([*_])([^\n]*?)\1/g, '$2').replace(/<\/?(?:u|mark)>/g, '').replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
      this.replaceRange(plain, area.selectionStart, area.selectionEnd, true)
    } else if (command === 'selectWord') area.setSelectionRange(...this.wordRange())
    else if (command === 'deleteWord') {
      if (area.selectionStart !== area.selectionEnd) this.insert('')
      else { const [start, end] = this.wordRange(); this.replaceRange('', start, end) }
    } else if (command === 'selectLine') {
      const start = area.value.lastIndexOf('\n', area.selectionStart - 1) + 1
      const end = area.value.indexOf('\n', area.selectionEnd)
      area.setSelectionRange(start, end < 0 ? area.value.length : end)
    } else if (command === 'selectScope') {
      const start = area.value.lastIndexOf('\n\n', area.selectionStart - 1) + 2
      const end = area.value.indexOf('\n\n', area.selectionEnd)
      area.setSelectionRange(start === 1 ? 0 : start, end < 0 ? area.value.length : end)
    } else if (command === 'jumpSelection') {
      const line = area.value.slice(0, area.selectionStart).split('\n').length - 1
      area.scrollTop = Math.max(0, line * 28 - area.clientHeight / 2)
    } else return false
    area.focus()
    return true
  }
  find(query: string, backwards = false): {current: number; total: number} {
    if (!query) return { current: 0, total: 0 }
    const matches: number[] = []
    for (let offset = 0; offset <= this.area.value.length - query.length;) {
      const index = this.area.value.indexOf(query, offset)
      if (index < 0) break
      matches.push(index)
      offset = index + query.length
    }
    if (!matches.length) return { current: 0, total: 0 }
    let selected = matches.findIndex((index) => index >= this.area.selectionEnd)
    if (backwards) {
      selected = -1
      for (let index = matches.length - 1; index >= 0; index--) {
        if (matches[index]! < this.area.selectionStart) { selected = index; break }
      }
    }
    if (selected < 0) selected = backwards ? matches.length - 1 : 0
    const start = matches[selected]!
    this.area.setSelectionRange(start, start + query.length)
    const line = this.area.value.slice(0, start).split('\n').length - 1
    this.area.scrollTop = Math.max(0, line * 28 - this.area.clientHeight / 2)
    return { current: selected + 1, total: matches.length }
  }
  replace(query: string, replacement: string, all = false): number {
    if (!query) return 0
    if (all) {
      const parts = this.area.value.split(query)
      if (parts.length < 2) return 0
      this.replaceRange(parts.join(replacement), 0, this.area.value.length)
      return parts.length - 1
    }
    if (this.area.value.slice(this.area.selectionStart, this.area.selectionEnd) !== query && !this.find(query).total) return 0
    this.insert(replacement)
    return 1
  }
}
