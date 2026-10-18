const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session, clipboard } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { MAX_DOCUMENT_BYTES, isMarkdownPath, readMarkdown, writeMarkdown, getFileRevision } = require('./documents.cjs');
const { ThemeStore } = require('./themes.cjs');
const { loadKatexCss, buildExportHtml, writeExport } = require('./exporter.cjs');
const { PreferencesStore } = require('./preferences.cjs');
const { FeedbackService } = require('./feedback.cjs');
const { t, setLanguage, getLanguage, isLanguage } = require('./i18n.cjs');

// Keep one stable userData directory when the display language changes.
app.setName('Lingshu');
let window;
let current;
let savedContent = '';
let hasBom = false;
let diskRevision = null;
let rendererReady = false;
let allowClose = false;
let operationPending = false;
let themeStore;
let preferencesStore;
let feedbackService;
let initialDocumentRequested = false;
let isWelcomeDocument = true;
let titleDirty = false;
const rendererPath = path.join(__dirname, '..', 'dist', 'index.html');
const filters = () => [{ name: t('Markdown 文档'), extensions: ['md', 'markdown', 'mdown', 'txt'] }];

function documentInfo(filePath, content, name = t('未命名.md')) {
  return {
    path: filePath,
    name: filePath ? path.basename(filePath) : name,
    content,
    baseUrl: pathToFileURL((filePath ? path.dirname(filePath) : path.dirname(rendererPath)) + path.sep).href,
  };
}

function assertSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error(t('无效的窗口请求。'));
  }
  const url = new URL(event.senderFrame.url);
  if (url.protocol !== 'file:' || path.resolve(fileURLToPath(url)) !== path.resolve(rendererPath)) {
    throw new Error(t('无效的页面来源。'));
  }
}

function assertContent(content) {
  if (typeof content !== 'string') throw new Error(t('文档内容必须是文本。'));
}

function validateExport(request) {
  if (!request || typeof request.contentHtml !== 'string' || Buffer.byteLength(request.contentHtml, 'utf8') > 48 * 1024 * 1024) {
    throw new Error(t('导出内容无效或超过 48 MB。'));
  }
  const options = request.options;
  if (!options || !['pdf', 'html'].includes(options.format) || !['A4', 'A5', 'Letter'].includes(options.paper)
    || (options.language !== undefined && !isLanguage(options.language))
    || !['light', 'dark'].includes(options.appearance) || !Number.isFinite(options.marginMm) || options.marginMm < 0 || options.marginMm > 50
    || ['landscape', 'pageNumbers', 'includeStyles', 'includeOutline'].some((key) => typeof options[key] !== 'boolean')) {
    throw new Error(t('导出设置无效。'));
  }
  if (!Array.isArray(request.outline) || request.outline.length > 10000 || request.outline.some((heading) => !heading
    || typeof heading.id !== 'string' || !/^heading-\d+$/.test(heading.id) || typeof heading.text !== 'string'
    || heading.text.length > 10000 || !Number.isInteger(heading.level) || heading.level < 1 || heading.level > 6)) {
    throw new Error(t('导出大纲无效。'));
  }
  return request;
}

function updateTitle(dirty = false) {
  titleDirty = dirty;
  if (window && !window.isDestroyed()) window.setTitle(`${dirty ? '● ' : ''}${current.name} — ${t('灵书 Markdown')}`);
}

async function welcomeDocument(language) {
  const filename = language === 'en-US' ? 'welcome.en.md' : 'welcome.md';
  const content = await fs.readFile(path.join(__dirname, filename), 'utf8');
  return documentInfo(null, content, language === 'en-US' ? 'Start writing.md' : '开始写作.md');
}

