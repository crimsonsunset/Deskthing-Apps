import { z } from 'zod';

export const SearchCandidateSchema = z.object({
  title: z.string(),
  url: z.string().url(),
});

export const MatchResponseSchema = z.object({
  matchedUrl: z.string().url().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string(),
});

export const TracklistTrackSchema = z.object({
  order: z.number(),
  cueSeconds: z.number().nullable(),
  artist: z.string(),
  title: z.string(),
  artworkUrl: z.string().url().optional(),
  processedArtwork: z.string().optional(),
});

export const TracklistResultSchema = z.object({
  sourceUrl: z.string().url(),
  mixTitle: z.string(),
  tracks: z.array(TracklistTrackSchema),
});

export type SearchCandidate = z.infer<typeof SearchCandidateSchema>;
export type MatchResponse = z.infer<typeof MatchResponseSchema>;
export type TracklistTrack = z.infer<typeof TracklistTrackSchema>;
export type TracklistResult = z.infer<typeof TracklistResultSchema>;
