const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

async function main() {
  if (process.env.LINGSHU_ALLOW_LIVE_ISSUE !== '1') throw new Error('Live verification creates and closes a public test Issue. Set LINGSHU_ALLOW_LIVE_ISSUE=1 only after authorization.');
  const project = path.resolve(__dirname, '..');
  const repository = 'https://github.com/Lingshu-Project/lingshu';
  const api = 'https://api.github.com/repos/Lingshu-Project/lingshu';
  const metadata = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifacts = path.join(project, 'output/live-feedback-verification', stamp);
  await fs.mkdir(artifacts, { recursive: true });
  const executablePath = process.env.INKSTONE_EXECUTABLE || require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  let token = '';
  let page;
  let child;
  const errors = [];
  const title = `[Verification] Lingshu ${metadata.version} desktop feedback ${stamp}`;
  const body = 'Release verification of the real desktop feedback form.\n\nThis issue was submitted through the unchanged application UI, preload, IPC and GitHub REST path. No user document, log, local path or personal contact information is attached. It is closed after verification.';
  const request = async (suffix, method = 'GET', data) => {
    const response = await fetch(`${api}${suffix}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Lingshu-Release-Verification', ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (!response.ok) throw new Error(`GitHub verification HTTP ${response.status}`);
    return response.json();
  };
  try {
    application = await _electron.launch({ executablePath, args: [...(process.env.INKSTONE_EXECUTABLE ? [] : [project]), `--user-data-dir=${path.join(artifacts, 'profile')}`], cwd: project, env, timeout: 60000 });
    child = application.process();
    page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#language-zh').waitFor({ timeout: 60000 });
    await page.locator('#language-zh').click();
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    await page.locator('#feedback-btn').click();
    await page.waitForFunction(() => document.getElementById('feedback-dialog').open && document.body.getAttribute('aria-busy') === 'false');
    const info = await page.evaluate(() => window.inkstone.getFeedbackInfo());
    assert.equal(info.configured, true);
    assert.equal(info.repositoryUrl, repository);
    assert.equal(info.version, metadata.version);
    await page.locator('#feedback-kind').selectOption('suggestion');
    await page.locator('#feedback-title').fill(title);
    await page.locator('#feedback-body').fill(body);
    assert.equal(await page.locator('#feedback-token').isVisible(), true);
    token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!token) throw new Error('GitHub CLI did not supply an authenticated token.');
    // No tracing, console echo, screenshots, or filesystem writes contain this value.
    await page.locator('#feedback-token').fill(token);
    assert.equal(await page.locator('#feedback-submit').isEnabled(), true);
    await page.locator('#feedback-submit').click();
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false', undefined, { timeout: 45000 });
    assert.equal(await page.locator('#feedback-token').evaluate(input => input.value.length === 0), true);
    const message = await page.locator('#feedback-status').innerText();
    const match = /#(\d+)/.exec(await page.locator('#feedback-view-issue').innerText());
    if (!match || !await page.locator('#feedback-view-issue').isVisible()) throw new Error('The real app did not confirm Issue creation: ' + message);
    const number = Number(match[1]);
    const issue = await request(`/issues/${number}`);
    assert.equal(issue.html_url, `${repository}/issues/${number}`);
    assert.equal(issue.title, title);
    assert.equal(issue.body, `${body}\n\n---\nFeedback type: suggestion\nLingshu version: ${metadata.version}\n`);
    await page.screenshot({ path: path.join(artifacts, 'feedback-created-zh-CN.png') });
    const closed = await request(`/issues/${number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
    assert.equal(closed.state, 'closed');
    assert.deepEqual(errors, []);
    const report = { status: 'PASS', version: metadata.version, executablePath, issue: { number, url: issue.html_url, title, stateAfterVerification: closed.state }, checks: ['real released feedback UI visible', 'installed canonical repository and current version', 'real GitHub Issue created through production preload/IPC/service', 'GitHub read-back matches exact user-entered body and only type/version metadata', 'token input cleared', 'verification issue closed', 'no renderer errors'], testDoubles: [], credentialHandling: 'GitHub CLI token used only in process memory; not logged, saved or bundled' };
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: 'PASS', artifacts, issueUrl: issue.html_url, state: closed.state }));
  } catch (error) {
    const safeError = token ? String(error.stack || error).replaceAll(token, '<redacted>') : String(error.stack || error);
    if (page && !page.isClosed()) {
      await page.locator('#feedback-token').fill('').catch(() => {});
      await page.screenshot({ path: path.join(artifacts, 'failure.png'), mask: [page.locator('#feedback-token')] }).catch(() => {});
    }
    await fs.writeFile(path.join(artifacts, 'failure.json'), JSON.stringify({ status: 'FAILED', error: safeError, testDoubles: [] }, null, 2));
    console.error(safeError);
    process.exitCode = 1;
  } finally {
    token = '';
    if (application) await application.close().catch(() => {});
    if (child && child.exitCode === null) child.kill();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
