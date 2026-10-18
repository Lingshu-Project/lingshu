const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

async function main() {
  const project = path.resolve(__dirname, '..');
  const metadata = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  const portable = path.resolve(project, '../../outputs', `Lingshu-Markdown-${metadata.version}-win-x64`);
  await fs.access(path.join(portable, 'Lingshu.exe'));
  const info = JSON.parse(await fs.readFile(path.join(portable, 'resources/app/project.json'), 'utf8'));
  if (info.repositoryUrl !== 'https://github.com/Lingshu-Project/lingshu') throw new Error('安装包缺少正确的官方反馈仓库配置。');
  const cli = path.join(project, 'node_modules/electron-builder/out/cli/cli.js');
  const child = spawn(process.execPath, [cli, '--win', 'nsis', '--x64', '--prepackaged', portable, '--config', 'electron-builder.json', '--publish', 'never'], { cwd: project, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
