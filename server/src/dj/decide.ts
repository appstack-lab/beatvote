import type { Wish } from '../../../shared/src/types';
import { styleGroups, type StyleGroup } from './era';
import { DEFAULT_CONFIG, type DjConfig } from './scoring';

export interface DjState {
  wishes: Wish[];
  currentGenre: string | null;
  /** Reference year of the current phase; missing or null means any year fits. */
  currentEra?: number | null;
  songsInGenre: number;
}

export interface Decision {
  genre: string | null;
  /** Reference year of the phase after this decision (new one on a switch). */
  era: number | null;
  switched: boolean;
  /** Wish to play next; null means the queue has nothing in the chosen phase (auto-fill needed). */
  wish: Wish | null;
}

/**
 * Core DJ rule: stay in the current phase (genre family + time window) as long as possible, switch only when
 * another style is clearly more wanted (and we've played enough in this one).
 */
export function decideNext(state: DjState, now: number, cfg: DjConfig = DEFAULT_CONFIG): Decision {
  const { currentGenre, songsInGenre } = state;
  const currentEra = state.currentEra ?? null;
  const { current, others } = styleGroups(state.wishes, { genre: currentGenre, era: currentEra }, now, cfg);
  const top = others.reduce<StyleGroup | null>((best, g) => (!best || g.score > best.score ? g : best), null);
  const switchTo = (g: StyleGroup): Decision => ({ genre: g.genre, era: g.era, switched: true, wish: g.wishes[0] });

  if (currentGenre === null) {
    return top ? switchTo(top) : { genre: null, era: null, switched: false, wish: null };
  }
  if (top) {
    const currentScore = current?.score ?? 0;
    const hasCurrentWishes = currentScore > 0;
    const enoughPlayed = songsInGenre >= cfg.minSongsPerGenre;
    // No wishes left in the current phase: free to move on without the stickiness test.
    const clearlyWanted = top.score > currentScore * cfg.stickyBonus * cfg.switchMargin;
    if (!hasCurrentWishes || (enoughPlayed && clearlyWanted)) return switchTo(top);
  }
  return { genre: currentGenre, era: currentEra, switched: false, wish: current?.wishes[0] ?? null };
}
