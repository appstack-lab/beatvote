import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../../../shared/src/types';
import { api, watchSession } from '../api';
import { isPinned, pinLabel } from '../../../shared/src/era';
import { History, withYear } from '../History';
import { Search } from '../Search';
import { NowPlaying, skipStatus } from '../NowPlaying';
import { estimatePosition } from '../Progress';
import { VolumeSlider } from '../Volume';

function guestId(): string {
  let id = localStorage.getItem('dj.guestId');
  if (!id) {
    // Guests open the page over plain http (LAN IP), where crypto.randomUUID is unavailable.
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('dj.guestId', id);
  }
  return id;
}

export function Guest({ code }: { code: string }) {
  const me = useRef(guestId()).current;
  const [state, setState] = useState<SessionState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Phone clocks can be off, so remember how far ours is from the server's.
  const clockOffset = useRef(0);
  useEffect(
    () =>
      watchSession(
        code,
        (s) => {
          clockOffset.current = Date.now() - s.serverTime;
          setState(s);
        },
        me,
      ),
    [code, me],
  );
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  async function act(fn: () => Promise<unknown>, okText: string) {
    try {
      await fn();
      setMsg(okText);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="card">
      <h1>Request a song 🎧</h1>
      {state?.nowPlaying && (
        <>
          <NowPlaying
            state={state}
            progress={{
              positionMs: estimatePosition(state.nowPlaying, Date.now() - clockOffset.current),
              durationMs: state.nowPlaying.track.durationMs,
            }}
            aside={
              state.guestSkip && (
                <>
                  <button
                    className={state.nowPlaying.skipVoters?.includes(me) ? 'ghost' : ''}
                    disabled={state.nowPlaying.skipVoters?.includes(me) || state.nowPlaying.skipRequested}
                    onClick={() => act(() => api.voteSkip(code, me), 'Skip vote counted')}
                  >
                    Skip 👎
                  </button>
                  <small>{skipStatus(state)}</small>
                </>
              )
            }
          />
          <VolumeSlider
            value={state.volume}
            disabled={!state.guestVolume}
            onChange={(v) => api.setVolume(code, v).catch((e) => setMsg(e.message))}
          />
          {!state.guestVolume && <small className="muted">The host has locked the volume.</small>}
        </>
      )}
      <Search code={code} onError={setMsg}>
        {(t, clear) => (
          <button
            onClick={() =>
              act(async () => {
                await api.wish(code, me, t);
                clear();
              }, `“${t.name}” is on the list`)
            }
          >
            Request
          </button>
        )}
      </Search>
      {msg && <p className="warn">{msg}</p>}
      <h2>Requests</h2>
      {state && isPinned(state.pin) && (
        <p className="muted">The host picked {pinLabel(state.pin)}. Other requests wait until that changes.</p>
      )}
      <ul className="list">
        {state?.wishes.map((w) => (
          <li key={w.id}>
            <span>
              {w.track.name} <small>{withYear(w.track)}</small>
            </span>
            <button
              className={w.voters.includes(me) ? 'ghost' : ''}
              disabled={w.voters.includes(me)}
              onClick={() => act(() => api.vote(code, me, w.id), 'Vote counted')}
            >
              {w.voters.length} 👍
            </button>
          </li>
        ))}
        {state?.wishes.length === 0 && <li className="muted">No requests yet, be the first!</li>}
      </ul>
      {state && <History entries={state.history} />}
    </main>
  );
}
