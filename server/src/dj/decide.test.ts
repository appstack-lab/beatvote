import { describe, expect, it } from 'vitest';
import type { Wish } from '../../../shared/src/types';
import { decideNext } from './decide';
import { normalizeGenre } from './genre';

const NOW = 1_000_000;
let n = 0;
function wish(genre: string, votes: number, name = `t${n++}`): Wish {
  return {
    id: name,
    genre,
    addedAt: NOW,
    voters: Array.from({ length: votes }, (_, i) => `g${i}`),
    track: { id: name, uri: `spotify:track:${name}`, name, artists: 'x', artistId: 'a', durationMs: 1000 },
  };
}

describe('normalizeGenre', () => {
  it('maps sub-genres to families', () => {
    expect(normalizeGenre(['deep house', 'german techno', 'tech house'])).toBe('house');
    expect(normalizeGenre(['trap', 'rap'])).toBe('hip hop');
    expect(normalizeGenre([])).toBe('unknown');
  });

  it('keeps metal apart from rock', () => {
    expect(normalizeGenre(['metalcore', 'post-hardcore', 'alternative metal', 'rock', 'nu metal'])).toBe('metal'); // I Prevail
    expect(normalizeGenre(['industrial metal', 'german', 'neue deutsche härte', 'metal'])).toBe('metal'); // Rammstein
    expect(normalizeGenre(['nu metal', 'alternative rock', 'rap metal', 'rock', 'rap rock'])).toBe('metal'); // Linkin Park
    expect(normalizeGenre(['hard rock', 'rock', 'blues rock'])).toBe('rock'); // AC/DC
    expect(normalizeGenre(['hardcore punk', 'punk'])).toBe('rock');
  });

  it('puts modern hardcore with metal but keeps hardcore punk, hip hop and techno apart', () => {
    expect(normalizeGenre(['metalcore', 'hardcore punk', 'hardcore', 'beatdown', 'beatdown hardcore'])).toBe('metal'); // Knocked Loose
    expect(normalizeGenre(['hardcore punk', 'hardcore', 'beatdown hardcore', 'tough guy hardcore', 'punk'])).toBe('metal'); // Terror
    expect(normalizeGenre(['hardcore punk', 'straight edge', 'punk'])).toBe('rock'); // Minor Threat
    expect(normalizeGenre(['hardcore hip hop', 'hip hop'])).toBe('hip hop');
    expect(normalizeGenre(['happy hardcore', 'techno'])).toBe('techno');
  });

  it('lets the most used tags decide', () => {
    expect(normalizeGenre(['hip hop', 'conscious hip hop', 'jazz rap', 'hardcore hip hop'])).toBe('hip hop');
    expect(normalizeGenre(['alternative rock', 'grunge', 'heavy metal'])).toBe('rock');
  });
});

