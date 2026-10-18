'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { FeedbackService, TOKEN_HELP_URL, API_VERSION } = require('../electron/feedback.cjs')

// All HTTP responses and browser launches below are explicit component doubles.
// No test creates an issue, reads credentials, or contacts GitHub.
const repoUrl = 'https://github.com/example-owner/lingshu-test'
const valid = () => ({ kind: 'bug', title: 'A test report', body: 'User supplied details.', token: 'test_token_not_a_credential' })
const issue = (number = 7, html_url = `${repoUrl}/issues/${number}`) => new Response(JSON.stringify({ number, html_url }), { status: 201 })

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-feedback-'))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('lingshu-feedback-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  const projectPath = path.join(root, 'project.json')
  const writeProject = value => fs.writeFile(projectPath, JSON.stringify({ repositoryUrl: value, attribution: 'Lingshu Project' }), 'utf8')
  await writeProject(options.repositoryUrl ?? repoUrl)
  const requests = []
  const opened = []
  const service = new FeedbackService({
    projectPath, version: '0.3.0', timeoutMs: options.timeoutMs ?? 15000,
    fetchImpl: options.fetchImpl ?? (async (url, request) => { requests.push({ url, request }); return issue() }),
    openExternal: options.openExternal ?? (async url => { opened.push(url) }),
  })
  return { service, projectPath, writeProject, requests, opened }
}

test('feedback: fixed project file, canonical repository, and current version', async t => {
  const { service, writeProject } = await fixture(t)
  assert.deepEqual(await service.getInfo(), { configured: true, repositoryUrl: repoUrl, issuesUrl: `${repoUrl}/issues`, tokenHelpUrl: TOKEN_HELP_URL, version: '0.3.0' })
  await writeProject('https://github.com/example-owner/another-repo')
  assert.equal((await service.getInfo()).repositoryUrl, 'https://github.com/example-owner/another-repo')
})

test('feedback: absent, corrupt, empty, or unsafe repository never submits or opens a placeholder', async t => {
  const { service, projectPath, writeProject, requests, opened } = await fixture(t)
  for (const unsafe of ['', null, 'https://example.com/owner/repo', 'https://github.com.evil.test/owner/repo', 'https://github.com/owner/repo/issues', 'https://github.com/owner/repo?token=bad', 'https://user:password@github.com/owner/repo', 'https://github.com/owner/../repo', 'https://github.com/owner/repo.git', 'http://github.com/owner/repo']) {
    await writeProject(unsafe)
    assert.equal((await service.getInfo()).configured, false)
    assert.deepEqual(await service.submit(valid()), { status: 'error', code: 'notConfigured' })
    assert.deepEqual(await service.openWeb({ kind: 'bug', title: 'Title', body: 'Body' }), { status: 'error', code: 'notConfigured' })
  }
  await fs.writeFile(projectPath, '{invalid')
  assert.equal((await service.getInfo()).configured, false)
  await fs.unlink(projectPath)
  assert.equal((await service.getInfo()).configured, false)
  assert.equal(requests.length, 0)
  assert.equal(opened.length, 0)
})

test('feedback: bounded input and missing token are rejected before HTTP', async t => {
  const { service, requests } = await fixture(t)
  for (const invalid of [null, [], 'input', { ...valid(), kind: 'other' }, { ...valid(), title: '' }, { ...valid(), title: '   ' }, { ...valid(), title: 'x'.repeat(121) }, { ...valid(), title: 'two\nlines' }, { ...valid(), body: '\t\n' }, { ...valid(), body: 'x'.repeat(8001) }, { ...valid(), body: 'bad\u0000body' }, { ...valid(), token: 123 }, { ...valid(), token: 'bad\r\nheader' }, { ...valid(), token: 'x'.repeat(1025) }, { ...valid(), document: 'not permitted' }]) {
    assert.deepEqual(await service.submit(invalid), { status: 'error', code: 'invalidInput' })
  }
  for (const missing of [undefined, '', '  ']) assert.deepEqual(await service.submit({ ...valid(), token: missing }), { status: 'error', code: 'missingToken' })
  assert.equal(requests.length, 0)
})

test('feedback: one fixed-host POST uses official headers without mutating input or persisting token', async t => {
  const { service, requests, projectPath } = await fixture(t)
  const input = { ...valid(), title: '  My report  ', body: '\nMy original details.\n' }
  const before = structuredClone(input)
  const result = await service.submit(input)
  assert.deepEqual(result, { status: 'ok', number: 7, url: `${repoUrl}/issues/7` })
  assert.deepEqual(input, before)
  assert.equal(requests.length, 1)
  const { url, request } = requests[0]
  assert.equal(url, 'https://api.github.com/repos/example-owner/lingshu-test/issues')
  assert.equal(request.method, 'POST')
  assert.equal(request.redirect, 'error')
  assert.equal(request.headers.Authorization, `Bearer ${input.token}`)
  assert.equal(request.headers.Accept, 'application/vnd.github+json')
  assert.equal(request.headers['X-GitHub-Api-Version'], API_VERSION)
  assert.equal(request.headers['Content-Type'], 'application/json')
  assert.equal(request.headers['User-Agent'], 'Lingshu-Markdown/0.3.0')
  assert.ok(request.signal instanceof AbortSignal)
  assert.deepEqual(JSON.parse(request.body), { title: 'My report', body: '\nMy original details.\n\n\n---\nFeedback type: bug\nLingshu version: 0.3.0\n' })
  assert.equal(JSON.stringify(result).includes(input.token), false)
  assert.equal(JSON.stringify(service).includes(input.token), false)
  assert.equal((await fs.readFile(projectPath, 'utf8')).includes(input.token), false)
})

