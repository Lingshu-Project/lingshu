'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')

async function prepareExportAssets() {
  // 与导出插件解析的 KaTeX 保持同版，避免顶层其他编辑依赖使用不同版本。
  const pluginRequire = createRequire(require.resolve('@mdit/plugin-katex'))
  const cssPath = pluginRequire.resolve('katex/dist/katex.min.css')
  const packageRoot = path.dirname(pluginRequire.resolve('katex/package.json'))
  const sourceFonts = path.join(path.dirname(cssPath), 'fonts')
  const destination = path.resolve(__dirname, '../electron/export-assets/katex')
  const destinationFonts = path.join(destination, 'fonts')
  await fs.mkdir(destinationFonts, { recursive: true })

  const fonts = (await fs.readdir(sourceFonts, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:woff2?|ttf|otf)$/i.test(entry.name))
  if (fonts.length === 0) throw new Error('KaTeX 字体目录为空，无法准备离线导出资源。')

  await Promise.all([
    fs.copyFile(cssPath, path.join(destination, 'katex.min.css')),
    fs.copyFile(path.join(packageRoot, 'LICENSE'), path.join(destination, 'LICENSE')),
    ...fonts.map((entry) => fs.copyFile(path.join(sourceFonts, entry.name), path.join(destinationFonts, entry.name))),
  ])
  return { destination, fontFiles: fonts.length }
}

if (require.main === module) {
  prepareExportAssets().then((result) => {
    console.log(`已准备 KaTeX 离线导出资源：${result.fontFiles} 个字体文件。`)
  }).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { prepareExportAssets }
