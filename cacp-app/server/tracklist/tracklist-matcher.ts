import {
  MatchResponseSchema,
  type MatchResponse,
  type SearchCandidate,
} from './tracklist.types.js';
import { getOpenRouterApiKey } from '../initSettings.js';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MATCHER_MODEL = 'anthropic/claude-haiku-4.5';
const HTTP_REFERER = 'https://github.com/crimsonsunset/DeskThing-Apps';

type OpenRouterChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

/**
 * Strips optional markdown code fences from an LLM response before JSON parsing.
 * @param {string} text - Raw model output.
 * @returns {string} JSON string suitable for parsing.
 */
function stripMarkdownFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

/**
 * Builds the matcher prompt from the mix query and search candidates.
 * @param {string} query - SoundCloud mix search string (artist + title).
 * @param {SearchCandidate[]} candidates - 1001tracklists search results.
 * @returns {string} Chat completion user message.
 */
function buildMatchPrompt(query: string, candidates: SearchCandidate[]): string {
  const candidateLines = candidates
    .map((candidate, index) => `${index + 1}. Title: "${candidate.title}" URL: ${candidate.url}`)
    .join('\n');

  return [
    'You are matching a SoundCloud mix to the best 1001tracklists.com search result.',
    '',
    `Mix query: "${query}"`,
    '',
    'Candidates:',
    candidateLines,
    '',
    'Return JSON only with this shape:',
    '{',
    '  "matchedUrl": "<best candidate URL or null if none match>",',
    '  "confidence": "high" | "medium" | "low",',
    '  "reasoning": "<brief explanation>"',
    '}',
    '',
    'Prefer the radio episode page that matches the episode number over nearby episodes,',
    'event listings, or unrelated mixes from the same artist. Use matchedUrl: null when no',
    'candidate is a reasonable match.',
  ].join('\n');
}

/**
 * Calls OpenRouter chat completions and returns validated match JSON.
 * @param {string} apiKey - OpenRouter API key from DeskThing settings.
 * @param {string} prompt - Matcher prompt.
 * @returns {Promise<MatchResponse>} Parsed and schema-validated match result.
 */
async function requestMatchFromOpenRouter(
  apiKey: string,
  prompt: string,
): Promise<MatchResponse> {
  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': HTTP_REFERER,
      'X-Title': 'CACP Tracklist Matcher',
    },
    body: JSON.stringify({
      model: MATCHER_MODEL,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OpenRouter request failed (${response.status}): ${errorBody.slice(0, 500)}`,
    );
  }

  const payload = (await response.json()) as OpenRouterChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenRouter response did not include message content');
  }

  console.log(`🧩 [CACP-Tracklist] OpenRouter raw response: ${content.slice(0, 500)}`);

  const parsedJson = JSON.parse(stripMarkdownFences(content)) as unknown;
  const match = MatchResponseSchema.parse(parsedJson);
  console.log(
    `🧩 [CACP-Tracklist] Matcher result — matchedUrl=${match.matchedUrl ?? 'null'} confidence=${match.confidence} reasoning="${match.reasoning}"`,
  );
  return match;
}

/**
 * Picks the best 1001tracklists candidate for a SoundCloud mix via OpenRouter + Zod validation.
 * @param {string} query - SoundCloud mix search string (typically artist + title).
 * @param {SearchCandidate[]} candidates - Deduped search results from 1001tracklists.
 * @returns {Promise<MatchResponse>} Best match URL, confidence, and reasoning.
 */
export async function matchBestCandidate(
  query: string,
  candidates: SearchCandidate[],
): Promise<MatchResponse> {
  console.log(
    `🧩 [CACP-Tracklist] matchBestCandidate start — query="${query}" candidates=${candidates.length}`,
  );

  if (candidates.length === 0) {
    console.warn('🧩 [CACP-Tracklist] No candidates provided — skipping OpenRouter call');
    return MatchResponseSchema.parse({
      matchedUrl: null,
      confidence: 'low',
      reasoning: 'No search candidates were provided.',
    });
  }

  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured in DeskThing settings');
  }

  console.log(`🧩 [CACP-Tracklist] Calling OpenRouter (${MATCHER_MODEL})`);
  const prompt = buildMatchPrompt(query, candidates);
  return requestMatchFromOpenRouter(apiKey, prompt);
}
