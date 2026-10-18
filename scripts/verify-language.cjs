const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const project = path.resolve(__dirname, '..');
  const artifacts = path.join(project, 'output', 'language-verification', new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(artifacts, { recursive: true });
  const results = [];
  const passed = (name) => { results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); };
  const executablePath = process.env.INKSTONE_EXECUTABLE || require('electron');
  const packaged = Boolean(process.env.INKSTONE_EXECUTABLE);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  let page;
  const errors = [];
  async function close() {
    if (!application) return;
    const child = application.process();
    await application.close().catch(() => {});
    if (child.exitCode === null) child.kill();
    application = undefined;
  }
  async function launch(profile) {
    application = await _electron.launch({ executablePath, args: [...(packaged ? [] : [project]), `--user-data-dir=${profile}`], cwd: project, env, timeout: 60000 });
    page = await application.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    // Only the native unsaved-confirmation button is answered; the renderer and editor run unchanged.
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  }
  async function ready() {
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    const focused = await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.focus(); return window.isFocused(); });
    console.log(`Native window focused: ${focused}`);
  }
  async function sourceText() {
    if (await page.locator('#source-btn').getAttribute('aria-pressed') !== 'true') await page.locator('#source-btn').click();
    return page.locator('#source-editor').inputValue();
  }
  async function setText(text) {
    await sourceText();
    await page.locator('#source-editor').fill(text);
    await page.locator('#source-btn').click();
    await page.locator('#write').click();
    await page.keyboard.press('Control+Home');
  }
  async function menu(command) {
    await application.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu().getMenuItemById(id);
      if (!item) throw new Error(`Missing native command: ${id}`);
      item.click(item, undefined, {});
    }, command);
  }
  async function hotkey(keyCode, modifiers = []) {
    await application.evaluate(({ BrowserWindow }, input) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.focus();
      window.webContents.sendInputEvent({ type: 'keyDown', ...input });
      window.webContents.sendInputEvent({ type: 'keyUp', ...input });
    }, { keyCode, modifiers });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  try {
    for (const language of ['zh-CN', 'en-US']) {
      const profile = path.join(artifacts, language);
      await launch(profile);
      await page.locator('#language-dialog').waitFor({ timeout: 60000 });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#language-dialog').evaluate((dialog) => dialog.open), true);
      await page.locator(language === 'zh-CN' ? '#language-zh' : '#language-en').click();
      await ready();
      await page.evaluate(() => { window.__verificationCommands = []; window.inkstone.onCommand(command => window.__verificationCommands.push(command)); });
      assert.equal(await page.locator('html').getAttribute('lang'), language);
      assert.equal((await page.evaluate(() => window.inkstone.getPreferences())).language, language);
      const menuLabels = await application.evaluate(({ Menu }) => {
        const visit = (items) => items.flatMap((item) => [item.label, ...(item.submenu ? visit(item.submenu.items) : [])]);
        return visit(Menu.getApplicationMenu().items);
      });
      assert.ok(menuLabels.includes(language === 'zh-CN' ? '文件' : 'File'));
      if (language === 'en-US') assert.ok(!menuLabels.some((label) => /\p{Script=Han}/u.test(label)));
      await page.screenshot({ path: path.join(artifacts, `${language}-welcome.png`) });
      passed(`${language}: first launch choice, persisted preference, native menu and welcome`);

      await page.locator('#new-btn').click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      const rich = page.locator('#write');
      await rich.click();
      await page.keyboard.type('/');
      const slash = page.locator('.milkdown-slash-menu');
      await slash.waitFor();
      const slashText = await slash.innerText();
      for (const text of language === 'zh-CN' ? ['列表', '高级'] : ['List', 'Advanced']) assert.ok(slashText.includes(text), slashText);
      if (language === 'zh-CN') assert.doesNotMatch(slashText, /Bullet List|Ordered List|Task List|Advanced|Heading/);
      else assert.doesNotMatch(slashText, /\p{Script=Han}/u);
      const listLabel = language === 'zh-CN' ? '列表' : 'List';
      await slash.locator('.tab-group').getByText(listLabel, { exact: true }).click();
      await page.waitForFunction(label => {
        const root = document.querySelector('.milkdown-slash-menu .menu-groups');
        const group = [...root.querySelectorAll('.menu-group')].find(item => item.querySelector('h6').textContent === label);
        const item = group.querySelector('li[data-index]').getBoundingClientRect();
        const viewport = root.getBoundingClientRect();
        return item.top >= viewport.top && item.top - viewport.top < 72 && item.bottom <= viewport.bottom;
      }, listLabel);
      for (const label of language === 'zh-CN' ? ['无序列表', '有序列表', '任务列表', '代码块', '表格', '数学公式'] : ['Bullet List', 'Ordered List', 'Task List', 'Code', 'Table', 'Math']) assert.ok(slashText.includes(label), slashText);
      await page.screenshot({ path: path.join(artifacts, `${language}-insert-menu.png`) });
      await page.keyboard.press('Escape');
      await page.locator('#export-btn').click();
      if (language === 'en-US') assert.doesNotMatch(await page.locator('#export-dialog').innerText(), /\p{Script=Han}/u);
      await page.screenshot({ path: path.join(artifacts, `${language}-export.png`) });
      await page.locator('#export-dialog [data-close-dialog]').first().click();
      await page.locator('#custom-theme-btn').click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      if (language === 'en-US') assert.doesNotMatch(await page.locator('#theme-dialog').innerText(), /\p{Script=Han}/u);
      await page.locator('#theme-dialog [data-close-dialog]').first().click();
      passed(`${language}: actual insertion menu, export and theme panels localized`);

      await setText('alpha beta');
      await hotkey('1', ['control']);
      await page.locator('#write h1').waitFor();
      await hotkey('0', ['control']);
      assert.equal(await page.locator('#write h1').count(), 0);
      await hotkey('A', ['control']);
      assert.equal(await page.evaluate(() => window.getSelection().toString()), 'alpha beta');
      await hotkey('B', ['control']);
      assert.match(await sourceText(), /\*\*alpha beta\*\*/);
      await page.locator('#source-btn').click();
      await hotkey('Z', ['control']);
      assert.equal(await page.locator('#write strong').count(), 0);
      await setText('alpha beta');
      await hotkey('A', ['control']);
      await hotkey('U', ['control']);
      assert.match(await sourceText(), /<u>alpha beta<\/u>/);
      await setText('alpha beta');
      await hotkey('A', ['control']);
      await menu('edit:highlight');
      assert.match(await sourceText(), /==alpha beta==/);
      passed(`${language}: Electron Ctrl+1/0/B/U/Z input and native highlight menu handler`);
      await sourceText();
      await page.locator('#source-editor').fill('source alpha');
      await hotkey('A', ['control']);
      await hotkey('B', ['control']);
      assert.equal(await page.locator('#source-editor').inputValue(), '**source alpha**');
      await hotkey('Z', ['control']);
      assert.equal(await page.locator('#source-editor').inputValue(), 'source alpha');
      await hotkey('Y', ['control']);
      assert.equal(await page.locator('#source-editor').inputValue(), '**source alpha**');
      passed(`${language}: source-mode Ctrl+B/Z/Y context editing and history`);

      await setText('- first\n- second\n');
      await page.locator('#write li').last().locator('p').click();
      await hotkey('[', ['control']);
      assert.equal(await page.locator('#write li li').count(), 1);
      await hotkey(']', ['control']);
      assert.equal(await page.locator('#write li li').count(), 0);
      await hotkey('Tab');
      assert.equal(await page.locator('#write li li').count(), 1);
      await hotkey('Tab', ['shift']);
      assert.equal(await page.locator('#write li li').count(), 0);
      await sourceText();
      await page.locator('#source-editor').fill('source indent');
      await hotkey('A', ['control']);
      await hotkey('[', ['control']);
      assert.equal(await page.locator('#source-editor').inputValue(), '  source indent');
      await hotkey(']', ['control']);
      assert.equal(await page.locator('#source-editor').inputValue(), 'source indent');
      passed(`${language}: official Ctrl+[/] indentation in rich/source modes and list Tab/Shift+Tab`);

      await setText('');
      await hotkey('M', ['control', 'shift']);
      assert.match(await sourceText(), /\$\$/);
      await setText('');
      await hotkey('K', ['control', 'shift']);
      assert.match(await sourceText(), /```/);
      await setText('');
      await hotkey('T', ['control']);
      await page.locator('#write table:visible').first().waitFor();
      await setText('');
      await page.keyboard.type('```python');
      await page.keyboard.press('Enter');
      await page.locator('#write .cm-editor').waitFor();
      await page.keyboard.insertText('def square(x):\n    return x * x');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const markdown = await sourceText();
      assert.match(markdown, /```python/);
      assert.match(markdown, /return x \* x/);
      await page.locator('#source-btn').click();
      await page.waitForFunction(() => document.querySelectorAll('#write .cm-content .cm-line span').length > 0);
      await setText('');
      await page.keyboard.type('$$');
      await page.keyboard.press('Enter');
      assert.match(await sourceText(), /\$\$/);
      passed(`${language}: Electron math/code/table shortcuts, fenced code and math Enter input`);

      await setText('Find alpha and alpha.');
      await hotkey('F', ['control']);
      await page.locator('#find-query').fill('alpha');
      await page.keyboard.press('Enter');
      assert.match(await page.locator('#find-result').innerText(), /2/);
      await page.keyboard.press('Escape');
      await setText('Find **alpha** and alpha. Alpha remains.');
      await hotkey('H', ['control']);
      await page.locator('#find-query').fill('alpha');
      await page.locator('#replace-text').fill('beta');
      await page.locator('#replace-all').click();
      assert.equal(await page.locator('#write strong').innerText(), 'beta');
      await page.keyboard.press('Escape');
      const replacedText = await sourceText();
      assert.match(replacedText, /\*\*beta\*\* and beta/);
      assert.match(replacedText, /Alpha remains/);
      await page.locator('#source-btn').click();
      await setText('Before $x$ alpha after.');
      await hotkey('H', ['control']);
      await page.locator('#find-query').fill('alpha');
      await page.locator('#replace-text').fill('beta');
      await page.locator('#replace-all').click();
      await page.keyboard.press('Escape');
      assert.match(await sourceText(), /Before \$x\$ beta after\./);
      await page.locator('#source-btn').click();
      passed(`${language}: replace-all changes real document and preserves bold structure`);
      await hotkey('/', ['control']);
      assert.equal(await page.locator('#source-btn').getAttribute('aria-pressed'), 'true');
      await hotkey('/', ['control']);
      assert.equal(await page.locator('#source-btn').getAttribute('aria-pressed'), 'false');
      await hotkey('F8');
      assert.ok(await page.locator('body').evaluate((body) => body.classList.contains('focus-mode')));
      await hotkey('F8');
      await hotkey('F9');
      assert.ok(await page.locator('body').evaluate((body) => body.classList.contains('typewriter-mode')));
      await hotkey('F9');
      passed(`${language}: Electron find, source, focus and typewriter shortcut dispatch`);
      await setText('==marked== <u>under **bold**</u> $E=mc^2$\n\n\\==literal==');
      assert.equal(await page.locator('#write mark').count(), 1);
      assert.equal(await page.locator('#write strong').innerText(), 'bold');
      assert.ok(await page.locator('#write strong').evaluate(node => Boolean(node.closest('u') || node.querySelector('u'))));
      await page.locator('#write .katex').waitFor();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText(' tail');
      const preserved = await sourceText();
      await page.locator('#source-btn').click();
      assert.equal(await page.locator('#write mark').count(), 1);
      assert.match(preserved, /literal/);
      passed(`${language}: inline math, nested underline/highlight, escaped literal survives edit and roundtrip`);

      const beforeSwitch = await sourceText();
      await page.locator('#language-btn').click();
      await page.locator(language === 'zh-CN' ? '#language-en' : '#language-zh').click();
      await page.waitForFunction(expected => document.documentElement.lang === expected && !document.getElementById('language-dialog').open && document.body.getAttribute('aria-busy') === 'false', language === 'zh-CN' ? 'en-US' : 'zh-CN');
      await ready();
      assert.equal(await page.locator('#source-editor').inputValue(), beforeSwitch);
      assert.equal((await page.evaluate(() => window.inkstone.getPreferences())).language, language === 'zh-CN' ? 'en-US' : 'zh-CN');
      await page.locator('#language-btn').click();
      await page.locator(language === 'zh-CN' ? '#language-zh' : '#language-en').click();
      await page.waitForFunction(expected => document.documentElement.lang === expected && !document.getElementById('language-dialog').open && document.body.getAttribute('aria-busy') === 'false', language);
      await ready();
      assert.equal(await page.locator('#source-editor').inputValue(), beforeSwitch);
      passed(`${language}: switching both languages preserves unsaved source text`);
      await close();
      await launch(profile);
      await ready();
      assert.equal(await page.locator('#language-dialog').evaluate((dialog) => dialog.open), false);
      assert.equal(await page.locator('html').getAttribute('lang'), language);
      passed(`${language}: restart restores chosen language without asking again`);
      await close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ executablePath, results, errors, testDoubles: ['Native unsaved-confirmation answer'], keyboardEvidence: { ElectronSendInputTestedShortcuts: 'PASS', CDPMenuAccelerators: 'NO_EFFECT', physicalWindowsKeyboard: 'NOT_RUNTIME_OBSERVABLE' }, boundaries: ['Highlight command invoked via actual MenuItem.click; tested keyboard chords use Electron.sendInputEvent', 'No full Typora feature parity claim', 'Windows IME and installer first-run on a clean PC not manually verified'] }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', artifacts, checks: results.length }));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(artifacts, 'failure.json'), JSON.stringify({ error: error.stack, results, errors }, null, 2));
    console.error(`证据目录：${artifacts}`);
    throw error;
  } finally { await close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
