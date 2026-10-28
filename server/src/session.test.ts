import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../shared/src/types';
import type { MusicProvider } from './providers/types';
import type { Session } from './session';

const dir = mkdtempSync(join(tmpdir(), 'dj-test-'));
process.env.DJ_DATA_FILE = join(dir, 'sessions.json');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const track = (id: string): Track => ({ id, uri: `spotify:track:${id}`, name: id, artists: 'x', artistId: 'a', durationMs: 1000 });
const provider: MusicProvider = {
  search: async () => [],
  artistGenres: async () => ['deep house'],
  searchByGenre: async () => [],
};

// A fresh module instance has an empty in-memory session map, like a restarted server.
async function restart() {
  vi.resetModules();
  return import('./session');
}

describe('playWish', () => {
  it('plays the chosen wish and switches to its genre, but not to "unknown"', async () => {
    const { createSession } = await restart();
    const genres: Record<string, string[]> = { house: ['deep house'], rock: ['hard rock'], none: [] };
    const s = createSession({ ...provider, artistGenres: async (_t, artistId) => genres[artistId] });
    s.token = 'tok';
    await s.addWish('g1', { ...track('h'), artistId: 'house' });
    await s.addWish('g4', { ...track('h'), artistId: 'house' }); // second vote, so house clearly leads
    await s.addWish('g2', { ...track('r'), artistId: 'rock' });
    await s.addWish('g3', { ...track('u'), artistId: 'none' });
    await s.next();
    expect(s.state().currentGenre).toBe('house');

    const id = (t: string) => s.state().wishes.find((w) => w.track.id === t)!.id;
    expect(s.playWish(id('r')).track.id).toBe('r');
    expect(s.state()).toMatchObject({ currentGenre: 'rock', lastSwitch: { from: 'house', to: 'rock' } });

    s.playWish(id('u'));
    expect(s.state().nowPlaying?.track.id).toBe('u');
    expect(s.state().currentGenre).toBe('rock');
    expect(s.state().wishes).toEqual([]);
    expect(() => s.playWish('gone')).toThrow('Request not found');
  });
});

describe('upNext', () => {
  it('names the request the DJ plays next, and none when it would pick a track itself', async () => {
    const { createSession } = await restart();
    const s = createSession(provider);
    s.token = 'tok';
    expect(s.state().upNext).toBeNull();
    await s.addWish('g1', { ...track('a'), artistId: 'x' });
    await s.addWish('g2', { ...track('b'), artistId: 'y' });
    await s.addWish('g3', { ...track('b'), artistId: 'y' }); // second vote
    const id = s.state().upNext;
    expect(s.state().wishes.find((w) => w.id === id)?.track.id).toBe('b');
    expect((await s.next())?.track.id).toBe('b');
  });
});

describe('host order', () => {
  it('plays the requests in the order the host arranged, new ones at the end, until back to votes', async () => {
    const { createSession } = await restart();
    const genres: Record<string, string[]> = { m: ['metalcore'], e: ['electro'], r: ['hard rock'] };
    const s = createSession({ ...provider, artistGenres: async (_t, artistId) => genres[artistId] });
    s.token = 'tok';
    await s.addWish('g1', { ...track('metal'), artistId: 'm' });
    await s.addWish('g2', { ...track('edm'), artistId: 'e' });
    await s.addWish('g3', { ...track('edm'), artistId: 'e' }); // most votes: first by votes
    const names = () => s.state().wishes.map((w) => w.track.id);
    const id = (t: string) => s.state().wishes.find((w) => w.track.id === t)!.id;
    expect(names()).toEqual(['edm', 'metal']);

    s.moveWish(id('metal'), 'up');
    expect(names()).toEqual(['metal', 'edm']);
    expect(s.state()).toMatchObject({ manualOrder: true, upNext: id('metal') });
    await s.addWish('g4', { ...track('rock'), artistId: 'r' });
    await s.addWish('g5', { ...track('rock'), artistId: 'r' }); // votes don't lift it over the host's order
    expect(names()).toEqual(['metal', 'edm', 'rock']);
    expect((await s.next())?.track.id).toBe('metal');

    s.orderByVotes();
    expect(names()).toEqual(['edm', 'rock']); // equal votes: the earlier request first
    expect(s.state().manualOrder).toBe(false);
  });
});

