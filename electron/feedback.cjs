'use strict'

const fs = require('node:fs/promises')

const TOKEN_HELP_URL = 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens'
const API_VERSION = '2026-03-10'
const MAX_TITLE_LENGTH = 120
const MAX_BODY_LENGTH = 8000
const MAX_WEB_URL_BYTES = 8000
const MAX_RESPONSE_BYTES = 256 * 1024
const REQUEST_TIMEOUT_MS = 15000
const failure = code => ({ status: 'error', code })

function repository(value) {
  if (typeof value !== 'string') return null
  const match = /^https:\/\/github\.com\/([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9_.-]{1,100})\/?$/i.exec(value.trim())
  if (!match || ['.', '..'].includes(match[2]) || /\.git$/i.test(match[2])) return null
  const [, owner, repo] = match
  return { owner, repo, url: `https://github.com/${owner}/${repo}` }
}

function validFields(input, withToken) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const allowed = withToken ? ['kind', 'title', 'body', 'token'] : ['kind', 'title', 'body']
  if (Object.keys(input).some(key => !allowed.includes(key))) return false
  return ['bug', 'suggestion'].includes(input.kind)
    && typeof input.title === 'string' && input.title.trim().length > 0 && input.title.length <= MAX_TITLE_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(input.title)
    && typeof input.body === 'string' && input.body.trim().length > 0 && input.body.length <= MAX_BODY_LENGTH
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.body)
}

function issueBody(input, version) {
  // Only explicitly submitted feedback, its type, and the app version are sent.
  return `${input.body}\n\n---\nFeedback type: ${input.kind}\nLingshu version: ${version}\n`
}

async function readResponse(response) {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { return null }
}

function httpFailure(response, data) {
  if (response.status < 400) return null
  const message = typeof data?.message === 'string' ? data.message : ''
  if (response.status === 429 || ((response.status === 403 || response.status === 422)
    && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after') || /rate limit|abuse detection/i.test(message)))) return failure('rateLimited')
  if (response.status === 401) return failure('unauthorized')
  if (response.status === 403 || response.status === 410) return failure('forbidden')
  if (response.status === 404) return failure('notFound')
  if (response.status === 400 || response.status === 422) return failure('invalidInput')
  return failure(response.status >= 500 ? 'network' : 'unexpected')
}

class FeedbackService {
  constructor({ projectPath, version, openExternal, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
    if (typeof projectPath !== 'string' || typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(version)
      || typeof openExternal !== 'function' || typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REQUEST_TIMEOUT_MS) {
      throw new TypeError('Invalid feedback service configuration')
    }
    this.projectPath = projectPath
    this.version = version
    this.openExternal = openExternal
    this.fetch = fetchImpl
    this.timeoutMs = timeoutMs
    this.inFlight = false
  }

  async _repository() {
    try {
      const entry = await fs.lstat(this.projectPath)
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 16384) return null
      const buffer = await fs.readFile(this.projectPath)
      if (buffer.length > 16384) return null
      const project = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
      return repository(project?.repositoryUrl)
    } catch { return null }
  }

  async getInfo() {
    const repo = await this._repository()
    return { configured: repo !== null, repositoryUrl: repo?.url || '', issuesUrl: repo ? `${repo.url}/issues` : '', tokenHelpUrl: TOKEN_HELP_URL, version: this.version }
  }

  async submit(input) {
    if (this.inFlight) return failure('unexpected')
    this.inFlight = true
    let timer
    let requestStarted = false
    let confirmedFailure = null
    const controller = new AbortController()
    try {
      const repo = await this._repository()
      if (!repo) return failure('notConfigured')
      if (!validFields(input, true)) return failure('invalidInput')
      if (typeof input.token !== 'string') return failure(input.token === undefined ? 'missingToken' : 'invalidInput')
      const token = input.token.trim()
      if (!token) return failure('missingToken')
      if (token.length > 1024 || !/^[!-~]+$/.test(token)) return failure('invalidInput')
      // The bearer token is scoped to this request, is never persisted or returned,
      // and cannot be redirected to another host.
      const request = async () => {
        const options = {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': `Lingshu-Markdown/${this.version}` },
          body: JSON.stringify({ title: input.title.trim(), body: issueBody(input, this.version) }),
        }
        // A rejected fetch cannot establish whether GitHub accepted the POST.
        requestStarted = true
        const response = await this.fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues`, options)
        // Preserve an explicit HTTP failure even if its optional JSON body is lost.
        confirmedFailure = httpFailure(response, null)
        const data = await readResponse(response)
        if (confirmedFailure) return httpFailure(response, data)
        if (response.status !== 201) return failure('submissionUnknown')
        if (!data || !Number.isSafeInteger(data.number) || data.number < 1 || typeof data.html_url !== 'string' || data.html_url.length > 2048 || Object.hasOwn(data, 'pull_request')) return failure('submissionUnknown')
        let url
        try { url = new URL(data.html_url) } catch { return failure('submissionUnknown') }
        if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
          || url.pathname.toLowerCase() !== `/${repo.owner}/${repo.repo}/issues/${data.number}`.toLowerCase()) return failure('submissionUnknown')
        return { status: 'ok', number: data.number, url: `${repo.url}/issues/${data.number}` }
      }
      return await Promise.race([
        request(),
        new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(confirmedFailure || failure('submissionUnknown')) }, this.timeoutMs) }),
      ])
    } catch { return confirmedFailure || failure(requestStarted ? 'submissionUnknown' : 'invalidInput') }
    finally { clearTimeout(timer); this.inFlight = false }
  }

  async openWeb(input) {
    if (this.inFlight) return failure('unexpected')
    this.inFlight = true
    try {
      const repo = await this._repository()
      if (!repo) return failure('notConfigured')
      if (!validFields(input, false)) return failure('invalidInput')
      const url = new URL(`${repo.url}/issues/new`)
      url.searchParams.set('title', input.title.trim())
      url.searchParams.set('body', issueBody(input, this.version))
      if (Buffer.byteLength(url.href, 'utf8') > MAX_WEB_URL_BYTES) return failure('invalidInput')
      await this.openExternal(url.href)
      // Opening a prefilled form does not establish that an issue was created.
      return { status: 'ok' }
    } catch { return failure('network') }
    finally { this.inFlight = false }
  }

  async openLink(target, issueNumber) {
    if (!['repository', 'issues', 'tokenHelp'].includes(target)
      || (issueNumber !== undefined && (target !== 'issues' || !Number.isSafeInteger(issueNumber) || issueNumber < 1))) return failure('invalidInput')
    try {
      let url = TOKEN_HELP_URL
      if (target !== 'tokenHelp') {
        const repo = await this._repository()
        if (!repo) return failure('notConfigured')
        url = target === 'repository' ? repo.url : `${repo.url}/issues${issueNumber === undefined ? '' : `/${issueNumber}`}`
      }
      await this.openExternal(url)
      return { status: 'ok' }
    } catch { return failure('network') }
  }
}

module.exports = { FeedbackService, MAX_TITLE_LENGTH, MAX_BODY_LENGTH, MAX_WEB_URL_BYTES, REQUEST_TIMEOUT_MS, API_VERSION, TOKEN_HELP_URL }