test('feedback: explicit HTTP fixtures map authentication, access, validation, and rate limits', async t => {
  const cases = [
    [401, {}, {}, 'unauthorized'], [403, {}, {}, 'forbidden'], [404, {}, {}, 'notFound'], [410, {}, {}, 'forbidden'],
    [400, {}, {}, 'invalidInput'], [422, {}, {}, 'invalidInput'], [429, {}, {}, 'rateLimited'],
    [403, { 'x-ratelimit-remaining': '0' }, {}, 'rateLimited'], [403, { 'retry-after': '60' }, {}, 'rateLimited'],
    [403, {}, { message: 'You have exceeded a secondary rate limit.' }, 'rateLimited'],
    [503, {}, {}, 'network'], [302, {}, {}, 'submissionUnknown'], [200, {}, {}, 'submissionUnknown'],
  ]
  for (const [status, headers, body, expected] of cases) {
    const { service } = await fixture(t, { fetchImpl: async () => new Response(JSON.stringify(body), { status, headers }) })
    assert.deepEqual(await service.submit(valid()), { status: 'error', code: expected })
  }
})

test('feedback: successful responses must identify an issue in the exact configured repository', async t => {
  for (const data of [
    { number: 7, html_url: 'https://evil.test/owner/repo/issues/7' },
    { number: 7, html_url: `${repoUrl}/issues/8` },
    { number: 7, html_url: 'https://github.com/example-owner/other/issues/7' },
    { number: 7, html_url: `${repoUrl}/issues/7?next=evil` },
    { number: 7, html_url: `${repoUrl}/issues/7#fragment` },
    { number: 7, html_url: 'https://user@github.com/example-owner/lingshu-test/issues/7' },
    { number: 0, html_url: `${repoUrl}/issues/0` },
    { number: 7.5, html_url: `${repoUrl}/issues/7.5` },
    { number: 7, html_url: `${repoUrl}/issues/7`, pull_request: {} },
  ]) {
    const { service } = await fixture(t, { fetchImpl: async () => new Response(JSON.stringify(data), { status: 201 }) })
    assert.deepEqual(await service.submit(valid()), { status: 'error', code: 'submissionUnknown' })
  }
})

test('feedback: invalid or oversized response bodies cannot establish issue creation', async t => {
  for (const body of ['{invalid', ' '.repeat(256 * 1024 + 1)]) {
    const { service } = await fixture(t, { fetchImpl: async () => new Response(body, { status: 201 }) })
    assert.deepEqual(await service.submit(valid()), { status: 'error', code: 'submissionUnknown' })
  }
})

test('feedback: lost POST response is unknown, redacted, and never automatically retried', async t => {
  let attempts = 0
  let acceptedCreates = 0
  const { service } = await fixture(t, { fetchImpl: async () => {
    attempts++
    acceptedCreates++ // Fixture models server acceptance followed by a lost response.
    throw new Error('Deliberately sensitive fixture details')
  } })
  assert.deepEqual(await service.submit(valid()), { status: 'error', code: 'submissionUnknown' })
  assert.equal(attempts, 1)
  assert.equal(acceptedCreates, 1)
})

test('feedback: timeout aborts a pending request and returns without retries', async t => {
  let attempts = 0
  let aborted = false
  const { service } = await fixture(t, { timeoutMs: 20, fetchImpl: async (_url, { signal }) => {
    attempts++
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted fixture')) }, { once: true }))
  } })
  assert.deepEqual(await service.submit(valid()), { status: 'error', code: 'submissionUnknown' })
  assert.equal(aborted, true)
  assert.equal(attempts, 1)
})

test('feedback: 201 body stalled after acceptance is unknown and never reposted', async t => {
  let attempts = 0
  let acceptedCreates = 0
  let aborted = false
  const { service } = await fixture(t, { timeoutMs: 20, fetchImpl: async (_url, { signal }) => {
    attempts++
    acceptedCreates++
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"number":7,'))
      signal.addEventListener('abort', () => { aborted = true; controller.error(new Error('Fixture body interrupted on abort')) }, { once: true })
    } }), { status: 201 })
  } })
  assert.deepEqual(await service.submit(valid()), { status: 'error', code: 'submissionUnknown' })
  assert.equal(attempts, 1)
  assert.equal(acceptedCreates, 1)
  assert.equal(aborted, true)
})

