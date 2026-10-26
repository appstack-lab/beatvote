import { GENRE_FAMILIES as FAMILIES } from '../../../shared/src/genres';

export const UNKNOWN_GENRE = 'unknown';

/**
 * Picks the family with the strongest tags. Earlier tags weigh more: MusicBrainz sorts them by how many people
 * used them, so "nu metal, alternative rock, rock" is metal rather than a tie.
 */
export function normalizeGenre(genres: string[]): string {
  const scores = new Map<string, number>();
  genres.forEach((raw, i) => {
    const g = raw.toLowerCase();
    const family = FAMILIES.find(([, keys]) => keys.some((k) => (k.startsWith('=') ? g === k.slice(1) : g.includes(k))))?.[0];
    if (family) scores.set(family, (scores.get(family) ?? 0) + (genres.length - i));
  });
  let best = UNKNOWN_GENRE;
  let bestScore = 0;
  for (const [family, score] of scores) {
    if (score > bestScore) {
      best = family;
      bestScore = score;
    }
  }
  return best;
}
