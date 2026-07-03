import { DeskThing } from '@deskthing/server';
import { DESKTHING_EVENTS, SETTING_TYPES, type AppSettings } from '@deskthing/types';

/** Default auto-lookup minimum duration before DeskThing settings hydrate (10 minutes). */
export const DEFAULT_AUTO_LOOKUP_MIN_DURATION_SECONDS = 600;

/** DeskThing setting ids for CACP. */
export const CACP_SETTING_IDS = {
  OPENROUTER_API_KEY: 'openrouter_api_key',
  AUTO_LOOKUP_MIN_DURATION_SECONDS: 'auto_lookup_min_duration_seconds',
} as const;

let autoLookupMinDurationSeconds = DEFAULT_AUTO_LOOKUP_MIN_DURATION_SECONDS;

/**
 * Applies the OpenRouter API key to process.env for tracklist matcher lookups.
 * @param {string | undefined} value - Raw key from DeskThing settings or .env.
 */
export function applyOpenRouterApiKey(value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    process.env.OPENROUTER_API_KEY = trimmed;
  }
}

/**
 * Applies the auto-lookup minimum duration threshold from DeskThing settings.
 * @param {number | string | undefined} value - Raw seconds from DeskThing settings.
 */
function applyAutoLookupMinDurationSeconds(value: number | string | undefined): void {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    autoLookupMinDurationSeconds = parsed;
  }
}

/**
 * Returns the last-applied auto-lookup minimum duration, or the default before settings load.
 * @returns {number} Threshold in seconds.
 */
export function getAutoLookupMinDurationSeconds(): number {
  return autoLookupMinDurationSeconds;
}

/**
 * Hydrates runtime env from a DeskThing settings payload.
 * @param {AppSettings} settings - Saved or incoming settings from DeskThing.
 */
function applySettingsPayload(settings: AppSettings): void {
  const keySetting = settings[CACP_SETTING_IDS.OPENROUTER_API_KEY];
  if (keySetting?.type === SETTING_TYPES.STRING && keySetting.value) {
    applyOpenRouterApiKey(String(keySetting.value));
  }

  const durationSetting = settings[CACP_SETTING_IDS.AUTO_LOOKUP_MIN_DURATION_SECONDS];
  if (durationSetting?.type === SETTING_TYPES.NUMBER && durationSetting.value != null) {
    applyAutoLookupMinDurationSeconds(durationSetting.value);
  }
}

/**
 * Registers CACP settings with DeskThing and loads any saved values into process.env.
 */
export async function initializeCacpSettings(): Promise<void> {
  const settings: AppSettings = {
    [CACP_SETTING_IDS.OPENROUTER_API_KEY]: {
      id: CACP_SETTING_IDS.OPENROUTER_API_KEY,
      type: SETTING_TYPES.STRING,
      label: 'OpenRouter API Key',
      description:
        'Required for 1001tracklists mix matching. Create a key at https://openrouter.ai/keys',
      value: process.env.OPENROUTER_API_KEY ?? '',
    },
    [CACP_SETTING_IDS.AUTO_LOOKUP_MIN_DURATION_SECONDS]: {
      id: CACP_SETTING_IDS.AUTO_LOOKUP_MIN_DURATION_SECONDS,
      type: SETTING_TYPES.NUMBER,
      label: 'Auto-Lookup Minimum Duration (seconds)',
      description:
        'Tracks shorter than this are assumed to be regular songs, not DJ mixes, and skip the automatic 1001tracklists lookup. Use "Lookup current mix" to force a lookup on any track regardless of length.',
      value: DEFAULT_AUTO_LOOKUP_MIN_DURATION_SECONDS,
      min: 60,
      max: 3600,
      step: 30,
    } as AppSettings[typeof CACP_SETTING_IDS.AUTO_LOOKUP_MIN_DURATION_SECONDS],
  };

  await DeskThing.initSettings(settings);

  const saved = await DeskThing.getSettings();
  if (saved) {
    applySettingsPayload(saved);
  }
}

DeskThing.on(DESKTHING_EVENTS.SETTINGS, async (settingData) => {
  if (settingData.payload) {
    applySettingsPayload(settingData.payload);
  }
});
