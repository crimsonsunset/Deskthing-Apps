#!/usr/bin/env node

import { exec } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getCurrentProcessTree, getProcessCwd } from './terminal.helpers.js';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const cacpAppDir = path.join(rootDir, 'cacp-app');
const cacpExtensionDir = path.join(rootDir, 'cacp-extension');

/** CACP dev ports — emulator UI, Vite, link bus, WS bridge, extension HMR */
const CACP_DEV_PORTS = [3050, 5050, 8080, 8081, 5150];

/**
 * Returns PIDs listening on the given TCP port, excluding the current process tree.
 * @param {number} port
 * @param {Set<string>} currentTree
 * @returns {Promise<string[]>}
 */
async function findListenerPidsOnPort(port, currentTree) {
  try {
    const { stdout } = await execAsync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`);
    return stdout
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter((pid) => pid.length > 0 && !currentTree.has(pid));
  } catch {
    return [];
  }
}

/**
 * Kills processes bound to CACP dev ports.
 * @param {Set<string>} currentTree
 * @returns {Promise<number>}
 */
async function killPortListeners(currentTree) {
  let killed = 0;

  for (const port of CACP_DEV_PORTS) {
    const pids = await findListenerPidsOnPort(port, currentTree);
    for (const pid of pids) {
      try {
        await execAsync(`kill -9 ${pid}`);
        console.log(`  ✓ Killed port ${port} listener (PID ${pid})`);
        killed++;
      } catch {
        // already dead
      }
    }
  }

  return killed;
}

/**
 * Kills processes whose command line matches the pattern and whose cwd is under the given directory.
 * @param {string} dir
 * @param {RegExp} commandPattern
 * @param {Set<string>} currentTree
 * @param {string} label
 * @returns {Promise<number>}
 */
async function killProcessesInDir(dir, commandPattern, currentTree, label) {
  let killed = 0;

  try {
    const { stdout } = await execAsync('ps -e -o pid= -o command= 2>/dev/null || true');
    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const pidMatch = line.match(/^\s*(\d+)\s+/);
      if (!pidMatch) continue;

      const pid = pidMatch[1];
      if (currentTree.has(pid)) continue;

      const command = line.slice(pidMatch[0].length);
      if (!commandPattern.test(command)) continue;

      const cwd = await getProcessCwd(pid);
      if (!cwd.startsWith(dir)) continue;

      try {
        await execAsync(`kill -9 ${pid}`);
        console.log(`  ✓ Killed ${label} (PID ${pid})`);
        killed++;
      } catch {
        // already dead
      }
    }
  } catch {
    // ignore
  }

  return killed;
}

console.log('\n🛑 Killing CACP dev processes\n');

const currentTree = await getCurrentProcessTree();

console.log('Port listeners (3050, 5050, 8080, 8081, 5150)...');
const portKilled = await killPortListeners(currentTree);
if (portKilled === 0) console.log('  (none found)');

console.log('\ncacp-app (Vite, @deskthing/cli, concurrently)...');
const appKilled = await killProcessesInDir(
  cacpAppDir,
  /vite|deskthing|concurrently|tsm/,
  currentTree,
  'cacp-app'
);
if (appKilled === 0) console.log('  (none found)');

console.log('\ncacp-extension (Vite / CRXJS)...');
const extKilled = await killProcessesInDir(
  cacpExtensionDir,
  /vite/,
  currentTree,
  'cacp-extension'
);
if (extKilled === 0) console.log('  (none found)');

console.log('\n✅ Done.\n');
