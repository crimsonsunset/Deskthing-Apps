import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = join(__dirname, '../../tracklist-debug');

/**
 * Dumps a screenshot + HTML snapshot of the current page state to disk for diagnosing
 * scraper failures (selector never appeared, page blocked by consent modal, etc.).
 * Never throws — debug capture failures shouldn't mask the original scrape error.
 * @param {Page} page - Puppeteer page to snapshot.
 * @param {string} label - Short identifier used in the output filenames (e.g. "search-timeout").
 */
export async function dumpDebugSnapshot(page: Page, label: string): Promise<void> {
  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `${timestamp}_${label}`;

    const html = await page.content();
    writeFileSync(join(DEBUG_DIR, `${baseName}.html`), html, 'utf8');
    await page.screenshot({ path: join(DEBUG_DIR, `${baseName}.png`) as `${string}.png`, fullPage: true });

    console.log(`🐞 [CACP-Tracklist] Debug snapshot saved: tracklist-debug/${baseName}.{html,png}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`🐞 [CACP-Tracklist] Failed to capture debug snapshot for "${label}": ${message}`);
  }
}
