'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { t, isLanguage } = require('./i18n.cjs')
const MAX_SETTINGS_BYTES = 4096
const DEFAULT_EDITOR_FONT_SIZE = 18
const MIN_EDITOR_FONT_SIZE = 14
const MAX_EDITOR_FONT_SIZE = 24

function isEditorFontSize(value) {
  return Number.isInteger(value) && value >= MIN_EDITOR_FONT_SIZE && value <= MAX_EDITOR_FONT_SIZE
}

class PreferencesStore {
  constructor(directory) {
    this.directory = path.resolve(directory)
    this.file = path.join(this.directory, 'settings.json')
    this.language = null
    this.editorFontSize = DEFAULT_EDITOR_FONT_SIZE
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true })
    let entry
    try { entry = await fs.lstat(this.file) } catch (error) {
      if (error.code === 'ENOENT') return this.getState()
      throw error
    }
    const invalid = () => new Error(t('设置文件损坏或格式无效，请检查应用数据目录中的 settings.json。'))
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_SETTINGS_BYTES) throw invalid()
    const buffer = await fs.readFile(this.file)
    if (buffer.length > MAX_SETTINGS_BYTES) throw invalid()
    let settings
    try { settings = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) } catch { throw invalid() }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !isLanguage(settings.language)) throw invalid()
    const editorFontSize = settings.editorFontSize === undefined ? DEFAULT_EDITOR_FONT_SIZE : settings.editorFontSize
    if (!isEditorFontSize(editorFontSize)) throw invalid()
    this.language = settings.language
    this.editorFontSize = editorFontSize
    return this.getState()
  }

  getState() { return { language: this.language, editorFontSize: this.editorFontSize } }

  async setLanguage(language) {
    if (!isLanguage(language)) throw new TypeError(t('语言设置无效。'))
    try {
      const entry = await fs.lstat(this.file)
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(t('设置文件损坏或格式无效，请检查应用数据目录中的 settings.json。'))
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const temporary = path.join(this.directory, `.settings-${randomUUID()}.tmp`)
    let ownsTemporary = false
    try {
      const handle = await fs.open(temporary, 'wx')
      ownsTemporary = true
      try { await handle.writeFile(`${JSON.stringify({ language, editorFontSize: this.editorFontSize }, null, 2)}\n`, 'utf8') } finally { await handle.close() }
      await fs.rename(temporary, this.file)
      this.language = language
    } finally {
      if (ownsTemporary) await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
    return this.getState()
  }

  async setEditorFontSize(editorFontSize) {
    if (!isEditorFontSize(editorFontSize)) throw new TypeError(t('字号必须是 14 至 24 的整数。'))
    const previous = this.editorFontSize
    this.editorFontSize = editorFontSize
    try { return await this.setLanguage(this.language) }
    catch (error) { this.editorFontSize = previous; throw error }
  }
}

module.exports = { PreferencesStore }
