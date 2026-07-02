import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFileIfExists } from '../../scripts/dev/load-env.helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..');

loadEnvFileIfExists(path.join(appDir, '.env'));

const child = spawn(
  'npx',
  ['concurrently', 'npm run dev:vite', 'npm run dev:wrapper'],
  {
    cwd: appDir,
    stdio: 'inherit',
    env: process.env,
  },
);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
