const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL, fileURLToPath } = require('node:url')
const { t } = require('./i18n.cjs')

const MAX_CSS_BYTES = 1024 * 1024
const SETTINGS_FILE = '.inkstone-theme.json'
const BASE_OVERRIDE = 'base.user.css'
const BUNDLED_THEMES = ['forest.css', 'book.css']

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function entryOrNull(file) {
  try { return await fs.lstat(file) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function themeFile(name) {
  return /\.css$/i.test(name) && !/\.user\.css$/i.test(name)
}

// Common CSS URL syntax is supported; complex CSS escapes are intentionally
// left to the browser. Strings and url() references share the same relocation.
function transformReferences(css, transform) {
  return css
    .replace(/\burl\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi, (original, quote, quoted, bare) => {
      const replacement = transform((quote ? quoted : bare).trim())
      return replacement === null ? original : `url("${replacement}")`
    })
    .replace(/(@import\s+)(["'])([^"'\r\n]+)\2/gi, (original, prefix, quote, value) => {
      const replacement = transform(value.trim())
      return replacement === null ? original : `${prefix}"${replacement}"`
    })
}

function relativeReference(value) {
  return value !== '' && !/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(value) && !path.isAbsolute(value)
}

function absoluteReferences(css, cssPath) {
  const base = pathToFileURL(`${path.dirname(cssPath)}${path.sep}`)
  return transformReferences(css, value => relativeReference(value) ? new URL(value.replace(/\\/g, '/'), base).href : null)
}

async function readCss(file, optional = false) {
  const entry = await entryOrNull(file)
  if (!entry && optional) return null
  if (!entry || !entry.isFile() || entry.isSymbolicLink()) throw new Error(t('主题 CSS 必须是普通文件：{name}', { name: path.basename(file) }))
  if (entry.size > MAX_CSS_BYTES) throw new Error(t('主题 CSS 超过 1 MB：{name}', { name: path.basename(file) }))
  const handle = await fs.open(file, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_CSS_BYTES) throw new Error(t('主题 CSS 无法读取或超过 1 MB：{name}', { name: path.basename(file) }))
    const buffer = Buffer.alloc(MAX_CSS_BYTES + 1)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > MAX_CSS_BYTES) throw new Error(t('主题 CSS 超过 1 MB：{name}', { name: path.basename(file) }))
    return buffer.subarray(0, total).toString('utf8')
  } finally { await handle.close() }
}

async function resourceTree(root, directory = root) {
  if (!inside(root, directory)) throw new Error(t('主题资源路径超出目录'))
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const source = path.resolve(directory, entry.name)
    if (!inside(root, source) || entry.isSymbolicLink()) throw new Error(t('主题资源不能包含符号链接或目录外路径'))
    if (entry.isDirectory()) files.push({ relative: path.relative(root, source), directory: true }, ...await resourceTree(root, source))
    else if (entry.isFile()) {
      if (/\.css$/i.test(entry.name)) await readCss(source)
      files.push({ relative: path.relative(root, source), directory: false })
    }
    else throw new Error(t('主题资源只能包含普通文件和目录'))
  }
  return files
}

function relocateImportedResources(css, sourceFile, sourceAssets, targetAssets, targetDirectory) {
  const sourceBase = pathToFileURL(`${path.dirname(sourceFile)}${path.sep}`)
  const targetBase = pathToFileURL(`${targetDirectory}${path.sep}`).href
  return transformReferences(css, value => {
    if (!relativeReference(value)) return null
    const resolved = new URL(value.replace(/\\/g, '/'), sourceBase)
    const source = fileURLToPath(resolved)
    if (!inside(sourceAssets, source)) return null
    const target = pathToFileURL(path.resolve(targetAssets, path.relative(sourceAssets, source)))
    target.search = resolved.search
    target.hash = resolved.hash
    return target.href.slice(targetBase.length)
  })
}

class ThemeStore {
  constructor(directory) {
    if (typeof directory !== 'string' || directory.length === 0) throw new Error(t('需要主题目录'))
    this.directory = path.resolve(directory)
    this.activeId = null
    this.initialized = false
    this.pending = Promise.resolve()
  }

