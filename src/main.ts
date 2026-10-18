import './styles.css'
import { createMarkdownEditor } from './editor'
import { renderMarkdownForExport } from './export-content'
import type { AppCommand, AppLanguage, DocumentInfo, EditorCommand, ExportOptions, FeedbackErrorCode, FeedbackInfo, FeedbackKind, FeedbackPayload, MarkdownEditor, OutlineHeading, ThemeResult, ThemeState } from './contracts'
import { getLanguage, setInterfaceLanguage, t, translateInterface } from './i18n'
import type { MessageKey } from './i18n'
import { SourceCommands } from './source-commands'

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing interface element: ${id}`)
  return found as T
}

const editorRoot = element<HTMLDivElement>('editor')
const sourceEditor = element<HTMLTextAreaElement>('source-editor')
const documentName = element('document-name')
const documentStatus = element('document-status')
const outlineList = element('outline-list')
const documentBase = element<HTMLBaseElement>('document-base')
const initialBaseUrl = document.baseURI
const bridge = window.inkstone
const exportDialog = element<HTMLDialogElement>('export-dialog')
const themeDialog = element<HTMLDialogElement>('theme-dialog')
const themeSelect = element<HTMLSelectElement>('theme-select')
const languageDialog = element<HTMLDialogElement>('language-dialog')
const feedbackDialog = element<HTMLDialogElement>('feedback-dialog')
const feedbackForm = element<HTMLFormElement>('feedback-form')
const feedbackKind = element<HTMLSelectElement>('feedback-kind')
const feedbackTitle = element<HTMLInputElement>('feedback-title')
const feedbackBody = element<HTMLTextAreaElement>('feedback-body')
const feedbackToken = element<HTMLInputElement>('feedback-token')
const findPanel = element('find-panel')
const findQuery = element<HTMLInputElement>('find-query')
const replaceText = element<HTMLInputElement>('replace-text')
const sourceCommands = new SourceCommands(sourceEditor)
const userThemeStyle = document.createElement('style')
userThemeStyle.id = 'user-theme-style'
document.head.append(userThemeStyle)
const buttons = {
  new: element<HTMLButtonElement>('new-btn'),
  open: element<HTMLButtonElement>('open-btn'),
  save: element<HTMLButtonElement>('save-btn'),
  source: element<HTMLButtonElement>('source-btn'),
  outline: element<HTMLButtonElement>('outline-btn'),
  focus: element<HTMLButtonElement>('focus-btn'),
  theme: element<HTMLButtonElement>('theme-btn'),
  export: element<HTMLButtonElement>('export-btn'),
  customTheme: element<HTMLButtonElement>('custom-theme-btn'),
  language: element<HTMLButtonElement>('language-btn'),
  find: element<HTMLButtonElement>('find-btn'),
  typewriter: element<HTMLButtonElement>('typewriter-btn'),
  feedback: element<HTMLButtonElement>('feedback-btn'),
}

let editor: MarkdownEditor | undefined
let currentDocument: DocumentInfo | undefined
let originalText = ''
let savedRichBaseline = ''
let richAnchorText = ''
let richAnchorBaseline = ''
let sourceAnchorText = ''
let sourceAnchorDisplayed = ''
let sourceLineEnding = '\n'
let sourceMode = false
let outlineVisible = true
let focusMode = false
let typewriterMode = false
let darkTheme = false
let busy = false
let applyingDocument = false
let lastDirty: boolean | undefined
let languageRequired = true
let resolveInitialLanguage: (() => void) | undefined
let lastSearch: {current: number; total: number} | undefined
let lastReplacement: number | undefined
let typewriterFrame = 0
let feedbackInfo: FeedbackInfo | undefined
let feedbackCreatedNumber: number | undefined
let feedbackMessage: { key: MessageKey; values?: Record<string, string | number> } | undefined

function settingsOpen(): boolean { return exportDialog.open || themeDialog.open || languageDialog.open || feedbackDialog.open }

function refreshLanguage(): void {
  translateInterface()
  document.body.dataset.language = getLanguage()
  buttons.theme.querySelector('span')!.textContent = t(darkTheme ? 'light' : 'dark')
  element('mode-label').textContent = t(sourceMode ? 'markdownSource' : 'richMode')
  const defaultTheme = themeSelect.querySelector<HTMLOptionElement>('option[value=""]')
  if (defaultTheme) defaultTheme.textContent = t('defaultTheme')
  refreshSearchResult()
  refreshFeedbackUI()
  if (currentDocument) refreshDocumentState()
  else document.title = t('appName')
}

function showNotice(message: string): void {
  element('notice-text').textContent = message
  element('notice').hidden = false
}

function hideNotice(): void { element('notice').hidden = true }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getCurrentText(): string {
  if (sourceMode) {
    if (sourceEditor.value === sourceAnchorDisplayed) return sourceAnchorText
    return sourceLineEnding === '\r\n' ? sourceEditor.value.replace(/\n/g, '\r\n') : sourceEditor.value
  }
  if (!editor) return richAnchorText
  const markdown = editor.getMarkdown()
  // Preserve the exact loaded/source text until a rich-text edit changes its normalization.
  if (markdown === richAnchorBaseline) return richAnchorText
  if (markdown === savedRichBaseline) return originalText
  return markdown
}

function setSourceText(markdown: string, resetHistory = false): void {
  const previous = sourceEditor.value
  sourceEditor.value = markdown
  sourceAnchorText = markdown
  sourceAnchorDisplayed = sourceEditor.value
  sourceLineEnding = markdown.includes('\r\n') && !/(?<!\r)\n/.test(markdown) ? '\r\n' : '\n'
  if (resetHistory || previous !== sourceEditor.value) sourceCommands.reset()
}

function synchronizeRichText(markdown: string, resetHistory = false): void {
  if (!editor) return
  applyingDocument = true
  try {
    editor.setMarkdown(markdown, resetHistory)
    ensureEditorBody()
    richAnchorText = markdown
    richAnchorBaseline = editor.getMarkdown()
    if (markdown === originalText) savedRichBaseline = richAnchorBaseline
  } finally { applyingDocument = false }
}

function setBusy(value: boolean): void {
  busy = value
  for (const button of Object.values(buttons)) button.disabled = value || !editor
  editorRoot.inert = value
  sourceEditor.readOnly = value
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('.settings-dialog input, .settings-dialog textarea, .settings-dialog select, .settings-dialog button')) control.disabled = value
  for (const control of findPanel.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) control.disabled = value || !editor
  synchronizeExportControls()
  synchronizeFeedbackControls()
  document.body.setAttribute('aria-busy', String(value))
}

function ensureEditorBody(): void {
  const body = editorRoot.querySelector<HTMLElement>('.ProseMirror')
  if (body) {
    body.id = 'write'
    body.classList.add('markdown-body')
  }
}

function sourceOutline(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  const lines = markdown.split('\n')
  let offset = 0
  let previousOffset = 0
  let fence: string | undefined
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? ''
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
    } else if (!fence) {
      const atx = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
      if (atx) headings.push({ level: atx[1]!.length, text: atx[2]!, index: offset })
      else if (index > 0 && /^\s{0,3}(=+|-+)\s*$/.test(line) && lines[index - 1]?.trim()) {
        headings.push({ level: line.trim().startsWith('=') ? 1 : 2, text: lines[index - 1]!.trim(), index: previousOffset })
      }
    }
    previousOffset = offset
    offset += line.length + 1
  }
  return headings
}

function updateOutline(): void {
  const headings = sourceMode ? sourceOutline(sourceEditor.value) : editor?.getOutline() ?? []
  const fragment = document.createDocumentFragment()
  if (!headings.length) {
    const empty = document.createElement('p')
    empty.className = 'outline-empty'
    empty.textContent = t('outlineEmpty')
    fragment.append(empty)
  }
  for (const heading of headings) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'outline-heading'
    button.style.setProperty('--heading-depth', String(heading.level - 1))
    button.textContent = heading.text || t('untitledHeading')
    button.title = heading.text
    button.addEventListener('click', () => {
      if (sourceMode) {
        sourceEditor.focus()
        sourceEditor.setSelectionRange(heading.index, heading.index)
        const lineNumber = sourceEditor.value.slice(0, heading.index).split('\n').length - 1
        sourceEditor.scrollTop = Math.max(0, lineNumber * 28 - sourceEditor.clientHeight / 3)
      } else editor?.scrollToHeading(heading.index)
    })
    fragment.append(button)
  }
  outlineList.replaceChildren(fragment)
}

function refreshDocumentState(): void {
  if (!currentDocument || !editor || applyingDocument) return
  const markdown = getCurrentText()
  const dirty = markdown !== originalText
  const status = t(!currentDocument.path ? 'unsaved' : dirty ? 'dirty' : 'saved')
  const name = !currentDocument.path && /^(?:未命名|Untitled)\.md$/i.test(currentDocument.name) ? t('untitled') : currentDocument.name
  documentName.textContent = name
  documentStatus.textContent = status
  documentStatus.classList.toggle('is-dirty', dirty || !currentDocument.path)
  element('save-indicator').textContent = status
  element('word-count').textContent = t('words', { count: (markdown.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length.toLocaleString(getLanguage()) })
  document.title = `${dirty ? '• ' : ''}${name} — ${t('appName')}`
  if (dirty !== lastDirty) {
    bridge.setDirty(dirty)
    lastDirty = dirty
  }
  updateOutline()
  scheduleTypewriter()
}

function applyDocument(info: DocumentInfo): void {
  currentDocument = info
  originalText = info.content
  // Resolve relative assets before Milkdown creates any image nodes.
  documentBase.href = info.baseUrl || initialBaseUrl
  setSourceText(info.content, true)
  synchronizeRichText(info.content, true)
  lastDirty = undefined
  refreshDocumentState()
  if (sourceMode) sourceEditor.focus()
  else editor?.focus()
}

async function fileAction(action: 'new' | 'open' | 'save' | 'saveAs'): Promise<void> {
  if (busy || !editor || settingsOpen()) return
  const currentText = getCurrentText()
  setBusy(true)
  hideNotice()
  try {
    const result = action === 'new' ? await bridge.newDocument(currentText)
      : action === 'open' ? await bridge.openDocument(currentText)
        : await bridge.saveDocument(currentText, action === 'saveAs')
    if (result.status === 'error') {
      if (result.document) applyDocument(result.document)
      showNotice(t('actionFailed', { action: t(action === 'open' ? 'open' : action === 'new' ? 'new' : 'save'), error: result.error }))
    } else if (result.status === 'ok') {
      if (action === 'new' || action === 'open') applyDocument(result.document)
      else {
        currentDocument = result.document
        originalText = result.document.content
        documentBase.href = result.document.baseUrl || initialBaseUrl
        const selection = { start: sourceEditor.selectionStart, end: sourceEditor.selectionEnd, scrollTop: sourceEditor.scrollTop }
        setSourceText(originalText)
        if (sourceMode) {
          sourceEditor.setSelectionRange(selection.start, selection.end)
          sourceEditor.scrollTop = selection.scrollTop
        }
        if (sourceMode || originalText !== currentText) synchronizeRichText(originalText)
        else {
          // Saving rich text must not replace its document or move the current selection.
          richAnchorText = originalText
          richAnchorBaseline = editor.getMarkdown()
        }
        savedRichBaseline = richAnchorBaseline
        lastDirty = undefined
        refreshDocumentState()
      }
    }
  } catch (error) { showNotice(t('documentFailed', { error: errorText(error) })) }
  finally {
    setBusy(false)
    if (sourceMode) sourceEditor.focus()
    else editor.focus()
  }
}

function toggleSource(): void {
  if (busy || !editor) return
  const markdown = getCurrentText()
  if (!sourceMode) setSourceText(markdown)
  else if (markdown !== getRichText()) synchronizeRichText(markdown)
  sourceMode = !sourceMode
  editorRoot.hidden = sourceMode
  sourceEditor.hidden = !sourceMode
  buttons.source.setAttribute('aria-pressed', String(sourceMode))
  element('mode-label').textContent = t(sourceMode ? 'markdownSource' : 'richMode')
  refreshDocumentState()
  if (sourceMode) sourceEditor.focus()
  else editor.focus()
}

function getRichText(): string {
  const normalized = editor?.getMarkdown() ?? ''
  if (normalized === richAnchorBaseline) return richAnchorText
  if (normalized === savedRichBaseline) return originalText
  return normalized
}

function toggleOutline(): void {
  if (busy) return
  outlineVisible = !outlineVisible
  document.body.classList.toggle('outline-hidden', !outlineVisible)
  buttons.outline.setAttribute('aria-pressed', String(outlineVisible))
}

function toggleFocus(): void {
  if (busy) return
  focusMode = !focusMode
  document.body.classList.toggle('focus-mode', focusMode)
  buttons.focus.setAttribute('aria-pressed', String(focusMode))
  updateFocusedBlock()
}

function toggleTypewriter(): void {
  if (busy || !editor) return
  typewriterMode = !typewriterMode
  document.body.classList.toggle('typewriter-mode', typewriterMode)
  buttons.typewriter.setAttribute('aria-pressed', String(typewriterMode))
  if (sourceMode) sourceEditor.focus()
  else editor.focus()
  scheduleTypewriter()
}

function updateFocusedBlock(): void {
  for (const block of editorRoot.querySelectorAll('.focus-current')) block.classList.remove('focus-current')
  if (!focusMode || sourceMode) return
  const selection = window.getSelection()
  let node = selection?.focusNode instanceof HTMLElement ? selection.focusNode : selection?.focusNode?.parentElement
  const body = editorRoot.querySelector('.ProseMirror')
  if (!node || !body?.contains(node)) return
  while (node.parentElement && node.parentElement !== body) node = node.parentElement
  node.classList.add('focus-current')
}

function scheduleTypewriter(): void {
  if (typewriterFrame) cancelAnimationFrame(typewriterFrame)
  typewriterFrame = requestAnimationFrame(() => {
    typewriterFrame = 0
    updateFocusedBlock()
    if (!typewriterMode || busy || settingsOpen()) return
    if (sourceMode && document.activeElement === sourceEditor) {
      // A mirror includes soft wrapping, tabs and padding when locating the source caret.
      const mirror = document.createElement('div')
      const style = getComputedStyle(sourceEditor)
      for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'tab-size', 'word-spacing']) mirror.style.setProperty(property, style.getPropertyValue(property))
      Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', width: `${sourceEditor.clientWidth}px`, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', boxSizing: 'border-box' })
      mirror.textContent = sourceEditor.value.slice(0, sourceEditor.selectionStart)
      const caret = document.createElement('span')
      caret.textContent = '\u200b'
      mirror.append(caret)
      document.body.append(mirror)
      sourceEditor.scrollTop = Math.max(0, caret.offsetTop - sourceEditor.clientHeight / 2 + 14)
      mirror.remove()
    } else if (!sourceMode && editorRoot.contains(document.activeElement)) {
      const selection = window.getSelection()
      if (!selection?.rangeCount || !editorRoot.contains(selection.focusNode)) return
      const range = selection.getRangeAt(0).cloneRange()
      range.collapse(false)
      let caret = range.getBoundingClientRect()
      if (!caret.height) caret = selection.focusNode?.parentElement?.getBoundingClientRect() ?? caret
      const viewport = editorRoot.getBoundingClientRect()
      if (caret.height) editorRoot.scrollTop += caret.top + caret.height / 2 - viewport.top - viewport.height / 2
    }
  })
}

function toggleTheme(): void {
  if (busy) return
  darkTheme = !darkTheme
  document.body.dataset.theme = darkTheme ? 'dark' : 'light'
  buttons.theme.setAttribute('aria-pressed', String(darkTheme))
  buttons.theme.querySelector('span')!.textContent = t(darkTheme ? 'light' : 'dark')
}

function synchronizeExportControls(): void {
  const pdf = element<HTMLSelectElement>('export-format').value === 'pdf'
  element('export-pdf-options').hidden = !pdf
  element('export-html-options').hidden = pdf
  element<HTMLInputElement>('export-margin').required = pdf
  for (const control of element('export-pdf-options').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) control.disabled = busy || !pdf
  for (const control of element('export-html-options').querySelectorAll<HTMLInputElement>('input')) control.disabled = busy || pdf
}

function updateExportOptions(): void {
  synchronizeExportControls()
  element('export-message').textContent = ''
}

function showExport(): void {
  if (busy || !editor || settingsOpen()) return
  updateExportOptions()
  exportDialog.showModal()
}

async function exportCurrentDocument(): Promise<void> {
  if (busy || !editor) return
  const form = element<HTMLFormElement>('export-form')
  if (!form.reportValidity()) return
  const format = element<HTMLSelectElement>('export-format').value === 'html' ? 'html' : 'pdf'
  const options: ExportOptions = {
    format,
    paper: element<HTMLSelectElement>('export-paper').value as ExportOptions['paper'],
    marginMm: Number(element<HTMLInputElement>('export-margin').value),
    landscape: element<HTMLInputElement>('export-landscape').checked,
    pageNumbers: format === 'pdf' && element<HTMLInputElement>('export-page-numbers').checked,
    includeStyles: format === 'pdf' || element<HTMLInputElement>('export-styles').checked,
    includeOutline: format === 'html' && element<HTMLInputElement>('export-outline').checked,
    appearance: darkTheme ? 'dark' : 'light',
    language: getLanguage(),
  }
  const markdown = getCurrentText()
  setBusy(true)
  element('export-message').textContent = t('preparingExport')
  try {
    const rendered = renderMarkdownForExport(markdown)
    const result = await bridge.exportDocument({ ...rendered, options })
    if (result.status === 'ok') {
      exportDialog.close()
      showNotice(t('exported', { path: result.path }))
    } else if (result.status === 'error') element('export-message').textContent = t('exportFailed', { error: result.error })
    else element('export-message').textContent = t('exportCancelled')
  } catch (error) { element('export-message').textContent = t('exportFailed', { error: errorText(error) }) }
  finally { setBusy(false) }
}

function applyThemeState(state: ThemeState): void {
  userThemeStyle.textContent = state.css
  element('theme-directory').textContent = state.directory
  element('theme-directory').removeAttribute('data-i18n')
  const defaults = document.createElement('option')
  defaults.value = ''
  defaults.textContent = t('defaultTheme')
  themeSelect.replaceChildren(defaults)
  for (const theme of state.themes) {
    const option = document.createElement('option')
    option.value = theme.id
    option.textContent = theme.name
    themeSelect.append(option)
  }
  themeSelect.value = state.activeId ?? ''
  ensureEditorBody()
}

async function themeAction(action: () => Promise<ThemeResult>, successMessage: string): Promise<void> {
  if (busy || !editor) return
  setBusy(true)
  element('theme-message').textContent = ''
  try {
    const result = await action()
    if (result.status === 'ok') {
      applyThemeState(result.theme)
      element('theme-message').textContent = successMessage
    } else if (result.status === 'error') element('theme-message').textContent = t('themeFailed', { error: result.error })
  } catch (error) { element('theme-message').textContent = t('themeFailed', { error: errorText(error) }) }
  finally { setBusy(false) }
}

async function showThemes(): Promise<void> {
  if (busy || !editor || settingsOpen()) return
  themeDialog.showModal()
  await themeAction(() => bridge.getThemeState(), '')
}

function refreshSearchResult(): void {
  element('find-result').textContent = lastReplacement !== undefined ? t('replaced', { count: lastReplacement })
    : !findQuery.value ? t('searchEmpty') : lastSearch?.total ? t('searchResults', lastSearch) : t('noMatches')
}

function showFind(replace = false): void {
  if (busy || !editor || settingsOpen()) return
  findPanel.hidden = false
  element('replace-fields').hidden = !replace
  refreshSearchResult()
  findQuery.focus()
  findQuery.select()
}

function closeFind(): void {
  findPanel.hidden = true
  if (sourceMode) sourceEditor.focus()
  else editor?.focus()
}

function findMatch(backwards = false): void {
  if (busy || !editor || settingsOpen()) return
  if (!findQuery.value) { showFind(); return }
  lastReplacement = undefined
  const active = document.activeElement
  lastSearch = sourceMode ? sourceCommands.find(findQuery.value, backwards) : editor.find(findQuery.value, backwards)
  refreshSearchResult()
  if (active instanceof HTMLElement && findPanel.contains(active)) active.focus()
  else if (sourceMode) sourceEditor.focus()
}

function replaceMatch(all = false): void {
  if (busy || !editor || settingsOpen() || !findQuery.value) return
  const active = document.activeElement
  lastReplacement = sourceMode ? sourceCommands.replace(findQuery.value, replaceText.value, all) : editor.replace(findQuery.value, replaceText.value, all)
  refreshSearchResult()
  refreshDocumentState()
  if (active instanceof HTMLElement && findPanel.contains(active)) active.focus()
}

const feedbackErrors: Record<FeedbackErrorCode, MessageKey> = {
  notConfigured: 'feedbackNotConfigured', invalidInput: 'feedbackInvalidInput', missingToken: 'feedbackMissingToken',
  unauthorized: 'feedbackUnauthorized', forbidden: 'feedbackForbidden', notFound: 'feedbackNotFound',
  rateLimited: 'feedbackRateLimited', network: 'feedbackNetwork', submissionUnknown: 'feedbackSubmissionUnknown', unexpected: 'feedbackUnexpected',
}

function validFeedbackFields(): boolean {
  const title = feedbackTitle.value.trim()
  const body = feedbackBody.value
  return (feedbackKind.value === 'bug' || feedbackKind.value === 'suggestion')
    && title.length > 0 && title.length <= 120 && !/[\u0000-\u001f\u007f]/.test(title)
    && body.trim().length > 0 && body.length <= 8000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)
}

function synchronizeFeedbackControls(): void {
  const configured = feedbackInfo?.configured === true
  const valid = validFeedbackFields() && feedbackCreatedNumber === undefined
  element<HTMLButtonElement>('feedback-submit').disabled = busy || !configured || !valid || !/^[\x21-\x7e]{1,1024}$/.test(feedbackToken.value.trim())
  element<HTMLButtonElement>('feedback-web').disabled = busy || !configured || !valid
  element<HTMLButtonElement>('feedback-repository').disabled = busy || !configured
  element<HTMLButtonElement>('feedback-issues').disabled = busy || !configured
  element<HTMLButtonElement>('feedback-view-issue').disabled = busy || !configured || feedbackCreatedNumber === undefined
  element<HTMLButtonElement>('feedback-token-help').disabled = busy || !feedbackInfo?.tokenHelpUrl
}

function refreshFeedbackUI(): void {
  element('feedback-version').textContent = feedbackInfo ? t('feedbackVersion', { version: feedbackInfo.version }) : ''
  element('feedback-configuration').textContent = !feedbackInfo ? (busy ? t('feedbackPreparing') : '') : feedbackInfo.configured ? '' : t('feedbackNotConfigured')
  element('feedback-repository-row').hidden = !feedbackInfo?.configured
  element('feedback-repository-url').textContent = feedbackInfo?.configured ? feedbackInfo.repositoryUrl : ''
  element('feedback-status').textContent = feedbackMessage ? t(feedbackMessage.key, feedbackMessage.values) : ''
  element('feedback-success').hidden = feedbackCreatedNumber === undefined
  element('feedback-view-issue').textContent = feedbackCreatedNumber === undefined ? '' : t('feedbackViewIssue', { number: feedbackCreatedNumber })
  synchronizeFeedbackControls()
}

function feedbackFailure(code: FeedbackErrorCode): void {
  feedbackMessage = { key: feedbackErrors[code] ?? 'feedbackUnexpected' }
}

function feedbackPayload(): FeedbackPayload {
  return { kind: feedbackKind.value as FeedbackKind, title: feedbackTitle.value.trim(), body: feedbackBody.value }
}

async function showFeedback(): Promise<void> {
  if (busy || !editor || settingsOpen()) return
  feedbackToken.value = ''
  feedbackInfo = undefined
  feedbackMessage = feedbackCreatedNumber === undefined ? undefined : { key: 'feedbackCreated', values: { number: feedbackCreatedNumber } }
  feedbackDialog.showModal()
  setBusy(true)
  refreshFeedbackUI()
  try { feedbackInfo = await bridge.getFeedbackInfo() }
  catch { feedbackFailure('unexpected') }
  finally { setBusy(false); refreshFeedbackUI() }
}

async function sendFeedback(web = false): Promise<void> {
  if (busy || !feedbackDialog.open || feedbackCreatedNumber !== undefined) return
  if (!feedbackInfo?.configured) { feedbackFailure('notConfigured'); refreshFeedbackUI(); return }
  if (!validFeedbackFields()) { feedbackFailure('invalidInput'); refreshFeedbackUI(); return }
  if (!web && !/^[\x21-\x7e]{1,1024}$/.test(feedbackToken.value.trim())) {
    feedbackFailure(feedbackToken.value.trim() ? 'invalidInput' : 'missingToken')
    refreshFeedbackUI()
    return
  }
  const payload = feedbackPayload()
  setBusy(true)
  feedbackMessage = { key: web ? 'feedbackOpeningWeb' : 'feedbackSubmitting' }
  refreshFeedbackUI()
  try {
    if (web) {
      // The browser opens a draft. The user still submits the Issue on GitHub.
      feedbackToken.value = ''
      const result = await bridge.openFeedbackWeb(payload)
      if (result.status === 'ok') feedbackMessage = { key: 'feedbackWebOpened' }
      else feedbackFailure(result.code)
    } else {
      // Do not retain the credential in renderer state or leave it in the input while awaiting the request.
      const request = bridge.submitFeedback({ ...payload, token: feedbackToken.value.trim() })
      feedbackToken.value = ''
      const result = await request
      if (result.status === 'ok' && Number.isSafeInteger(result.number) && result.number > 0) {
        feedbackCreatedNumber = result.number
        feedbackMessage = { key: 'feedbackCreated', values: { number: result.number } }
      } else feedbackFailure(result.status === 'error' ? result.code : 'unexpected')
    }
  } catch { feedbackFailure('unexpected') }
  finally {
    feedbackToken.value = ''
    setBusy(false)
    refreshFeedbackUI()
  }
}

async function openFeedbackLink(target: 'repository' | 'issues' | 'tokenHelp', issueNumber?: number): Promise<void> {
  if (busy || !feedbackDialog.open || !feedbackInfo || (target !== 'tokenHelp' && !feedbackInfo.configured)) return
  setBusy(true)
  feedbackMessage = { key: 'feedbackOpeningLink' }
  refreshFeedbackUI()
  try {
    const result = await bridge.openFeedbackLink(target, issueNumber)
    if (result.status === 'error') feedbackFailure(result.code)
    else feedbackMessage = feedbackCreatedNumber === undefined ? { key: 'feedbackLinkOpened' } : { key: 'feedbackCreated', values: { number: feedbackCreatedNumber } }
  } catch { feedbackFailure('unexpected') }
  finally {
    feedbackToken.value = ''
    setBusy(false)
    refreshFeedbackUI()
  }
}

function showLanguage(): void {
  if (busy || settingsOpen()) return
  element('language-close').hidden = languageRequired
  element('language-message').textContent = ''
  languageDialog.showModal()
  if (languageRequired) document.body.dataset.ready = 'language'
}

async function chooseLanguage(language: AppLanguage): Promise<void> {
  if (busy) return
  const content = editor ? getCurrentText() : undefined
  const sourceSelection = { start: sourceEditor.selectionStart, end: sourceEditor.selectionEnd, scroll: sourceEditor.scrollTop }
  const richScroll = editorRoot.scrollTop
  setBusy(true)
  element('language-message').textContent = ''
  try {
    const result = await bridge.setLanguage(language)
    if (result.status === 'error') { element('language-message').textContent = t('languageFailed', { error: result.error }); return }
    const changed = getLanguage() !== language
    setInterfaceLanguage(language)
    if (editor && content !== undefined && changed) {
      applyingDocument = true
      try {
        await editor.destroy()
        editor = await createMarkdownEditor(editorRoot, content, onEditorChange, language)
        ensureEditorBody()
        richAnchorText = content
        richAnchorBaseline = editor.getMarkdown()
        if (content === originalText) savedRichBaseline = richAnchorBaseline
        editorRoot.hidden = sourceMode
        sourceEditor.hidden = !sourceMode
        sourceEditor.setSelectionRange(sourceSelection.start, sourceSelection.end)
        sourceEditor.scrollTop = sourceSelection.scroll
        editorRoot.scrollTop = richScroll
      } finally { applyingDocument = false }
    }
    languageRequired = false
    refreshLanguage()
    // Previously displayed transient messages may be in the former language.
    hideNotice()
    element('export-message').textContent = ''
    element('theme-message').textContent = ''
    languageDialog.close()
    resolveInitialLanguage?.()
    resolveInitialLanguage = undefined
    if (editor) document.body.dataset.ready = 'true'
  } catch (error) { element('language-message').textContent = t('languageFailed', { error: errorText(error) }) }
  finally { setBusy(false) }
}

function onEditorChange(): void {
  if (!applyingDocument && !sourceMode) refreshDocumentState()
}

async function clipboardAction(copy: boolean): Promise<void> {
  if (busy || !editor || settingsOpen()) return
  const documentAtStart = currentDocument
  const modeAtStart = sourceMode
  try {
    if (copy) {
      const selection = sourceMode ? sourceEditor.value.slice(sourceEditor.selectionStart, sourceEditor.selectionEnd) : editor.getSelectionMarkdown()
      await bridge.writeClipboard(selection || getCurrentText())
    } else {
      const text = await bridge.readClipboard()
      if (busy || settingsOpen() || currentDocument !== documentAtStart || sourceMode !== modeAtStart) return
      if (sourceMode) sourceCommands.insert(text)
      else editor.insertText(text)
      refreshDocumentState()
    }
  } catch (error) { showNotice(t('clipboardFailed', { error: errorText(error) })) }
}

function handleCommand(command: AppCommand): void {
  if (busy || languageRequired || settingsOpen()) return
  if (command === 'new' || command === 'open' || command === 'save' || command === 'saveAs') void fileAction(command)
  else if (command === 'toggleSource') toggleSource()
  else if (command === 'toggleOutline') toggleOutline()
  else if (command === 'toggleFocus') toggleFocus()
  else if (command === 'toggleTypewriter') toggleTypewriter()
  else if (command === 'export') showExport()
  else if (command === 'showThemes') void showThemes()
  else if (command === 'showLanguage') showLanguage()
  else if (command === 'showFeedback') void showFeedback()
  else if (command === 'find' || command === 'replace') showFind(command === 'replace')
  else if (command === 'findNext' || command === 'findPrevious') findMatch(command === 'findPrevious')
  else if (command === 'copyMarkdown' || command === 'pastePlainText') void clipboardAction(command === 'copyMarkdown')
  else if (command.startsWith('edit:')) {
    const editCommand = command.slice(5) as EditorCommand
    if (sourceMode) sourceCommands.run(editCommand)
    else editor?.runCommand(editCommand)
    refreshDocumentState()
  }
}

buttons.new.addEventListener('click', () => { void fileAction('new') })
buttons.open.addEventListener('click', () => { void fileAction('open') })
buttons.save.addEventListener('click', () => { void fileAction('save') })
buttons.source.addEventListener('click', toggleSource)
buttons.outline.addEventListener('click', toggleOutline)
buttons.focus.addEventListener('click', toggleFocus)
buttons.typewriter.addEventListener('click', toggleTypewriter)
buttons.theme.addEventListener('click', toggleTheme)
buttons.export.addEventListener('click', showExport)
buttons.customTheme.addEventListener('click', () => { void showThemes() })
buttons.language.addEventListener('click', showLanguage)
buttons.find.addEventListener('click', () => showFind())
buttons.feedback.addEventListener('click', () => { void showFeedback() })
feedbackForm.addEventListener('submit', (event) => { event.preventDefault(); void sendFeedback() })
element('feedback-web').addEventListener('click', () => { void sendFeedback(true) })
element('feedback-repository').addEventListener('click', () => { void openFeedbackLink('repository') })
element('feedback-issues').addEventListener('click', () => { void openFeedbackLink('issues') })
element('feedback-token-help').addEventListener('click', () => { void openFeedbackLink('tokenHelp') })
element('feedback-view-issue').addEventListener('click', () => {
  if (feedbackCreatedNumber !== undefined) void openFeedbackLink('issues', feedbackCreatedNumber)
})
for (const field of [feedbackKind, feedbackTitle, feedbackBody]) field.addEventListener('input', () => {
  feedbackCreatedNumber = undefined
  feedbackMessage = undefined
  refreshFeedbackUI()
})
feedbackToken.addEventListener('input', synchronizeFeedbackControls)
feedbackDialog.addEventListener('close', () => { feedbackToken.value = ''; synchronizeFeedbackControls() })
feedbackDialog.addEventListener('cancel', () => { if (!busy) feedbackToken.value = '' })
element('language-zh').addEventListener('click', () => { void chooseLanguage('zh-CN') })
element('language-en').addEventListener('click', () => { void chooseLanguage('en-US') })
element('language-close').addEventListener('click', () => { if (!busy && !languageRequired) languageDialog.close() })
languageDialog.addEventListener('cancel', (event) => { if (busy || languageRequired) event.preventDefault() })
element('find-close').addEventListener('click', closeFind)
element('find-form').addEventListener('submit', (event) => { event.preventDefault(); findMatch() })
element('find-previous').addEventListener('click', () => findMatch(true))
element('replace-one').addEventListener('click', () => replaceMatch())
element('replace-all').addEventListener('click', () => replaceMatch(true))
findQuery.addEventListener('input', () => {
  lastSearch = undefined
  lastReplacement = undefined
  if (findQuery.value) findMatch()
  else refreshSearchResult()
})
element('export-format').addEventListener('change', updateExportOptions)
element('export-form').addEventListener('submit', (event) => { event.preventDefault(); void exportCurrentDocument() })
element('theme-import').addEventListener('click', () => { void themeAction(() => bridge.importTheme(), t('themeImported')) })
element('theme-refresh').addEventListener('click', () => { void themeAction(() => bridge.getThemeState(), t('themesRefreshed')) })
element('theme-apply').addEventListener('click', () => {
  const selectedId = themeSelect.value || null
  void themeAction(() => bridge.selectTheme(selectedId), t('themeApplied'))
})
element('theme-folder').addEventListener('click', () => {
  if (busy) return
  void bridge.openThemeDirectory().catch((error: unknown) => { element('theme-message').textContent = t('folderFailed', { error: errorText(error) }) })
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-close-dialog]')) {
  button.addEventListener('click', () => {
    if (!busy) {
      if (button.dataset.closeDialog === 'feedback-dialog') feedbackToken.value = ''
      element<HTMLDialogElement>(button.dataset.closeDialog!).close()
    }
  })
}
for (const dialog of [exportDialog, themeDialog, feedbackDialog]) {
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault() })
}
element('notice-dismiss').addEventListener('click', hideNotice)
sourceEditor.addEventListener('input', refreshDocumentState)
sourceEditor.addEventListener('click', scheduleTypewriter)
sourceEditor.addEventListener('keyup', scheduleTypewriter)
sourceEditor.addEventListener('keydown', (event) => {
  if (busy) return
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    const commands: Partial<Record<string, EditorCommand>> = { b: 'bold', i: 'italic', u: 'underline', z: 'undo', y: 'redo' }
    const command = commands[event.key.toLowerCase()]
    if (command) {
      event.preventDefault()
      sourceCommands.run(command)
      refreshDocumentState()
      return
    }
  }
  if (event.key !== 'Tab') return
  event.preventDefault()
  if (!event.shiftKey && sourceEditor.selectionStart === sourceEditor.selectionEnd) sourceCommands.insert('  ')
  else sourceCommands.run(event.shiftKey ? 'outdent' : 'indent')
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || settingsOpen()) return
  if (!findPanel.hidden) { event.preventDefault(); closeFind() }
  else if (focusMode) toggleFocus()
})
document.addEventListener('selectionchange', scheduleTypewriter)

async function initialize(): Promise<void> {
  refreshLanguage()
  if (!bridge) throw new Error(t('bridgeMissing'))
  const preferences = await bridge.getPreferences()
  if (preferences.language === 'zh-CN' || preferences.language === 'en-US') {
    languageRequired = false
    setInterfaceLanguage(preferences.language)
    refreshLanguage()
  } else await new Promise<void>((resolve) => { resolveInitialLanguage = resolve; showLanguage() })
  const result = await bridge.getInitialDocument()
  if (result.status === 'error') throw new Error(result.error)
  if (result.status !== 'ok') throw new Error(t('initializationCancelled'))
  documentBase.href = result.document.baseUrl || initialBaseUrl
  editor = await createMarkdownEditor(editorRoot, result.document.content, onEditorChange, getLanguage())
  ensureEditorBody()
  applyDocument(result.document)
  try {
    const themeResult = await bridge.getThemeState()
    if (themeResult.status === 'ok') applyThemeState(themeResult.theme)
    else if (themeResult.status === 'error') showNotice(t('themeReadFailed', { error: themeResult.error }))
  } catch (error) { showNotice(t('themeReadFailed', { error: errorText(error) })) }
  bridge.onCommand(handleCommand)
  bridge.onCloseRequested(() => {
    if (busy) { showNotice(t('waitClose')); return }
    void bridge.requestClose(getCurrentText()).catch((error: unknown) => showNotice(t('closeFailed', { error: errorText(error) })))
  })
  setBusy(false)
  document.body.dataset.ready = 'true'
}

void initialize().catch((error: unknown) => {
  editorRoot.hidden = true
  sourceEditor.hidden = true
  element('startup-error-message').textContent = errorText(error)
  element('startup-error').hidden = false
  documentStatus.textContent = t('startupFailed')
  document.body.dataset.ready = 'error'
})