describe('auto-fill', () => {
  it('continues in the last real genre after an unknown song, without repeats', async () => {
    const { createSession } = await restart();
    const searched: string[] = [];
    let page = 0;
    const s = createSession({
      ...provider,
      artistGenres: async (_t, artistId) => (artistId === 'house' ? ['deep house'] : []),
      // First page holds only the already played track, the next one a fresh track.
      searchByGenre: async (_t, genre) => {
        searched.push(genre ?? '');
        return page++ === 0 ? [track('h')] : [track('fresh')];
      },
    });
    s.token = 'tok';
    await s.addWish('g1', { ...track('h'), artistId: 'house' });
    await s.next();
    await s.addWish('g1', { ...track('u'), artistId: 'none' });
    await s.next();
    expect(s.state().currentGenre).toBe('unknown');

    const next = await s.next();
    expect(next).toEqual({ track: track('fresh'), genre: 'house' });
    expect(searched).toEqual(['house', 'house']);
    expect(s.state()).toMatchObject({ currentGenre: 'house', nowPlaying: { auto: true } });
  });

  it('fills within the phase era and skips the artist of the last song', async () => {
    const before = await restart();
    const calls: (string | undefined)[] = [];
    const lp = { ...track('lp'), artistId: 'linkinpark', year: 2000 };
    const s = before.createSession({
      ...provider,
      artistGenres: async () => ['alternative rock'],
      searchByGenre: async (_t, genre, years) => {
        calls.push(years ? `${genre} ${years.from}-${years.to}` : (genre ?? undefined));
        // Same artist as the last song first, then a fresh one; nothing new without the year filter.
        return years ? [{ ...track('lp2'), artistId: 'linkinpark', year: 2003 }, { ...track('ev'), artistId: 'evanescence', year: 2003 }] : [];
      },
    });
    s.token = 'tok';
    await s.addWish('g1', lp);
    await s.next();
    expect(s.state()).toMatchObject({ currentGenre: 'rock', currentEra: 2000 });

    const next = await s.next();
    expect(next?.track.id).toBe('ev');
    expect(calls).toEqual(['alternative rock 1990-2010']); // the phase's finer style comes first

    const after = await restart();
    after.restoreSessions(provider);
    expect(after.getSession(s.code).state().currentEra).toBe(2000);
  });

  it('takes a recently heard artist rather than stopping the music', async () => {
    const { createSession } = await restart();
    const s = createSession({
      ...provider,
      artistGenres: async () => ['deep house'],
      searchByGenre: async () => [{ ...track('again'), artistId: 'same' }],
    });
    s.token = 'tok';
    await s.addWish('g1', { ...track('first'), artistId: 'same' });
    await s.next();
    expect((await s.next())?.track.id).toBe('again');
  });

  // Plays one wish per artist, oldest first.
  async function playArtists(s: Session, artists: string[]) {
    for (const [i, artistId] of artists.entries()) {
      await s.addWish('g1', { ...track(`t${i}`), artistId });
      await s.next();
    }
  }

  it('skips artists heard in the last 20 songs', async () => {
    const { createSession } = await restart();
    const s = createSession({
      ...provider,
      searchByGenre: async () => [{ ...track('old-again'), artistId: 'old' }, { ...track('new'), artistId: 'new' }],
    });
    s.token = 'tok';
    // "old" played 20 songs ago, 19 other artists since.
    await playArtists(s, ['old', ...Array.from({ length: 19 }, (_, i) => `a${i}`)]);
    expect((await s.next())?.track.id).toBe('new');
  });

  it('repeats the artist heard longest ago when only recent ones come up', async () => {
    const { createSession } = await restart();
    const s = createSession({
      ...provider,
      searchByGenre: async () => [{ ...track('b2'), artistId: 'b' }, { ...track('a2'), artistId: 'a' }],
    });
    s.token = 'tok';
    await playArtists(s, ['a', 'b']);
    expect((await s.next())?.track.id).toBe('a2');
  });

  it('stays in the phase window rather than playing a fresh artist from another era', async () => {
    const { createSession } = await restart();
    const offsets = new Set<number | undefined>();
    const s = createSession({
      ...provider,
      artistGenres: async () => ['metalcore'],
      searchByGenre: async (_t, g, years, offset) => {
        if (years && g === 'metal') offsets.add(offset);
        return years ? [{ ...track('sb2'), artistId: 'spiritbox', year: 2023 }] : [{ ...track('soad'), artistId: 'soad', year: 2001 }];
      },
    });
    s.token = 'tok';
    await s.addWish('g1', { ...track('sb'), artistId: 'spiritbox', year: 2021 });
    await s.next();
    expect((await s.next())?.track.id).toBe('sb2');
    expect(offsets.size).toBe(5); // five different result pages of the phase
  });

  it('searches the finer style of the phase before the whole family', async () => {
    const { createSession } = await restart();
    const searched: string[] = [];
    const s = createSession({
      ...provider,
      artistGenres: async () => ['metalcore', 'post-hardcore', 'alternative metal'],
      searchByGenre: async (_t, g) => {
        searched.push(g ?? '');
        // Power metal only turns up when searching all of metal.
        return g === 'metalcore'
          ? [{ ...track('mc'), artistId: 'architects', year: 2021 }]
          : [{ ...track('pm'), artistId: 'sabaton', year: 2022 }];
      },
    });
    s.token = 'tok';
    await s.addWish('g1', { ...track('bo'), artistId: 'badomens', year: 2022 });
    await s.next();
    expect((await s.next())?.track.id).toBe('mc');
    expect(searched).toEqual(['metalcore']);
  });

  it('ends the phase window this year', async () => {
    const { createSession } = await restart();
    const ranges: string[] = [];
    const year = new Date().getFullYear();
    const s = createSession({
      ...provider,
      searchByGenre: async (_t, _g, years) => {
        ranges.push(`${years?.from}-${years?.to}`);
        return [{ ...track('new'), artistId: 'new', year }];
      },
    });
    s.token = 'tok';
    await s.addWish('g1', { ...track('now'), artistId: 'b', year });
    await s.next();
    await s.next();
    expect(ranges).toEqual([`${year - 10}-${year}`]);
  });

  it('waits when nothing has a known genre yet', async () => {
    const { createSession } = await restart();
    const s = createSession({ ...provider, artistGenres: async () => [] });
    s.token = 'tok';
    await s.addWish('g1', track('u'));
    await s.next();
    expect(await s.next()).toBeNull();
  });
});

