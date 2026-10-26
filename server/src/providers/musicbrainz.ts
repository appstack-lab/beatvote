// Fallback genre source: Spotify returns empty `genres` for many artists in dev-mode apps.
// MusicBrainz needs no API key but allows only ~1 request per second, so calls are queued.
const API = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'BeatVote/0.1 (private party app)';
const MIN_GAP_MS = 1100;
const MAX_TAGS = 10;

let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

interface MbArtist {
  name: string;
  score: number;
  tags?: { name: string; count: number }[];
}

async function searchArtist(name: string): Promise<MbArtist[]> {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
  const res = await fetch(`${API}/artist?query=${q}&limit=5&fmt=json`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
  return ((await res.json()) as { artists?: MbArtist[] }).artists ?? [];
}

/**
 * Community tags of the best-matching artist, most used first. Empty if nothing reliable is found or
 * MusicBrainz is unreachable; the session retries unknown genres later (see Session.retryGenre).
 */
export async function musicBrainzTags(artistName: string): Promise<string[]> {
  let artists: MbArtist[] = [];
  // Retries cover MusicBrainz' rate limiter (503) and the occasional slow connect.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      artists = await throttled(() => searchArtist(artistName));
      break;
    } catch (e) {
      console.warn(`MusicBrainz lookup for "${artistName}" failed (attempt ${attempt}): ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  const wanted = artistName.toLowerCase();
  const match = artists.find((a) => a.name.toLowerCase() === wanted && a.tags?.length) ?? artists.find((a) => a.score >= 95 && a.tags?.length);
  return (match?.tags ?? [])
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TAGS)
    .map((t) => t.name);
}
