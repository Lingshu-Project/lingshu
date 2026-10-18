'use strict';

// Renderer/IPC UI verification only. Every submit and browser-open feedback
// handler is replaced in this test process. No GitHub Issue is created.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const SUCCESS_FIXTURE = { status: 'ok', number: 424242, url: 'https://example.invalid/lingshu-feedback-fixture/issues/424242' };
const TEST_DOUBLES = [
  'Main-process feedback:submit IPC handler: deterministic errors, deferred result and fictional success fixture; no HTTP request',
  'Main-process feedback:web and feedback:link IPC handlers: record safe arguments; no browser is opened',
  'Main-process feedback:info IPC handler: authentic initial local configuration, with one not-configured UI fixture',
  'Native unsaved-document confirmation: choose discard for this task-owned isolated profile',
  'shell.openExternal guard and HTTP(S) session request cancellation guard',
  'Only the fictional test-token string is entered; credential content is never recorded in reports',
];
const BOUNDARIES = [
  'DEV_VERIFIED renderer and preload IPC behavior with explicit UI test doubles',
  'Actual GitHub authentication, HTTP status mapping, Issue creation and real browser navigation are NOT_RUN',
  'The returned Issue number and URL are fixtures, not evidence of an existing Issue',
  'No claim of physical Windows keyboard or clean-machine installer acceptance',
];
const LABELS = {
  'zh-CN': {
    toolbar: '反馈', heading: '向项目提交反馈', kind: '反馈类型', submit: '直接提交到 Issue', web: '在 GitHub 网页提交',
    webOpened: /此操作尚未创建 Issue/, created: /反馈已创建为 Issue #424242/, view: '查看 Issue #424242',
    errors: {
      notConfigured: /此版本尚未配置反馈仓库/, invalidInput: /请检查标题和详细内容/, missingToken: /需要填写你自己的 GitHub 令牌/,
      unauthorized: /GitHub 未接受此令牌/, forbidden: /GitHub 拒绝了请求/, notFound: /无法访问反馈仓库/,
      rateLimited: /GitHub 请求额度暂时受限/, network: /与 GitHub 的网络通信未完成/,
      submissionUnknown: /未能确认是否已创建 Issue。请先查看仓库中的 Issue，再决定是否重新提交。/,
      unexpected: /无法确认反馈操作的结果/,
    },
  },
  'en-US': {
    toolbar: 'Feedback', heading: 'Send project feedback', kind: 'Feedback type', submit: 'Submit directly to Issues', web: 'Submit on the GitHub website',
    webOpened: /No Issue has been created yet/, created: /Your feedback was created as Issue #424242/, view: 'View Issue #424242',
    errors: {
      notConfigured: /no feedback repository configured/, invalidInput: /Check the length and format/, missingToken: /requires your own GitHub token/,
      unauthorized: /GitHub did not accept this token/, forbidden: /GitHub denied the request/, notFound: /feedback repository is unavailable/,
      rateLimited: /GitHub is temporarily limiting requests/, network: /Network communication with GitHub did not complete/,
      submissionUnknown: /Unable to confirm whether an Issue was created\. Check the repository Issues before deciding whether to submit again\./,
      unexpected: /feedback operation could not be confirmed/,
    },
  },
};

