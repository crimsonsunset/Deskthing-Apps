import { DeskThing } from '@deskthing/server';

type DeskThingLogger = {
  sendLog?: (message: string) => void;
  sendWarning?: (message: string) => void;
};

/**
 * @deskthing/server 0.11.x does not expose sendLog at runtime; guard before calling.
 */
const getDeskThingLoggers = (): DeskThingLogger => DeskThing as DeskThingLogger;

/**
 * Logs an info message to console and DeskThing when sendLog is available.
 * @param {string} message
 */
export function sendDeskThingLog(message: string): void {
  console.log(message);
  const deskThing = getDeskThingLoggers();
  if (typeof deskThing.sendLog === 'function') {
    deskThing.sendLog(message);
  }
}

/**
 * Logs an error to console and DeskThing when sendLog is available.
 * @param {string} message
 */
export function sendDeskThingError(message: string): void {
  console.error(message);
  const deskThing = getDeskThingLoggers();
  if (typeof deskThing.sendLog === 'function') {
    deskThing.sendLog(message);
  }
}

/**
 * Logs a warning to console and DeskThing, falling back to sendLog when sendWarning is unavailable.
 * @param {string} message
 */
export function sendDeskThingWarning(message: string): void {
  console.warn(message);
  const deskThing = getDeskThingLoggers();
  if (typeof deskThing.sendWarning === 'function') {
    deskThing.sendWarning(message);
    return;
  }
  if (typeof deskThing.sendLog === 'function') {
    deskThing.sendLog(message);
  }
}
