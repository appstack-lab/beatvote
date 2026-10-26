import type { Track } from '../../../../shared/src/types';
import { musicBrainzTags } from '../musicbrainz';
import type { MusicProvider } from '../types';

const API = 'https://api.spotify.com/v1';

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) throw new Error('Spotify rate limit reached, try again shortly');
  if (res.status === 401) throw new Error('Spotify token expired');
  if (!res.ok) throw new Error(`Spotify ${res.status} on ${path}`);
  return (await res.json()) as T;
}

interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { id: string; name: string }[];
  album: { images: { url: string }[]; release_date?: string };
}

function toTrack(t: SpotifyTrack): Track {
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(', '),
    artistId: t.artists[0]?.id ?? '',
    durationMs: t.duration_ms,
    image: t.album.images.at(-1)?.url,
    // release_date is "1980", "1980-07" or "1980-07-25" depending on its precision.
    year: Number(t.album.release_date?.slice(0, 4)) || undefined,
  };
}

async function searchTracks(token: string, q: string, offset = 0): Promise<Track[]> {
  // Dev-mode apps are capped at 10 results per request.
  const data = await get<{ tracks: { items: SpotifyTrack[] } }>(
    token,
    `/search?type=track&limit=10&offset=${offset}&q=${encodeURIComponent(q)}`,
  );
  return data.tracks.items.filter(Boolean).map(toTrack);
}

export const spotify: MusicProvider = {
  search: (token, query) => searchTracks(token, query),

  async artistGenres(token, artistId) {
    if (!artistId) return [];
    const data = await get<{ name: string; genres?: string[] }>(token, `/artists/${artistId}`);
    if (data.genres?.length) return data.genres;
    return musicBrainzTags(data.name);
  },

  searchByGenre(token, genre, years, offset = 0) {
    const filters = [genre && `genre:"${genre}"`, years && `year:${years.from}-${years.to}`].filter(Boolean);
    return searchTracks(token, filters.join(' '), offset);
  },
};
