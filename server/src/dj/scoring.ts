import { ERA_WINDOW_YEARS } from '../../../shared/src/era';
import type { Wish } from '../../../shared/src/types';

export interface DjConfig {
  /** Multiplier on the current genre's score (stickiness). */
  stickyBonus: number;
  /** Another genre must beat the (boosted) current genre by this factor to win. */
  switchMargin: number;
  /** Minimum songs to play in a genre before switching is considered. */
  minSongsPerGenre: number;
  /** Waiting this long gives a wish a quarter of a vote; the bonus approaches half a vote, never a whole one. */
  waitBonusMs: number;
  /** A phase keeps to songs released within this many years of the song that started it. */
  eraWindowYears: number;
}

export const DEFAULT_CONFIG: DjConfig = {
  stickyBonus: 1.5,
  switchMargin: 1.2,
  minSongsPerGenre: 2,
  waitBonusMs: 30 * 60_000,
  eraWindowYears: ERA_WINDOW_YEARS,
};

/**
 * Votes first; among equal votes, whoever has waited longer comes first. The waiting bonus stays below half a vote,
 * so one more vote always wins.
 */
export function wishScore(wish: Wish, now: number, cfg: DjConfig = DEFAULT_CONFIG): number {
  const age = Math.max(0, now - wish.addedAt);
  return wish.voters.length + (0.5 * age) / (age + cfg.waitBonusMs);
}
