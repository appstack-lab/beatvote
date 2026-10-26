import type { Pin } from './era';

export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: string;
  artistId: string;
  durationMs: number;
  image?: string;
  /** Release year of the album; missing on tracks saved before it was recorded. */
  year?: number;
}

export interface Wish {
  id: string;
  track: Track;
  genre: string;
  voters: string[];
  addedAt: number;
}

export interface PublicWish extends Wish {
  score: number;
}

export interface NowPlaying {
  track: Track;
  genre: string;
  startedAt: number;
  auto: boolean;
  /** Last position reported by the host player; `at` is server time. */
  progress?: { positionMs: number; paused: boolean; at: number };
  /** Guests who voted to skip this track. */
  skipVoters?: string[];
  /** Set once more than half of the online guests voted to skip; the host player then moves on. */
  skipRequested?: boolean;
}

export interface HistoryEntry {
  track: Track;
  genre: string;
  /** Missing on entries saved before these fields existed. */
  playedAt?: number;
  auto?: boolean;
  skipped?: boolean;
}

export interface SessionState {
  code: string;
  currentGenre: string | null;
  /** Reference year of the current phase: songs within ±10 years of it fit (see server/src/dj/era.ts). */
  currentEra: number | null;
  nowPlaying: NowPlaying | null;
  wishes: PublicWish[];
  /** Most recent last; includes the track that is playing now. */
  history: HistoryEntry[];
  lastSwitch: { from: string | null; to: string; at: number; fromEra?: number | null; toEra?: number | null } | null;
  /** Lets clients correct for their own clock when extrapolating `progress`. */
  serverTime: number;
  /** Guests with the guest page open right now. */
  guestsOnline: number;
  /** Skip votes needed to skip the current track (more than half of `guestsOnline`). */
  skipNeeded: number;
  /** Playback volume 0–100, shared by host and guests; the host player applies it. */
  volume: number;
  /** Whether guests may change the volume (the host can lock it). */
  guestVolume: boolean;
  /** Whether guests may vote to skip (the host can turn it off; the host can always skip). */
  guestSkip: boolean;
  /** Genre and/or decade fixed by the host; the DJ only plays matching songs while set. */
  pin: Pin;
}
