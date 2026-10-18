import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdownForExport } from '../src/export-content.ts'

test('真实渲染：高亮、受限下划线、任务列表与公式', () => {
  const { contentHtml } = renderMarkdownForExport('==重点== 与 <u>下划线 **加粗**</u>\n\n- [x] 已完成\n- [ ] 待办\n\n$E=mc^2$\n\n$$\n\\frac{a}{b}\n$$')
  assert.match(contentHtml, /<mark>重点<\/mark>/)
  assert.match(contentHtml, /<u>下划线 <strong>加粗<\/strong><\/u>/)
  assert.match(contentHtml, /task-checkbox">☑/)
  assert.match(contentHtml, /task-checkbox">☐/)
  assert.match(contentHtml, /katex/)
  assert.match(contentHtml, /katex-display/)
  assert.doesNotMatch(contentHtml, /<input\b/)
})

test('真实语法高亮：完整代码、未知语言与HTML不执行', () => {
  const script = '<script>alert(1)</script>'
  const result = renderMarkdownForExport('```js\nconst value = "test";\n' + Array.from({length: 100}, (_, i) => `// line ${i}`).join('\n') + '\n```\n\n```unknown-language\n' + script + '\n```\n\n<img src=x onerror=alert(1)>')
  assert.match(result.contentHtml, /hljs-keyword/)
  assert.match(result.contentHtml, /line 99/)
  assert.match(result.contentHtml, /&lt;script&gt;/)
  assert.doesNotMatch(result.contentHtml, /<script\b|<img\b/)
  assert.match(renderMarkdownForExport('- \\[x] 普通文字').contentHtml, /\[x\]/)
  assert.doesNotMatch(renderMarkdownForExport('- \\[x] 普通文字').contentHtml, /task-checkbox/)
})