describe('decideNext', () => {
  it('starts with the most wanted genre', () => {
    const d = decideNext({ wishes: [wish('house', 1), wish('techno', 3)], currentGenre: null, songsInGenre: 0 }, NOW);
    expect(d.genre).toBe('techno');
    expect(d.switched).toBe(true);
  });

  it('returns nothing on an empty queue at the start', () => {
    const d = decideNext({ wishes: [], currentGenre: null, songsInGenre: 0 }, NOW);
    expect(d).toEqual({ genre: null, era: null, switched: false, wish: null });
  });

  it('keeps the genre when another is only slightly ahead', () => {
    const wishes = [wish('house', 2), wish('techno', 3)];
    const d = decideNext({ wishes, currentGenre: 'house', songsInGenre: 5 }, NOW);
    expect(d.genre).toBe('house');
    expect(d.switched).toBe(false);
  });

  it('ignores a single outlier wish', () => {
    const wishes = [wish('house', 3), wish('house', 2), wish('rock', 1)];
    const d = decideNext({ wishes, currentGenre: 'house', songsInGenre: 5 }, NOW);
    expect(d.genre).toBe('house');
  });

  it('switches once another genre is clearly ahead', () => {
    const wishes = [wish('house', 1), wish('techno', 4), wish('techno', 3)];
    const d = decideNext({ wishes, currentGenre: 'house', songsInGenre: 5 }, NOW);
    expect(d.genre).toBe('techno');
    expect(d.switched).toBe(true);
  });

  it('does not switch before the minimum songs in a genre', () => {
    const wishes = [wish('house', 1), wish('techno', 9)];
    const d = decideNext({ wishes, currentGenre: 'house', songsInGenre: 1 }, NOW);
    expect(d.genre).toBe('house');
  });

  it('switches freely when the current genre has no wishes left', () => {
    const d = decideNext({ wishes: [wish('techno', 1)], currentGenre: 'house', songsInGenre: 0 }, NOW);
    expect(d.genre).toBe('techno');
  });

  it('keeps the genre but reports no wish when its queue is empty (auto-fill)', () => {
    const d = decideNext({ wishes: [], currentGenre: 'house', songsInGenre: 3 }, NOW);
    expect(d.genre).toBe('house');
    expect(d.wish).toBeNull();
  });

  describe('time window (±10 years around the phase start)', () => {
    const at = (genre: string, votes: number, year: number | undefined, name: string): Wish => {
      const w = wish(genre, votes, name);
      return { ...w, track: { ...w.track, year } };
    };

    it('prefers a song from the phase era over a stronger one from decades earlier', () => {
      const evanescence = at('rock', 1, 2003, 'evanescence');
      const acdc = at('rock', 2, 1980, 'acdc');
      const d = decideNext({ wishes: [acdc, evanescence], currentGenre: 'rock', currentEra: 2000, songsInGenre: 1 }, NOW);
      expect(d).toMatchObject({ genre: 'rock', era: 2000, switched: false, wish: { id: 'evanescence' } });
    });

    it('treats another era of the same genre like another genre: switches only when clearly wanted', () => {
      const papaRoach = at('rock', 1, 2000, 'papa');
      const acdc1 = at('rock', 3, 1980, 'acdc1');
      const acdc2 = at('rock', 2, 1979, 'acdc2');
      const early = decideNext({ wishes: [papaRoach, acdc1, acdc2], currentGenre: 'rock', currentEra: 2000, songsInGenre: 1 }, NOW);
      expect(early).toMatchObject({ switched: false, wish: { id: 'papa' } });
      const later = decideNext({ wishes: [papaRoach, acdc1, acdc2], currentGenre: 'rock', currentEra: 2000, songsInGenre: 5 }, NOW);
      expect(later).toMatchObject({ genre: 'rock', era: 1980, switched: true, wish: { id: 'acdc1' } });
    });

    it('moves on to another era once the phase has no requests left', () => {
      const d = decideNext({ wishes: [at('rock', 1, 1980, 'acdc')], currentGenre: 'rock', currentEra: 2000, songsInGenre: 0 }, NOW);
      expect(d).toMatchObject({ era: 1980, switched: true, wish: { id: 'acdc' } });
    });

    it('lets songs without a year fit any phase', () => {
      const d = decideNext({ wishes: [at('rock', 1, undefined, 'old')], currentGenre: 'rock', currentEra: 2000, songsInGenre: 1 }, NOW);
      expect(d).toMatchObject({ switched: false, wish: { id: 'old' } });
    });

    it('starts a phase with the era of its strongest request', () => {
      const d = decideNext({ wishes: [at('rock', 1, 2001, 'a'), at('rock', 3, 1999, 'b')], currentGenre: null, songsInGenre: 0 }, NOW);
      expect(d).toMatchObject({ genre: 'rock', era: 1999, switched: true, wish: { id: 'b' } });
    });
  });

  it('plays the highest-scored wish inside the genre', () => {
    const a = wish('house', 1, 'a');
    const b = wish('house', 3, 'b');
    const d = decideNext({ wishes: [a, b], currentGenre: 'house', songsInGenre: 1 }, NOW);
    expect(d.wish?.id).toBe('b');
  });
});