async function persist(content, saveAs = false) {
  assertContent(content);
  if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error(t('文档超过 16 MB，无法保存；仍可取消或选择不保存离开。'));
  let target = current.path;
  if (target && !saveAs && await getFileRevision(target) !== diskRevision) {
    const conflict = await dialog.showMessageBox(window, {
      type: 'warning', title: t('磁盘文件已变化'), message: t('此文件已被其他程序修改、移动或删除。'),
      detail: t('可以保留磁盘版本并另存为，也可以明确覆盖为当前编辑内容。'),
      buttons: ['另存为', '覆盖磁盘版本', '取消'].map(label => t(label)), defaultId: 0, cancelId: 2, noLink: true,
    });
    if (conflict.response === 2) return false;
    if (conflict.response === 0) saveAs = true;
  }
  if (saveAs || !target) {
    const result = await dialog.showSaveDialog(window, { title: t('保存 Markdown 文档'), buttonLabel: t('保存'), defaultPath: target || current.name, filters: filters() });
    if (result.canceled || !result.filePath) return false;
    target = result.filePath;
    if (!path.extname(target)) target += '.md';
  }
  diskRevision = await writeMarkdown(target, content, { bom: hasBom });
  current = documentInfo(target, content);
  savedContent = content;
  updateTitle(false);
  return true;
}

async function protectUnsaved(content) {
  assertContent(content);
  if (content === savedContent) return true;
  const result = await dialog.showMessageBox(window, {
    type: 'question', title: t('保存修改'),
    message: t('要保存对「{name}」的修改吗？', { name: current.name }),
    detail: t('未保存的修改在离开文档后会丢失。'),
    buttons: ['保存', '不保存', '取消'].map(label => t(label)), defaultId: 0, cancelId: 2, noLink: true,
  });
  if (result.response === 2) return false;
  if (result.response === 0) return persist(content);
  return true;
}

function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertSender(event);
    if (operationPending) return { status: 'error', error: t('文件操作正在进行，请稍候。') };
    operationPending = true;
    try { return await action(...args); }
    catch (error) { return { status: 'error', error: error.message || String(error) }; }
    finally { operationPending = false; }
  });
}

