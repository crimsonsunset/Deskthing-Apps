import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(fileURLToPath(import.meta.url));

/**
 * Loads KEY=VALUE pairs from a .env file into process.env.
 * Does not override non-empty values already in the environment.
 * @param {string} envPath - Absolute path to the .env file.
 */
export function loadEnvFileIfExists(envPath: string): void {
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    const existing = process.env[key];
    if (existing === undefined || existing === '') {
      process.env[key] = value;
    }
  }
}

/**
 * Loads cacp-app/.env for dev (server/) and packaged (dist/server/) layouts.
 */
export function loadCacpAppEnv(): void {
  loadEnvFileIfExists(join(serverDir, '..', '.env'));
  loadEnvFileIfExists(join(serverDir, '../..', '.env'));
}
