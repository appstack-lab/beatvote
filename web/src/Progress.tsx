import type { NowPlaying } from '../../shared/src/types';

function formatTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Position from the host's last report, extrapolated to `serverNow`. Before the first report
 * of a track, falls back to when the server handed the track out.
 */
export function estimatePosition(np: NowPlaying, serverNow: number): number {
  const p = np.progress;
  const pos = p ? p.positionMs + (p.paused ? 0 : serverNow - p.at) : serverNow - np.startedAt;
  return Math.min(np.track.durationMs, Math.max(0, pos));
}

export function Progress({ positionMs, durationMs }: { positionMs: number; durationMs: number }) {
  const pct = durationMs ? Math.min(100, (positionMs / durationMs) * 100) : 0;
  return (
    <>
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <small>
        {formatTime(positionMs)} / {formatTime(durationMs)} · <b>{formatTime(durationMs - positionMs)}</b> left
      </small>
    </>
  );
}