function installHandlers() {
  ipcMain.handle('feedback:info', async (event) => { assertSender(event); return feedbackService.getInfo(); });
  for (const [channel, action] of [
    ['feedback:submit', (request) => feedbackService.submit(request)],
    ['feedback:web', (request) => feedbackService.openWeb(request)],
    ['feedback:link', (target, issueNumber) => feedbackService.openLink(target, issueNumber)],
  ]) {
    ipcMain.handle(channel, async (event, ...args) => {
      try { assertSender(event); } catch { return { status: 'error', code: 'forbidden' }; }
      return action(...args);
    });
  }
  ipcMain.handle('preferences:get', (event) => { assertSender(event); return preferencesStore.getState(); });
  handle('preferences:set-language', async (language) => {
    if (!isLanguage(language)) throw new TypeError(t('语言设置无效。'));
    const welcome = !initialDocumentRequested && isWelcomeDocument ? await welcomeDocument(language) : null;
    await preferencesStore.setLanguage(language);
    setLanguage(language);
    if (welcome) { current = welcome; savedContent = welcome.content; }
    installMenu();
    updateTitle(titleDirty);
    return { status: 'ok' };
  });
  const assertClipboard = (text) => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) {
      throw new Error(t('剪贴板内容必须是文本且不能超过 16 MB。'));
    }
  };
  ipcMain.handle('clipboard:read', (event) => {
    assertSender(event);
    const text = clipboard.readText();
    assertClipboard(text);
    return text;
  });
  ipcMain.handle('clipboard:write', (event, text) => {
    assertSender(event);
    assertClipboard(text);
    clipboard.writeText(text);
  });
  handle('document:initial', async () => {
    initialDocumentRequested = true;
    return { status: 'ok', document: current };
  });
  handle('document:new', async (content) => {
    if (!await protectUnsaved(content)) return { status: 'cancelled' };
    hasBom = false;
    diskRevision = null;
    current = documentInfo(null, '');
    isWelcomeDocument = false;
    savedContent = '';
    updateTitle();
    return { status: 'ok', document: current };
  });
  handle('document:open', async (content) => {
    assertContent(content);
    const selected = await dialog.showOpenDialog(window, { title: t('打开 Markdown 文档'), buttonLabel: t('打开…').replace('…', ''), properties: ['openFile'], filters: filters() });
    if (selected.canceled || !selected.filePaths[0]) return { status: 'cancelled' };
    const target = selected.filePaths[0];
    await readMarkdown(target);
    const beforeProtection = current;
    if (!await protectUnsaved(content)) return { status: 'cancelled' };
    let loaded;
    try { loaded = await readMarkdown(target); }
    catch (error) {
      return { status: 'error', error: error.message || String(error), ...(current !== beforeProtection ? { document: current } : {}) };
    }
    hasBom = loaded.bom;
    diskRevision = loaded.revision;
    current = documentInfo(target, loaded.content);
    isWelcomeDocument = false;
    savedContent = loaded.content;
    updateTitle();
    return { status: 'ok', document: current };
  });
  handle('document:save', async (content, saveAs = false) => {
    if (!await persist(content, Boolean(saveAs))) return { status: 'cancelled' };
    return { status: 'ok', document: current };
  });
  handle('document:export', async (request) => {
    const { contentHtml, outline, options } = validateExport(request);
    const extension = options.format === 'pdf' ? 'pdf' : 'html';
    const stem = current.name.replace(/\.(md|markdown|mdown|txt)$/i, '');
    const selected = await dialog.showSaveDialog(window, {
      title: t('导出 {format}', { format: extension.toUpperCase() }), buttonLabel: t('导出…').replace('…', ''),
      defaultPath: path.join(current.path ? path.dirname(current.path) : app.getPath('documents'), `${stem}.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (selected.canceled || !selected.filePath) return { status: 'cancelled' };
    let targetPath = selected.filePath;
    if (path.extname(targetPath).toLowerCase() !== `.${extension}`) targetPath += `.${extension}`;
    if (current.path && path.resolve(targetPath).toLowerCase() === path.resolve(current.path).toLowerCase()) {
      throw new Error(t('导出文件不能覆盖正在编辑的 Markdown 文档。'));
    }
    const theme = await themeStore.getState();
    const html = buildExportHtml({ title: stem, baseUrl: current.baseUrl, contentHtml, outline, options,
      themeCss: theme.css, katexCss: options.includeStyles ? await loadKatexCss() : '' });
    await writeExport({ BrowserWindow, html, targetPath, options, temporaryDirectory: path.join(app.getPath('userData'), 'export-temp') });
    return { status: 'ok', path: targetPath };
  });
  handle('theme:state', async () => ({ status: 'ok', theme: await themeStore.getState() }));
  handle('theme:select', async (id) => ({ status: 'ok', theme: await themeStore.select(id) }));
  handle('theme:import', async () => {
    const selected = await dialog.showOpenDialog(window, { title: t('导入 CSS 主题'), buttonLabel: t('打开…').replace('…', ''), properties: ['openFile'], filters: [{ name: t('CSS 主题'), extensions: ['css'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { status: 'cancelled' };
    return { status: 'ok', theme: await themeStore.importFile(selected.filePaths[0]) };
  });
  handle('theme:open-directory', async () => {
    const theme = await themeStore.getState();
    const error = await shell.openPath(theme.directory);
    if (error) throw new Error(error);
  });
  ipcMain.on('document:dirty', (event, dirty) => {
    try { assertSender(event); updateTitle(dirty === true); } catch { /* 非应用页面的通知不会修改状态。 */ }
  });
  ipcMain.on('renderer:ready', (event) => { assertSender(event); rendererReady = true; });
  ipcMain.handle('document:close', async (event, content) => {
    assertSender(event);
    if (operationPending) throw new Error(t('请先完成当前文件操作。'));
    operationPending = true;
    try {
      if (await protectUnsaved(content)) {
        allowClose = true;
        window.close();
      }
    } finally { operationPending = false; }
  });
}

function installMenu() {
  const command = (name) => () => window?.webContents.send('app:command', name);
  const item = (label, name, accelerator) => ({ id: name, label: t(label), click: command(name), ...(accelerator ? { accelerator } : {}) });
  const edit = (label, name, accelerator) => item(label, `edit:${name}`, accelerator);
  const separator = { type: 'separator' };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: t('文件'), submenu: [
      item('新建', 'new', 'CmdOrCtrl+N'), item('打开…', 'open', 'CmdOrCtrl+O'), separator,
      item('保存', 'save', 'CmdOrCtrl+S'), item('另存为…', 'saveAs', 'CmdOrCtrl+Shift+S'),
      item('导出…', 'export', 'CmdOrCtrl+Shift+E'), separator,
      { id: 'close', label: t('关闭'), accelerator: 'CmdOrCtrl+W', click: () => window?.close() },
      { label: t('退出'), role: 'quit' },
    ] },
    { label: t('编辑'), submenu: [
      edit('撤销', 'undo', 'CmdOrCtrl+Z'), edit('重做', 'redo', 'CmdOrCtrl+Y'), separator,
      { role: 'cut', label: t('剪切'), accelerator: 'CmdOrCtrl+X' },
      { role: 'copy', label: t('复制'), accelerator: 'CmdOrCtrl+C' },
      { role: 'paste', label: t('粘贴'), accelerator: 'CmdOrCtrl+V' },
      item('复制为 Markdown', 'copyMarkdown', 'CmdOrCtrl+Shift+C'), item('粘贴为纯文本', 'pastePlainText', 'CmdOrCtrl+Shift+V'),
      { role: 'selectAll', label: t('全选'), accelerator: 'CmdOrCtrl+A' }, separator,
      edit('选中当前行', 'selectLine', 'CmdOrCtrl+L'), edit('选中当前范围', 'selectScope', 'CmdOrCtrl+E'),
      edit('选中当前词', 'selectWord', 'CmdOrCtrl+D'), edit('删除当前词', 'deleteWord', 'CmdOrCtrl+Shift+D'),
      edit('跳转到选区', 'jumpSelection', 'CmdOrCtrl+J'), separator,
      item('查找…', 'find', 'CmdOrCtrl+F'), item('替换…', 'replace', 'CmdOrCtrl+H'),
      item('查找下一个', 'findNext', 'F3'), item('查找上一个', 'findPrevious', 'Shift+F3'), separator,
      item('语言…', 'showLanguage', 'CmdOrCtrl+,'),
    ] },
    { label: t('段落'), submenu: [
      ...[1, 2, 3, 4, 5, 6].map(level => ({ id: `edit:heading${level}`, label: t('标题 {level}', { level }), accelerator: `CmdOrCtrl+${level}`, click: command(`edit:heading${level}`) })),
      edit('普通段落', 'paragraph', 'CmdOrCtrl+0'), separator,
      edit('提升标题级别', 'headingIncrease', 'CmdOrCtrl+='), edit('降低标题级别', 'headingDecrease', 'CmdOrCtrl+-'), separator,
      edit('表格', 'table', 'CmdOrCtrl+T'), edit('代码块', 'codeBlock', 'CmdOrCtrl+Shift+K'),
      edit('数学公式块', 'mathBlock', 'CmdOrCtrl+Shift+M'), edit('引用', 'quote', 'CmdOrCtrl+Shift+Q'), separator,
      edit('有序列表', 'orderedList', 'CmdOrCtrl+Shift+['), edit('无序列表', 'bulletList', 'CmdOrCtrl+Shift+]'),
      edit('任务列表', 'taskList'), edit('增加缩进', 'indent', 'CmdOrCtrl+['), edit('减少缩进', 'outdent', 'CmdOrCtrl+]'),
      edit('分隔线', 'horizontalRule'),
    ] },
    { label: t('格式'), submenu: [
      edit('加粗', 'bold', 'CmdOrCtrl+B'), edit('斜体', 'italic', 'CmdOrCtrl+I'), edit('下划线', 'underline', 'CmdOrCtrl+U'),
      edit('行内代码', 'inlineCode', 'CmdOrCtrl+Shift+`'), edit('删除线', 'strike', 'Alt+Shift+5'), edit('高亮', 'highlight'), separator,
      edit('超链接', 'link', 'CmdOrCtrl+K'), edit('图片', 'image', 'CmdOrCtrl+Shift+I'),
      edit('清除格式', 'clearFormat', 'CmdOrCtrl+\\'),
    ] },
    { label: t('视图'), submenu: [
      item('源码模式', 'toggleSource', 'CmdOrCtrl+/'), { ...item('侧栏', 'toggleOutline', 'CmdOrCtrl+Shift+L'), id: 'toggleSidebar' },
      item('文档大纲', 'toggleOutline', 'CmdOrCtrl+Shift+1'), item('专注模式', 'toggleFocus', 'F8'), item('打字机模式', 'toggleTypewriter', 'F9'),
      item('CSS 主题…', 'showThemes'), separator,
      { role: 'resetZoom', label: t('实际大小'), accelerator: 'CmdOrCtrl+Shift+0' },
      { role: 'zoomIn', label: t('放大'), accelerator: 'CmdOrCtrl+Shift+=' },
      { role: 'zoomOut', label: t('缩小'), accelerator: 'CmdOrCtrl+Shift+-' },
      { role: 'togglefullscreen', label: t('全屏'), accelerator: 'F11' },
    ] },
    { label: t('帮助'), submenu: [item('反馈与建议…', 'showFeedback'), separator, { label: t('关于灵书'), click: () => dialog.showMessageBox(window, {
      type: 'info', title: t('关于灵书'), message: `${t('灵书 Markdown')} ${app.getVersion()}`,
      detail: t('独立实现的本地 Markdown 写作工具。\n编辑核心：Milkdown / Crepe（MIT）。\n不包含 Typora 的代码、素材或授权机制。'), buttons: [getLanguage() === 'en-US' ? 'OK' : '确定'],
    }) }] },
  ]));
}

