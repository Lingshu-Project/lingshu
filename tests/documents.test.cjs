const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readMarkdown, writeMarkdown } = require('../electron/documents.cjs');

test('真实磁盘：中文路径、UTF-8、空文件和原子替换', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkstone-documents-'));
  try {
    const target = path.join(root, '中文 文档.md');
    const markdown = '# 中文标题\r\n\r\n- **加粗**\r\n- 测试 😀\r\n';
    await writeMarkdown(target, markdown);
    const loaded = await readMarkdown(target);
    assert.equal(loaded.content, markdown);
    assert.equal(loaded.bom, false);
    assert.match(loaded.revision, /^[a-f0-9]{64}$/);
    await writeMarkdown(target, '');
    assert.equal((await fs.stat(target)).size, 0);
    assert.equal((await readMarkdown(target)).content, '');
    assert.deepEqual(await fs.readdir(root), ['中文 文档.md']);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('inkstone-documents-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('真实磁盘：保留 UTF-8 BOM，拒绝无效编码和目录', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkstone-encoding-'));
  try {
    const target = path.join(root, 'bom.md');
    await writeMarkdown(target, '# 编码', { bom: true });
    const bytes = await fs.readFile(target);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const loaded = await readMarkdown(target);
    assert.equal(loaded.content, '# 编码');
    assert.equal(loaded.bom, true);
    const invalid = path.join(root, 'invalid.md');
    await fs.writeFile(invalid, Buffer.from([0xff, 0xfe, 0xfa]));
    await assert.rejects(readMarkdown(invalid), /UTF-8/);
    await assert.rejects(readMarkdown(root), /Markdown 文件/);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('inkstone-encoding-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