describe('skip voting', () => {
  async function playing() {
    const { createSession } = await restart();
    const s = createSession(provider);
    s.token = 'tok';
    await s.addWish('g1', track('a'));
    await s.addWish('g2', track('a')); // second vote, so 'a' plays first regardless of timing
    await s.addWish('g1', track('b'));
    await s.next();
    return s;
  }

  it('skips once more than half of the online guests vote', async () => {
    const s = await playing();
    s.guestConnected('g1');
    s.guestConnected('g2');
    s.guestConnected('g3');
    expect(s.state().skipNeeded).toBe(2);
    s.voteSkip('g1');
    s.voteSkip('g1');
    expect(s.state().nowPlaying?.skipRequested).toBeFalsy();
    s.voteSkip('g2');
    expect(s.state().nowPlaying?.skipRequested).toBe(true);

    await s.next();
    expect(s.state().nowPlaying).toMatchObject({ track: { id: 'b' } });
    expect(s.state().nowPlaying?.skipVoters).toBeUndefined();
    const history = s.state().history;
    expect(history.map((h) => [h.track.id, h.auto, h.skipped ?? false])).toEqual([
      ['a', false, true],
      ['b', false, false],
    ]);
    expect(history[0].playedAt).toEqual(expect.any(Number));
  });

  it('ignores votes of guests who left, and re-checks when someone leaves', async () => {
    const s = await playing();
    const leaveG1 = s.guestConnected('g1');
    s.guestConnected('g2');
    const leaveG3 = s.guestConnected('g3');
    s.guestConnected('g4');
    s.guestConnected('g5');
    s.voteSkip('g1');
    leaveG1();
    s.voteSkip('g2');
    s.voteSkip('g4');
    // g1's vote no longer counts: 2 of 4 online is not more than half.
    expect(s.state()).toMatchObject({ guestsOnline: 4, skipNeeded: 3 });
    expect(s.state().nowPlaying?.skipRequested).toBeFalsy();
    leaveG3();
    expect(s.state()).toMatchObject({ guestsOnline: 3, skipNeeded: 2, nowPlaying: { skipRequested: true } });
  });

  it('counts a guest with two open tabs once', async () => {
    const s = await playing();
    s.guestConnected('g1');
    const closeTab = s.guestConnected('g1');
    s.guestConnected('g2');
    closeTab();
    expect(s.state().guestsOnline).toBe(2);
  });

  it('can be turned off by the host and stays off after a restart', async () => {
    const s = await playing();
    s.guestConnected('g1');
    const leaveG2 = s.guestConnected('g2');
    s.guestConnected('g3');
    s.voteSkip('g1');
    s.setGuestSkip(false);
    expect(s.state()).toMatchObject({ guestSkip: false, nowPlaying: { skipVoters: [] } });
    expect(() => s.voteSkip('g3')).toThrow('turned off skip voting');
    leaveG2();
    expect(s.state().nowPlaying?.skipRequested).toBeFalsy();

    const after = await restart();
    after.restoreSessions(provider);
    expect(after.getSession(s.code).state().guestSkip).toBe(false);
  });
});

