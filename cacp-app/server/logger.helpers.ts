import { createRequire } from 'node:module';
import JSGLogger, { type LoggerInstance } from '@crimsonsunset/jsg-logger';
import { forceEnvironment } from '@crimsonsunset/jsg-logger/utils/environment';

// Inlined at build time (not read from disk) so packaged/installed apps get the
// same component log levels as local dev - the CLI's package step only copies
// server/client/icons/manifest.json into dist, not arbitrary root-level files.
// tsm/esbuild's dev transform doesn't support `import ... with { type: 'json' }`, so use createRequire instead.
const require = createRequire(import.meta.url);
const loggerConfig = require('../logger-config.json');

// DeskThing app workers are non-TTY; without this jsg-logger uses pino JSON and
// mediastore/tracklist logs never show up in readable.log.
forceEnvironment('cli');
JSGLogger.configure(loggerConfig as Parameters<typeof JSGLogger.configure>[0]);

const logger = JSGLogger.getInstanceSync();

/** Structured logger for MediaStore transport, commands, and DeskThing sync. */
export const mediastoreLogger: LoggerInstance = logger.getComponent('mediastore');

/** Structured logger for 1001tracklists lookup, scrape, and match pipeline. */
export const tracklistLogger: LoggerInstance = logger.getComponent('tracklist');
