import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import type { NowPlaying as NowPlayingState, SessionState } from '../../../shared/src/types';
import { api, watchSession } from '../api';
import { DECADES, isPinned, matchesPin, phaseLabel, type Pin } from '../../../shared/src/era';
import { GENRE_NAMES } from '../../../shared/src/genres';
import { History, withYear } from '../History';
import { NowPlaying, skipStatus } from '../NowPlaying';
import { Search } from '../Search';
import { VolumeSlider } from '../Volume';
import {
  finishLogin,
  getClientId,
  isLoopbackIp,
  loadTokens,
  logout,
  redirectUri,
  refresh,
  setClientId,
  startLogin,
  type Tokens,
} from './spotifyAuth';
import { NATIVE_VOLUME_EVENT, nativeVolume } from './native';
import { usePlayer } from './usePlayer';

// The party (code + host key) lives in localStorage so closing the app does not lose it. Older builds kept it
// in sessionStorage, which the app clears on close; read that once as a fallback.
const PARTY_KEY = 'dj.party';
type Party = { code: string; hostKey: string };

function loadParty(): Party | null {
  try {
    return JSON.parse(localStorage.getItem(PARTY_KEY) ?? sessionStorage.getItem('dj.session') ?? 'null');
  } catch {
    return null;
  }
}

function saveParty(party: Party | null) {
  if (party) localStorage.setItem(PARTY_KEY, JSON.stringify(party));
  else localStorage.removeItem(PARTY_KEY);
  sessionStorage.removeItem('dj.session');
}

/**
 * Host override: the DJ sticks to this genre and/or decade until cleared. The choice only takes effect with Apply,
 * which also switches right away instead of after the current track. Clear lets the DJ choose again from the next track.
 */
