import { Crepe, type CrepeConfig } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { LanguageDescription } from '@codemirror/language'
import { languages as supportedCodeLanguages } from '@codemirror/language-data'
import type { AppLanguage } from './contracts'
import { highlightSchema, underlineSchema } from './editor-extensions'

export function editorFeatureConfigs(language: AppLanguage): CrepeConfig['featureConfigs'] {
  const zh = language === 'zh-CN'
  const t = (cn: string, en: string) => zh ? cn : en
  const labeledIcon = (label: string, icon: string) => `<span title="${label}" aria-label="${label}">${icon}</span>`
  return {
    [Crepe.Feature.Placeholder]: { text: t('开始书写，支持 Markdown…', 'Start writing with Markdown…'), mode: 'doc' },
    [Crepe.Feature.BlockEdit]: {
      textGroup: {
        label: t('文本', 'Text'), text: { label: t('正文', 'Paragraph') },
        h1: { label: t('一级标题', 'Heading 1') }, h2: { label: t('二级标题', 'Heading 2') },
        h3: { label: t('三级标题', 'Heading 3') }, h4: { label: t('四级标题', 'Heading 4') },
        h5: { label: t('五级标题', 'Heading 5') }, h6: { label: t('六级标题', 'Heading 6') },
        quote: { label: t('引用', 'Quote') }, divider: { label: t('分隔线', 'Divider') },
      },
      listGroup: { label: t('列表', 'List'), bulletList: { label: t('无序列表', 'Bullet List') }, orderedList: { label: t('有序列表', 'Ordered List') }, taskList: { label: t('任务列表', 'Task List') } },
      advancedGroup: { label: t('高级', 'Advanced'), image: { label: t('图片', 'Image') }, codeBlock: { label: t('代码块', 'Code') }, table: { label: t('表格', 'Table') }, math: { label: t('数学公式', 'Math') } },
    },
    [Crepe.Feature.Toolbar]: {
      boldLabel: t('加粗', 'Bold'), italicLabel: t('斜体', 'Italic'), strikethroughLabel: t('删除线', 'Strikethrough'),
      codeLabel: t('行内代码', 'Inline code'), linkLabel: t('链接', 'Link'), latexLabel: t('行内公式', 'Inline math'), aiLabel: t('询问 AI', 'Ask AI'),
      buildToolbar(builder) {
        builder.getGroup('formatting').group.label = t('格式', 'Formatting')
        builder.getGroup('function').group.label = t('插入', 'Insert')
        for (const [key, schema, icon, label] of [
          ['underline', underlineSchema, '<u>U</u>', t('下划线', 'Underline')],
          ['highlight', highlightSchema, '<mark>H</mark>', t('高亮', 'Highlight')],
        ] as const) {
          builder.getGroup('formatting').addItem(key, { icon, label,
            active: (ctx) => { const { state } = ctx.get(editorViewCtx); return state.doc.rangeHasMark(state.selection.from, state.selection.to, schema.type(ctx)) },
            onRun: (ctx) => { const view = ctx.get(editorViewCtx); toggleMark(schema.type(ctx))(view.state, view.dispatch, view) },
          })
        }
      },
    },
    [Crepe.Feature.LinkTooltip]: {
      inputPlaceholder: t('粘贴或输入链接…', 'Paste or enter a link…'),
      linkIcon: t('复制链接', 'Copy link'), editButton: t('编辑', 'Edit'), removeButton: t('移除', 'Remove'), confirmButton: t('确认 ↵', 'Confirm ↵'),
      onCopyLink: (text) => { void window.inkstone.writeClipboard(text) },
    },
    [Crepe.Feature.Latex]: { inlineEditConfirm: t('确认 ↵', 'Confirm ↵'), katexOptions: { trust: false, throwOnError: false } },
    [Crepe.Feature.CodeMirror]: {
      searchPlaceholder: t('搜索代码语言', 'Search language'), noResultText: t('没有匹配的语言', 'No matching languages'), copyText: t('复制', 'Copy'),
      previewToggleText: (previewOnly) => previewOnly ? t('编辑', 'Edit') : t('隐藏', 'Hide'),
      previewLabel: t('预览', 'Preview'), previewLoading: t('加载中…', 'Loading…'),
      renderLanguage: (value) => value === 'Text' ? t('纯文本', 'Text') : value,
      languages: [
        ...supportedCodeLanguages,
        LanguageDescription.of({ name: 'LaTeX', alias: ['latex', 'tex'], load: async () => { const { StreamLanguage, LanguageSupport } = await import('@codemirror/language'); return new LanguageSupport(StreamLanguage.define((await import('@codemirror/legacy-modes/mode/stex')).stex)) } }),
      ],
      // LaTeX's own renderer augments this callback. Other code remains text.
      renderPreview: () => null,
    },
    [Crepe.Feature.Table]: {
      addRowIcon: labeledIcon(t('添加行', 'Add row'), '+'), addColIcon: labeledIcon(t('添加列', 'Add column'), '+'),
      deleteRowIcon: labeledIcon(t('删除行', 'Delete row'), '−'), deleteColIcon: labeledIcon(t('删除列', 'Delete column'), '−'),
      alignLeftIcon: labeledIcon(t('左对齐', 'Align left'), '⇤'), alignCenterIcon: labeledIcon(t('居中对齐', 'Align center'), '↔'), alignRightIcon: labeledIcon(t('右对齐', 'Align right'), '⇥'),
      colDragHandleIcon: labeledIcon(t('移动列', 'Move column'), '⠿'), rowDragHandleIcon: labeledIcon(t('移动行', 'Move row'), '⠿'),
    },
  }
}

// 7.22.3 hard-codes the empty language button's `Text` label. Patch only that
// known component text node, never editor content or global page strings.
export function localizeGeneratedControls(root: HTMLElement, language: AppLanguage) {
  const update = () => {
    root.querySelectorAll<HTMLButtonElement>('.milkdown-code-block .language-button').forEach((button) => {
      const text = Array.from(button.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)
      if (text?.textContent?.trim() === 'Text' && language === 'zh-CN') text.textContent = '纯文本'
      button.setAttribute('aria-label', language === 'zh-CN' ? '代码语言' : 'Code language')
    })
  }
  update()
  const observer = new MutationObserver(update)
  observer.observe(root, { subtree: true, childList: true, characterData: true })
  return () => observer.disconnect()
}
