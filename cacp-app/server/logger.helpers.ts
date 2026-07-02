import JSGLogger, { type LoggerInstance } from '@crimsonsunset/jsg-logger';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Loads logger-config.json and applies component levels for server-side logging.
 */
function configureServerLogger(): void {
  try {
    const configPath = join(__dirname, '../logger-config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Parameters<typeof JSGLogger.configure>[0];
    JSGLogger.configure(config);
  } catch {
    // ponytail: fall back to library defaults when config is missing (e.g. partial deploy)
  }
}

configureServerLogger();

const logger = JSGLogger.getInstanceSync();

/** Structured logger for MediaStore transport, commands, and DeskThing sync. */
export const mediastoreLogger: LoggerInstance = logger.getComponent('mediastore');

/** Structured logger for 1001tracklists lookup, scrape, and match pipeline. */
export const tracklistLogger: LoggerInstance = logger.getComponent('tracklist');
