import type { SessionState, Track } from '../../shared/src/types';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
  return body as T;
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  info: () => call<{ lanIps: string[] }>('/info'),
  session: (code: string) => call<SessionState>(`/sessions/${code}`),
  /** Creates a session, or resumes `prev` (same code) if the server has lost it. */
  createSession: (prev?: { code: string; hostKey: string }) =>
    post<{ code: string; hostKey: string; connected: boolean }>('/sessions', prev ?? {}),
  sendToken: (code: string, hostKey: string, accessToken: string) =>
    post(`/sessions/${code}/token`, { hostKey, accessToken }),
  search: (code: string, q: string) => call<Track[]>(`/sessions/${code}/search?q=${encodeURIComponent(q)}`),
  /** As the host (with hostKey) there is no limit on open requests. */
  wish: (code: string, guestId: string, track: Track, hostKey?: string) =>
    post(`/sessions/${code}/wishes`, { guestId, track, hostKey }),
  playTrack: (code: string, hostKey: string, track: Track) =>
    post<{ track: Track; genre: string }>(`/sessions/${code}/play-track`, { hostKey, track }),
  vote: (code: string, guestId: string, id: string) => post(`/sessions/${code}/wishes/${id}/vote`, { guestId }),
  voteSkip: (code: string, guestId: string) => post(`/sessions/${code}/skip`, { guestId }),
  /** Pass the host key as the host; guests omit it and are refused while the volume is locked. */
  setVolume: (code: string, volume: number, hostKey?: string) => post(`/sessions/${code}/volume`, { volume, hostKey }),
  /** Fix a genre and/or decade for the DJ (null = Auto / Any era). */
  setPin: (code: string, hostKey: string, genre: string | null, decade: number | null) =>
    post(`/sessions/${code}/pin`, { hostKey, genre, decade }),
  setGuestSkip: (code: string, hostKey: string, allowed: boolean) =>
    post(`/sessions/${code}/guest-skip`, { hostKey, allowed }),
  setGuestVolume: (code: string, hostKey: string, allowed: boolean) =>
    post(`/sessions/${code}/guest-volume`, { hostKey, allowed }),
  next: (code: string, hostKey: string) =>
    post<{ track: Track; genre: string } | null>(`/sessions/${code}/next`, { hostKey }),
  progress: (code: string, hostKey: string, positionMs: number, paused: boolean) =>
    post(`/sessions/${code}/progress`, { hostKey, positionMs, paused }),
  playWish: (code: string, hostKey: string, id: string) =>
    post<{ track: Track; genre: string }>(`/sessions/${code}/wishes/${id}/play`, { hostKey }),
};

/** Live session state over WebSocket with auto-reconnect. Guests pass their ID to count as online. */
export function watchSession(code: string, onState: (s: SessionState) => void, guestId?: string): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  const query = guestId ? `?guest=${encodeURIComponent(guestId)}` : '';
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/sessions/${code}/ws${query}`);
    ws.onmessage = (e) => onState(JSON.parse(e.data));
    ws.onclose = () => {
      if (!closed) setTimeout(connect, 2000);
    };
  };
  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}