function PinPicker({
  pin,
  nowPlaying,
  onApply,
  onClear,
}: {
  pin: Pin;
  nowPlaying: NowPlayingState | null;
  onApply: (pin: Pin) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(pin);
  useEffect(() => setDraft(pin), [pin.genre, pin.decade]);
  const changed = draft.genre !== pin.genre || draft.decade !== pin.decade;
  // Unchanged, Apply still helps when the current track doesn't fit the pin (e.g. a host ▶ pick).
  const offPin = !!nowPlaying && !matchesPin(pin, nowPlaying.genre, nowPlaying.track.year);
  return (
    <div className="row pin">
      <label>
        Genre
        <select value={draft.genre ?? ''} onChange={(e) => setDraft({ ...draft, genre: e.target.value || null })}>
          <option value="">Any genre</option>
          {GENRE_NAMES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <label>
        Era
        <select
          value={draft.decade ?? ''}
          onChange={(e) => setDraft({ ...draft, decade: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Any era</option>
          {DECADES.map((d) => (
            <option key={d} value={d}>
              {d}s
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => onApply(draft)} disabled={!changed && !offPin}>
        Apply
      </button>
      {isPinned(pin) && (
        <button className="ghost" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  );
}

/** The app name with B and V in the logo colour. */
function Title() {
  return (
    <h1>
      <span className="brand">B</span>eat<span className="brand">V</span>ote
    </h1>
  );
}

function ResumeParty({ party, onResume, onNew }: { party: Party; onResume: () => void; onNew: () => void }) {
  const [info, setInfo] = useState<SessionState | 'gone' | null>(null);
  useEffect(() => {
    api.session(party.code).then(setInfo, () => setInfo('gone'));
  }, [party.code]);
  return (
    <section className="resume">
      <h2>Resume your party?</h2>
      <p>
        Party <b>{party.code}</b>
        {info && info !== 'gone' && ` · ${info.wishes.length} requests · ${info.history.length} songs played`}
      </p>
      {info && info !== 'gone' && info.nowPlaying && <p className="muted">Last song: {info.nowPlaying.track.name}</p>}
      {info === 'gone' && (
        <p className="muted">The requests are gone, but resuming keeps the code, so guests can rejoin with the same QR code.</p>
      )}
      <div className="row">
        <button onClick={onResume}>Resume party</button>
        <button className="ghost" onClick={onNew}>
          Start new party
        </button>
      </div>
    </section>
  );
}

const DASHBOARD = 'https://developer.spotify.com/dashboard';
const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy">
      <small>{label}</small>
      <div className="row">
        <code className="block">{value}</code>
        <button
          className="ghost icon"
          onClick={() =>
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/**
 * Each host registers their own Spotify developer app (dev mode allows only 5 users per app).
 * The dashboard has no API for that, so this walks the host through it by hand.
 */
function Setup({ onLogin }: { onLogin: () => void }) {
  const [clientId, setId] = useState(getClientId());
  const [showGuide, setShowGuide] = useState(!getClientId());
  const valid = CLIENT_ID_PATTERN.test(clientId.trim());
  const idInput = (
    <label>
      Client ID
      <input
        value={clientId}
        onChange={(e) => {
          setId(e.target.value);
          // Saved as soon as it is valid, so it survives even if the host leaves before connecting.
          if (CLIENT_ID_PATTERN.test(e.target.value.trim())) setClientId(e.target.value);
        }}
        placeholder="32 characters, e.g. 3f2a9c…"
      />
    </label>
  );
  return (
    <main className="card">
      <Title />
      {!isLoopbackIp() && (
        <p className="warn">
          Open this page via <b>http://127.0.0.1:{location.port}</b> instead of “{location.hostname}”. Spotify only
          allows http for 127.0.0.1.
        </p>
      )}
      {showGuide ? (
        <>
          <p>
            BeatVote plays through your own Spotify account. For that you need your own Spotify app, once. It takes about 5
            minutes.
          </p>
          <ol className="steps">
            <li>
              <b>Open Spotify for Developers.</b> Log in with your Spotify account (Premium required) and accept the
              developer terms the first time.
              <a className="button" href={DASHBOARD} target="_blank" rel="noreferrer">
                Open Spotify for Developers ↗
              </a>
            </li>
            <li>
              <b>Create an app.</b> Click “Create app” and enter these values:
              <CopyField label="App name" value="BeatVote" />
              <CopyField label="App description" value="Party DJ for private parties" />
              <CopyField label="Redirect URIs (then click “Add”)" value={redirectUri()} />
              <span>
                Under “Which API/SDKs” tick <b>Web API</b> and <b>Web Playback SDK</b>, accept the terms and save. Leave
                Website empty.
              </span>
              <a className="button ghost" href={`${DASHBOARD}/create`} target="_blank" rel="noreferrer">
                Open “Create app” directly ↗
              </a>
            </li>
            <li>
              <b>Copy the Client ID.</b> Your new app shows it under “Basic Information”. You don't need the Client
              Secret, don't enter it anywhere. Then tap “Connect with Spotify”: you log in to Spotify once more, this
              time inside BeatVote. That's normal and only needed once.
              {idInput}
              {clientId.trim() && !valid && <p className="warn">A Client ID has 32 characters from 0–9 and a–f.</p>}
            </li>
          </ol>
        </>
      ) : (
        <>
          <p>Connect your Spotify Premium account to start the party.</p>
          {idInput}
          <button className="ghost" onClick={() => setShowGuide(true)}>
            Show setup guide
          </button>
        </>
      )}
      <button
        disabled={!valid || !isLoopbackIp()}
        onClick={() => {
          setClientId(clientId);
          void startLogin();
          onLogin();
        }}
      >
        Connect with Spotify
      </button>
    </main>
  );
}

function GuestLink({ code }: { code: string }) {
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState('');
  useEffect(() => {
    api.info().then(({ lanIps }) => {
      const host = lanIps[0] ?? location.hostname;
      const u = `${location.protocol}//${host}:${location.port}/s/${code}`;
      setUrl(u);
      QRCode.toDataURL(u, { margin: 1, width: 220 }).then(setQr);
    });
  }, [code]);
  return (
    <div className="guestlink">
      {qr && <img src={qr} alt="QR code for guests" width={220} height={220} />}
      <div>
        <b>Guest link</b>
        <code className="block">{url}</code>
        <small>Guests need to be on the same Wi-Fi.</small>
      </div>
    </div>
  );
}

function Console({ tokens, onLogout }: { tokens: Tokens; onLogout: () => void }) {
  const [session, setSession] = useState<Party | null>(null);
  // A party saved before the app was closed; the host chooses to resume it or start a new one.
  const [saved, setSaved] = useState<Party | null>(loadParty);
  const [state, setState] = useState<SessionState | null>(null);
  const tokenRef = useRef(tokens);
  const [err, setErr] = useState<string | null>(null);

  const player = usePlayer({
    getToken: () => tokenRef.current.accessToken,
    fetchNext: async () => {
      if (!session) return null;
      return api.next(session.code, session.hostKey);
    },
  });

  // Keep the Spotify token fresh, locally and on the server (for guest searches).
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const push = () =>
      api.sendToken(session.code, session.hostKey, tokenRef.current.accessToken).catch((e) => setErr(e.message));
    // Heartbeat: if the server restarted, this recreates the session under the same code
    // and hands it the token again, so the party continues and the guest QR code stays valid.
    const ensure = async () => {
      try {
        const s = await api.createSession(session);
        if (s.code !== session.code) {
          const next = { code: s.code, hostKey: s.hostKey };
          saveParty(next);
          setSession(next);
          return;
        }
        if (!s.connected) await push();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    };
    const heartbeat = setInterval(ensure, 10_000);
    const schedule = () => {
      const wait = Math.max(5_000, tokenRef.current.expiresAt - Date.now() - 120_000);
      timer = setTimeout(async () => {
        try {
          tokenRef.current = await refresh(tokenRef.current.refreshToken);
          await push();
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
        schedule();
      }, wait);
    };
    void ensure().then(push);
    schedule();
    return () => {
      clearTimeout(timer);
      clearInterval(heartbeat);
    };
  }, [session]);

  useEffect(() => (session ? watchSession(session.code, setState) : undefined), [session]);

  // Guests extrapolate between reports, so only report on start, pause/stop, seeks and every 10 s.
  const reported = useRef({ at: 0, positionMs: 0, paused: true });
  useEffect(() => {
    if (!session || !player.progress) return;
    const { positionMs } = player.progress;
    const paused = player.status !== 'running' || player.progress.paused;
    const last = reported.current;
    const now = Date.now();
    const drift = Math.abs(positionMs - (last.positionMs + (last.paused ? 0 : now - last.at)));
    if (paused === last.paused && drift < 2000 && now - last.at < 10_000) return;
    reported.current = { at: now, positionMs, paused };
    api.progress(session.code, session.hostKey, positionMs, paused).catch(() => undefined);
  }, [player.progress, player.status, session]);

  const canPlay = player.status !== 'loading' && player.status !== 'error';
  const djRunning = player.status === 'running' || player.status === 'waiting';
  // Guests voted the track away: move on, once per play (startedAt identifies it).
  const skippedPlay = useRef<number | null>(null);
  useEffect(() => {
    const np = state?.nowPlaying;
    if (!np?.skipRequested || skippedPlay.current === np.startedAt) return;
    if (player.status !== 'running' && player.status !== 'waiting') return;
    skippedPlay.current = np.startedAt;
    player.skip();
  }, [state?.nowPlaying, player.status, player.skip]);

  // The party volume lives on the server (host and guests change it). In the Android app it drives the device's
  // media volume, so it matches the hardware buttons, and the player itself stays at full volume. Elsewhere the
  // player follows it directly.
  const native = nativeVolume();
  // In the app the device volume counts when the host opens; until the server has it, don't push the old value.
  const [deviceVolumeSent, setDeviceVolumeSent] = useState(!native);
  useEffect(() => {
    if (!state || !deviceVolumeSent) return;
    if (native) {
      native.setVolume(state.volume);
      player.setVolume(1);
    } else {
      player.setVolume(state.volume / 100);
    }
  }, [state?.volume, deviceVolumeSent, player.setVolume]);

  useEffect(() => {
    if (!native || !session) return;
    const report = (volume: number) => api.setVolume(session.code, volume, session.hostKey);
    void report(native.getVolume())
      .catch(() => undefined)
      .finally(() => setDeviceVolumeSent(true));
    const onDeviceChange = (e: Event) => void report((e as CustomEvent<number>).detail).catch(() => undefined);
    window.addEventListener(NATIVE_VOLUME_EVENT, onDeviceChange);
    return () => window.removeEventListener(NATIVE_VOLUME_EVENT, onDeviceChange);
  }, [session]);

  const playWish = (id: string) => {
    if (session) void player.playNow(() => api.playWish(session.code, session.hostKey, id));
  };

  async function create() {
    const { code, hostKey } = await api.createSession();
    saveParty({ code, hostKey });
    setSaved(null);
    setSession({ code, hostKey });
  }

  function resume(party: Party) {
    saveParty(party);
    setSaved(null);
    setSession(party);
  }

  async function endParty() {
    if (!confirm('End the party? Guests can no longer send requests with this QR code.')) return;
    await player.stop();
    saveParty(null);
    setSession(null);
    setState(null);
  }

  return (
    <main className="card wide">
      <header className="row">
        <Title />
        <span className="row">
          {session && (
            // Both labels take up space, so the button keeps its width when Start DJ turns into Stop.
            <button
              className="stack"
              onClick={djRunning ? player.stop : player.start}
              disabled={!djRunning && player.status !== 'ready'}
            >
              <span className={djRunning ? 'hidden' : undefined}>Start DJ</span>
              <span className={djRunning ? undefined : 'hidden'}>Stop</span>
            </button>
          )}
          {session && (
            <button className="ghost" onClick={endParty}>
              End party
            </button>
          )}
          <button
            className="ghost"
            onClick={() => {
              if (confirm('Disconnect Spotify? The music stops and you have to log in again. The party stays saved.')) {
                void player.stop();
                onLogout();
              }
            }}
          >
            Disconnect Spotify
          </button>
        </span>
      </header>
      {!session && saved ? (
        <ResumeParty party={saved} onResume={() => resume(saved)} onNew={create} />
      ) : !session ? (
        <button onClick={create}>Start party</button>
      ) : (
        <div className="party">
          <div className="col">
            <GuestLink code={session.code} />
            <section>
              {state && (
                <>
                  <PinPicker
                    pin={state.pin}
                    nowPlaying={state.nowPlaying}
                    onApply={(pin) =>
                      api
                        .setPin(session.code, session.hostKey, pin.genre, pin.decade)
                        .then(() => {
                          if (djRunning) player.skip();
                        })
                        .catch((e) => setErr(e.message))
                    }
                    onClear={() =>
                      api.setPin(session.code, session.hostKey, null, null).catch((e) => setErr(e.message))
                    }
                  />
                  <VolumeSlider
                    value={state.volume}
                    onChange={(v) => api.setVolume(session.code, v, session.hostKey).catch((e) => setErr(e.message))}
                  />
                  <div className="checks">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={state.guestVolume}
                        onChange={(e) =>
                          api
                            .setGuestVolume(session.code, session.hostKey, e.target.checked)
                            .catch((er) => setErr(er.message))
                        }
                      />
                      Guests can change the volume
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={state.guestSkip}
                        onChange={(e) =>
                          api
                            .setGuestSkip(session.code, session.hostKey, e.target.checked)
                            .catch((er) => setErr(er.message))
                        }
                      />
                      Guests can vote to skip
                    </label>
                  </div>
                </>
              )}
              {(player.error || err) && <p className="warn">{player.error ?? err}</p>}
            </section>
            {state?.nowPlaying && (
              <NowPlaying
                state={state}
                progress={player.progress}
                aside={
                  <>
                    <button className="ghost" onClick={player.skip} disabled={!djRunning}>
                      Skip ⏭
                    </button>
                    <small>{skipStatus(state)}</small>
                    <small>{state.guestsOnline} guests online</small>
                  </>
                }
              />
            )}
            {state?.lastSwitch && (
              <p className="muted">
                Last switch: {phaseLabel(state.lastSwitch.from, state.lastSwitch.fromEra)} →{' '}
                <b>{phaseLabel(state.lastSwitch.to, state.lastSwitch.toEra)}</b>
              </p>
            )}
          </div>
          <div className="col">
            <h2>Add a song</h2>
            <Search code={session.code} onError={(m) => m && setErr(m)}>
              {(t, clear) => (
                <span className="row">
                  <button
                    className="ghost"
                    onClick={() =>
                      api.wish(session.code, 'host', t, session.hostKey).then(clear, (e) => setErr(e.message))
                    }
                  >
                    + Request
                  </button>
                  <button
                    className="icon"
                    title="Play now"
                    disabled={!canPlay}
                    onClick={() => {
                      clear();
                      void player.playNow(() => api.playTrack(session.code, session.hostKey, t));
                    }}
                  >
                    ▶
                  </button>
                </span>
              )}
            </Search>
            <h2>Requests</h2>
            <ul className="list">
              {state?.wishes.map((w) => (
                <li key={w.id}>
                  <span>
                    {w.track.name} <small>{withYear(w.track)}</small>
                  </span>
                  <span className="pill">{w.genre}</span>
                  {state && isPinned(state.pin) && !matchesPin(state.pin, w.genre, w.track.year) && (
                    <span className="pill muted" title="Doesn't match the genre/era you picked">
                      waits
                    </span>
                  )}
                  <span className="pill">{w.voters.length} 👍</span>
                  <button className="ghost icon" onClick={() => playWish(w.id)} disabled={!canPlay} title="Play now">
                    ▶
                  </button>
                </li>
              ))}
              {state?.wishes.length === 0 && <li className="muted">No requests yet</li>}
            </ul>
            {state && <History entries={state.history} scroll />}
          </div>
        </div>
      )}
    </main>
  );
}

export function Host() {
  const [tokens, setTokens] = useState<Tokens | null>(loadTokens());
  const [busy, setBusy] = useState(location.pathname.startsWith('/callback'));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!location.pathname.startsWith('/callback')) return;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    history.replaceState(null, '', '/');
    if (!code) {
      setError(params.get('error') ?? 'Login cancelled');
      setBusy(false);
      return;
    }
    finishLogin(code)
      .then(setTokens)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, []);

  if (busy) return <p className="center">Connecting to Spotify …</p>;
  return (
    <>
      {error && <p className="warn center">{error}</p>}
      {tokens ? (
        <Console
          tokens={tokens}
          onLogout={() => {
            // The party stays saved, so the host can resume it after reconnecting.
            logout();
            setTokens(null);
          }}
        />
      ) : (
        <Setup onLogin={() => setBusy(true)} />
      )}
    </>
  );
}
