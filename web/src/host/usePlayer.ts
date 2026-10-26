import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../../../shared/src/types';

const FADE_OUT_MS = 4000;
const FADE_IN_MS = 3000;
const RETRY_MS = 5000;

export type PlayerStatus = 'loading' | 'ready' | 'running' | 'waiting' | 'error';

type FetchTrack = () => Promise<{ track: Track; genre: string } | null>;

interface Options {
  getToken: () => string;
  /** Asks the server's DJ for the next track. */
  fetchNext: FetchTrack;
}

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  return new Promise((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    document.body.appendChild(s);
  });
}

/**
 * Web Playback SDK wrapper. Spotify streams cannot be mixed, so a "transition" is
 * a fade-out of the last seconds followed by a fade-in of the next track.
 */
export function usePlayer({ getToken, fetchNext }: Options) {
  const [status, setStatus] = useState<PlayerStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ positionMs: number; durationMs: number; paused: boolean } | null>(null);
  const playerRef = useRef<Spotify.Player | null>(null);
  const deviceRef = useRef('');
  const runningRef = useRef(false);
  const advancingRef = useRef(false);
  const startedAtRef = useRef(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Party volume (0–1, set by host or guests) times the current fade factor gives the player volume.
  const volumeRef = useRef(0.8);
  const fadeRef = useRef(1);
  const fetchNextRef = useRef(fetchNext);
  fetchNextRef.current = fetchNext;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    let cancelled = false;
    loadSdk().then(() => {
      if (cancelled) return;
      const player = new Spotify.Player({
        name: 'BeatVote',
        getOAuthToken: (cb) => cb(getTokenRef.current()),
        volume: volumeRef.current,
      });
      player.addListener('ready', ({ device_id }) => {
        deviceRef.current = device_id;
        setStatus('ready');
      });
      player.addListener('not_ready', () => setStatus('loading'));
      for (const ev of ['initialization_error', 'authentication_error', 'account_error', 'playback_error'] as const) {
        player.addListener(ev, ({ message }) => {
          setError(
            ev === 'account_error' ? 'Playback requires Spotify Premium.' : message,
          );
          if (ev !== 'playback_error') setStatus('error');
        });
      }
      player.connect();
      playerRef.current = player;
    });
    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
    };
  }, []);

  // `fetchTrack` overrides the DJ's choice, e.g. when the host picks a wish by hand.
  const playNext = useCallback(async (fetchTrack?: FetchTrack) => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = null;
    const retryLater = () => {
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        if (runningRef.current) void playNext();
      }, RETRY_MS);
    };
    try {
      const next = await (fetchTrack ?? fetchNextRef.current)();
      if (!runningRef.current) return;
      if (!next) {
        setStatus('waiting');
        retryLater();
        return;
      }
      await playerRef.current?.setVolume(0);
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceRef.current}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${getTokenRef.current()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [next.track.uri] }),
      });
      if (!res.ok && res.status !== 204) throw new Error(`Playback failed (${res.status})`);
      startedAtRef.current = Date.now();
      setStatus('running');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (runningRef.current) retryLater();
    } finally {
      advancingRef.current = false;
    }
  }, []);

  // Fade + end-of-track watcher.
  useEffect(() => {
    const timer = setInterval(async () => {
      const player = playerRef.current;
      // While a retry is pending the player sits paused at 0, which would look like "ended".
      if (!runningRef.current || advancingRef.current || retryRef.current || !player) return;
      const state = await player.getCurrentState();
      if (!state) return;
      setProgress({ positionMs: state.position, durationMs: state.duration, paused: state.paused });
      const remaining = state.duration - state.position;
      const sinceStart = Date.now() - startedAtRef.current;
      const factor = Math.min(1, sinceStart / FADE_IN_MS) * Math.min(1, remaining / FADE_OUT_MS);
      fadeRef.current = Math.max(0, factor);
      await player.setVolume(volumeRef.current * fadeRef.current);
      const ended = remaining < 700 || (state.paused && state.position === 0 && sinceStart > 3000);
      if (ended) void playNext();
    }, 400);
    return () => clearInterval(timer);
  }, [playNext]);

  const start = useCallback(async () => {
    await playerRef.current?.activateElement(); // needed for browser autoplay rules
    runningRef.current = true;
    void playNext();
  }, [playNext]);

  const skip = useCallback(() => void playNext(), [playNext]);

  const setVolume = useCallback((volume: number) => {
    volumeRef.current = volume;
    if (runningRef.current) void playerRef.current?.setVolume(volume * fadeRef.current);
  }, []);

  /** Plays the given track right away, starting the DJ if it is not running yet. */
  const playNow = useCallback(
    async (fetchTrack: FetchTrack) => {
      if (!runningRef.current) {
        await playerRef.current?.activateElement();
        runningRef.current = true;
      }
      void playNext(fetchTrack);
    },
    [playNext],
  );

  const stop = useCallback(async () => {
    runningRef.current = false;
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = null;
    await playerRef.current?.pause();
    setStatus('ready');
  }, []);

  return { status, error, progress, start, stop, skip, playNow, setVolume };
}
