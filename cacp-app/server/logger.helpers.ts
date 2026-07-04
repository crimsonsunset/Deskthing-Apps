import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSGLogger, { type LoggerInstance } from '@crimsonsunset/jsg-logger';
import { forceEnvironment } from '@crimsonsunset/jsg-logger/utils/environment';

// ponytail: readFileSync instead of import attributes — @deskthing/cli's tsm/esbuild
// does not parse `with { type: 'json' }` yet; build still bundles this at compile time.
const loggerConfigPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../logger-config.json',
);
const loggerConfig = JSON.parse(readFileSync(loggerConfigPath, 'utf8'));

// DeskThing app workers are non-TTY; without this jsg-logger uses pino JSON and
// mediastore/tracklist logs never show up in readable.log.
forceEnvironment('cli');
JSGLogger.configure(loggerConfig as Parameters<typeof JSGLogger.configure>[0]);

const logger = JSGLogger.getInstanceSync();

/** Structured logger for MediaStore transport, commands, and DeskThing sync. */
export const mediastoreLogger: LoggerInstance = logger.getComponent('mediastore');

/** Structured logger for 1001tracklists lookup, scrape, and match pipeline. */
export const tracklistLogger: LoggerInstance = logger.getComponent('tracklist');
