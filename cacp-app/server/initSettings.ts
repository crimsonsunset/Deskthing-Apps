import { DeskThing } from '@deskthing/server';
import { DESKTHING_EVENTS, SETTING_TYPES, type AppSettings } from '@deskthing/types';

/** DeskThing setting ids for CACP. */
export const CACP_SETTING_IDS = {
  OPENROUTER_API_KEY: 'openrouter_api_key',
} as const;

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
 * Hydrates runtime env from a DeskThing settings payload.
 * @param {AppSettings} settings - Saved or incoming settings from DeskThing.
 */
function applySettingsPayload(settings: AppSettings): void {
  const keySetting = settings[CACP_SETTING_IDS.OPENROUTER_API_KEY];
  if (keySetting?.type === SETTING_TYPES.STRING && keySetting.value) {
    applyOpenRouterApiKey(String(keySetting.value));
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
