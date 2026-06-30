import { exec, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const isMacOS = process.platform === 'darwin';

/**
 * Walk the parent process chain and return ancestor command names.
 * @returns {Promise<string[]>}
 */
async function getParentProcessNames() {
  const names = [];
  let currentPid = process.pid.toString();

  for (let i = 0; i < 10; i++) {
    try {
      const { stdout } = await execAsync(`ps -o comm= -p ${currentPid}`);
      const comm = stdout.trim();
      if (comm) names.push(comm);

      const { stdout: ppidOut } = await execAsync(`ps -o ppid= -p ${currentPid}`);
      const parentPid = ppidOut.trim();
      if (!parentPid || parentPid === '1' || parentPid === '0') break;
      currentPid = parentPid;
    } catch {
      break;
    }
  }

  return names;
}

/**
 * Returns PIDs for the current process and its ancestors so we never kill the script or its caller.
 * @returns {Promise<Set<string>>}
 */
export async function getCurrentProcessTree() {
  const tree = new Set();
  let currentPid = process.pid.toString();
  tree.add(currentPid);

  for (let i = 0; i < 10; i++) {
    try {
      const { stdout } = await execAsync(`ps -o ppid= -p ${currentPid}`);
      const parentPid = stdout.trim();
      if (!parentPid || parentPid === '1' || parentPid === '0') break;
      tree.add(parentPid);
      currentPid = parentPid;
    } catch {
      break;
    }
  }

  return tree;
}

/**
 * Returns the working directory of the given process via lsof. Empty string if unavailable.
 * @param {string} pid
 * @returns {Promise<string>}
 */
export async function getProcessCwd(pid) {
  try {
    const { stdout } = await execAsync(`lsof -a -d cwd -p ${pid} -Fn 2>/dev/null | grep "^n" | cut -c2-`);
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Detect which terminal is running this process.
 * @returns {Promise<'warp'|'iterm'|'apple_terminal'|'cursor'|'vscode'|'unknown'>}
 */
export async function getTerminalType() {
  const termProgram = process.env.TERM_PROGRAM ?? '';

  if (termProgram === 'WarpTerminal') return 'warp';
  if (termProgram === 'iTerm.app') return 'iterm';
  if (termProgram === 'Apple_Terminal') return 'apple_terminal';

  const ancestorNames = await getParentProcessNames();
  const combined = ancestorNames.join(' ');

  if (termProgram === 'vscode' || termProgram === '') {
    if (combined.includes('Cursor')) return 'cursor';
    if (combined.includes('Code')) return 'vscode';
  }

  return 'unknown';
}

/**
 * Escape a string for use inside AppleScript double quotes.
 * @param {string} value
 * @returns {string}
 */
function escapeForAppleScript(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Run an AppleScript snippet and log failures.
 * @param {string} script
 * @param {string} label
 */
async function runOsascript(script, label) {
  const escaped = script.replace(/'/g, "'\"'\"'");
  const cmd = `osascript -e '${escaped}'`;
  console.log(`   [${label}] Running osascript...`);
  try {
    const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 });
    if (stdout?.trim()) console.log(`   [${label}] stdout: ${stdout.trim()}`);
    if (stderr?.trim()) console.log(`   [${label}] stderr: ${stderr.trim()}`);
  } catch (err) {
    const e = err;
    console.error(`   [${label}] failed: ${e.message ?? String(err)}`);
    if (e.stderr?.trim()) console.error(`   [${label}] stderr: ${e.stderr.trim()}`);
    throw err;
  }
}

/**
 * Spawn a command detached in the background (non-macOS or IDE fallback).
 * @param {string} cwd
 * @param {string} command
 */
function spawnDetached(cwd, command) {
  console.log(`   Spawning in background: ${command}`);
  console.log(`   cwd: ${cwd}`);
  const child = spawn('bash', ['-lc', command], {
    cwd,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.unref();
}

/**
 * Open a new terminal tab and run a command in the given directory.
 * @param {'warp'|'iterm'|'apple_terminal'|'cursor'|'vscode'|'unknown'} terminalType
 * @param {string} cwd - Absolute path to working directory
 * @param {string} command - Shell command to run in the new tab
 */
export async function openInNewTab(terminalType, cwd, command) {
  if (!isMacOS) {
    spawnDetached(cwd, command);
    return;
  }

  const fullCommand = `cd "${cwd}" && ${command}`;

  switch (terminalType) {
    case 'warp': {
      const tmpScript = path.join(os.tmpdir(), `cacp-run-${process.pid}.sh`);
      const scriptBody = `#!/usr/bin/env bash\ncd ${JSON.stringify(cwd)}\n${command}\n`;
      fs.writeFileSync(tmpScript, scriptBody, { mode: 0o700 });
      console.log('   [Warp] Opening new tab...');
      try {
        await execAsync(`open -a Warp "${tmpScript}"`);
        setTimeout(() => {
          try {
            fs.unlinkSync(tmpScript);
          } catch {
            // ignore
          }
        }, 3000);
      } catch (err) {
        try {
          fs.unlinkSync(tmpScript);
        } catch {
          // ignore
        }
        throw err;
      }
      break;
    }

    case 'iterm': {
      const script = `
        tell application "iTerm" to activate
        tell application "iTerm"
          tell current window to create tab with default profile
          tell current session of current window to write text "${escapeForAppleScript(fullCommand)}"
        end tell
      `;
      await runOsascript(script, 'iTerm');
      break;
    }

    case 'apple_terminal': {
      const script = `tell application "Terminal" to do script "${escapeForAppleScript(fullCommand)}"`;
      await runOsascript(script, 'Terminal.app');
      break;
    }

    case 'cursor':
    case 'vscode':
    case 'unknown':
      console.log(`   [${terminalType}] macOS new-tab opening not supported; spawning detached.`);
      spawnDetached(cwd, command);
      break;

    default:
      spawnDetached(cwd, command);
  }
}
