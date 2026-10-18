const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { t } = require('./i18n.cjs');

const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const markdownExtensions = new Set(['.md', '.markdown', '.mdown', '.txt']);

function isMarkdownPath(filePath) {
  return typeof filePath === 'string' && markdownExtensions.has(path.extname(filePath).toLowerCase());
}

async function readMarkdown(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(t('请选择一个 Markdown 文件。'));
  if (stat.size > MAX_DOCUMENT_BYTES) throw new Error(t('文件超过当前版本支持的 16 MB，请选择较小的文档。'));
  const buffer = await fs.readFile(filePath);
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error(t('文件超过当前版本支持的 16 MB，请选择较小的文档。'));
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error(t('此文件不是有效的 UTF-8 文本，请先将它另存为 UTF-8。'));
  }
  return { content, bom, revision: createHash('sha256').update(buffer).digest('hex') };
}

async function getFileRevision(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error(t('原文件路径已不再是普通文件。'));
    if (stat.size > MAX_DOCUMENT_BYTES) return 'changed-oversize';
    return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeMarkdown(filePath, content, { bom = false } = {}) {
  if (typeof content !== 'string') throw new TypeError(t('文档内容必须是文本。'));
  const data = Buffer.from((bom && !content.startsWith('\uFEFF') ? '\uFEFF' : '') + content, 'utf8');
  if (data.length > MAX_DOCUMENT_BYTES) throw new Error(t('文档超过当前版本支持的 16 MB。'));
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.inkstone-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' });
    await fs.rename(temporary, filePath);
    return createHash('sha256').update(data).digest('hex');
  } finally {
    await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

module.exports = { MAX_DOCUMENT_BYTES, isMarkdownPath, readMarkdown, writeMarkdown, getFileRevision };
