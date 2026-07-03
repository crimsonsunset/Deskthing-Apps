/**
 * 1001tracklists.com selectors, URL patterns, and timeouts.
 * Single source of truth for scraper, DOM parser, mix-favorite, and artwork helpers.
 */

export const SEARCH_BASE_URL = 'https://www.1001tracklists.com/';

export const SEARCH_INPUT_SELECTOR = '#sBoxInput';
export const TRACKLIST_LINK_SELECTOR = 'a[href*="/tracklist/"]';
export const LOOSE_TRACKLIST_LINK_SELECTOR = 'a[href*="tracklist"]';

/** Puppeteer waitForSelector — primary row class on mix pages. */
export const TRACK_ROW_WAIT_SELECTOR = 'div.tlpItem[id^="tlp_"]';

/** DOM querySelectorAll — includes legacy rows missing tlpItem class. */
export const TRACK_ROW_QUERY_SELECTOR = 'div.tlpItem[id^="tlp_"], div[id^="tlp_"]';

export const MIX_TITLE_PAGE_TITLE_SELECTOR = '#pageTitle h1';
export const MIX_TITLE_H1_SELECTOR = 'h1';
export const MIX_TITLE_SUFFIX_PATTERN = /\s*\|\s*1001Tracklists.*$/i;

export const TRACK_META_NAME_SELECTOR = 'meta[itemprop="name"]';
export const TRACK_META_ARTIST_SELECTOR = 'meta[itemprop="byArtist"]';
export const TRACK_CUE_INPUT_SELECTOR = 'input[id$="_cue_seconds"]';
export const TRACK_ARTWORK_SELECTOR = 'img.artwork.artM';
export const TRACK_ROW_ORDER_ATTR = 'data-trno';
export const TRACK_ROW_ID_PREFIX = 'tlp_';
export const TRACK_CUE_ID_PREFIX = 'tlp';

export const PLACEHOLDER_ART_PATTERN = /default_100\.png|empty\.png|\/artworks\/default/i;

export const SC_WIDGET_IFRAME_SELECTOR = 'iframe[src*="w.soundcloud.com"]';
export const SC_ROW_SOUNDCLOUD_ICON_SELECTOR = 'i.mAction.fa-soundcloud';
export const SC_TRACK_ID_FROM_WIDGET_SRC_PATTERN = /tracks%2F(\d+)|tracks\/(\d+)/;

export const MAX_SEARCH_CANDIDATES = 10;
export const SEARCH_RESULTS_TIMEOUT_MS = 15_000;
export const PAGE_LOAD_TIMEOUT_MS = 30_000;
export const WIDGET_IFRAME_TIMEOUT_MS = 25_000;

/**
 * Serializable selector bundle for parseTracklistDom inside page.evaluate
 * (regexes cannot cross the evaluate boundary — pass pattern source strings).
 */
export type Tracklist1001tlDomSelectors = {
  mixTitlePageTitle: string;
  mixTitleH1: string;
  mixTitleSuffixPattern: string;
  trackRow: string;
  metaName: string;
  metaArtist: string;
  cueInput: string;
  artwork: string;
  placeholderArtPattern: string;
  rowOrderAttr: string;
  rowIdPrefix: string;
  cueIdPrefix: string;
};

/** Default DOM selectors passed to parseTracklistDom in Node and in page.evaluate. */
export const TRACKLIST_1001TL_DOM_SELECTORS: Tracklist1001tlDomSelectors = {
  mixTitlePageTitle: MIX_TITLE_PAGE_TITLE_SELECTOR,
  mixTitleH1: MIX_TITLE_H1_SELECTOR,
  mixTitleSuffixPattern: MIX_TITLE_SUFFIX_PATTERN.source,
  trackRow: TRACK_ROW_QUERY_SELECTOR,
  metaName: TRACK_META_NAME_SELECTOR,
  metaArtist: TRACK_META_ARTIST_SELECTOR,
  cueInput: TRACK_CUE_INPUT_SELECTOR,
  artwork: TRACK_ARTWORK_SELECTOR,
  placeholderArtPattern: PLACEHOLDER_ART_PATTERN.source,
  rowOrderAttr: TRACK_ROW_ORDER_ATTR,
  rowIdPrefix: TRACK_ROW_ID_PREFIX,
  cueIdPrefix: TRACK_CUE_ID_PREFIX,
};

/**
 * Builds the row-scoped SoundCloud icon selector for a 1001tracklists track row.
 * @param {string} rowId - DOM id of the track row (e.g. "tlp_14101120").
 * @returns {string} CSS selector for the row's SoundCloud action icon.
 */
export function soundCloudRowIconSelector(rowId: string): string {
  return `#${rowId} ${SC_ROW_SOUNDCLOUD_ICON_SELECTOR}`;
}

/**
 * Parses the numeric SoundCloud track id from a widget iframe src URL.
 * @param {string} src - iframe src attribute.
 * @returns {string | null} Track id when matched.
 */
export function parseTrackIdFromWidgetSrc(src: string): string | null {
  const match = src.match(SC_TRACK_ID_FROM_WIDGET_SRC_PATTERN);
  return match?.[1] ?? match?.[2] ?? null;
}