describe('host search', () => {
  it('lets the host queue more than 3 requests, guests not', async () => {
    const { createSession } = await restart();
    const s = createSession(provider);
    s.token = 'tok';
    for (const id of ['a', 'b', 'c', 'd']) await s.addWish('host', track(id), true);
    expect(s.state().wishes).toHaveLength(4);
    for (const id of ['e', 'f', 'g']) await s.addWish('g1', track(id));
    await expect(s.addWish('g1', track('h'))).rejects.toThrow('At most 3');
  });

  it('plays a searched track right away, uses up a matching request and switches the phase', async () => {
    const { createSession } = await restart();
    const genres: Record<string, string[]> = { house: ['deep house'], metal: ['metalcore'] };
    const s = createSession({ ...provider, artistGenres: async (_t, artistId) => genres[artistId] ?? [] });
    s.token = 'tok';
    await s.addWish('g1', { ...track('h'), artistId: 'house' });
    await s.next();
    await s.addWish('g2', { ...track('m'), artistId: 'metal', year: 2018 });

    const played = await s.playTrack({ ...track('m'), artistId: 'metal', year: 2018 });
    expect(played.genre).toBe('metal');
    expect(s.state()).toMatchObject({ currentGenre: 'metal', currentEra: 2018, wishes: [], nowPlaying: { track: { id: 'm' } } });
  });
});

