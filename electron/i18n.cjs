'use strict'

let language = 'zh-CN'
const english = {
  '字号必须是 14 至 24 的整数。': 'Font size must be a whole number from 14 to 24.',
  '反馈与建议…': 'Feedback and Suggestions…',
  '灵书 Markdown': 'Lingshu Markdown', '未命名.md': 'Untitled.md', '开始写作.md': 'Start writing.md',
  '无效的窗口请求。': 'Invalid window request.', '无效的页面来源。': 'Invalid page origin.',
  '文档内容必须是文本。': 'Document content must be text.',
  '导出内容无效或超过 48 MB。': 'Export content is invalid or exceeds 48 MB.',
  '导出设置无效。': 'Invalid export settings.', '导出大纲无效。': 'Invalid export outline.',
  '文档超过 16 MB，无法保存；仍可取消或选择不保存离开。': 'This document exceeds 16 MB and cannot be saved. You can still cancel or leave without saving.',
  '磁盘文件已变化': 'File changed on disk', '此文件已被其他程序修改、移动或删除。': 'Another application has modified, moved, or deleted this file.',
  '可以保留磁盘版本并另存为，也可以明确覆盖为当前编辑内容。': 'Save a separate copy to keep the disk version, or explicitly overwrite it with your current edits.',
  '另存为': 'Save As', '覆盖磁盘版本': 'Overwrite Disk Version', '取消': 'Cancel',
  '保存 Markdown 文档': 'Save Markdown Document', 'Markdown 文档': 'Markdown Documents',
  '保存修改': 'Save Changes', '要保存对「{name}」的修改吗？': 'Save changes to “{name}”?',
  '未保存的修改在离开文档后会丢失。': 'Unsaved changes will be lost when you leave this document.',
  '保存': 'Save', '不保存': 'Don’t Save', '文件操作正在进行，请稍候。': 'A file operation is in progress. Please wait.',
  '打开 Markdown 文档': 'Open Markdown Document', '导出 {format}': 'Export {format}',
  '导出文件不能覆盖正在编辑的 Markdown 文档。': 'The export cannot overwrite the Markdown document you are editing.',
  '导入 CSS 主题': 'Import CSS Theme', 'CSS 主题': 'CSS Themes', '请先完成当前文件操作。': 'Finish the current file operation first.',
  '文件': 'File', '新建': 'New', '打开…': 'Open…', '另存为…': 'Save As…', '导出…': 'Export…', '关闭': 'Close', '退出': 'Quit',
  '编辑': 'Edit', '撤销': 'Undo', '重做': 'Redo', '剪切': 'Cut', '复制': 'Copy', '粘贴': 'Paste', '全选': 'Select All',
  '复制为 Markdown': 'Copy as Markdown', '粘贴为纯文本': 'Paste as Plain Text',
  '选中当前行': 'Select Line', '选中当前词': 'Select Word', '删除当前词': 'Delete Word', '选中当前范围': 'Select Scope', '跳转到选区': 'Jump to Selection',
  '查找…': 'Find…', '替换…': 'Replace…', '查找下一个': 'Find Next', '查找上一个': 'Find Previous', '语言…': 'Language…',
  '段落': 'Paragraph', '标题 {level}': 'Heading {level}', '普通段落': 'Paragraph', '提升标题级别': 'Increase Heading Level', '降低标题级别': 'Decrease Heading Level',
  '表格': 'Table', '代码块': 'Code Block', '数学公式块': 'Math Block', '引用': 'Quote', '有序列表': 'Ordered List', '无序列表': 'Unordered List',
  '任务列表': 'Task List', '增加缩进': 'Indent', '减少缩进': 'Outdent', '分隔线': 'Horizontal Rule',
  '格式': 'Format', '加粗': 'Bold', '斜体': 'Italic', '下划线': 'Underline', '行内代码': 'Inline Code', '删除线': 'Strikethrough', '高亮': 'Highlight',
  '超链接': 'Link', '图片': 'Image', '清除格式': 'Clear Formatting',
  '视图': 'View', '源码模式': 'Source Code Mode', '侧栏': 'Sidebar', '文档大纲': 'Outline', '专注模式': 'Focus Mode', '打字机模式': 'Typewriter Mode',
  'CSS 主题…': 'CSS Themes…', '实际大小': 'Actual Size', '放大': 'Zoom In', '缩小': 'Zoom Out', '全屏': 'Full Screen',
  '帮助': 'Help', '关于灵书': 'About Lingshu',
  '独立实现的本地 Markdown 写作工具。\n编辑核心：Milkdown / Crepe（MIT）。\n不包含 Typora 的代码、素材或授权机制。': 'An independently built local Markdown writing app.\nEditor: Milkdown / Crepe (MIT).\nContains no Typora code, assets, or licensing mechanisms.',
  '无法打开文档': 'Cannot Open Document', '灵书未能启动': 'Lingshu Could Not Start',
  '请选择一个 Markdown 文件。': 'Choose a Markdown file.',
  '文件超过当前版本支持的 16 MB，请选择较小的文档。': 'This file exceeds the supported 16 MB limit. Choose a smaller document.',
  '此文件不是有效的 UTF-8 文本，请先将它另存为 UTF-8。': 'This file is not valid UTF-8 text. Save it as UTF-8 first.',
  '原文件路径已不再是普通文件。': 'The original path is no longer a regular file.', '文档超过当前版本支持的 16 MB。': 'The document exceeds the supported 16 MB limit.',
  '主题 CSS 必须是普通文件：{name}': 'Theme CSS must be a regular file: {name}', '主题 CSS 超过 1 MB：{name}': 'Theme CSS exceeds 1 MB: {name}',
  '主题 CSS 无法读取或超过 1 MB：{name}': 'Theme CSS cannot be read or exceeds 1 MB: {name}',
  '主题资源路径超出目录': 'A theme resource path leaves its directory.', '主题资源不能包含符号链接或目录外路径': 'Theme resources cannot contain symbolic links or paths outside their directory.',
  '主题资源只能包含普通文件和目录': 'Theme resources can contain only regular files and directories.', '需要主题目录': 'A theme directory is required.',
  '主题目录必须是普通目录': 'The theme directory must be a regular directory.', '主题设置文件无效': 'The theme settings file is invalid.',
  '请选择 .css 主题文件': 'Choose a .css theme file.', '主题文件需要有效的文件名，以限制同名资源目录范围': 'The theme needs a valid filename to constrain its matching resource directory.',
  '同名主题资源必须是普通目录': 'The matching theme resource folder must be a regular directory.', '目标主题路径无效': 'Invalid destination theme path.',
  '主题资源路径无效': 'Invalid theme resource path.', '主题资源在导入期间发生变化': 'A theme resource changed during import.',
  '导入后的主题 CSS 超过 1 MB': 'The imported theme CSS exceeds 1 MB.', '主题目录尚未初始化': 'The theme directory has not been initialized.',
  '请选择当前主题目录中的有效主题': 'Choose a valid theme from the current theme directory.',
  '导出选项格式不正确。': 'Invalid export options.', 'KaTeX 样式包含不支持的字体资源地址。': 'The KaTeX stylesheet contains an unsupported font URL.',
  '导出文档的资源基址必须是本地文件 URL。': 'The export resource base must be a local file URL.',
  '导出公式的 HTML 结构不完整。': 'The exported formula has incomplete HTML.', '无样式导出需要有效的 MathML 公式。': 'Exporting without styles requires valid MathML formulas.',
  '导出文档数据格式不正确。': 'Invalid export document data.', '导出正文包含不允许的活动内容。': 'The export contains disallowed active content.',
  '文章大纲': 'Document Outline', '目录': 'Contents', '导出临时文件超出了当前任务临时目录。': 'The export temporary file is outside its dedicated directory.',
  '导出文件内容或目标路径不正确。': 'Invalid export content or destination path.', 'PDF 导出窗口或临时目录不正确。': 'Invalid PDF export window or temporary directory.',
  '导出资源在 30 秒内未加载完成，请检查图片或字体路径及网络连接。': 'Export resources did not finish loading within 30 seconds. Check image and font paths and your network connection.',
  '图片无法加载：': 'Image could not load: ', '导出资源加载失败：': 'Export resources could not load: ', '未知资源错误': 'Unknown resource error',
  'PDF 引擎没有返回有效文件。': 'The PDF engine did not return a valid file.', '导出临时目录发生变化，已停止清理。': 'The export temporary directory changed. Cleanup was stopped.',
  'PDF 导出或临时资源清理失败。': 'PDF export or temporary resource cleanup failed.',
  '语言设置无效。': 'Invalid language setting.', '设置文件损坏或格式无效，请检查应用数据目录中的 settings.json。': 'The settings file is damaged or invalid. Check settings.json in the application data directory.',
  '剪贴板内容必须是文本且不能超过 16 MB。': 'Clipboard content must be text and must not exceed 16 MB.',
}

function isLanguage(value) { return value === 'zh-CN' || value === 'en-US' }
function setLanguage(value) {
  if (!isLanguage(value)) throw new TypeError(t('语言设置无效。'))
  language = value
}
function getLanguage() { return language }
function t(key, values = {}, locale = language) {
  const template = locale === 'en-US' ? (english[key] || key) : key
  return template.replace(/\{([A-Za-z]+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match)
}

module.exports = { t, isLanguage, setLanguage, getLanguage }