test('feedback: 201 JSON stream failure after acceptance is unknown without a second request', async t => {
  let attempts = 0
  let acceptedCreates = 0
  const { service } = await fixture(t, { fetchImpl: async () => {
    attempts++
    acceptedCreates++
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"number":7,'))
      queueMicrotask(() => controller.error(new Error('Fixture JSON stream failure')))
    } }), { status: 201 })
  } })
  assert.deepEqual(await service.submit(valid()), { status: 'error', code: 'submissionUnknown' })
  assert.equal(attempts, 1)
  assert.equal(acceptedCreates, 1)
})

test('feedback: known HTTP failures retain their mapping when response JSON stalls or throws', async t => {
  for (const [status, headers, expected] of [[401, {}, 'unauthorized'], [403, { 'x-ratelimit-remaining': '0' }, 'rateLimited'], [503, {}, 'network']]) {
    for (const stall of [true, false]) {
      let attempts = 0
      const { service } = await fixture(t, { timeoutMs: 20, fetchImpl: async (_url, { signal }) => {
        attempts++
        return new Response(new ReadableStream({ start(controller) {
          const fail = () => controller.error(new Error('Fixture HTTP-error body failure'))
          if (stall) signal.addEventListener('abort', fail, { once: true })
          else queueMicrotask(fail)
        } }), { status, headers })
      } })
      assert.deepEqual(await service.submit(valid()), { status: 'error', code: expected })
      assert.equal(attempts, 1)
    }
  }
})

test('feedback: a concurrent second submit does not create a second request', async t => {
  let release
  let begin
  const started = new Promise(resolve => { begin = resolve })
  let attempts = 0
  const { service } = await fixture(t, { fetchImpl: async () => { attempts++; begin(); return new Promise(resolve => { release = resolve }) } })
  const first = service.submit(valid())
  await started
  assert.deepEqual(await service.submit(valid()), { status: 'error', code: 'unexpected' })
  release(issue())
  assert.equal((await first).status, 'ok')
  assert.equal(attempts, 1)
})

test('feedback: web form is encoded, contains no token, and claims only opened', async t => {
  const { service, opened, requests } = await fixture(t)
  const input = { kind: 'suggestion', title: 'An & encoded # title', body: '正文 & ? = + # detail' }
  assert.deepEqual(await service.openWeb(input), { status: 'ok' })
  assert.equal(requests.length, 0)
  assert.equal(opened.length, 1)
  const url = new URL(opened[0])
  assert.equal(url.origin, 'https://github.com')
  assert.equal(url.pathname, '/example-owner/lingshu-test/issues/new')
  assert.equal(url.searchParams.get('title'), input.title)
  assert.equal(url.searchParams.get('body'), `${input.body}\n\n---\nFeedback type: suggestion\nLingshu version: 0.3.0\n`)
  assert.deepEqual([...url.searchParams.keys()], ['title', 'body'])
  assert.deepEqual(await service.openWeb({ ...input, token: 'must_not_open' }), { status: 'error', code: 'invalidInput' })
  assert.deepEqual(await service.openWeb({ ...input, body: '中'.repeat(1000) }), { status: 'error', code: 'invalidInput' })
  assert.equal(opened.length, 1)
})

test('feedback: external links are limited to configured GitHub destinations and official token help', async t => {
  const { service, opened, writeProject } = await fixture(t)
  assert.deepEqual(await service.openLink('repository'), { status: 'ok' })
  assert.deepEqual(await service.openLink('issues'), { status: 'ok' })
  assert.deepEqual(await service.openLink('issues', 7), { status: 'ok' })
  assert.deepEqual(await service.openLink('tokenHelp'), { status: 'ok' })
  assert.deepEqual(opened, [repoUrl, `${repoUrl}/issues`, `${repoUrl}/issues/7`, TOKEN_HELP_URL])
  for (const [target, number] of [['https://evil.test'], ['issues', 0], ['issues', -1], ['issues', 1.5], ['issues', '7'], ['repository', 7], ['tokenHelp', 7]]) {
    assert.deepEqual(await service.openLink(target, number), { status: 'error', code: 'invalidInput' })
  }
  await writeProject('')
  assert.deepEqual(await service.openLink('repository'), { status: 'error', code: 'notConfigured' })
  assert.deepEqual(await service.openLink('tokenHelp'), { status: 'ok' })
  assert.equal(opened.length, 5)
})

test('feedback: opening browser failure remains a safe code without leaking error details', async t => {
  const { service } = await fixture(t, { openExternal: async () => { throw new Error('Deliberately sensitive shell fixture details') } })
  assert.deepEqual(await service.openLink('issues'), { status: 'error', code: 'network' })
  assert.deepEqual(await service.openWeb({ kind: 'bug', title: 'Title', body: 'Body' }), { status: 'error', code: 'network' })
})
