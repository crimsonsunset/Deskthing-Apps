/**
 * Cue-matching and formatting helpers for the extension popup tracklist panel.
 */

export {
  findCurrentTracklistTrack,
  formatCueSeconds,
  getTrackDurationSeconds,
} from 'cacp-shared';

/**
 * Escapes text for safe HTML insertion in the popup.
 * @param {string} text - Raw display text.
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