function openExternal(url) {
  try { if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url); } catch { /* 忽略无法解析的地址。 */ }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  feedbackService = new FeedbackService({ projectPath: path.join(__dirname, '..', 'project.json'), version: app.getVersion(), openExternal: (url) => shell.openExternal(url) });
  preferencesStore = new PreferencesStore(app.getPath('userData'));
  const preferences = await preferencesStore.initialize();
  if (preferences.language) setLanguage(preferences.language);
  themeStore = new ThemeStore(path.join(app.getPath('userData'), 'themes'));
  await themeStore.initialize();
  current = await welcomeDocument(getLanguage());
  const args = process.defaultApp ? process.argv.slice(2) : process.argv.slice(1);
  const supplied = args.find((arg) => !arg.startsWith('-') && isMarkdownPath(arg));
  if (supplied) {
    try {
      const filePath = path.resolve(supplied);
      const loaded = await readMarkdown(filePath);
      hasBom = loaded.bom;
      diskRevision = loaded.revision;
      current = documentInfo(filePath, loaded.content);
      isWelcomeDocument = false;
    } catch (error) { dialog.showErrorBox(t('无法打开文档'), error.message); }
  }
  savedContent = current.content;
  window = new BrowserWindow({
    width: 1280, height: 900, minWidth: 760, minHeight: 540,
    backgroundColor: '#f7f7f2', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  installHandlers();
  installMenu();
  updateTitle();
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { event.preventDefault(); openExternal(url); });
  window.on('close', (event) => {
    if (allowClose || !rendererReady) return;
    event.preventDefault();
    if (operationPending) return;
    window.webContents.send('document:close-requested');
  });
  window.once('ready-to-show', () => window.show());
  await window.loadFile(rendererPath);
}).catch((error) => {
  dialog.showErrorBox(t('灵书未能启动'), error.message || String(error));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
