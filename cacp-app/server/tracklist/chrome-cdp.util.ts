import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';

const DEFAULT_MAC_CHROME_PATH = join(
  homedir(),
  'Library/Application Support/Google/Chrome/DevToolsActivePort',
);

/**
 * Reads DevToolsActivePort from the target Chrome profile and connects via CDP.
 * @param {string} [devToolsActivePortPath] - Path to DevToolsActivePort; defaults to macOS Chrome profile or CHROME_DEVTOOLS_ACTIVE_PORT_PATH env.
 * @returns {Promise<Browser>} Connected Puppeteer browser handle (never launched — attach only).
 */
export async function connectToChrome(
  devToolsActivePortPath = process.env.CHROME_DEVTOOLS_ACTIVE_PORT_PATH ?? DEFAULT_MAC_CHROME_PATH,
): Promise<Browser> {
  if (!existsSync(devToolsActivePortPath)) {
    throw new Error(
      `Chrome remote debugging not detected at ${devToolsActivePortPath}. ` +
        `Enable "Allow remote debugging for this browser instance" at chrome://inspect/#remote-debugging ` +
        `and make sure Chrome is running, then retry.`,
    );
  }

  console.log(`🔌 [CACP-Tracklist] Reading DevToolsActivePort from ${devToolsActivePortPath}`);
  const raw = await readFile(devToolsActivePortPath, 'utf8');
  const [port, wsPath] = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!port || !wsPath) {
    throw new Error(
      `Invalid DevToolsActivePort at ${devToolsActivePortPath}: expected port and WebSocket path on separate lines`,
    );
  }

  const browserWSEndpoint = `ws://127.0.0.1:${port}${wsPath}`;
  console.log(`🔌 [CACP-Tracklist] Connecting to ${browserWSEndpoint}`);
  const browser = await puppeteer.connect({ browserWSEndpoint });
  console.log(`🔌 [CACP-Tracklist] Connected — browser version: ${await browser.version()}`);
  return browser;
}
