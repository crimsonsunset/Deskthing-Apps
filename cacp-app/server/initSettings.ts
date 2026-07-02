import { DeskThing } from '@deskthing/server';
import { SETTING_TYPES, type AppSettings } from '@deskthing/types';

export const CACPSettingIDs = {
  OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
} as const;

let hasInitializedSettings = false;

/**
 * Registers CACP DeskThing settings (OpenRouter API key for tracklist matching).
 */
export async function initializeSettings(): Promise<void> {
  const settings: AppSettings = {
    [CACPSettingIDs.OPENROUTER_API_KEY]: {
      id: CACPSettingIDs.OPENROUTER_API_KEY,
      type: SETTING_TYPES.STRING,
      label: 'OpenRouter API Key',
      description: 'API key used server-side for 1001tracklists mix matching.',
      value: '',
    },
  };

  await DeskThing.initSettings(settings);
  hasInitializedSettings = true;
}

/**
 * Ensures settings are registered before reading values.
 */
async function ensureSettingsInitialized(): Promise<void> {
  if (hasInitializedSettings) {
    return;
  }

  await initializeSettings();
}

/**
 * Reads the OpenRouter API key from DeskThing settings (server-side only).
 * @returns {Promise<string | null>} Trimmed API key, or null when unset.
 */
export async function getOpenRouterApiKey(): Promise<string | null> {
  const envKey = process.env.OPENROUTER_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  await ensureSettingsInitialized();

  const settings = await DeskThing.getSettings();
  const apiKeySetting = settings?.[CACPSettingIDs.OPENROUTER_API_KEY];

  if (!apiKeySetting || apiKeySetting.type !== SETTING_TYPES.STRING) {
    return null;
  }

  const apiKey = apiKeySetting.value?.trim();
  return apiKey || null;
}
