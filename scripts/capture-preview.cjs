const { _electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');

async function main() {
  const project = path.resolve(__dirname, '..');
  const outputs = path.resolve(project, '..', '..', 'outputs');
  const profile = path.join(project, 'output', 'preview', new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(profile, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  for (const language of ['zh-CN', 'en-US']) {
    const application = await _electron.launch({
      executablePath: path.join(outputs, `Lingshu-Markdown-${manifest.version}-win-x64`, 'Lingshu.exe'),
      args: [`--user-data-dir=${path.join(profile, language)}`], env, timeout: 60000,
    });
    const child = application.process();
    try {
    const page = await application.firstWindow();
    await page.locator('#language-dialog').waitFor({ timeout: 60000 });
    if (language === 'zh-CN') await page.screenshot({ path: path.join(outputs, '灵书-首次语言选择.png') });
    await page.locator(language === 'zh-CN' ? '#language-zh' : '#language-en').click();
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    await page.locator('#write h1').waitFor();
    await page.screenshot({ path: path.join(outputs, `灵书-${language}-编辑界面.png`) });
    await page.locator('#export-btn').click();
    await page.screenshot({ path: path.join(outputs, `灵书-${language}-导出设置.png`) });
    await page.locator('#export-dialog [data-close-dialog]').first().click();
    await page.locator('#custom-theme-btn').click();
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    await page.screenshot({ path: path.join(outputs, `灵书-${language}-CSS主题.png`) });
    await page.locator('#theme-dialog [data-close-dialog]').first().click();
    await page.locator('#new-btn').click();
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    await page.locator('#write').click();
    await page.keyboard.type('/');
    await page.locator('.milkdown-slash-menu').waitFor();
    await page.locator('.milkdown-slash-menu .tab-group').getByText(language === 'zh-CN' ? '列表' : 'List', { exact: true }).click();
    // The menu scrolls smoothly; capture only once the chosen group is in view.
    await page.waitForFunction(label => {
      const root = document.querySelector('.milkdown-slash-menu .menu-groups');
      const group = [...root.querySelectorAll('.menu-group')].find(item => item.querySelector('h6').textContent === label);
      const item = group.querySelector('li[data-index]').getBoundingClientRect();
      const viewport = root.getBoundingClientRect();
      return item.top >= viewport.top && item.top - viewport.top < 72 && item.bottom <= viewport.bottom;
    }, language === 'zh-CN' ? '列表' : 'List');
    await page.screenshot({ path: path.join(outputs, `灵书-${language}-插入菜单.png`) });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    console.log(`已从便携版实际窗口生成 ${language} 预览。`);
    } finally {
      await application.close();
      if (child.exitCode === null) child.kill();
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
