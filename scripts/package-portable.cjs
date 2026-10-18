const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const project = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  const outputRoot = path.resolve(project, '..', '..', 'outputs');
  const target = path.join(outputRoot, `Lingshu-Markdown-${manifest.version}-win-x64`);
  if (path.dirname(target) !== outputRoot) throw new Error('打包目标超出 outputs 目录。');
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.mkdir(target);
  const runtime = path.join(project, 'node_modules', 'electron', 'dist');
  for (const entry of await fs.readdir(runtime)) {
    await fs.cp(path.join(runtime, entry), path.join(target, entry), { recursive: true, errorOnExist: true, force: false });
  }
  const appDir = path.join(target, 'resources', 'app');
  await fs.mkdir(appDir, { recursive: true });
  await fs.cp(path.join(project, 'dist'), path.join(appDir, 'dist'), { recursive: true });
  await fs.cp(path.join(project, 'electron'), path.join(appDir, 'electron'), { recursive: true });
  await fs.copyFile(path.join(project, 'project.json'), path.join(appDir, 'project.json'));
  await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify({
    name: manifest.name, productName: manifest.productName, version: manifest.version,
    description: manifest.description, license: manifest.license, main: manifest.main,
  }, null, 2));
  await fs.rename(path.join(target, 'electron.exe'), path.join(target, 'Lingshu.exe'));
  await fs.copyFile(path.join(target, 'LICENSE'), path.join(target, 'LICENSE.electron'));
  for (const name of ['README.md', 'LICENSE', 'NOTICE']) await fs.copyFile(path.join(project, name), path.join(target, name));
  await fs.cp(path.join(project, 'licenses'), path.join(target, 'licenses'), { recursive: true });
  const lock = JSON.parse(await fs.readFile(path.join(project, 'package-lock.json'), 'utf8'));
  const notices = [`灵书 Markdown ${manifest.version} — Third-party licenses / 第三方许可`, '本目录同时保留 Electron 随附的 LICENSE.electron 与 LICENSES.chromium.html。'];
  for (const relative of Object.keys(lock.packages || {}).filter((name) => name.startsWith('node_modules/')).sort()) {
    const directory = path.join(project, relative);
    let dependency;
    try { dependency = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')); } catch { continue; }
    notices.push(`\n\n===== ${dependency.name} ${dependency.version} (${dependency.license || 'see below'}) =====\n`);
    for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'license.txt', 'COPYING']) {
      try { notices.push(await fs.readFile(path.join(directory, candidate), 'utf8')); break; } catch { /* 不同包使用不同许可文件名。 */ }
    }
  }
  await fs.writeFile(path.join(target, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'), 'utf8');
  console.log(JSON.stringify({ portableDirectory: target, executable: path.join(target, 'Lingshu.exe') }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
