import { DeskThing } from '@deskthing/server';

/**
 * Logs an error to console and DeskThing when sendLog is available.
 * ponytail: sendError was removed or never shipped in @deskthing/server; sendLog is the stable API.
 * @param {string} message
 */
export function sendDeskThingError(message: string): void {
  console.error(message);
  if (typeof DeskThing.sendLog === 'function') {
    DeskThing.sendLog(message);
  }
}

/**
 * Logs a warning to console and DeskThing, falling back to sendLog when sendWarning is unavailable.
 * @param {string} message
 */
export function sendDeskThingWarning(message: string): void {
  console.warn(message);
  const deskThing = DeskThing as { sendWarning?: (msg: string) => void; sendLog?: (msg: string) => void };
  if (typeof deskThing.sendWarning === 'function') {
    deskThing.sendWarning(message);
    return;
  }
  if (typeof deskThing.sendLog === 'function') {
    deskThing.sendLog(message);
  }
}