  async initialize() {
    return this._exclusive(async () => {
      await fs.mkdir(this.directory, { recursive: true })
      const root = await fs.lstat(this.directory)
      if (!root.isDirectory() || root.isSymbolicLink()) throw new Error(t('主题目录必须是普通目录'))
      for (const name of BUNDLED_THEMES) {
        const bundled = await readCss(path.join(__dirname, 'themes', name))
        try { await fs.writeFile(path.join(this.directory, name), bundled, { flag: 'wx' }) } catch (error) {
          if (error.code !== 'EEXIST') throw error
        }
      }
      try {
        await fs.writeFile(path.join(this.directory, BASE_OVERRIDE), '/* 所有主题的个人样式。正文选择器：#write。 */\n', { flag: 'wx' })
      } catch (error) { if (error.code !== 'EEXIST') throw error }
      const settingsPath = path.join(this.directory, SETTINGS_FILE)
      const settingsEntry = await entryOrNull(settingsPath)
      if (settingsEntry) {
        if (!settingsEntry.isFile() || settingsEntry.isSymbolicLink() || settingsEntry.size > 4096) throw new Error(t('主题设置文件无效'))
        let settings
        try { settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) } catch { throw new Error(t('主题设置文件无效')) }
        if (!settings || (settings.activeId !== null && typeof settings.activeId !== 'string')) throw new Error(t('主题设置文件无效'))
        const themes = await this._scan()
        this.activeId = themes.some(theme => theme.id === settings.activeId) ? settings.activeId : null
      }
      this.initialized = true
      return this._state()
    })
  }

  async getState() {
    await this.pending
    this._requireInitialized()
    return this._state()
  }

  async select(id) {
    return this._exclusive(async () => {
      this._requireInitialized()
      await this._persist(id)
      this.activeId = id
      return this._state()
    })
  }

  async importFile(sourcePath) {
    return this._exclusive(async () => {
      this._requireInitialized()
      if (typeof sourcePath !== 'string' || !/\.css$/i.test(sourcePath)) throw new Error(t('请选择 .css 主题文件'))
      const sourceFile = path.resolve(sourcePath)
      const sourceDirectory = path.dirname(sourceFile)
      const originalStem = path.basename(sourceFile, path.extname(sourceFile))
      const sourceAssets = path.resolve(sourceDirectory, originalStem)
      if (!inside(sourceDirectory, sourceAssets) || sourceAssets === sourceDirectory) throw new Error(t('主题文件需要有效的文件名，以限制同名资源目录范围'))
      const css = await readCss(sourceFile)
      const assetEntry = await entryOrNull(sourceAssets)
      if (assetEntry && (assetEntry.isSymbolicLink() || !assetEntry.isDirectory())) throw new Error(t('同名主题资源必须是普通目录'))
      const assets = assetEntry ? await resourceTree(sourceAssets) : null
      const stem = /\.user$/i.test(originalStem) ? `${originalStem.replace(/\.user$/i, '')} (imported)` : originalStem || 'Imported theme'
      let name = `${stem}.css`
      let number = 2
      while (await entryOrNull(path.join(this.directory, name)) || await entryOrNull(path.join(this.directory, path.basename(name, '.css')))) {
        name = `${stem} (${number++}).css`
      }
      const targetFile = path.resolve(this.directory, name)
      const targetAssets = path.resolve(this.directory, path.basename(name, '.css'))
      if (!inside(this.directory, targetFile) || !inside(this.directory, targetAssets)) throw new Error(t('目标主题路径无效'))
      let ownsAssets = false
      try {
        if (assets) {
          await fs.mkdir(targetAssets)
          ownsAssets = true
          for (const asset of assets) {
            const source = path.resolve(sourceAssets, asset.relative)
            const target = path.resolve(targetAssets, asset.relative)
            if (!inside(sourceAssets, source) || !inside(targetAssets, target)) throw new Error(t('主题资源路径无效'))
            const current = await fs.lstat(source)
            if (current.isSymbolicLink() || (asset.directory ? !current.isDirectory() : !current.isFile())) throw new Error(t('主题资源在导入期间发生变化'))
            if (asset.directory) await fs.mkdir(target)
            else await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL)
          }
        }
        const imported = assets ? relocateImportedResources(css, sourceFile, sourceAssets, targetAssets, this.directory) : css
        if (Buffer.byteLength(imported, 'utf8') > MAX_CSS_BYTES) throw new Error(t('导入后的主题 CSS 超过 1 MB'))
        await fs.writeFile(targetFile, imported, { flag: 'wx' })
      } catch (error) {
        // Only this import's exclusively created resource directory can be removed.
        if (ownsAssets && inside(this.directory, targetAssets) && targetAssets !== this.directory) await fs.rm(targetAssets, { recursive: true, force: false })
        throw error
      }
      await this._persist(name)
      this.activeId = name
      return this._state()
    })
  }

  _requireInitialized() {
    if (!this.initialized) throw new Error(t('主题目录尚未初始化'))
  }

  _exclusive(operation) {
    const next = this.pending.then(operation)
    this.pending = next.catch(() => {})
    return next
  }

  async _scan() {
    const entries = await fs.readdir(this.directory, { withFileTypes: true })
    return entries.filter(entry => entry.isFile() && !entry.isSymbolicLink() && themeFile(entry.name))
      .map(entry => ({ id: entry.name, name: path.basename(entry.name, path.extname(entry.name)).replace(/[-_]+/g, ' ') }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async _persist(id) {
    const themes = await this._scan()
    if (id !== null && (typeof id !== 'string' || !themes.some(theme => theme.id === id))) throw new Error(t('请选择当前主题目录中的有效主题'))
    // Validate readable CSS before changing the persisted selection.
    if (id !== null) await readCss(path.join(this.directory, id))
    const settingsPath = path.join(this.directory, SETTINGS_FILE)
    const entry = await entryOrNull(settingsPath)
    if (entry && (!entry.isFile() || entry.isSymbolicLink())) throw new Error(t('主题设置文件无效'))
    await fs.writeFile(settingsPath, `${JSON.stringify({ activeId: id }, null, 2)}\n`, { flag: entry ? 'w' : 'wx' })
  }

  async _state() {
    const themes = await this._scan()
    const activeId = themes.some(theme => theme.id === this.activeId) ? this.activeId : null
    const files = []
    if (activeId !== null) files.push({ name: activeId, optional: false })
    files.push({ name: BASE_OVERRIDE, optional: true })
    if (activeId !== null) files.push({ name: `${path.basename(activeId, path.extname(activeId))}.user.css`, optional: true })
    const parts = []
    for (const file of files) {
      const cssPath = path.join(this.directory, file.name)
      const css = await readCss(cssPath, file.optional)
      if (css !== null) parts.push(absoluteReferences(css, cssPath))
    }
    return { directory: this.directory, activeId, themes, css: parts.join('\n\n') }
  }
}

module.exports = { ThemeStore }
