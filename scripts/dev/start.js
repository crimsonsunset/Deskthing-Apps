import { spawn, exec } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { select } from '@inquirer/prompts';
import { getTerminalType, openInNewTab } from './terminal.helpers.js';
import { loadEnvFileIfExists } from './load-env.helpers.js';

const execAsync = promisify(exec);

const MODES = ['emulator', 'desktop'];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const cacpAppDir = path.join(rootDir, 'cacp-app');
const cacpExtensionDir = path.join(rootDir, 'cacp-extension');

loadEnvFileIfExists(path.join(cacpAppDir, '.env'));

/** @type {import('node:child_process').ChildProcess[]} */
const childProcesses = [];

/**
 * Parse `--mode=emulator|desktop` from argv.
 * @returns {'emulator'|'desktop'|undefined}
 */
function parseModeFlag() {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  if (!modeArg) return undefined;

  const mode = modeArg.slice('--mode='.length);
  if (!MODES.includes(mode)) {
    console.error(`Invalid --mode=${mode}. Expected: ${MODES.join(', ')}`);
    process.exit(1);
  }

  return mode;
}

/**
 * Resolve run mode from argv, interactive prompt, or default.
 * @returns {Promise<'emulator'|'desktop'>}
 */
async function getRunMode() {
  const modeFromArgv = parseModeFlag();
  if (modeFromArgv) return modeFromArgv;

  if (!process.stdin.isTTY) {
    console.log('No TTY detected, defaulting to emulator mode.');
    return 'emulator';
  }

  return select({
    message: 'How do you want to run CACP?',
    default: 'emulator',
    choices: [
      {
        value: 'emulator',
        name: 'Emulator (local dev)',
        description: 'Start cacp-app (@deskthing/cli dev) + cacp-extension in a new tab',
      },
      {
        value: 'desktop',
        name: 'DeskThing Desktop',
        description: 'Start cacp-extension only — DeskThing Desktop must already be running',
      },
    ],
  });
}

/**
 * Print the local port map for emulator mode.
 */
function printPortMap() {
  console.log('\nPort map:');
  console.log('  cacp-app emulator UI  :3050');
  console.log('  cacp-app Vite         :5050');
  console.log('  WS bridge             :8081  (starts on DeskThing START)');
  console.log('  cacp-extension HMR    :5150');
  console.log('\nLoad cacp-extension/dist in Chrome as an unpacked extension if not already loaded.\n');
}

/**
 * Open a URL in the default browser (macOS/Linux/Windows).
 * @param {string} url
 */
async function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32'  ? `start "${url}"` :
                                    `xdg-open "${url}"`;
  try {
    await execAsync(cmd);
    console.log(`  Opened ${url}`);
  } catch {
    console.warn(`  Could not open ${url} automatically — open it manually.`);
  }
}

/**
 * Spawn a tracked child process, piping stdout/stderr to the parent terminal.
 * Calls onLine(line) for each line of combined output.
 * @param {string} cwd
 * @param {string[]} args
 * @param {(line: string) => void} [onLine]
 * @returns {import('node:child_process').ChildProcess}
 */
function spawnTracked(cwd, args, onLine) {
  const child = spawn('npm', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  childProcesses.push(child);

  /** @param {Buffer} chunk */
  const forward = (stream, chunk) => {
    const text = chunk.toString();
    stream.write(chunk);
    if (onLine) {
      for (const line of text.split('\n')) {
        if (line.trim()) onLine(line);
      }
    }
  };

  child.stdout?.on('data', (chunk) => forward(process.stdout, chunk));
  child.stderr?.on('data', (chunk) => forward(process.stderr, chunk));

  return child;
}

/**
 * Kill all tracked child processes.
 */
function killChildren() {
  for (const child of childProcesses) {
    if (!child.pid || child.killed) continue;
    try {
      process.kill(child.pid, 'SIGINT');
    } catch {
      // process may already be gone
    }
  }
}

/**
 * Run emulator mode: cacp-app in current terminal, extension in new tab.
 * Opens http://localhost:3050 in the browser once the emulator is ready.
 * @returns {Promise<number>}
 */
async function runEmulator() {
  printPortMap();

  const terminalType = await getTerminalType();
  console.log(`Detected terminal: ${terminalType}`);
  console.log('Opening cacp-extension in a new tab...');

  try {
    await openInNewTab(terminalType, cacpExtensionDir, 'npm run dev');
  } catch (err) {
    console.warn(`Could not open new tab (${err?.message ?? err}); extension may need to be started manually.`);
    console.warn(`  cd cacp-extension && npm run dev`);
  }

  console.log('Starting cacp-app in this terminal...\n');

  return new Promise((resolve) => {
    let browserOpened = false;

    const appProcess = spawnTracked(cacpAppDir, ['run', 'dev'], (line) => {
      if (!browserOpened && line.includes('Development Server is running')) {
        browserOpened = true;
        console.log('\nEmulator ready — opening browser...');
        void openBrowser('http://localhost:3050');
      }
    });

    appProcess.on('close', (code) => {
      resolve(code ?? 0);
    });

    appProcess.on('error', (err) => {
      console.error('Failed to start cacp-app:', err.message);
      resolve(1);
    });
  });
}

/**
 * Run desktop mode: extension only in current terminal.
 * @returns {Promise<number>}
 */
function runDesktop() {
  console.log('\nDeskThing Desktop must be running with the cacp app installed.');
  console.log('Extension connects to ws://127.0.0.1:8081 once the app fires START.\n');

  return new Promise((resolve) => {
    const extProcess = spawnTracked(cacpExtensionDir, ['run', 'dev']);

    extProcess.on('close', (code) => {
      resolve(code ?? 0);
    });

    extProcess.on('error', (err) => {
      console.error('Failed to start cacp-extension:', err.message);
      resolve(1);
    });
  });
}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  killChildren();
  process.exit(0);
});

const mode = await getRunMode();
const exitCode = mode === 'emulator' ? await runEmulator() : await runDesktop();
process.exit(exitCode);
