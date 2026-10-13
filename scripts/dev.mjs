// `npm run dev`: backend with auto-restart (:3001) + Vite with hot reload (:5173), in one terminal.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shell = process.platform === 'win32';

const procs = [
  ['api', spawn(process.execPath, ['--watch', 'server.js'], { cwd: path.join(root, 'backend') })],
  ['web', spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0'], { cwd: path.join(root, 'frontend'), shell })],
];

for (const [name, proc] of procs) {
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  proc.stdout.on('data', (d) => process.stdout.write(prefix(d)));
  proc.stderr.on('data', (d) => process.stderr.write(prefix(d)));
  proc.on('exit', (code) => {
    console.log(`[${name}] exited (${code}), stopping`);
    for (const [, other] of procs) other.kill();
    process.exit(code ?? 0);
  });
}

process.on('SIGINT', () => { for (const [, p] of procs) p.kill(); process.exit(0); });
