'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { PreferencesStore } = require('../electron/preferences.cjs')
const DEFAULT_EDITOR_FONT_SIZE = 18

async function withSettings(t, setup) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-preferences-'))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('lingshu-preferences-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  if (setup) await setup(path.join(root, 'settings.json'))
  return { root, file: path.join(root, 'settings.json') }
}

test('font size defaults and persists without losing the selected language', async t => {
  const { root, file } = await withSettings(t)
  const store = new PreferencesStore(root)
  assert.deepEqual(await store.initialize(), { language: null, editorFontSize: DEFAULT_EDITOR_FONT_SIZE })

  await store.setLanguage('zh-CN')
  await store.setEditorFontSize(19)
  assert.deepEqual(store.getState(), { language: 'zh-CN', editorFontSize: 19 })

  const restarted = new PreferencesStore(root)
  assert.deepEqual(await restarted.initialize(), { language: 'zh-CN', editorFontSize: 19 })
  await restarted.setLanguage('en-US')
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { language: 'en-US', editorFontSize: 19 })
})

test('font size preference migrates language-only settings', async t => {
  const { root, file } = await withSettings(t, target => fs.writeFile(target, JSON.stringify({ language: 'en-US' })))
  const store = new PreferencesStore(root)
  assert.deepEqual(await store.initialize(), { language: 'en-US', editorFontSize: DEFAULT_EDITOR_FONT_SIZE })

  await store.setEditorFontSize(20)
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { language: 'en-US', editorFontSize: 20 })
})

test('font size preference rejects values outside the supported whole-pixel range', async t => {
  const { root, file } = await withSettings(t)
  const store = new PreferencesStore(root)
  await store.initialize()

  for (const value of [13, 25, 18.5, '20', null]) {
    await assert.rejects(store.setEditorFontSize(value), TypeError)
  }
  await assert.rejects(fs.access(file), { code: 'ENOENT' })
  assert.deepEqual(store.getState(), { language: null, editorFontSize: DEFAULT_EDITOR_FONT_SIZE })
})
