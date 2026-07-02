import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Copies runtime assets into deskthing/ before @deskthing/cli package zips dist/.
 * The CLI only copies deskthing/ (manifest, icons) — not server/deskthing/tracklists.
 */
async function stagePackageAssets() {
  const sourceDir = join(ROOT, 'server/deskthing/tracklists');
  const targetDir = join(ROOT, 'deskthing/tracklists');

  if (!existsSync(sourceDir)) {
    console.warn('[stage-package-assets] No tracklist cache source at', sourceDir);
    return;
  }

  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
  console.log('[stage-package-assets] Staged tracklist cache → deskthing/tracklists/');
}

await stagePackageAssets();
