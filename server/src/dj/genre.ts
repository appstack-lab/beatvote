import { GENRE_FAMILIES as FAMILIES } from '../../../shared/src/genres';

export const UNKNOWN_GENRE = 'unknown';

/**
 * Picks the family with the strongest tags. Earlier tags weigh more: MusicBrainz sorts them by how many people
 * used them, so "nu metal, alternative rock, rock" is metal rather than a tie.
 */
export function normalizeGenre(genres: string[]): string {
  const scores = new Map<string, number>();
  genres.forEach((raw, i) => {
    const family = familyOf(raw);
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

function familyOf(tag: string): string | undefined {
  const g = tag.toLowerCase();
  return FAMILIES.find(([, keys]) => keys.some((k) => (k.startsWith('=') ? g === k.slice(1) : g.includes(k))))?.[0];
}

/**
 * The finer style of an artist within `family`: their strongest tag of that family ("metalcore" rather than just
 * metal), so auto-fill can stay close to what was playing. A tag that only names the family is too broad.
 */
export function styleOf(genres: string[], family: string): string | null {
  for (const raw of genres) {
    const tag = raw.toLowerCase().trim();
    if (tag !== family && familyOf(tag) === family) return tag;
  }
  return null;
}

/** The style of a phase: the most frequent among its recent tracks' styles, the latest one on a tie. */
export function phaseStyle(styles: string[]): string | null {
  let best: string | null = null;
  let bestCount = 0;
  const counts = new Map<string, number>();
  for (const style of styles) {
    const count = (counts.get(style) ?? 0) + 1;
    counts.set(style, count);
    if (count >= bestCount) {
      best = style;
      bestCount = count;
    }
  }
  return best;
}
