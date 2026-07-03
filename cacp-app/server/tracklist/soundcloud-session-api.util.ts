import type { Browser, Page } from 'puppeteer-core';

/** SoundCloud's shared public web client id (not app-specific). */
const WEB_CLIENT_ID = 'O7atZypwLvuWSY9hWnnQ3vrLTHH7wqMe';

/**
 * NOTE: the `oauth_token` cookie read in this module grants full account access.
 * It only ever lives inside `page.evaluate()` (the browser context, not Node) and
 * is passed straight to `fetch` — never returned to the caller or logged. Keep it
 * that way: do not include `token` in any tracklistLogger call in this file or its
 * callers.
 */

export type SessionLikeResult = {
  success: boolean;
  status?: number;
  error?: string;
};

/**
 * Returns an existing soundcloud.com tab or opens one and navigates there so session cookies apply.
 * @param {Browser} browser - Connected Puppeteer browser.
 * @returns {Promise<Page>} Page on a soundcloud.com origin.
 */
export async function findOrOpenSoundCloudTab(browser: Browser): Promise<Page> {
  const existing = (await browser.pages()).find((p) => p.url().includes('soundcloud.com'));
  if (existing) {
    return existing;
  }

  const page = await browser.newPage();
  await page.goto('https://soundcloud.com', { waitUntil: 'domcontentloaded' });
  return page;
}

/**
 * Resolves the logged-in SoundCloud user id via GET /me using the session oauth_token cookie.
 * @param {Page} page - Page on soundcloud.com origin.
 * @returns {Promise<string | null>} Numeric user id, or null when not authenticated.
 */
export async function getAuthenticatedUserId(page: Page): Promise<string | null> {
  return page.evaluate(async (clientId) => {
    const token = document.cookie
      .split('; ')
      .find((c) => c.startsWith('oauth_token='))
      ?.split('=')[1];
    if (!token) {
      return null;
    }

    const res = await fetch(`https://api-v2.soundcloud.com/me?client_id=${clientId}`, {
      headers: { authorization: `OAuth ${token}` },
    });
    if (!res.ok) {
      return null;
    }

    const body = (await res.json()) as { id?: number | string };
    return body.id != null ? String(body.id) : null;
  }, WEB_CLIENT_ID);
}

/**
 * Likes a track via session-replay PUT against api-v2 track_likes (no UI click on SoundCloud DOM).
 * @param {Page} page - Page on soundcloud.com origin with oauth_token cookie.
 * @param {string} userId - Authenticated SoundCloud user id.
 * @param {string} trackId - Numeric SoundCloud track id.
 * @returns {Promise<SessionLikeResult>} API outcome.
 */
export async function likeTrackViaSession(
  page: Page,
  userId: string,
  trackId: string,
): Promise<SessionLikeResult> {
  return page.evaluate(
    async (clientId, uid, tid) => {
      const token = document.cookie
        .split('; ')
        .find((c) => c.startsWith('oauth_token='))
        ?.split('=')[1];
      if (!token) {
        return { success: false, error: 'oauth_token cookie not found — not logged in?' };
      }

      const res = await fetch(
        `https://api-v2.soundcloud.com/users/${uid}/track_likes/${tid}?client_id=${clientId}`,
        { method: 'PUT', headers: { authorization: `OAuth ${token}` } },
      );
      return { success: res.ok, status: res.status };
    },
    WEB_CLIENT_ID,
    userId,
    trackId,
  );
}
