import { sendDeskThingError, sendDeskThingWarning } from './deskthing-log.helpers.js';
import { existsSync, mkdirSync, writeFile, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_BASE = '/resource/image/cacp/';

/**
 * Two serving conventions exist for /resource/image/cacp/*:
 * - `@deskthing/cli` dev emulator's DevClient serves from `cwd()/deskthing/images`
 * - The packaged Desktop install (matches soundcloud-app/ultimateclock prod convention) serves from `__dirname/../images`
 * Neither environment exposes a reliable env var to branch on, so artwork is written to both.
 */
const IMAGES_DIRS = [
  join(__dirname, '../deskthing/images'),
  join(__dirname, '../images'),
];

const writeLocks = new Map<string, Promise<void>>();

/**
 * Serializes concurrent writes to the same local image filename.
 * @param {string} lockKey - Stable key (typically the filename without extension).
 * @param {() => Promise<T>} fn - Critical section to run under the lock.
 * @returns {Promise<T>} Result of fn.
 */
async function withCacheLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const prior = writeLocks.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeLocks.set(lockKey, prior.then(() => next));
  await prior;
  try {
    return await fn();
  } finally {
    release();
  }
}

function ensureImagesDirs() {
  for (const dir of IMAGES_DIRS) {
    if (!existsSync(dir)) {
      console.log(`Creating images directory for CACP: ${dir}`);
      mkdirSync(dir, { recursive: true });
    }
  }
}

function writeFileAsync(filePath: string, binary: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    writeFile(filePath, binary, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export async function saveBinaryImage(binary: Buffer, fileNameNoExt: string, ext = 'png'): Promise<string> {
  return withCacheLock(`${fileNameNoExt}.${ext}`, async () => {
    ensureImagesDirs();
    try {
      await Promise.all(
        IMAGES_DIRS.map((dir) => writeFileAsync(join(dir, `${fileNameNoExt}.${ext}`), binary)),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendDeskThingError(`Failed to save image: ${message}`);
      throw err;
    }
    return `${PUBLIC_BASE}${fileNameNoExt}.${ext}`;
  });
}

export async function saveRemoteImage(url: string, fileNameHint: string): Promise<string | undefined> {
  try {
    ensureImagesDirs();
    const res = await fetch(url);
    if (!res.ok) {
      sendDeskThingWarning(`Image fetch failed: ${url} (${res.status})`);
      return undefined;
    }
    const contentType = res.headers.get('content-type') || '';
    const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('png') ? 'png' : 'png';
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const safeName = fileNameHint.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'artwork';
    return await saveBinaryImage(buffer, safeName, ext);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendDeskThingWarning(`saveRemoteImage error: ${message}`);
    return undefined;
  }
}

export function deleteImages() {
  ensureImagesDirs();
  for (const dir of IMAGES_DIRS) {
    const files = readdirSync(dir);
    for (const file of files) {
      try {
        unlinkSync(join(dir, file));
      } catch {
        // file may already be gone
      }
    }
  }
}

/**
 * Resolves a DeskThing public image URL to an on-disk file when it exists under IMAGES_DIRS.
 * @param {string | null | undefined} publicPath - e.g. /resource/image/cacp/foo.jpg
 * @returns {string | null} Absolute file path, or null when missing or not a local CACP path.
 */
export function resolveLocalImageFile(publicPath: string | null | undefined): string | null {
  if (!publicPath?.startsWith(PUBLIC_BASE)) {
    return null;
  }

  const fileName = publicPath.slice(PUBLIC_BASE.length);
  if (!fileName) {
    return null;
  }

  for (const dir of IMAGES_DIRS) {
    const fullPath = join(dir, fileName);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

/**
 * Returns true when a thumbnail path is a cached local file DeskThing can serve.
 * @param {string | null | undefined} thumbnail - Local /resource path or remote URL.
 * @returns {boolean} Whether the file exists for a CACP /resource/image path.
 */
export function isLocalDeskThingImageAvailable(thumbnail: string | null | undefined): boolean {
  if (!thumbnail) {
    return false;
  }

  if (thumbnail.startsWith('http://') || thumbnail.startsWith('https://')) {
    return false;
  }

  return resolveLocalImageFile(thumbnail) !== null;
}
