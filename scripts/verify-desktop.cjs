const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');

async function main() {
  const project = path.resolve(__dirname, '..');
  const artifacts = path.join(project, 'output', 'verification', new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(artifacts, { recursive: true });
  const imageServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="18"><rect width="24" height="18" fill="#d94f43"/></svg>');
  });
  await new Promise((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
  const imageUrl = `http://127.0.0.1:${imageServer.address().port}/test.svg`;
  const original = `\uFEFF# 中文标题\r\n\r\n开头带 **加粗**。\r\n\r\n## 第二节\r\n\r\n![本地图片](./test-image.svg)\r\n\r\n![HTTP图片](${imageUrl})\r\n\r\n|项目|值|\r\n|---|---|\r\n|示例|一|\r\n\r\n$$\r\nE=mc^2\r\n$$\r\n\r\n\`\`\`js\r\nconst value = 1;\r\n\`\`\`\r\n`;
  const originalFile = path.join(artifacts, '中文 文档.md');
  const secondFile = path.join(artifacts, '新文档.md');
  const invalidFile = path.join(artifacts, 'invalid.md');
  await fs.writeFile(originalFile, original, 'utf8');
  await fs.writeFile(invalidFile, Buffer.from([0xff, 0xfe, 0xfa]));
  await fs.writeFile(path.join(artifacts, 'test-image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#617965"/></svg>');
  const packaged = process.env.INKSTONE_EXECUTABLE;
  const executablePath = packaged || require('electron');
  const args = [...(packaged ? [] : [project]), originalFile, `--user-data-dir=${path.join(artifacts, 'profile')}`];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const results = [];
  const passed = (name) => { results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); };
  let application;
  let window;
  const errors = [];
  try {
    application = await _electron.launch({ executablePath, args, cwd: project, env, timeout: 60000 });
    window = await application.firstWindow();
    window.on('pageerror', (error) => errors.push(error.message));
    await window.locator('#language-zh').waitFor({ timeout: 60000 });
    await window.locator('#language-zh').click();
    await window.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    assert.equal(await window.locator('#document-name').innerText(), '中文 文档.md');
    assert.equal(await window.locator('#editor h1').first().innerText(), '中文标题');
    assert.deepEqual(await window.locator('#outline-list .outline-heading').allTextContents(), ['中文标题', '第二节']);
    assert.ok(await window.locator('#editor table').count() > 0);
    await window.locator('#editor .katex').first().waitFor({ timeout: 10000 });
    const editorStyle = await window.locator('#write').evaluate((node) => {
      const style = getComputedStyle(node);
      return { fontSize: style.fontSize, maxWidth: style.maxWidth, lineHeight: style.lineHeight, virtualCursorColor: style.getPropertyValue('--prosemirror-virtual-cursor-color').trim() };
    });
    assert.equal(editorStyle.fontSize, '18px');
    assert.equal(editorStyle.maxWidth, '1000px');
    assert.ok(Number.parseFloat(editorStyle.lineHeight) >= 33);
    assert.equal(editorStyle.virtualCursorColor, '#294a32');
    assert.equal(await window.locator('#source-editor').evaluate((node) => getComputedStyle(node).caretColor), 'rgb(41, 74, 50)');
    assert.equal(await window.locator('#font-size-value').innerText(), '18px');
    await window.locator('#font-increase-btn').click();
    assert.equal(await window.locator('#write').evaluate((node) => getComputedStyle(node).fontSize), '19px');
    await window.waitForFunction(async () => (await window.inkstone.getPreferences()).editorFontSize === 19);
    await window.locator('#font-decrease-btn').click();
    assert.equal(await window.locator('#write').evaluate((node) => getComputedStyle(node).fontSize), '18px');
    assert.equal(await window.locator('#document-status').innerText(), '已保存');
    passed('实际 Electron 启动、CLI 打开、中文、表格与公式排版');
    const image = window.locator('#editor img').first();
    await image.waitFor({ state: 'attached' });
    await window.waitForFunction(() => [...document.querySelectorAll('#editor img')].some((img) => img.naturalWidth === 32), { timeout: 10000 });
    passed('真实本地相对图片加载');

    // 原生对话框仅用于选择测试文件/按钮；文件读写、IPC和编辑器均使用真实实现。
    await application.evaluate(({ dialog }) => {
      globalThis.__inkstoneTestDialogs = { open: [], save: [], message: [], seen: [] };
      dialog.showOpenDialog = async () => {
        const target = globalThis.__inkstoneTestDialogs.open.shift();
        return { canceled: !target, filePaths: target ? [target] : [] };
      };
      dialog.showSaveDialog = async () => {
        const target = globalThis.__inkstoneTestDialogs.save.shift();
        return { canceled: !target, filePath: target };
      };
      dialog.showMessageBox = async (_owner, options) => {
        globalThis.__inkstoneTestDialogs.seen.push(options.message);
        return { response: globalThis.__inkstoneTestDialogs.message.shift() ?? 1, checkboxChecked: false };
      };
    });
    const queue = (kind, value) => application.evaluate((_electron, { kind, value }) => { globalThis.__inkstoneTestDialogs[kind].push(value); }, { kind, value });
    const save = async () => {
      await window.locator('#save-btn').click();
      await window.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false' && document.getElementById('document-status').textContent === '已保存');
    };
    await save();
    assert.equal(await fs.readFile(originalFile, 'utf8'), original);
    await window.locator('#source-btn').click();
    const source = window.locator('#source-editor');
    assert.equal(await source.inputValue(), original.slice(1).replace(/\r\n/g, '\n'));
    await save();
    assert.equal(await fs.readFile(originalFile, 'utf8'), original);
    await window.locator('#source-btn').click();
    await save();
    assert.equal(await fs.readFile(originalFile, 'utf8'), original);
    passed('未编辑保存、源码往返保持 UTF-8 BOM 与原始 CRLF 字节');

    await window.locator('#source-btn').click();
    const changedSource = (await source.inputValue()) + '\n源码编辑检查：中文 😀\n';
    await source.fill(changedSource);
    await save();
    assert.equal(await fs.readFile(originalFile, 'utf8'), '\uFEFF' + changedSource.replace(/\n/g, '\r\n'));
    await window.locator('#source-btn').click();
    const rich = window.locator('#editor .ProseMirror');
    await rich.click();
    await window.keyboard.press('Control+End');
    await window.keyboard.press('Enter');
    await window.keyboard.insertText('即时保存检查 中文');
    await save();
    assert.match(await fs.readFile(originalFile, 'utf8'), /即时保存检查 中文/);
    assert.match(await fs.readFile(originalFile, 'utf8'), /!\[本地图片\]\(\.\/test-image\.svg\)/);
    assert.match(await fs.readFile(originalFile, 'utf8'), /!\[HTTP图片\]\(http:/);
    passed('源码与富文本真实编辑后立即保存到磁盘');

    await window.locator('#new-btn').click();
    await window.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false' && document.getElementById('document-name').textContent === '未命名.md');
    await rich.click();
    await window.keyboard.press('Control+z');
    assert.doesNotMatch(await rich.innerText(), /中文标题|即时保存/);
    await window.keyboard.type('# ');
    await window.keyboard.insertText('新标题');
    await window.keyboard.press('Enter');
    await window.keyboard.insertText('写作内容');
    assert.equal(await window.locator('#editor h1').innerText(), '新标题');
    await window.keyboard.press('Enter');
    await window.keyboard.type('1. ');
    await window.keyboard.insertText('Primary item');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Tab');
    await window.waitForFunction(() => document.querySelector('#write ol')?.querySelectorAll(':scope > .milkdown-list-item-block > li .children ol > .milkdown-list-item-block > li').length === 1);
    await window.keyboard.insertText('Nested item one');
    await window.keyboard.press('Enter');
    await window.waitForFunction(() => document.querySelector('#write ol')?.querySelectorAll(':scope > .milkdown-list-item-block > li .children ol > .milkdown-list-item-block > li').length === 2);
    await window.keyboard.insertText('Nested item two');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Shift+Tab');
    await window.waitForFunction(() => document.querySelector('#write ol')?.querySelectorAll(':scope > .milkdown-list-item-block > li').length === 2);
    await window.keyboard.insertText('Second primary item');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter');
    await window.keyboard.insertText('After ordered list');
    await window.waitForFunction(() => !document.getSelection()?.anchorNode?.parentElement?.closest('li'));
    await window.keyboard.press('Enter');
    await window.keyboard.type('- ');
    await window.waitForFunction(() => document.querySelectorAll('#write ul > .milkdown-list-item-block > li').length === 1);
    await window.keyboard.insertText('Bullet item');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Backspace');
    assert.equal(await window.locator('#write ul > .milkdown-list-item-block > li').count(), 1);
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter');
    await window.waitForFunction(() => !document.getSelection()?.anchorNode?.parentElement?.closest('li'));
    await window.keyboard.insertText('After bullet backspace');
    await window.keyboard.press('Enter');
    await window.keyboard.insertText('Undo check');
    await window.keyboard.press('Control+z');
    assert.doesNotMatch(await rich.innerText(), /Undo check/);
    await window.keyboard.press('Control+Shift+z');
    assert.match(await rich.innerText(), /Undo check/);
    const listStructure = await window.locator('#write').evaluate((root) => {
      const ordered = root.querySelector('ol');
      const bullet = root.querySelector('ul');
      const orderedItem = ordered?.querySelector(':scope > .milkdown-list-item-block > li');
      const bulletItem = bullet?.querySelector(':scope > .milkdown-list-item-block > li');
      const orderedLabel = orderedItem?.querySelector('.label-wrapper .label.ordered');
      const bulletWrapper = bulletItem?.querySelector('.label-wrapper');
      const bulletLabel = bulletWrapper?.querySelector('.label.bullet');
      const bulletIcon = bulletLabel?.querySelector('svg');
      const orderedText = orderedItem?.querySelector('.children p');
      const bulletText = bulletItem?.querySelector('.children p');
      const orderedStyle = orderedLabel && getComputedStyle(orderedLabel);
      const bulletStyle = bulletWrapper && getComputedStyle(bulletWrapper);
      const bulletLabelStyle = bulletLabel && getComputedStyle(bulletLabel);
      const orderedLabelRect = orderedLabel?.getBoundingClientRect();
      const orderedTextRect = orderedText?.getBoundingClientRect();
      const bulletIconRect = bulletIcon?.getBoundingClientRect();
      const bulletTextRect = bulletText?.getBoundingClientRect();
      const orderedTextLineHeight = orderedText && parseFloat(getComputedStyle(orderedText).lineHeight);
      const bulletTextLineHeight = bulletText && parseFloat(getComputedStyle(bulletText).lineHeight);
      return {
        topLevelItems: ordered?.querySelectorAll(':scope > .milkdown-list-item-block > li').length ?? 0,
        nestedItems: ordered?.querySelectorAll(':scope > .milkdown-list-item-block > li .children ol > .milkdown-list-item-block > li').length ?? 0,
        bulletItems: bullet?.querySelectorAll(':scope > .milkdown-list-item-block > li').length ?? 0,
        orderedMarker: orderedStyle && { color: orderedStyle.color, fontSize: orderedStyle.fontSize, fontFamily: orderedStyle.fontFamily, lineHeight: orderedStyle.lineHeight },
        orderedTextLineHeight: orderedTextLineHeight && `${orderedTextLineHeight}px`,
        orderedMarkerCenterDiff: orderedLabelRect && orderedTextRect ? Math.abs((orderedLabelRect.top + orderedLabelRect.height / 2) - (orderedTextRect.top + orderedTextLineHeight / 2)) : null,
        orderedMarkerAlignItems: orderedStyle?.alignItems,
        bulletMarker: bulletStyle && { color: bulletStyle.color, fontSize: bulletStyle.fontSize, fill: bulletIcon ? getComputedStyle(bulletIcon).fill : null },
        bulletLabelAlignItems: bulletLabelStyle?.alignItems,
        bulletTextLineHeight: bulletTextLineHeight && `${bulletTextLineHeight}px`,
        bulletMarkerCenterDiff: bulletIconRect && bulletTextRect ? Math.abs((bulletIconRect.top + bulletIconRect.height / 2) - (bulletTextRect.top + bulletTextLineHeight / 2)) : null,
      };
    });
    assert.equal(listStructure.topLevelItems, 2);
    assert.equal(listStructure.nestedItems, 2);
    assert.equal(listStructure.bulletItems, 1);
    assert.equal(listStructure.orderedMarker.color, 'rgb(53, 65, 59)');
    assert.equal(listStructure.orderedMarker.fontSize, '18px');
    assert.match(listStructure.orderedMarker.fontFamily, /Noto Serif SC/);
    assert.equal(listStructure.orderedMarker.lineHeight, listStructure.orderedTextLineHeight);
    assert.ok(listStructure.orderedMarkerCenterDiff < 1);
    assert.equal(listStructure.orderedMarkerAlignItems, 'baseline');
    assert.equal(listStructure.bulletMarker.color, 'rgb(53, 65, 59)');
    assert.equal(listStructure.bulletMarker.fontSize, '18px');
    assert.equal(listStructure.bulletMarker.fill, 'rgb(53, 65, 59)');
    assert.equal(listStructure.bulletLabelAlignItems, 'center');
    assert.equal(listStructure.bulletTextLineHeight, listStructure.orderedTextLineHeight);
    assert.ok(listStructure.bulletMarkerCenterDiff < 1);
    const listScreenshot = path.join(artifacts, 'list-typography.png');
    await window.screenshot({ path: listScreenshot });
    await queue('save', secondFile);
    await save();
    assert.match(await fs.readFile(secondFile, 'utf8'), /# 新标题[\s\S]*写作内容/);
    passed('空白新建、跨文档撤销隔离、Markdown 标题输入与另存实际文件');

    await window.locator('#source-btn').click();
    const draft = (await source.inputValue()) + '\n保留未保存的草稿\n';
    await source.fill(draft);
    await queue('open', originalFile);
    await queue('message', 2);
    await window.locator('#open-btn').click();
    await window.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.equal(await window.locator('#document-name').innerText(), '新文档.md');
    assert.equal(await source.inputValue(), draft);
    for (let i = 0; i < 2; i++) {
      await queue('message', 2);
      const previous = await application.evaluate(() => globalThis.__inkstoneTestDialogs.seen.length);
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      const deadline = Date.now() + 5000;
      while (await application.evaluate(() => globalThis.__inkstoneTestDialogs.seen.length) < previous + 1) {
        if (Date.now() > deadline) throw new Error('关闭请求未触发未保存保护');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(await application.evaluate(() => globalThis.__inkstoneTestDialogs.seen.length), previous + 1);
      assert.ok(!window.isClosed());
    }
    passed('未保存保护：取消打开和连续取消关闭均保留草稿（原生确认框替身）');

    await queue('open', invalidFile);
    await window.locator('#open-btn').click();
    await window.locator('#notice').waitFor();
    assert.match(await window.locator('#notice-text').innerText(), /UTF-8/);
    assert.equal(await window.locator('#document-name').innerText(), '新文档.md');
    assert.equal(await source.inputValue(), draft);
    passed('真实无效编码文件打开失败，不覆盖当前草稿');
    await save();
    await window.locator('#source-btn').click();

    // 主题文件与最终导出均走真实磁盘；这里只替代原生选择位置的交互。
    await queue('open', originalFile);
    await window.locator('#open-btn').click();
    await window.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false' && document.getElementById('document-name').textContent === '中文 文档.md');
    const customCss = path.join(artifacts, 'custom.css');
    await fs.writeFile(customCss, '#write h1 { color: rgb(11, 77, 123); }\n');
    await window.locator('#custom-theme-btn').click();
    await queue('open', customCss);
    await window.locator('#theme-import').click();
    await window.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false' && document.getElementById('theme-select').value === 'custom.css');
    assert.equal(await window.locator('#write h1').first().evaluate((h) => getComputedStyle(h).color), 'rgb(11, 77, 123)');
    const themeDirectory = await window.locator('#theme-directory').innerText();
    await fs.writeFile(path.join(themeDirectory, 'base.user.css'), '#write h1 { color: rgb(22, 88, 44); }\n');
    await fs.writeFile(path.join(themeDirectory, 'custom.user.css'), '#write h1 { color: rgb(123, 44, 88); }\n');
    await window.locator('#theme-refresh').click();
    await window.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.equal(await window.locator('#write h1').first().evaluate((h) => getComputedStyle(h).color), 'rgb(123, 44, 88)');
    await window.locator('#theme-dialog [data-close-dialog]').first().click();
    passed('真实 CSS 导入、#write 生效、base.user.css 与主题专用覆盖顺序');

    await window.locator('#source-btn').click();
    const exportMarkdown = (await source.inputValue()) + '\nEXPORT_UNSAVED_MARKER\n\n```text\n' + Array.from({ length: 85 }, (_, index) => `line_${index + 1}_FULL_CODE`).join('\n') + '\n```\n';
    await source.fill(exportMarkdown);
    const beforeExport = await fs.readFile(originalFile, 'utf8');
    const htmlFile = path.join(artifacts, 'export-styled.html');
    const plainFile = path.join(artifacts, 'export-unstyled.html');
    const pdfFile = path.join(artifacts, 'export-a5-landscape.pdf');
    const exportAs = async (format, target, styles = true) => {
      await window.locator('#export-btn').click();
      await window.locator('#export-format').selectOption(format);
      if (format === 'html') {
        await window.locator('#export-styles').setChecked(styles);
        await window.locator('#export-outline').setChecked(true);
      } else {
        await window.locator('#export-paper').selectOption('A5');
        await window.locator('#export-margin').fill('15');
        await window.locator('#export-landscape').setChecked(true);
      }
      await queue('save', target);
      await window.locator('#export-confirm').click();
      await window.waitForFunction(() => !document.getElementById('export-dialog').open, { timeout: 60000 });
    };
    await exportAs('html', htmlFile);
    const html = await fs.readFile(htmlFile, 'utf8');
    assert.match(html, /EXPORT_UNSAVED_MARKER/);
    assert.match(html, /line_85_FULL_CODE/);
    assert.match(html, /heading-1/);
    assert.match(html, /rgb\(123, 44, 88\)/);
    assert.match(html, /katex/);
    const htmlInspection = await application.evaluate(async ({ BrowserWindow }, target) => {
      const viewer = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try {
        await viewer.loadFile(target);
        return await viewer.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(image => image.decode())); return {color:getComputedStyle(document.querySelector('#write h1')).color, widths:Array.from(document.images).map(image=>image.naturalWidth), outline:document.querySelectorAll('.export-outline a').length, target:document.querySelector('.export-outline a').hash}; })()` }]);
      } finally { viewer.destroy(); }
    }, htmlFile);
    assert.equal(htmlInspection.color, 'rgb(123, 44, 88)');
    assert.deepEqual(htmlInspection.widths, [32, 24]);
    assert.equal(htmlInspection.outline, 2);
    assert.equal(htmlInspection.target, '#heading-1');
    await exportAs('html', plainFile, false);
    assert.doesNotMatch(await fs.readFile(plainFile, 'utf8'), /<style\b/i);
    await exportAs('pdf', pdfFile);
    const pdfBytes = await fs.readFile(pdfFile);
    assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(await fs.readFile(originalFile, 'utf8'), beforeExport);
    assert.equal(await source.inputValue(), exportMarkdown);
    assert.equal(await window.locator('#document-status').innerText(), '有未保存修改');
    passed('真实 HTML/无样式 HTML/PDF 导出、完整长代码、主题和未保存内容；原文件不变');

    await source.fill(exportMarkdown + '\n![缺失图片](./missing-image.png)\n');
    const failedPdf = path.join(artifacts, 'must-not-exist.pdf');
    await window.locator('#export-btn').click();
    await queue('save', failedPdf);
    await window.locator('#export-confirm').click();
    await window.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false' && document.getElementById('export-message').textContent.includes('导出失败'));
    assert.match(await window.locator('#export-message').innerText(), /图片无法加载/);
    await assert.rejects(fs.access(failedPdf), { code: 'ENOENT' });
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    await window.locator('#export-dialog [data-close-dialog]').first().click();
    await source.fill(exportMarkdown);
    passed('PDF 图片失败明确报错、不生成伪成功文件、释放隐藏窗口');

    await queue('open', originalFile);
    await queue('message', 0);
    await window.locator('#open-btn').click();
    await window.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.match(await source.inputValue(), /EXPORT_UNSAVED_MARKER/);
    assert.equal(await window.locator('#document-status').innerText(), '已保存');
    passed('打开同一文件时先保存再重读，避免载入旧内容');
    const external = '# 磁盘外部版本\n由其他程序编辑。\n';
    await fs.writeFile(originalFile, external);
    await source.fill((await source.inputValue()) + '\n本地冲突修改\n');
    await queue('message', 2);
    await window.locator('#save-btn').click();
    await window.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.equal(await fs.readFile(originalFile, 'utf8'), external);
    assert.equal(await window.locator('#document-status').innerText(), '有未保存修改');
    const conflictCopy = path.join(artifacts, 'conflict-copy.md');
    await queue('message', 0);
    await queue('save', conflictCopy);
    await save();
    assert.equal(await fs.readFile(originalFile, 'utf8'), external);
    assert.match(await fs.readFile(conflictCopy, 'utf8'), /本地冲突修改/);
    passed('真实磁盘外部修改冲突：取消不覆盖，另存保留两个版本');
    await window.locator('#source-btn').click();
    await window.locator('#theme-btn').click();
    assert.equal(await window.locator('body').getAttribute('data-theme'), 'dark');
    assert.equal(await window.locator('#write').evaluate((node) => getComputedStyle(node).getPropertyValue('--prosemirror-virtual-cursor-color').trim()), '#edf7ea');
    await window.screenshot({ path: path.join(artifacts, 'dark.png') });
    await window.locator('#theme-btn').click();
    await window.screenshot({ path: path.join(artifacts, 'light.png') });
    const preferences = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(await window.evaluate(() => typeof window.require), 'undefined');
    assert.deepEqual(errors, []);
    passed('浅深主题、真实窗口安全配置及无页面异常');
    await queue('message', 2);
    await window.evaluate(() => window.inkstone.requestClose('x'.repeat(16 * 1024 * 1024 + 1)));
    assert.ok(!window.isClosed());
    passed('超过保存上限的草稿仍能弹出关闭保护并取消');
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ executablePath, results, exports: { htmlFile, plainFile, pdfFile }, testDoubles: ['Electron原生文件选择框与未保存/磁盘冲突确认框'], notRun: ['Windows 原生对话框手动交互', 'Windows 拼音 IME 组合输入', 'PDF文字提取和渲染在独立后续检查'], errors }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', artifacts, checks: results.length }));
  } catch (error) {
    if (window && !window.isClosed()) await window.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(artifacts, 'failure.json'), JSON.stringify({ error: error.stack, results, errors }, null, 2));
    console.error(`验证失败，证据目录：${artifacts}`);
    throw error;
  } finally {
    if (application) {
      const child = application.process();
      await application.close().catch(() => {});
      if (child.exitCode === null) child.kill();
    }
    await new Promise((resolve) => imageServer.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
