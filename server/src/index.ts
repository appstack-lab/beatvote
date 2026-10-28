import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { createSocket } from 'node:dgram';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import type { Track } from '../../shared/src/types';
import { spotify } from './providers/spotify/client';
import { createSession, getSession, HttpError, restoreSessions } from './session';

const restored = restoreSessions(spotify);
if (restored) console.log(`restored ${restored} session(s) from disk`);

const app = Fastify({ logger: { level: 'warn' } });
await app.register(websocket);

app.setErrorHandler((err: Error, _req, reply) => {
  const status = err instanceof HttpError ? err.status : 502;
  reply.status(status).send({ error: err.message });
});

function hostSession(code: string, hostKey: unknown) {
  const s = getSession(code);
  if (hostKey !== s.hostKey) throw new HttpError(403, 'Host access only');
  return s;
}

function interfaceIps() {
  try {
    return Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i!.address);
  } catch {
    return []; // Android doesn't let apps list network interfaces.
  }
}

// Fallback for Android: the local address of a connected UDP socket is the LAN IP. Nothing is sent.
function routedIp() {
  return new Promise<string[]>((resolve) => {
    const s = createSocket('udp4');
    s.on('error', () => {
      s.close();
      resolve([]);
    });
    s.connect(53, '8.8.8.8', () => {
      resolve([s.address().address]);
      s.close();
    });
  });
}

app.get('/api/info', async () => {
  const ips = interfaceIps();
  return {
    lanIps: (ips.length ? ips : await routedIp())
      // Docker/VPN bridges come as 172.x; home Wi-Fi is usually 192.168.x, so list that first.
      .sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.'))),
  };
});

app.post<{ Body: { code?: string; hostKey?: string } | undefined }>('/api/sessions', async (req) => {
  const s = createSession(spotify, req.body ?? undefined);
  return { code: s.code, hostKey: s.hostKey, connected: s.token !== null };
});

app.get<{ Params: { code: string } }>('/api/sessions/:code', async (req) => getSession(req.params.code).state());

app.get<{ Params: { code: string } }>('/api/sessions/:code/ws', { websocket: true }, (socket, req) => {
  const session = getSession((req.params as { code: string }).code);
  const send = () => socket.send(JSON.stringify(session.state()));
  const off = session.onChange(send);
  // Guest pages identify themselves so they count as online for skip votes; the host page does not.
  const guest = (req.query as { guest?: string }).guest;
  const offline = guest && /^[\w-]{8,64}$/.test(guest) ? session.guestConnected(guest) : undefined;
  // Wish scores decay over time, so refresh periodically too.
  const timer = setInterval(send, 15_000);
  socket.on('close', () => {
    off();
    offline?.();
    clearInterval(timer);
  });
  send();
});

app.post<{ Params: { code: string }; Body: { hostKey: string; accessToken: string } }>(
  '/api/sessions/:code/token',
  async (req) => {
    hostSession(req.params.code, req.body.hostKey).token = req.body.accessToken;
    return { ok: true };
  },
);

app.get<{ Params: { code: string }; Querystring: { q?: string } }>('/api/sessions/:code/search', async (req) => {
  const q = req.query.q?.trim();
  if (!q) return [];
  return getSession(req.params.code).search(q);
});

// With the host key the request comes from the host: no per-guest limit.
app.post<{ Params: { code: string }; Body: { guestId: string; track: Track; hostKey?: string } }>(
  '/api/sessions/:code/wishes',
  async (req) => {
    const s = getSession(req.params.code);
    const byHost = req.body.hostKey === s.hostKey;
    await s.addWish(byHost ? 'host' : req.body.guestId, req.body.track, byHost);
    return { ok: true };
  },
);

app.post<{ Params: { code: string }; Body: { hostKey: string; track: Track } }>(
  '/api/sessions/:code/play-track',
  async (req) => hostSession(req.params.code, req.body.hostKey).playTrack(req.body.track),
);

app.post<{ Params: { code: string; id: string }; Body: { guestId: string } }>(
  '/api/sessions/:code/wishes/:id/vote',
  async (req) => {
    getSession(req.params.code).vote(req.body.guestId, req.params.id);
    return { ok: true };
  },
);