async function main() {
  const project = path.resolve(__dirname, '..');
  const artifacts = path.join(project, 'output', 'feedback-verification', new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(artifacts, { recursive: true });
  const executablePath = process.env.INKSTONE_EXECUTABLE || require('electron');
  const packaged = Boolean(process.env.INKSTONE_EXECUTABLE);
  const metadata = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  const configuration = JSON.parse(await fs.readFile(path.join(project, 'project.json'), 'utf8'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const results = [];
  const errors = [];
  const sessions = [];
  let application;
  let page;
  const passed = (name) => { results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); };

  async function close() {
    if (!application) return;
    const child = application.process();
    await application.close().catch(() => {});
    if (child.exitCode === null) child.kill();
    application = undefined;
  }
  async function idle() {
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false', undefined, { timeout: 15000 });
  }
  async function launch(language) {
    const profile = path.join(artifacts, 'profiles', language);
    application = await _electron.launch({ executablePath, args: [...(packaged ? [] : [project]), `--user-data-dir=${profile}`], cwd: project, env, timeout: 60000 });
    page = await application.firstWindow();
    page.on('pageerror', (error) => errors.push({ language, message: error.message }));
    await page.waitForFunction(() => typeof window.inkstone?.getFeedbackInfo === 'function', undefined, { timeout: 60000 });
    const authenticInfo = await page.evaluate(() => window.inkstone.getFeedbackInfo());
    assert.equal(authenticInfo.configured, true, 'The built application must contain the configured local repository');
    assert.equal(authenticInfo.repositoryUrl, configuration.repositoryUrl);
    assert.equal(authenticInfo.version, metadata.version);
    await application.evaluate(({ ipcMain, dialog, shell, session, BrowserWindow }, info) => {
      const fixture = globalThis.__lingshuFeedbackUiFixture = {
        info, response: { status: 'error', code: 'unauthorized' }, defer: false, pending: [],
        submitCalls: [], webCalls: [], linkCalls: [], unexpectedExternalCalls: 0, blockedHttpOrigins: [],
      };
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      shell.openExternal = async () => { fixture.unexpectedExternalCalls++; throw new Error('UI verification blocked unexpected external navigation'); };
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (request, callback) => {
        fixture.blockedHttpOrigins.push(new URL(request.url).origin);
        callback({ cancel: true });
      });
      for (const channel of ['feedback:info', 'feedback:submit', 'feedback:web', 'feedback:link']) ipcMain.removeHandler(channel);
      ipcMain.handle('feedback:info', () => fixture.info);
      ipcMain.handle('feedback:submit', (_event, request) => {
        // Check the synthetic credential without storing or printing it.
        if (request?.token !== 'test-token') throw new Error('Unexpected UI fixture credential');
        fixture.submitCalls.push({ keys: Object.keys(request).sort(), kind: request.kind, title: request.title, body: request.body, syntheticTokenMatched: true });
        return fixture.defer ? new Promise((resolve) => fixture.pending.push(resolve)) : fixture.response;
      });
      ipcMain.handle('feedback:web', (_event, request) => {
        fixture.webCalls.push({ keys: Object.keys(request).sort(), kind: request.kind, title: request.title, body: request.body, tokenPresent: Object.hasOwn(request, 'token') });
        return { status: 'ok' };
      });
      ipcMain.handle('feedback:link', (_event, target, issueNumber) => {
        fixture.linkCalls.push({ target, ...(issueNumber === undefined ? {} : { issueNumber }) });
        return { status: 'ok' };
      });
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1280, 1000);
      window.focus();
    }, authenticInfo);
    return { profile, authenticInfo };
  }
  async function fixtureState() {
    return application.evaluate(() => {
      const fixture = globalThis.__lingshuFeedbackUiFixture;
      return {
        submitCalls: fixture.submitCalls, webCalls: fixture.webCalls, linkCalls: fixture.linkCalls,
        unexpectedExternalCalls: fixture.unexpectedExternalCalls, blockedHttpOrigins: fixture.blockedHttpOrigins, pending: fixture.pending.length,
      };
    });
  }
  async function response(value, defer = false) {
    await application.evaluate((_electron, options) => { const fixture = globalThis.__lingshuFeedbackUiFixture; fixture.response = options.value; fixture.defer = options.defer; }, { value, defer });
  }
  async function releaseResponse() {
    await application.evaluate(() => { const fixture = globalThis.__lingshuFeedbackUiFixture; fixture.defer = false; for (const resolve of fixture.pending.splice(0)) resolve(fixture.response); });
  }
  async function configured(value) {
    await application.evaluate((_electron, value) => { globalThis.__lingshuFeedbackUiFixture.info = value; }, value);
  }
  async function menu(id) {
    return application.evaluate(({ Menu }, command) => {
      const item = Menu.getApplicationMenu().getMenuItemById(command);
      if (!item) throw new Error(`Missing native menu command: ${command}`);
      item.click(item, undefined, {});
      return item.label;
    }, id);
  }
  async function openFeedback(native = false) {
    if (native) await menu('showFeedback');
    else await page.locator('#feedback-btn').click();
    await page.locator('#feedback-dialog').waitFor();
    await idle();
    assert.equal(await page.locator('#feedback-dialog').evaluate((dialog) => dialog.open), true);
    assert.equal(await page.locator('#feedback-token').inputValue(), '');
  }
  async function closeFeedback(escape = false) {
    if (escape) await page.keyboard.press('Escape');
    else await page.locator('#feedback-dialog [data-close-dialog]').click();
    await page.locator('#feedback-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#feedback-token').inputValue(), '');
  }
  async function setField(id, value) {
    await page.locator(`#${id}`).evaluate((field, value) => { field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  }
  async function fillValid(language) {
    await page.locator('#feedback-kind').selectOption('suggestion');
    await page.locator('#feedback-title').fill(`UI fixture suggestion ${language}`);
    await page.locator('#feedback-body').fill('Fictional feedback entered explicitly for local UI verification.\nNo real Issue is requested.');
  }
  async function screenshot(name) {
    assert.equal(await page.locator('#feedback-token').inputValue(), '', 'Screenshots must show an empty credential input');
    await page.screenshot({ path: path.join(artifacts, name) });
  }

  try {
    for (const language of ['zh-CN', 'en-US']) {
      const labels = LABELS[language];
      const session = await launch(language);
      await page.locator('#language-dialog').waitFor({ timeout: 60000 });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#language-dialog').evaluate((dialog) => dialog.open), true);
      await page.locator(language === 'zh-CN' ? '#language-zh' : '#language-en').click();
      await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
      await idle();
      assert.equal(await page.locator('html').getAttribute('lang'), language);
      assert.equal(await page.locator('#feedback-btn').innerText(), labels.toolbar);
      assert.equal(await page.locator('#feedback-btn').isEnabled(), true);
      await page.locator('#new-btn').click();
      await idle();
      await page.locator('#source-btn').click();
      assert.equal(await page.locator('#source-btn').getAttribute('aria-pressed'), 'true');
      const draft = `# Unsaved local draft ${language}\n\nKeep **this document** unchanged.\nPRIVATE_UI_DOCUMENT_FIXTURE_NOT_FEEDBACK`;
      await page.locator('#source-editor').fill(draft);
      const documentStatus = await page.locator('#document-status').innerText();
      assert.match(documentStatus, language === 'zh-CN' ? /未保存/ : /not saved|unsaved/i);
      const pageUrl = page.url();
      await openFeedback(true);
      assert.equal(await page.locator('#feedback-heading').innerText(), labels.heading);
      assert.equal(await page.locator('label[for="feedback-kind"]').innerText(), labels.kind);
      assert.equal(await page.locator('#feedback-submit').innerText(), labels.submit);
      assert.equal(await page.locator('#feedback-web').innerText(), labels.web);
      const localized = await page.locator('#feedback-dialog').innerText();
      assert.doesNotMatch(localized, /\{(?:version|number)\}|feedback(?:Heading|Privacy|WebHint|Submit)/);
      if (language === 'en-US') assert.doesNotMatch(localized, /\p{Script=Han}/u);
      else assert.doesNotMatch(localized, /Send project feedback|Submit directly|Feedback type|Your GitHub token/);
      assert.equal(await page.locator('#feedback-repository-url').innerText(), configuration.repositoryUrl);
      assert.match(await page.locator('#feedback-version').innerText(), new RegExp(metadata.version.replaceAll('.', '\\.')));
      assert.equal(await page.locator('#feedback-configuration').innerText(), '');
      passed(`${language}: first language choice, toolbar and actual native help menu open localized feedback`);

      assert.equal(await page.locator('#feedback-title').getAttribute('maxlength'), '120');
      assert.equal(await page.locator('#feedback-body').getAttribute('maxlength'), '8000');
      assert.equal(await page.locator('#feedback-token').getAttribute('maxlength'), '1024');
      assert.equal(await page.locator('#feedback-token').getAttribute('type'), 'password');
      assert.equal(await page.locator('#feedback-token').getAttribute('autocomplete'), 'off');
      assert.equal(await page.locator('#feedback-submit').isDisabled(), true);
      assert.equal(await page.locator('#feedback-web').isDisabled(), true);
      await fillValid(language);
      assert.equal(await page.locator('#feedback-submit').isDisabled(), true);
      assert.equal(await page.locator('#feedback-web').isEnabled(), true);
      await page.locator('#feedback-form').evaluate((form) => form.requestSubmit());
      assert.match(await page.locator('#feedback-status').innerText(), labels.errors.missingToken);
      await page.locator('#feedback-token').fill('test token');
      assert.equal(await page.locator('#feedback-submit').isDisabled(), true);
      await page.locator('#feedback-token').fill('test-token');
      assert.equal(await page.locator('#feedback-submit').isEnabled(), true);
      const validTitle = await page.locator('#feedback-title').inputValue();
      const validBody = await page.locator('#feedback-body').inputValue();
      for (const [id, value] of [['feedback-title', ' '.repeat(3)], ['feedback-title', 't'.repeat(121)], ['feedback-body', ''], ['feedback-body', 'b'.repeat(8001)], ['feedback-token', 't'.repeat(1025)]]) {
        await setField(id, value);
        assert.equal(await page.locator('#feedback-submit').isDisabled(), true, `invalid ${id} must disable direct submission`);
        if (id !== 'feedback-token') assert.equal(await page.locator('#feedback-web').isDisabled(), true);
        await page.locator('#feedback-title').fill(validTitle);
        await page.locator('#feedback-body').fill(validBody);
        await page.locator('#feedback-token').fill('test-token');
      }
      await setField('feedback-title', '');
      await page.locator('#feedback-form').evaluate((form) => form.requestSubmit());
      assert.match(await page.locator('#feedback-status').innerText(), labels.errors.invalidInput);
      await fillValid(language);
      assert.equal((await fixtureState()).submitCalls.length, 0);
      passed(`${language}: required fields, bounds, token privacy controls and local validation prevent IPC submission`);

      await closeFeedback();
      await configured({ ...session.authenticInfo, configured: false, repositoryUrl: '', issuesUrl: '' });
      await openFeedback();
      assert.match(await page.locator('#feedback-configuration').innerText(), labels.errors.notConfigured);
      assert.equal(await page.locator('#feedback-submit').isDisabled(), true);
      assert.equal(await page.locator('#feedback-web').isDisabled(), true);
      await closeFeedback();
      await configured(session.authenticInfo);
      await openFeedback();
      passed(`${language}: explicit unconfigured UI fixture disables both submission paths`);

      await fillValid(language);
      await page.locator('#feedback-token').fill('test-token');
      await page.locator('#feedback-web').click();
      await idle();
      assert.equal(await page.locator('#feedback-token').inputValue(), '');
      assert.match(await page.locator('#feedback-status').innerText(), labels.webOpened);
      assert.equal(await page.locator('#feedback-success').isHidden(), true);
      const webCall = (await fixtureState()).webCalls.at(-1);
      assert.deepEqual(webCall.keys, ['body', 'kind', 'title']);
      assert.equal(webCall.kind, 'suggestion');
      assert.equal(webCall.title, validTitle);
      assert.equal(webCall.body, validBody);
      assert.equal(webCall.tokenPresent, false);
      assert.equal(page.url(), pageUrl);
      await screenshot(`${language}-feedback-form-empty-token.png`);
      for (const [id, target] of [['feedback-repository', 'repository'], ['feedback-issues', 'issues'], ['feedback-token-help', 'tokenHelp']]) {
        await page.locator(`#${id}`).click();
        await idle();
        assert.deepEqual((await fixtureState()).linkCalls.at(-1), { target });
      }
      passed(`${language}: website action reports no Issue created, carries no token, and all links use the IPC bridge fixture`);

      const failures = ['unauthorized', 'forbidden', 'notFound', 'rateLimited', 'network', 'submissionUnknown', 'unexpected', 'invalidInput', 'missingToken', 'notConfigured'];
      for (const code of failures) {
        const countBefore = (await fixtureState()).submitCalls.length;
        const deferred = code === 'unauthorized';
        await response({ status: 'error', code }, deferred);
        await page.locator('#feedback-token').fill('test-token');
        await page.locator('#feedback-submit').click();
        if (deferred) {
          await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'true' && document.getElementById('feedback-token').value === '');
          assert.equal((await fixtureState()).pending, 1);
          assert.equal(await page.locator('#feedback-submit').isDisabled(), true);
          await releaseResponse();
        }
        await idle();
        const message = await page.locator('#feedback-status').innerText();
        assert.match(message, labels.errors[code]);
        if (language === 'en-US') assert.doesNotMatch(message, /\p{Script=Han}/u);
        assert.equal(await page.locator('#feedback-title').inputValue(), validTitle);
        assert.equal(await page.locator('#feedback-body').inputValue(), validBody);
        assert.equal(await page.locator('#feedback-token').inputValue(), '');
        assert.equal(await page.locator('#feedback-success').isHidden(), true);
        assert.equal((await fixtureState()).submitCalls.length, countBefore + 1);
        if (code === 'submissionUnknown') {
          await screenshot(`${language}-feedback-submission-unknown-fixture.png`);
          await page.locator('#feedback-issues').click();
          await idle();
          assert.deepEqual((await fixtureState()).linkCalls.at(-1), { target: 'issues' });
          assert.equal((await fixtureState()).submitCalls.length, countBefore + 1, 'Reviewing Issues must not automatically resubmit');
        }
      }
      passed(`${language}: ten simulated error codes localized, pending token cleared immediately, text retained and unknown outcome advises review`);

      await page.locator('#feedback-token').fill('test-token');
      await closeFeedback();
      await openFeedback();
      await page.locator('#feedback-token').fill('test-token');
      await closeFeedback(true);
      await openFeedback();
      assert.equal(await page.locator('#feedback-title').inputValue(), validTitle);
      assert.equal(await page.locator('#feedback-body').inputValue(), validBody);
      passed(`${language}: close button and Escape clear the token while retaining feedback text`);

      await response(SUCCESS_FIXTURE);
      await page.locator('#feedback-token').fill('test-token');
      await page.locator('#feedback-submit').click();
      await idle();
      assert.match(await page.locator('#feedback-status').innerText(), labels.created);
      assert.equal(await page.locator('#feedback-success').isVisible(), true);
      assert.equal(await page.locator('#feedback-view-issue').innerText(), labels.view);
      assert.equal(await page.locator('#feedback-token').inputValue(), '');
      assert.equal(await page.locator('#feedback-submit').isDisabled(), true);
      assert.equal(await page.locator('#feedback-web').isDisabled(), true);
      const submittedCount = (await fixtureState()).submitCalls.length;
      await page.locator('#feedback-form').evaluate((form) => form.requestSubmit());
      assert.equal((await fixtureState()).submitCalls.length, submittedCount);
      await page.locator('#feedback-view-issue').click();
      await idle();
      assert.deepEqual((await fixtureState()).linkCalls.at(-1), { target: 'issues', issueNumber: SUCCESS_FIXTURE.number });
      assert.equal(page.url(), pageUrl);
      await screenshot(`${language}-feedback-success-fixture-empty-token.png`);
      await closeFeedback();
      assert.equal(await page.locator('#source-editor').inputValue(), draft);
      assert.equal(await page.locator('#source-btn').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#document-status').innerText(), documentStatus);
      passed(`${language}: fictional returned Issue number, duplicate-submit guard and view-Issue IPC preserve unsaved Markdown`);

      const audit = await fixtureState();
      for (const call of audit.submitCalls) {
        assert.deepEqual(call.keys, ['body', 'kind', 'title', 'token']);
        assert.equal(call.syntheticTokenMatched, true);
        assert.equal(call.title, validTitle);
        assert.equal(call.body, validBody);
        assert.ok(!JSON.stringify(call).includes('PRIVATE_UI_DOCUMENT_FIXTURE_NOT_FEEDBACK'));
      }
      assert.equal(audit.unexpectedExternalCalls, 0);
      assert.deepEqual(audit.blockedHttpOrigins, []);
      assert.equal(audit.pending, 0);
      assert.equal(application.windows().length, 1);
      sessions.push({ language, profile: session.profile, authenticLocalInfo: session.authenticInfo, ...audit });
      passed(`${language}: sanitized IPC audit contains only explicit feedback fields; no HTTP or external-navigation attempt`);
      await close();
    }
    assert.deepEqual(errors, []);
    const report = { status: 'PASS', verificationLevel: 'DEV_VERIFIED', executablePath, packaged, version: metadata.version, results, errors, sessions, successFixture: { ...SUCCESS_FIXTURE, realIssueCreated: false }, testDoubles: TEST_DOUBLES, realGitHubSubmission: 'NOT_RUN', boundaries: BOUNDARIES };
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: 'PASS', verificationLevel: 'DEV_VERIFIED', artifacts, checks: results.length, realGitHubSubmission: 'NOT_RUN', testDoubles: true }));
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.evaluate(() => { const token = document.getElementById('feedback-token'); if (token) token.value = ''; }).catch(() => {});
      await page.screenshot({ path: path.join(artifacts, 'failure-empty-token.png') }).catch(() => {});
    }
    await fs.writeFile(path.join(artifacts, 'failure.json'), JSON.stringify({ status: 'FAILED_OR_BLOCKED', error: error.stack, results, errors, testDoubles: TEST_DOUBLES, realGitHubSubmission: 'NOT_RUN', boundaries: BOUNDARIES }, null, 2));
    console.error(`反馈 UI 测试证据目录：${artifacts}`);
    throw error;
  } finally { await close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
