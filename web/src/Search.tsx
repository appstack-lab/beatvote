import { useEffect, useState, type ReactNode } from 'react';
import type { Track } from '../../shared/src/types';
import { api } from './api';
import { withYear } from './History';

/**
 * Song search for guests and the host. The caller renders the buttons per result; `clear` empties the search
 * after an action.
 */
export function Search({
  code,
  onError,
  children,
}: {
  code: string;
  onError: (message: string | null) => void;
  children: (track: Track, clear: () => void) => ReactNode;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>([]);

  // Debounced search keeps us well below Spotify's dev-mode rate limits.
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.search(code, q).then(
        (r) => {
          setResults(r);
          onError(null);
        },
        (e) => onError(e.message),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [q, code]);

  return (
    <>
      <input type="search" placeholder="Search song or artist …" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <ul className="list">
          {results.map((t) => (
            <li key={t.id}>
              <span>
                {t.name} <small>{withYear(t)}</small>
              </span>
              {children(t, () => setQ(''))}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
