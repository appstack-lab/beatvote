import type { Track } from '../../../shared/src/types';

/** Server-side part of a music service. Playback happens in the host's browser. */
export interface MusicProvider {
  search(token: string, query: string): Promise<Track[]>;
  /** Raw genre tags of an artist (to be normalized by dj/genre). */
  artistGenres(token: string, artistId: string): Promise<string[]>;
  /**
   * Tracks for a genre and/or released within `years` (at least one of both), used to auto-fill when no wishes
   * are left.
   */
  searchByGenre(token: string, genre: string | null, years?: { from: number; to: number }): Promise<Track[]>;
}
