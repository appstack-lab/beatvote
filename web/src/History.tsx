import type { HistoryEntry, Track } from '../../shared/src/types';

/** "Linkin Park · 2000" */
export const withYear = (t: Track) => (t.year ? `${t.artists} · ${t.year}` : t.artists);

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Recently played tracks, newest first, without the one playing now. `scroll` keeps the list to a fixed height
 * (host view, where it would otherwise stretch the whole screen).
 */
export function History({ entries, scroll = false }: { entries: HistoryEntry[]; scroll?: boolean }) {
  const played = entries.slice(0, -1).reverse();
  if (played.length === 0) return null;
  return (
    <>
      <h2>Recently played</h2>
      <ul className={scroll ? 'list scroll' : 'list'}>
        {played.map((h, i) => (
          <li key={`${h.track.id}-${h.playedAt ?? i}`}>
            <span>
              {h.playedAt && <small>{time(h.playedAt)} · </small>}
              {h.track.name} <small>{withYear(h.track)}</small>
            </span>
            <span className="pill">{h.genre}</span>
            {h.auto !== undefined && <span className="pill">{h.auto ? 'DJ pick' : 'request'}</span>}
            {h.skipped && <span className="pill">skipped</span>}
          </li>
        ))}
      </ul>
    </>
  );
}