describe('host picks genre and decade', () => {
  const genres: Record<string, string[]> = { metal: ['metalcore'], rock: ['hard rock'] };
  const tagged = (id: string, artistId: string, year?: number) => ({ ...track(id), artistId, year });

  it('plays only matching requests while a genre is picked; others wait', async () => {
    const { createSession } = await restart();
    const s = createSession({ ...provider, artistGenres: async (_t, a) => genres[a] ?? [] });
    s.token = 'tok';
    await s.addWish('g1', tagged('rock1', 'rock', 1980));
    await s.addWish('g2', tagged('rock1', 'rock', 1980)); // rock is wanted more
    await s.addWish('g3', tagged('metal1', 'metal', 2018));
    s.setPin('metal', null);

    expect((await s.next())?.track.id).toBe('metal1');
    expect(s.state()).toMatchObject({ currentGenre: 'metal', pin: { genre: 'metal', decade: null } });
    expect(s.state().wishes.map((w) => w.track.id)).toEqual(['rock1']);
  });

  it('fills with the picked genre and decade, and with the decade alone', async () => {
    const before = await restart();
    const calls: string[] = [];
    let metalSearches = 0;
    const s = before.createSession({
      ...provider,
      artistGenres: async (_t, a) => genres[a] ?? [],
      searchByGenre: async (_t, genre, years) => {
        calls.push(`${genre ?? '-'} ${years ? `${years.from}-${years.to}` : '-'}`);
        // Only the first metal search finds something; afterwards the decade alone has to do.
        if (genre === 'metal' && ++metalSearches > 1) return [];
        return [tagged(`t${calls.length}`, `artist${calls.length}`, 1995)];
      },
    });
    s.token = 'tok';
    s.setPin(null, 1990); // nothing played yet, so no genre: decade alone
    await s.next();
    s.setPin('metal', 1990);
    await s.next();
    s.setPin(null, 1990); // DJ stays in metal, finds nothing in the 90s, then drops the genre but not the decade
    await s.next();
    // Third song: five pages of metal in the 90s, then the decade alone.
    expect(calls).toEqual(['- 1990-1999', 'metal 1990-1999', ...Array(5).fill('metal 1990-1999'), '- 1990-1999']);

    const after = await restart();
    after.restoreSessions(provider);
    expect(after.getSession(s.code).state().pin).toEqual({ genre: null, decade: 1990 });
  });

  it('rejects unknown genres and decades', async () => {
    const { createSession } = await restart();
    const s = createSession(provider);
    expect(() => s.setPin('polka', null)).toThrow('Unknown genre');
    expect(() => s.setPin(null, 1995)).toThrow('Unknown decade');
  });
});

describe('volume', () => {
  it('is shared, clamped, lockable for guests and survives a restart', async () => {
    const before = await restart();
    const s = before.createSession(provider);
    expect(s.state()).toMatchObject({ volume: 80, guestVolume: true });
    s.setVolume(55.4, false);
    expect(s.state().volume).toBe(55);
    s.setVolume(140, true);
    expect(s.state().volume).toBe(100);
    s.setGuestVolume(false);
    expect(() => s.setVolume(10, false)).toThrow('locked');
    s.setVolume(30, true);

    const after = await restart();
    after.restoreSessions(provider);
    expect(after.getSession(s.code).state()).toMatchObject({ volume: 30, guestVolume: false });
  });
});

describe('genre retry', () => {
  afterEach(() => vi.useRealTimers());

  it('looks up an unknown genre again later and updates the wish', async () => {
    vi.useFakeTimers();
    const { createSession } = await restart();
    let reachable = false;
    const s = createSession({ ...provider, artistGenres: async () => (reachable ? ['hard rock'] : []) });
    s.token = 'tok';
    await s.addWish('g1', track('a'));
    expect(s.state().wishes[0].genre).toBe('unknown');

    reachable = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.state().wishes[0].genre).toBe('rock');
  });
});

describe('session persistence', () => {
  it('keeps wishes, votes and the current track across a restart', async () => {
    const before = await restart();
    const s = before.createSession(provider);
    s.token = 'tok';
    await s.addWish('g1', track('a'));
    await s.addWish('g2', track('b'));
    s.vote('g3', s.state().wishes.find((w) => w.track.id === 'b')!.id);
    await s.next();

    const after = await restart();
    expect(after.restoreSessions(provider)).toBe(1);
    const restored = after.getSession(s.code);
    expect(restored.hostKey).toBe(s.hostKey);
    expect(restored.token).toBeNull();
    const state = restored.state();
    expect(state.nowPlaying?.track.id).toBe('b');
    expect(state.wishes.map((w) => w.track.id)).toEqual(['a']);
    expect(state.currentGenre).toBe('house');
  });

  it('recreates a lost session under the same code when the host resumes it', async () => {
    const { createSession } = await restart();
    const prev = { code: 'ABC123', hostKey: 'f'.repeat(32) };
    const s = createSession(provider, prev);
    expect(s.code).toBe(prev.code);
    expect(createSession(provider, prev)).toBe(s);
    expect(createSession(provider, { ...prev, hostKey: '0'.repeat(32) }).code).not.toBe(prev.code);
  });
});
