import type { Wish } from '../../../shared/src/types';
import { wishScore, type DjConfig } from './scoring';

/** A style is a genre family within a time window, e.g. "rock, 1990–2010". */
export interface StyleGroup {
  genre: string;
  /** Reference year; songs within ±cfg.eraWindowYears fit. Null when no wish in the group has a year. */
  era: number | null;
  score: number;
  /** Strongest first. */
  wishes: Wish[];
}

/** Without a year on either side there is nothing to compare, so the song fits. */
export function fitsEra(year: number | undefined, era: number | null, windowYears: number): boolean {
  return year === undefined || era === null || Math.abs(year - era) <= windowYears;
}

/**
 * Splits the wishes into the current phase (same genre, within the window of its reference year) and other
 * styles. Others are clustered greedily from the strongest wish down: same genre and within the window of the
 * group's reference year, which is the year of its strongest wish that has one.
 */
export function styleGroups(
  wishes: Wish[],
  current: { genre: string | null; era: number | null },
  now: number,
  cfg: DjConfig,
): { current: StyleGroup | null; others: StyleGroup[] } {
  const scored = wishes
    .map((w) => ({ w, score: wishScore(w, now, cfg) }))
    .sort((a, b) => b.score - a.score || a.w.addedAt - b.w.addedAt);

  const currentGroup: StyleGroup | null = current.genre
    ? { genre: current.genre, era: current.era, score: 0, wishes: [] }
    : null;
  const others: StyleGroup[] = [];
  const add = (g: StyleGroup, w: Wish, score: number) => {
    g.wishes.push(w);
    g.score += score;
  };

  for (const { w, score } of scored) {
    const year = w.track.year;
    if (currentGroup && w.genre === currentGroup.genre && fitsEra(year, currentGroup.era, cfg.eraWindowYears)) {
      add(currentGroup, w, score);
      continue;
    }
    const group = others.find((g) => g.genre === w.genre && fitsEra(year, g.era, cfg.eraWindowYears));
    if (group) {
      if (group.era === null && year !== undefined) group.era = year;
      add(group, w, score);
    } else {
      others.push({ genre: w.genre, era: year ?? null, score, wishes: [w] });
    }
  }
  return { current: currentGroup, others };
}