// Host (with hostKey) and guests share one volume; guests only while the host allows it.
app.post<{ Params: { code: string }; Body: { hostKey?: string; volume: number } }>(
  '/api/sessions/:code/volume',
  async (req) => {
    const s = getSession(req.params.code);
    s.setVolume(Number(req.body.volume), req.body.hostKey === s.hostKey);
    return { ok: true };
  },
);

app.post<{ Params: { code: string }; Body: { hostKey: string; genre: string | null; decade: number | null } }>(
  '/api/sessions/:code/pin',
  async (req) => {
    hostSession(req.params.code, req.body.hostKey).setPin(req.body.genre ?? null, req.body.decade ?? null);
    return { ok: true };
  },
);

app.post<{ Params: { code: string }; Body: { hostKey: string; allowed: boolean } }>(
  '/api/sessions/:code/guest-skip',
  async (req) => {
    hostSession(req.params.code, req.body.hostKey).setGuestSkip(req.body.allowed === true);
    return { ok: true };
  },
);

app.post<{ Params: { code: string }; Body: { hostKey: string; allowed: boolean } }>(
  '/api/sessions/:code/guest-volume',
  async (req) => {
    hostSession(req.params.code, req.body.hostKey).setGuestVolume(req.body.allowed === true);
    return { ok: true };
  },
);

app.post<{ Params: { code: string }; Body: { guestId: string } }>('/api/sessions/:code/skip', async (req) => {
  getSession(req.params.code).voteSkip(req.body.guestId);
  return { ok: true };
});

app.post<{ Params: { code: string }; Body: { hostKey: string } }>('/api/sessions/:code/next', async (req) => {
  return hostSession(req.params.code, req.body.hostKey).next();
});

app.post<{ Params: { code: string }; Body: { hostKey: string; positionMs: number; paused: boolean } }>(
  '/api/sessions/:code/progress',
  async (req) => {
    const positionMs = Number(req.body.positionMs);
    if (!Number.isFinite(positionMs) || positionMs < 0) throw new HttpError(400, 'Invalid position');
    hostSession(req.params.code, req.body.hostKey).reportProgress(positionMs, req.body.paused === true);
    return { ok: true };
  },
);

app.post<{ Params: { code: string; id: string }; Body: { hostKey: string; direction: 'up' | 'down' } }>(
  '/api/sessions/:code/wishes/:id/move',
  async (req) => {
    const { direction } = req.body;
    if (direction !== 'up' && direction !== 'down') throw new HttpError(400, 'Direction must be up or down');
    hostSession(req.params.code, req.body.hostKey).moveWish(req.params.id, direction);
    return { ok: true };
  },
);

app.post<{ Params: { code: string }; Body: { hostKey: string } }>('/api/sessions/:code/order-by-votes', async (req) => {
  hostSession(req.params.code, req.body.hostKey).orderByVotes();
  return { ok: true };
});

app.post<{ Params: { code: string; id: string }; Body: { hostKey: string } }>(
  '/api/sessions/:code/wishes/:id/play',
  async (req) => hostSession(req.params.code, req.body.hostKey).playWish(req.params.id),
);

// The Android app has no separate web server: the built UI comes from this port too, so guests need one address.
const webDir = process.env.DJ_WEB_DIR && resolve(process.env.DJ_WEB_DIR);
if (webDir) {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
  };
  const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false);
  app.get('/*', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (path.startsWith('/api/')) throw new HttpError(404, 'Not found');
    let file: string;
    try {
      file = resolve(webDir, '.' + decodeURIComponent(path));
    } catch {
      throw new HttpError(400, 'Bad path');
    }
    // Unknown paths are client-side routes (/host, /callback, /s/:code) of the single-page app.
    if (!file.startsWith(webDir + sep) || !(await isFile(file))) file = join(webDir, 'index.html');
    return reply.type(types[extname(file)] ?? 'application/octet-stream').send(createReadStream(file));
  });
}

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`BeatVote server on :${port}`);
