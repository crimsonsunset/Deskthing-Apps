import { lookupTracklist } from './tracklist-lookup.js';
import { tracklistLogger } from '../logger.helpers.js';

/**
 * One-off manual validation: full lookup pipeline for Nora En Pure Purified #512.
 * Requires Gondor Chrome with remote debugging + OPENROUTER_API_KEY in env or .env.
 */
async function main(): Promise<void> {
  const result = await lookupTracklist('Nora En Pure', 'Purified #512');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  tracklistLogger.error(message);
  process.exitCode = 1;
});
