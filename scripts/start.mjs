// `npm start`: builds the interface once if needed, then runs everything on one port (3001).
import { existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shell = process.platform === 'win32';

if (!existsSync(path.join(root, 'frontend/dist/index.html'))) {
  console.log('Building the interface (first start only)...');
  const build = spawnSync('npm', ['--prefix', 'frontend', 'run', 'build'], { cwd: root, stdio: 'inherit', shell });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, ['server.js'], { cwd: path.join(root, 'backend'), stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
