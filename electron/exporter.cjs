'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { t, getLanguage, isLanguage } = require('./i18n.cjs')

const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const safeStyle = (css) => css.replace(/</g, '\\3c ')

function validateOptions(options) {
  if (!options || !['html', 'pdf'].includes(options.format)
    || (options.language !== undefined && !isLanguage(options.language))
    || !['A4', 'A5', 'Letter'].includes(options.paper)
    || !['light', 'dark'].includes(options.appearance)
    || !Number.isFinite(options.marginMm) || options.marginMm < 0 || options.marginMm > 50
    || ['landscape', 'pageNumbers', 'includeStyles', 'includeOutline'].some((key) => typeof options[key] !== 'boolean')) {
    throw new TypeError(t('导出选项格式不正确。'))
  }
}

async function loadKatexCss() {
  const directory = path.join(__dirname, 'export-assets/katex')
  const css = await fs.readFile(path.join(directory, 'katex.min.css'), 'utf8')
  const urlPattern = /url\(\s*(["']?)([^)"']+)\1\s*\)/g
  const urls = [...new Set(Array.from(css.matchAll(urlPattern), (match) => match[2].trim()))]
  const embedded = new Map()
  await Promise.all(urls.map(async (url) => {
    if (!/^(?:\.\/)?fonts\/[a-z0-9_-]+\.(?:woff2?|ttf|otf)$/i.test(url)) {
      throw new Error(t('KaTeX 样式包含不支持的字体资源地址。'))
    }
    const extension = path.extname(url).slice(1).toLowerCase()
    const mime = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' }[extension]
    const font = await fs.readFile(path.join(directory, url))
    embedded.set(url, `data:${mime};base64,${font.toString('base64')}`)
  }))
  return css.replace(urlPattern, (_match, _quote, url) => `url("${embedded.get(url.trim())}")`)
}

function decodeAttribute(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, code) => {
    if (code[0] === '#') {
      const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[code.toLowerCase()]
  })
}

function resolveDocumentResources(contentHtml, baseUrl) {
  if (!baseUrl) return contentHtml
  const base = new URL(baseUrl)
  if (base.protocol !== 'file:') throw new TypeError(t('导出文档的资源基址必须是本地文件 URL。'))
  // 不使用 <base>，保证目录中的 #heading 链接仍指向当前导出文件。
  return contentHtml.replace(/<(?:img|a)\b[^>]*>/gi, (tag) => tag.replace(/\b(src|href)=(["'])(.*?)\2/gi,
    (attribute, name, _quote, encodedValue) => {
      const value = decodeAttribute(encodedValue)
      if (!value || value.startsWith('#')) return attribute
      return `${name}="${escapeHtml(new URL(value, base).href)}"`
    }))
}

function mathmlWithoutStyles(contentHtml) {
  // KaTeX 的 HTML 与 MathML 双输出中，仅保留语义 MathML，避免无样式时出现重复公式。
  const opening = /<span\b[^>]*\bclass="katex(?:-display)?"[^>]*>/g
  let result = ''
  let cursor = 0
  let match
  while ((match = opening.exec(contentHtml))) {
    const spans = /<\/?span\b[^>]*>/g
    spans.lastIndex = opening.lastIndex
    let depth = 1
    let span
    while (depth > 0 && (span = spans.exec(contentHtml))) depth += span[0].startsWith('</') ? -1 : 1
    if (depth !== 0) throw new TypeError(t('导出公式的 HTML 结构不完整。'))
    const formula = contentHtml.slice(match.index, spans.lastIndex)
    const mathml = formula.match(/<math\b[\s\S]*?<\/math>/i)?.[0]
    if (!mathml) throw new TypeError(t('无样式导出需要有效的 MathML 公式。'))
    result += contentHtml.slice(cursor, match.index) + mathml
    cursor = spans.lastIndex
    opening.lastIndex = cursor
  }
  return result + contentHtml.slice(cursor)
}

function baseCss(appearance) {
  const dark = appearance === 'dark'
  return `:root{color-scheme:${appearance};--ink-bg:${dark ? '#202124' : '#fff'};--ink-fg:${dark ? '#e8eaed' : '#242424'};--ink-border:${dark ? '#55585c' : '#d9dce1'};--ink-muted:${dark ? '#303236' : '#f4f5f7'}}
body{margin:0;background:var(--ink-bg);color:var(--ink-fg);font:16px/1.75 'Segoe UI','Microsoft YaHei UI','Microsoft YaHei',system-ui,sans-serif;overflow-wrap:anywhere}
#write,.export-outline{max-width:850px;margin:40px auto;padding:0 28px}
h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.6em 0 .65em}h1{font-size:2em}h2{font-size:1.55em}h3{font-size:1.25em}
p,ul,ol,blockquote,pre,table{margin:1em 0}a{color:${dark ? '#9ac8ff' : '#235eae'}}
blockquote{margin-left:0;padding:.1em 1.2em;border-left:4px solid var(--ink-border);color:${dark ? '#b7bbc1' : '#62676e'}}
code,pre{font-family:Consolas,'Cascadia Code','Courier New',monospace}code{padding:.12em .3em;border-radius:3px;background:var(--ink-muted);font-size:.9em}
pre{padding:16px 20px;border-radius:8px;background:var(--ink-muted);white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4}pre code{padding:0;background:none;font-size:.9em}
mark{background:${dark ? '#66511b' : '#fff0a6'};color:var(--ink-fg);padding:.08em .15em;border-radius:2px}u{text-underline-offset:.15em}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-built_in{color:${dark ? '#d6a5f5' : '#7b268f'}}.hljs-string,.hljs-attr,.hljs-template-tag{color:${dark ? '#a5d6a7' : '#23692c'}}.hljs-comment,.hljs-quote{color:${dark ? '#a3aab2' : '#64707d'};font-style:italic}.hljs-number,.hljs-symbol,.hljs-bullet{color:${dark ? '#f0b87b' : '#9c4d0b'}}.hljs-title,.hljs-section,.hljs-name{color:${dark ? '#8fc6f4' : '#185b9b'}}.hljs-variable,.hljs-template-variable,.hljs-params{color:var(--ink-fg)}.task-checkbox{display:inline-block;margin-right:.45em}
table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--ink-border);padding:8px 12px;text-align:left}th{background:var(--ink-muted)}
img{max-width:100%;height:auto}hr{border:0;border-top:1px solid var(--ink-border);margin:2em 0}
.katex-display{overflow-x:auto;overflow-y:hidden}.export-outline{border-bottom:1px solid var(--ink-border);padding-bottom:24px}.export-outline ol{list-style:none;padding:0}.export-outline li{margin:.25em 0}.export-outline .outline-level-2{padding-left:1em}.export-outline .outline-level-3{padding-left:2em}.export-outline .outline-level-4{padding-left:3em}.export-outline .outline-level-5{padding-left:4em}.export-outline .outline-level-6{padding-left:5em}
@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}#write,.export-outline{max-width:none;margin:0;padding:0}.export-outline{padding-bottom:16px;margin-bottom:24px}h1,h2,h3,h4,h5,h6{break-after:avoid-page}thead{display:table-header-group}tr,img{break-inside:avoid}pre{white-space:pre-wrap;overflow:visible}}
`
}

function buildExportHtml({ title, baseUrl, contentHtml, outline, options, themeCss, katexCss }) {
  validateOptions(options)
  if ([title, baseUrl, contentHtml, themeCss, katexCss].some((value) => typeof value !== 'string') || !Array.isArray(outline)
    || outline.some((heading) => !heading || typeof heading.id !== 'string' || typeof heading.text !== 'string'
      || !Number.isInteger(heading.level) || heading.level < 1 || heading.level > 6)) {
    throw new TypeError(t('导出文档数据格式不正确。'))
  }
  if (/<\/?(?:script|iframe|frame|object|embed|form|input|button|textarea|select|base|meta|link|style)\b/i.test(contentHtml)) {
    throw new TypeError(t('导出正文包含不允许的活动内容。'))
  }

  let content = options.includeStyles ? contentHtml : mathmlWithoutStyles(contentHtml)
  const language = options.language || getLanguage()
  content = resolveDocumentResources(content, baseUrl)
  const outlineHtml = options.includeOutline && outline.length > 0
    ? `<nav class="export-outline" aria-label="${t('文章大纲', {}, language)}"><h2>${t('目录', {}, language)}</h2><ol>${outline.map((heading) =>
      `<li class="outline-level-${heading.level}"><a href="#${escapeHtml(encodeURIComponent(heading.id))}">${escapeHtml(heading.text)}</a></li>`).join('')}</ol></nav>`
    : ''
  const styles = options.includeStyles
    ? `<style>${safeStyle(baseCss(options.appearance))}</style>\n<style>${safeStyle(katexCss)}</style>\n<style>${safeStyle(themeCss)}</style>`
    : ''
  const printPage = options.format === 'pdf'
    ? `<style>@page{size:${options.paper} ${options.landscape ? 'landscape' : 'portrait'};margin:${options.marginMm}mm}</style>`
    : ''
  const policy = "default-src 'none'; script-src 'none'; script-src-attr 'none'; style-src 'unsafe-inline' file: data:; img-src file: data: https: http:; font-src file: data:; connect-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'"
  return `<!doctype html>\n<html lang="${language}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>\n${styles}\n${printPage}</head><body data-appearance="${options.appearance}">${outlineHtml}<article id="write" class="markdown-body">${content}</article></body></html>`
}

function assertWithin(directory, filename) {
  const relative = path.relative(directory, filename)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(t('导出临时文件超出了当前任务临时目录。'))
  }
}

async function writeExport({ BrowserWindow, html, targetPath, options, temporaryDirectory }) {
  validateOptions(options)
  if (typeof html !== 'string' || typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) {
    throw new TypeError(t('导出文件内容或目标路径不正确。'))
  }
  if (options.format === 'html') {
    await fs.writeFile(targetPath, html, 'utf8')
    return
  }
  if (typeof BrowserWindow !== 'function' || typeof temporaryDirectory !== 'string' || !path.isAbsolute(temporaryDirectory)) {
    throw new TypeError(t('PDF 导出窗口或临时目录不正确。'))
  }

  await fs.mkdir(temporaryDirectory, { recursive: true })
  const temporaryRoot = await fs.realpath(temporaryDirectory)
  const temporaryFile = path.join(temporaryRoot, `inkstone-export-${randomUUID()}.html`)
  assertWithin(temporaryRoot, temporaryFile)
  let ownsFile = false
  let window
  let failure
  const cleanupErrors = []
  async function resourceDeadline(operation) {
    let timer
    try {
      return await Promise.race([operation, new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(t('导出资源在 30 秒内未加载完成，请检查图片或字体路径及网络连接。'))), 30000)
      })])
    } finally { clearTimeout(timer) }
  }
  try {
    const handle = await fs.open(temporaryFile, 'wx')
    ownsFile = true
    try { await handle.writeFile(html, 'utf8') } finally { await handle.close() }
    window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 850,
      webPreferences: {
        javascript: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        backgroundThrottling: false,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    await resourceDeadline(window.loadFile(temporaryFile))
    // 固定的应用代码只等待排版资源，不插入文档文本，也不启用页面脚本。
    const resources = await resourceDeadline(window.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(async () => { try {
      await document.fonts.ready;
      await Promise.all(Array.from(document.fonts, face => face.load()));
      await Promise.all(Array.from(document.images).map(async image => {
        try { await image.decode(); }
        catch { throw new Error(${JSON.stringify(t('图片无法加载：'))} + image.getAttribute('src')); }
      }));
      return {ok:true};
    } catch(error) { return {ok:false,error:String(error.message || error)}; } })()` }]))
    if (!resources?.ok) throw new Error(t('导出资源加载失败：') + (resources?.error || t('未知资源错误')))
    const marginInches = options.marginMm / 25.4
    const pdf = await window.webContents.printToPDF({
      pageSize: options.paper,
      landscape: options.landscape,
      margins: { top: marginInches, bottom: marginInches, left: marginInches, right: marginInches },
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: options.pageNumbers,
      headerTemplate: '<span></span>',
      footerTemplate: options.pageNumbers
        ? '<div style="width:100%;text-align:center;font:9px sans-serif;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
        : '<span></span>',
    })
    if (!Buffer.isBuffer(pdf) || pdf.length === 0) throw new Error(t('PDF 引擎没有返回有效文件。'))
    await fs.writeFile(targetPath, pdf)
  } catch (error) {
    failure = error
  } finally {
    try { if (window && !window.isDestroyed()) window.destroy() } catch (error) { cleanupErrors.push(error) }
    if (ownsFile) {
      try {
        assertWithin(temporaryRoot, temporaryFile)
        if (await fs.realpath(path.dirname(temporaryFile)) !== temporaryRoot) throw new Error(t('导出临时目录发生变化，已停止清理。'))
        await fs.unlink(temporaryFile)
      } catch (error) { if (error.code !== 'ENOENT') cleanupErrors.push(error) }
    }
  }
  if (failure && cleanupErrors.length === 0) throw failure
  if (failure || cleanupErrors.length > 0) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], t('PDF 导出或临时资源清理失败。'))
}

module.exports = { loadKatexCss, buildExportHtml, writeExport }
