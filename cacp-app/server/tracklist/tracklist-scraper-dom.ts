/**
 * Pure DOM parsing for 1001tracklists tracklist pages.
 * No logger or Puppeteer imports — safe for node:test + linkedom fixtures.
 */

import {
  TRACKLIST_1001TL_DOM_SELECTORS,
  type Tracklist1001tlDomSelectors,
} from './tracklist-1001tl.constants.js';

export type ParsedTracklistDom = {
  mixTitle: string;
  tracks: {
    order: number;
    cueSeconds: number | null;
    artist: string;
    title: string;
    artworkUrl?: string;
    rowId: string;
  }[];
};

/**
 * Parses a 1001tracklists tracklist page DOM into mix title and timestamped track rows.
 * @param {Document} document - Tracklist page document.
 * @param {Tracklist1001tlDomSelectors} [selectors] - DOM selectors (required in page.evaluate; default in Node tests).
 * @returns {ParsedTracklistDom} Mix title and parsed track rows.
 */
export function parseTracklistDom(
  document: Document,
  selectors: Tracklist1001tlDomSelectors = TRACKLIST_1001TL_DOM_SELECTORS,
): ParsedTracklistDom {
  const mixTitleSuffix = new RegExp(selectors.mixTitleSuffixPattern, 'i');
  const placeholderArt = new RegExp(selectors.placeholderArtPattern, 'i');

  const mixTitle =
    document.querySelector(selectors.mixTitlePageTitle)?.textContent?.replace(/\s+/g, ' ').trim() ??
    document.querySelector(selectors.mixTitleH1)?.textContent?.replace(/\s+/g, ' ').trim() ??
    document.title.replace(mixTitleSuffix, '').trim();

  const rows = Array.from(document.querySelectorAll(selectors.trackRow)).filter(
    (row) =>
      row.querySelector(selectors.metaName) ?? row.querySelector(selectors.metaArtist),
  );

  const tracks = rows.map((row, index) => {
    const artist =
      row.querySelector(selectors.metaArtist)?.getAttribute('content')?.trim() ?? '';
    const fullName =
      row.querySelector(selectors.metaName)?.getAttribute('content')?.trim() ?? '';
    const title =
      artist && fullName.startsWith(`${artist} - `)
        ? fullName.slice(artist.length + 3).trim()
        : fullName;

    const cueInput =
      row.querySelector<HTMLInputElement>(selectors.cueInput) ??
      document.querySelector<HTMLInputElement>(
        `#${row.id.replace(new RegExp(`^${selectors.rowIdPrefix}`), selectors.cueIdPrefix)}_cue_seconds`,
      );
    const cueRaw = cueInput?.value?.trim();
    const parsedCue = cueRaw !== undefined && cueRaw !== '' ? Number.parseInt(cueRaw, 10) : null;

    const artImg = row.querySelector(selectors.artwork);
    const artRaw = artImg?.getAttribute('src') || artImg?.getAttribute('data-src') || '';
    const isPlaceholderArt = !artRaw || placeholderArt.test(artRaw);

    const trnoRaw = row.getAttribute(selectors.rowOrderAttr);
    const orderFromDom = trnoRaw !== null ? Number.parseInt(trnoRaw, 10) + 1 : null;

    return {
      order: orderFromDom !== null && !Number.isNaN(orderFromDom) ? orderFromDom : index + 1,
      cueSeconds: parsedCue !== null && Number.isNaN(parsedCue) ? null : parsedCue,
      artist,
      title,
      artworkUrl: isPlaceholderArt ? undefined : artRaw,
      rowId: row.id,
    };
  });

  return { mixTitle, tracks };
}
