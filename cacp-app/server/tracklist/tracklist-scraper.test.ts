import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { parseTracklistDom } from './tracklist-scraper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures/purified-512.html');

test('parseTracklistDom parses purified-512 fixture', () => {
  const html = readFileSync(FIXTURE_PATH, 'utf8');
  const { document } = parseHTML(html);
  const result = parseTracklistDom(document);

  assert.equal(result.mixTitle, 'Nora En Pure - Purified Radio 512 2026-06-15');
  assert.equal(result.tracks.length, 13);

  const firstTrack = result.tracks[0];
  assert.equal(firstTrack.artist, 'Corren Cavini');
  assert.equal(firstTrack.title, "Lion's Head");
  assert.equal(firstTrack.cueSeconds, 121);
  assert.equal(
    firstTrack.artworkUrl,
    'https://geo-media.beatport.com/image_size/300x300/078ba536-246d-48c5-971d-ba8c906bf2df.jpg',
  );

  const lastTrack = result.tracks[12];
  assert.equal(lastTrack.artist, 'P.A.V.');
  assert.equal(lastTrack.title, 'I Dream Of You');
  assert.equal(lastTrack.cueSeconds, 3372);
});
