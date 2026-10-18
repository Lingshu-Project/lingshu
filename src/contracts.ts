export interface DocumentInfo {
  path: string | null
  name: string
  content: string
  baseUrl: string
}

export type DocumentResult =
  | { status: 'ok'; document: DocumentInfo }
  | { status: 'cancelled' }
  | { status: 'error'; error: string; document?: DocumentInfo }

export interface ExportOptions {
  language?: 'zh-CN' | 'en-US'
  format: 'pdf' | 'html'
  paper: 'A4' | 'A5' | 'Letter'
  marginMm: number
  landscape: boolean
  pageNumbers: boolean
  includeStyles: boolean
  includeOutline: boolean
  appearance: 'light' | 'dark'
}
export interface ExportHeading { id: string; level: number; text: string }
export interface ExportRequest { contentHtml: string; outline: ExportHeading[]; options: ExportOptions }
export type ExportResult = { status: 'ok'; path: string } | { status: 'cancelled' } | { status: 'error'; error: string }
export interface ThemeState { directory: string; activeId: string | null; themes: { id: string; name: string }[]; css: string }
export type ThemeResult = { status: 'ok'; theme: ThemeState } | { status: 'cancelled' } | { status: 'error'; error: string }

export type AppLanguage = 'zh-CN' | 'en-US'
export interface AppPreferences { language: AppLanguage | null }
export type FeedbackKind = 'bug' | 'suggestion'
export type FeedbackErrorCode = 'notConfigured' | 'invalidInput' | 'missingToken' | 'unauthorized' | 'forbidden' | 'notFound' | 'rateLimited' | 'network' | 'submissionUnknown' | 'unexpected'
export interface FeedbackPayload { kind: FeedbackKind; title: string; body: string }
export interface FeedbackInfo { configured: boolean; repositoryUrl: string; issuesUrl: string; tokenHelpUrl: string; version: string }
export type FeedbackActionResult = { status: 'ok' } | { status: 'error'; code: FeedbackErrorCode }
export type FeedbackSubmitResult = { status: 'ok'; number: number; url: string } | { status: 'error'; code: FeedbackErrorCode }
export type EditorCommand = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6'
  | 'headingIncrease' | 'headingDecrease' | 'bold' | 'italic' | 'underline' | 'strike' | 'inlineCode' | 'highlight'
  | 'link' | 'image' | 'clearFormat' | 'quote' | 'orderedList' | 'bulletList' | 'taskList' | 'indent' | 'outdent'
  | 'codeBlock' | 'mathBlock' | 'table' | 'horizontalRule' | 'undo' | 'redo' | 'selectLine' | 'selectWord' | 'deleteWord' | 'selectScope' | 'jumpSelection'
export type AppCommand = 'new' | 'open' | 'save' | 'saveAs' | 'toggleSource' | 'toggleOutline' | 'toggleFocus' | 'toggleTypewriter'
  | 'export' | 'showThemes' | 'showLanguage' | 'showFeedback' | 'find' | 'replace' | 'findNext' | 'findPrevious' | 'copyMarkdown' | 'pastePlainText'
  | `edit:${EditorCommand}`

export interface InkstoneBridge {
  getPreferences(): Promise<AppPreferences>
  setLanguage(language: AppLanguage): Promise<{status: 'ok'} | {status:'error';error:string}>
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<void>
  getInitialDocument(): Promise<DocumentResult>
  newDocument(currentContent: string): Promise<DocumentResult>
  openDocument(currentContent: string): Promise<DocumentResult>
  saveDocument(content: string, saveAs?: boolean): Promise<DocumentResult>
  setDirty(dirty: boolean): void
  requestClose(currentContent: string): Promise<void>
  onCloseRequested(listener: () => void): () => void
  onCommand(listener: (command: AppCommand) => void): () => void
  exportDocument(request: ExportRequest): Promise<ExportResult>
  getThemeState(): Promise<ThemeResult>
  selectTheme(id: string | null): Promise<ThemeResult>
  importTheme(): Promise<ThemeResult>
  openThemeDirectory(): Promise<void>
  getFeedbackInfo(): Promise<FeedbackInfo>
  submitFeedback(payload: FeedbackPayload & { token: string }): Promise<FeedbackSubmitResult>
  openFeedbackWeb(payload: FeedbackPayload): Promise<FeedbackActionResult>
  openFeedbackLink(target: 'repository' | 'issues' | 'tokenHelp', issueNumber?: number): Promise<FeedbackActionResult>
}

export interface OutlineHeading { level: number; text: string; index: number }

export interface MarkdownEditor {
  getMarkdown(): string
  setMarkdown(markdown: string, resetHistory?: boolean): void
  focus(): void
  getOutline(): OutlineHeading[]
  scrollToHeading(index: number): void
  runCommand(command: EditorCommand): boolean
  getSelectionMarkdown(): string
  insertText(text: string): void
  find(query: string, backwards?: boolean): {current:number;total:number}
  replace(query: string, replacement: string, all?: boolean): number
  destroy(): Promise<void>
}

declare global {
  interface Window { inkstone: InkstoneBridge }
}
