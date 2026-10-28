import type { ReactNode } from 'react';
import { currentPhaseLabel } from '../../shared/src/era';
import type { SessionState } from '../../shared/src/types';
import { withYear } from './History';
import { Progress } from './Progress';

/** "1/2 skip votes", or that the guests' skip is under way. */
export function skipStatus(state: SessionState): string {
  const np = state.nowPlaying;
  if (!np) return '';
  if (!state.guestSkip) return 'Skip voting off';
  return np.skipRequested ? 'Skipping …' : `${np.skipVoters?.length ?? 0}/${state.skipNeeded} skip votes`;
}

/**
 * The current track as a framed card; `aside` (the skip button) sits on the right. `phase: false` leaves out the
 * genre/era line when the page shows it elsewhere.
 */
export function NowPlaying({
  state,
  progress,
  aside,
  phase = true,
}: {
  state: SessionState;
  progress: { positionMs: number; durationMs: number } | null;
  aside?: ReactNode;
  phase?: boolean;
}) {
  const np = state.nowPlaying;
  if (!np) return null;
  return (
    <section className="now">
      {np.track.image && <img src={np.track.image} alt="" width={64} height={64} />}
      <div className="now-info">
        <b>{np.track.name}</b>
        <div>{withYear(np.track)}</div>
        {phase && <small>{currentPhaseLabel(state.pin, state.currentGenre, state.currentEra)}</small>}
        {progress && <Progress {...progress} />}
      </div>
      {aside && <div className="now-aside">{aside}</div>}
    </section>
  );
}
