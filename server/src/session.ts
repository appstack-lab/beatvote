import { randomBytes, randomUUID } from 'node:crypto';
import type { PublicWish, SessionState, Track, Wish } from '../../shared/src/types';
import { decideNext } from './dj/decide';
import { fitsEra } from './dj/era';
import { DECADES, isPinned, matchesPin, type Pin } from '../../shared/src/era';
import { GENRE_NAMES } from '../../shared/src/genres';
import { normalizeGenre, UNKNOWN_GENRE } from './dj/genre';
import { DEFAULT_CONFIG, wishScore } from './dj/scoring';
import type { MusicProvider } from './providers/types';
import { readSnapshots, writeSnapshots } from './store';

const MAX_OPEN_WISHES_PER_GUEST = 3;
const DEFAULT_VOLUME = 80;
/** Auto-fill avoids artists heard in this many recent songs. */
const RECENT_ARTIST_TRACKS = 10;
/** When to look up an unknown genre again after a wish came in. */
const GENRE_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];
/** How many recently played tracks clients get; the full history stays on the server for auto-fill. */
const HISTORY_IN_STATE = 20;
/** Sessions idle for longer than this are not restored after a restart. */
const MAX_IDLE_MS = 24 * 60 * 60_000;

/** Everything needed to continue a party after a restart. The Spotify token is not stored. */
interface SessionSnapshot {
  code: string;
  hostKey: string;
  wishes: Wish[];
  currentGenre: string | null;
  /** Missing in snapshots saved before phases had a time window. */
  currentEra?: number | null;
  songsInGenre: number;
  nowPlaying: SessionState['nowPlaying'];
  history: SessionState['history'];
  lastSwitch: SessionState['lastSwitch'];
  updatedAt: number;
  /** Missing in snapshots saved before volume control existed. */
  volume?: number;
  guestVolume?: boolean;
  guestSkip?: boolean;
  pinnedGenre?: string | null;
  pinnedDecade?: number | null;
}

export class Session {
  readonly code: string;
  readonly hostKey: string;
  token: string | null = null;

  private wishes: Wish[] = [];
  private currentGenre: string | null = null;
  private currentEra: number | null = null;
  private songsInGenre = 0;
  private nowPlaying: SessionState['nowPlaying'] = null;
  private history: SessionState['history'] = [];
  private lastSwitch: SessionState['lastSwitch'] = null;
  private genreCache = new Map<string, string>();
  private listeners = new Set<() => void>();
  private updatedAt = Date.now();
  private volume = DEFAULT_VOLUME;
  private guestVolume = true;
  private guestSkip = true;
  private pinnedGenre: string | null = null;
  private pinnedDecade: number | null = null;
  /** Open guest page connections per guest ID; only these guests count for skip votes. */
  private guestsOnline = new Map<string, number>();

  constructor(code: string, private provider: MusicProvider, hostKey = randomBytes(16).toString('hex')) {
    this.code = code;
    this.hostKey = hostKey;
  }

  static fromSnapshot(s: SessionSnapshot, provider: MusicProvider): Session {
    const session = new Session(s.code, provider, s.hostKey);
    session.wishes = s.wishes;
    session.currentGenre = s.currentGenre;
    session.currentEra = s.currentEra ?? null;
    session.songsInGenre = s.songsInGenre;
    session.nowPlaying = s.nowPlaying;
    session.history = s.history;
    session.lastSwitch = s.lastSwitch;
    session.updatedAt = s.updatedAt;
    session.volume = s.volume ?? DEFAULT_VOLUME;
    session.guestVolume = s.guestVolume ?? true;
    session.guestSkip = s.guestSkip ?? true;
    session.pinnedGenre = s.pinnedGenre ?? null;
    session.pinnedDecade = s.pinnedDecade ?? null;
    for (const w of session.wishes) if (w.genre === UNKNOWN_GENRE) session.retryGenre(w.id);
    return session;
  }

  snapshot(): SessionSnapshot {
    return {
      code: this.code,
      hostKey: this.hostKey,
      wishes: this.wishes,
      currentGenre: this.currentGenre,
      currentEra: this.currentEra,
      songsInGenre: this.songsInGenre,
      nowPlaying: this.nowPlaying,
      history: this.history,
      lastSwitch: this.lastSwitch,
      updatedAt: this.updatedAt,
      volume: this.volume,
      guestVolume: this.guestVolume,
      guestSkip: this.guestSkip,
      pinnedGenre: this.pinnedGenre,
      pinnedDecade: this.pinnedDecade,
    };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Every state change goes through here, so this is also where it gets persisted.
  private emit() {
    this.updatedAt = Date.now();
    saveSessions();
    this.notify();
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  /** Host player position, relayed to guests. Too frequent and too short-lived to be worth saving. */
  reportProgress(positionMs: number, paused: boolean): void {
    if (!this.nowPlaying) return;
    this.nowPlaying = { ...this.nowPlaying, progress: { positionMs, paused, at: Date.now() } };
    this.notify();
  }

  state(now = Date.now()): SessionState {
    const wishes: PublicWish[] = this.wishes
      .map((w) => ({ ...w, score: wishScore(w, now) }))
      .sort((a, b) => b.score - a.score);
    return {
      code: this.code,
      currentGenre: this.currentGenre,
      currentEra: this.currentEra,
      nowPlaying: this.nowPlaying,
      wishes,
      history: this.history.slice(-HISTORY_IN_STATE),
      lastSwitch: this.lastSwitch,
      serverTime: now,
      guestsOnline: this.guestsOnline.size,
      skipNeeded: this.skipNeeded(),
      volume: this.volume,
      guestVolume: this.guestVolume,
      guestSkip: this.guestSkip,
      pin: this.pin(),
    };
  }

  private requireToken(): string {
    if (!this.token) throw new HttpError(409, 'The DJ is not connected to Spotify yet');
    return this.token;
  }

  search(query: string): Promise<Track[]> {
    return this.provider.search(this.requireToken(), query);
  }

  private async genreOf(track: Track): Promise<string> {
    const cached = this.genreCache.get(track.artistId);
    if (cached) return cached;
    const raw = await this.provider.artistGenres(this.requireToken(), track.artistId);
    const genre = normalizeGenre(raw);
    // Not cached when unknown, so a later wish for the same artist tries again.
    if (genre === UNKNOWN_GENRE) console.warn(`unknown genre for ${track.artists} (${track.artistId}), tags: ${JSON.stringify(raw)}`);
    else this.genreCache.set(track.artistId, genre);
    return genre;
  }

  /** `unlimited` is for the host, who may queue as many requests as they like. */
  async addWish(guestId: string, track: Track, unlimited = false): Promise<void> {
    const existing = this.wishes.find((w) => w.track.id === track.id);
    if (existing) {
      if (!existing.voters.includes(guestId)) existing.voters.push(guestId);
      return this.emit();
    }
    const open = this.wishes.filter((w) => w.voters[0] === guestId).length;
    if (!unlimited && open >= MAX_OPEN_WISHES_PER_GUEST) {
      throw new HttpError(429, `At most ${MAX_OPEN_WISHES_PER_GUEST} open requests per person`);
    }
    if (this.nowPlaying?.track.id === track.id) {
      throw new HttpError(409, 'This song is playing right now');
    }
    const genre = await this.genreOf(track);
    const id = randomUUID();
    this.wishes.push({ id, track, genre, voters: [guestId], addedAt: Date.now() });
    if (genre === UNKNOWN_GENRE) this.retryGenre(id);
    this.emit();
  }

  /**
   * A genre can be unknown only because MusicBrainz was unreachable or rate-limited at that moment, and an
   * unknown wish never moves the DJ. So try again a few times in the background and update the wish.
   */
  private retryGenre(wishId: string, attempt = 0): void {
    if (attempt >= GENRE_RETRY_DELAYS_MS.length) return;
    const timer = setTimeout(async () => {
      const wish = this.wishes.find((w) => w.id === wishId);
      if (!wish || wish.genre !== UNKNOWN_GENRE) return;
      // Without a token (e.g. right after a server restart) this attempt is skipped, the next one may work.
      const genre = this.token ? await this.genreOf(wish.track).catch(() => UNKNOWN_GENRE) : UNKNOWN_GENRE;
      if (genre === UNKNOWN_GENRE) return this.retryGenre(wishId, attempt + 1);
      wish.genre = genre;
      this.emit();
    }, GENRE_RETRY_DELAYS_MS[attempt]);
    timer.unref?.();
  }

  vote(guestId: string, wishId: string): void {
    const wish = this.wishes.find((w) => w.id === wishId);
    if (!wish) throw new HttpError(404, 'Request not found');
    if (!wish.voters.includes(guestId)) wish.voters.push(guestId);
    this.emit();
  }

  /** Tracks an open guest page. Returns the function to call when it closes. */
  guestConnected(guestId: string): () => void {
    this.guestsOnline.set(guestId, (this.guestsOnline.get(guestId) ?? 0) + 1);
    this.notify();
    return () => {
      const left = (this.guestsOnline.get(guestId) ?? 1) - 1;
      if (left > 0) this.guestsOnline.set(guestId, left);
      else this.guestsOnline.delete(guestId);
      // Fewer guests online can push the existing votes over the threshold.
      if (this.checkSkip()) this.emit();
      else this.notify();
    };
  }

  /** `byHost` is true for requests with a valid host key; guests are refused while the host has locked the volume. */
  setVolume(volume: number, byHost: boolean): void {
    if (!byHost && !this.guestVolume) throw new HttpError(403, 'The host has locked the volume');
    if (!Number.isFinite(volume)) throw new HttpError(400, 'Invalid volume');
    this.volume = Math.round(Math.min(100, Math.max(0, volume)));
    this.emit();
  }

  private pin(): Pin {
    return { genre: this.pinnedGenre, decade: this.pinnedDecade };
  }

  /** Host fixes a genre and/or decade (null = Auto / Any era); takes effect with the next song. */
  setPin(genre: string | null, decade: number | null): void {
    if (genre !== null && !GENRE_NAMES.includes(genre)) throw new HttpError(400, 'Unknown genre');
    if (decade !== null && !DECADES.includes(decade)) throw new HttpError(400, 'Unknown decade');
    this.pinnedGenre = genre;
    this.pinnedDecade = decade;
    this.emit();
  }

  setGuestVolume(allowed: boolean): void {
    this.guestVolume = allowed;
    this.emit();
  }

  /** Host switch for guest skip voting; turning it off drops the votes for the current track. */
  setGuestSkip(allowed: boolean): void {
    this.guestSkip = allowed;
    if (!allowed && this.nowPlaying?.skipVoters?.length && !this.nowPlaying.skipRequested) {
      this.nowPlaying = { ...this.nowPlaying, skipVoters: [] };
    }
    this.emit();
  }

  voteSkip(guestId: string): void {
    if (!this.guestSkip) throw new HttpError(403, 'The host has turned off skip voting');
    if (!this.nowPlaying) throw new HttpError(409, 'Nothing is playing');
    const voters = this.nowPlaying.skipVoters ?? [];
    if (!voters.includes(guestId)) this.nowPlaying = { ...this.nowPlaying, skipVoters: [...voters, guestId] };
    this.checkSkip();
    this.emit();
  }

  private skipNeeded(): number {
    return Math.floor(Math.max(1, this.guestsOnline.size) / 2) + 1;
  }

  /** Marks the current track for skipping once more than half of the online guests want it. */
  private checkSkip(): boolean {
    const np = this.nowPlaying;
    if (!np || np.skipRequested || !this.guestSkip) return false;
    const votes = (np.skipVoters ?? []).filter((g) => this.guestsOnline.has(g)).length;
    if (votes < this.skipNeeded()) return false;
    this.nowPlaying = { ...np, skipRequested: true };
    return true;
  }

  /** Called by the host player when it needs the next track. */
  async next(): Promise<{ track: Track; genre: string } | null> {
    const token = this.requireToken();
    const now = Date.now();
    const pin = this.pin();
    const pinned = isPinned(pin);
    // While the host has fixed a genre/decade, only matching requests count; the others wait on the list.
    const wishes = pinned ? this.wishes.filter((w) => matchesPin(pin, w.genre, w.track.year)) : this.wishes;
    const phaseGenre = pin.genre ?? this.currentGenre;
    const decision = decideNext(
      {
        wishes,
        currentGenre: phaseGenre,
        currentEra: pin.decade !== null ? pin.decade + 5 : this.currentEra,
        songsInGenre: phaseGenre === this.currentGenre ? this.songsInGenre : 0,
      },
      now,
    );

    if (decision.wish && decision.genre) {
      this.wishes = this.wishes.filter((w) => w.id !== decision.wish!.id);
      const switched = decision.switched || decision.genre !== this.currentGenre;
      return this.play(decision.wish.track, decision.genre, switched, false, now, decision.switched ? decision.era : null);
    }
    if (decision.genre === null && !pinned) return null;

    // No matching requests: keep the party going in the pinned or last real genre and its time window.
    const genre = pin.genre ?? (decision.genre && decision.genre !== UNKNOWN_GENRE ? decision.genre : this.lastKnownGenre());
    const w = DEFAULT_CONFIG.eraWindowYears;
    const years =
      pin.decade !== null
        ? { from: pin.decade, to: pin.decade + 9 }
        : genre === this.currentGenre && this.currentEra !== null
          ? { from: this.currentEra - w, to: this.currentEra + w }
          : undefined;
    if (!genre && !years) return null;
    // A picked decade is a hard rule, so is a picked genre; the DJ's own genre and time window may be dropped
    // rather than stop the music.
    const track = await this.autoFill(token, genre, years, {
      mayDropYears: pin.decade === null,
      mayDropGenre: pin.genre === null && pin.decade !== null,
    });
    if (!track) return null;
    const trackGenre = genre ?? (await this.genreOf(track).catch(() => UNKNOWN_GENRE));
    return this.play(track, trackGenre, trackGenre !== this.currentGenre, true, now);
  }

  private lastKnownGenre(): string | null {
    if (this.currentGenre && this.currentGenre !== UNKNOWN_GENRE) return this.currentGenre;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].genre !== UNKNOWN_GENRE) return this.history[i].genre;
    }
    return null;
  }

  /**
   * A not yet played track of the genre by an artist not heard in the last 10 songs, preferably released within
   * the phase's time window. Search offsets are random, so retries differ.
   */
  private async autoFill(
    token: string,
    genre: string | null,
    years: { from: number; to: number } | undefined,
    relax: { mayDropYears: boolean; mayDropGenre: boolean },
  ): Promise<Track | undefined> {
    const played = new Set(this.history.map((h) => h.track.id));
    const recentArtists = new Set(this.history.slice(-RECENT_ARTIST_TRACKS).map((h) => h.track.artistId));
    const repeats: Track[] = [];
    // Genre and time window first, then (where allowed) without one of them: rather close than silence.
    const attempts: [string | null, typeof years][] = [
      [genre, years],
      [genre, years],
      [genre, years],
    ];
    if (relax.mayDropYears && genre) attempts.push([genre, undefined]);
    if (relax.mayDropGenre && genre && years) attempts.push([null, years]);
    for (const [g, range] of attempts) {
      const candidates = (await this.provider.searchByGenre(token, g, range)).filter((t) => !played.has(t.id));
      const fresh = candidates.find((t) => !recentArtists.has(t.artistId));
      if (fresh) return fresh;
      repeats.push(...candidates);
    }
    // Only recently heard artists came up: a repeated artist still beats stopping the music.
    return repeats[0];
  }

  /** Host override: plays a wish right away, regardless of the DJ's genre rule. */
  playWish(wishId: string): { track: Track; genre: string } {
    const wish = this.wishes.find((w) => w.id === wishId);
    if (!wish) throw new HttpError(404, 'Request not found');
    this.wishes = this.wishes.filter((w) => w.id !== wishId);
    return this.playNow(wish.track, wish.genre);
  }

  /** Host override: plays a track the host searched for right away; a matching request is used up. */
  async playTrack(track: Track): Promise<{ track: Track; genre: string }> {
    const genre = await this.genreOf(track).catch(() => UNKNOWN_GENRE);
    this.wishes = this.wishes.filter((w) => w.track.id !== track.id);
    return this.playNow(track, genre);
  }

  private playNow(track: Track, genre: string) {
    // An unknown genre says nothing about the crowd, so it does not move the DJ off the current phase.
    const fits = genre === this.currentGenre && fitsEra(track.year, this.currentEra, DEFAULT_CONFIG.eraWindowYears);
    // While the host has fixed a genre/decade, a manual pick does not move the phase either.
    const switched = genre !== UNKNOWN_GENRE && !fits && !isPinned(this.pin());
    return this.play(track, genre, switched, false, Date.now(), track.year ?? null);
  }

  /** `era` is the reference year for a new phase; it falls back to the track's own year. */
  private play(track: Track, genre: string, switched: boolean, auto: boolean, now: number, era: number | null = null) {
    if (switched) {
      const toEra = era ?? track.year ?? null;
      this.lastSwitch = { from: this.currentGenre, to: genre, at: now, fromEra: this.currentEra, toEra };
      this.currentGenre = genre;
      this.currentEra = toEra;
      this.songsInGenre = 0;
    } else if (this.currentEra === null && track.year !== undefined && genre === this.currentGenre) {
      // Phases from before years were recorded get their reference year from the first song that has one.
      this.currentEra = track.year;
    }
    this.songsInGenre += 1;
    const previous = this.history.at(-1);
    if (previous && this.nowPlaying?.skipRequested) previous.skipped = true;
    this.nowPlaying = { track, genre, startedAt: now, auto };
    this.history.push({ track, genre, playedAt: now, auto });
    this.emit();
    return { track, genre };
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const sessions = new Map<string, Session>();

function saveSessions() {
  writeSnapshots([...sessions.values()].map((s) => s.snapshot()));
}

/** Loads the sessions saved before the last shutdown. Call once at startup. */
export function restoreSessions(provider: MusicProvider): number {
  const now = Date.now();
  for (const snap of readSnapshots<SessionSnapshot>()) {
    if (now - snap.updatedAt < MAX_IDLE_MS) sessions.set(snap.code, Session.fromSnapshot(snap, provider));
  }
  return sessions.size;
}

/**
 * Sessions live only in memory. After a server restart the host passes its previous
 * code and hostKey, and the session is recreated under the same code so guest links keep working.
 */
export function createSession(provider: MusicProvider, prev?: { code?: unknown; hostKey?: unknown }): Session {
  const prevCode = typeof prev?.code === 'string' ? prev.code.toUpperCase() : '';
  const prevKey = typeof prev?.hostKey === 'string' ? prev.hostKey : '';
  if (/^[0-9A-F]{6}$/.test(prevCode) && /^[0-9a-f]{32}$/.test(prevKey)) {
    const existing = sessions.get(prevCode);
    if (existing?.hostKey === prevKey) return existing;
    if (!existing) {
      const s = new Session(prevCode, provider, prevKey);
      sessions.set(prevCode, s);
      saveSessions();
      return s;
    }
  }
  let code: string;
  do {
    code = randomBytes(3).toString('hex').toUpperCase();
  } while (sessions.has(code));
  const s = new Session(code, provider);
  sessions.set(code, s);
  saveSessions();
  return s;
}

export function getSession(code: string): Session {
  const s = sessions.get(code.toUpperCase());
  if (!s) throw new HttpError(404, 'Party not found');
  return s;
}
