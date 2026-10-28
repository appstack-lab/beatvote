import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../../../shared/src/types';

const FADE_OUT_MS = 4000;
const FADE_IN_MS = 3000;
const RETRY_MS = 5000;
/**
 * Playback problems in a row (no track from the DJ, Spotify refused to play, a track stopped right away) before the
 * DJ stops instead of trying again: every retry asks Spotify again, and too many requests get BeatVote blocked.
 */
const MAX_PROBLEMS = 3;
/** A track counts as played after this long; some devices play a few seconds before Spotify's copy protection fails. */
const PLAYED_MS = 10_000;
/** Spotify Connect: how often to ask the device for its position, and more often shortly before a track ends. */
const CONNECT_POLL_MS = 2000;
const CONNECT_POLL_NEAR_END_MS = 500;
/** Spotify Connect has no "ended" event; the next track starts this close to the end, before autoplay can kick in. */
const CONNECT_END_MS = 1500;

export type PlayerStatus = 'loading' | 'ready' | 'running' | 'waiting' | 'error';

type FetchTrack = () => Promise<{ track: Track; genre: string } | null>;

/** A Spotify Connect device (the Spotify app on a TV, a speaker, a computer …). */
export interface ConnectDevice {
  id: string;
  name: string;
  type: string;
}

interface Options {
  getToken: () => string;
  /** Asks the server's DJ for the next track. */
  fetchNext: FetchTrack;
  /** Spotify Connect device to play on; null plays in this page (Web Playback SDK). */
  output: string | null;
  /** The party's current track, so a Connect device still playing it can be taken over. */
  currentUri: () => string | undefined;
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
 * Plays the DJ's tracks, either in this page (Web Playback SDK) or on a Spotify Connect device through the Web API.
 * SDK streams cannot be mixed, so a "transition" there is a fade-out of the last seconds followed by a fade-in of the
 * next track. Connect devices just play one track after the other.
 */
export function usePlayer({ getToken, fetchNext, output, currentUri }: Options) {
  const [status, setStatus] = useState<PlayerStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ positionMs: number; durationMs: number; paused: boolean } | null>(null);
  const playerRef = useRef<Spotify.Player | null>(null);
  const deviceRef = useRef('');
  const runningRef = useRef(false);
  const advancingRef = useRef(false);
  const startedAtRef = useRef(0);
  const playedRef = useRef(false);
  const failedRef = useRef(0);
  const uriRef = useRef('');
  const nextPollRef = useRef(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A track the DJ handed out that couldn't be started; retries play it instead of asking the DJ for another one.
  const pendingRef = useRef<{ track: Track; genre: string } | null>(null);
  const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Party volume (0–1, set by host or guests) times the current fade factor gives the player volume.
  const volumeRef = useRef(0.8);
  const fadeRef = useRef(1);
  const fetchNextRef = useRef(fetchNext);
  fetchNextRef.current = fetchNext;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const outputRef = useRef(output);
  outputRef.current = output;
  const currentUriRef = useRef(currentUri);
  currentUriRef.current = currentUri;

  const spotify = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(`https://api.spotify.com/v1${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${getTokenRef.current()}`, 'Content-Type': 'application/json' },
      }),
    [],
  );

  // The web player is only loaded while it plays here: on a weak device (e.g. a TV box) playing through a Spotify
  // Connect app, it would only take memory, and Android may then close the Spotify app.
  const playsHere = !output;
  useEffect(() => {
    if (!playsHere) return;
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
        setStatus((s) => (s === 'loading' ? 'ready' : s));
      });
      player.addListener('not_ready', () => setStatus((s) => (s === 'ready' ? 'loading' : s)));
      for (const ev of ['initialization_error', 'authentication_error', 'account_error', 'playback_error'] as const) {
        player.addListener(ev, ({ message }) => {
          if (outputRef.current) return; // not playing in this page
          setError(ev === 'account_error' ? 'Playback requires Spotify Premium.' : message);
          if (ev !== 'playback_error') setStatus('error');
        });
      }
      player.connect();
      playerRef.current = player;
    });
    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceRef.current = '';
      setStatus((s) => (s === 'ready' || s === 'error' ? 'loading' : s));
    };
  }, [playsHere]);

  /** Counts a playback problem; returns true when that was one too many and the DJ stopped. */
  const problem = (message: string): boolean => {
    const text = message.replace(/\.?$/, '.');
    if (++failedRef.current < MAX_PROBLEMS) {
      setError(text);
      return false;
    }
    runningRef.current = false;
    failedRef.current = 0;
    pendingRef.current = null;
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = null;
    setStatus('ready');
    setError(
      `${text} The DJ stopped after ${MAX_PROBLEMS} problems in a row, so Spotify doesn't block BeatVote for too ` +
        'many requests. Press Start to try again.',
    );
    return true;
  };

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
      if (fetchTrack) pendingRef.current = null;
      const next = pendingRef.current ?? (await (fetchTrack ?? fetchNextRef.current)());
      pendingRef.current = null;
      if (!runningRef.current) return;
      if (!next) {
        setStatus('waiting');
        retryLater();
        return;
      }
      const connect = outputRef.current;
      if (!connect) await playerRef.current?.setVolume(0);
      const res = await spotify(`/me/player/play?device_id=${connect ?? deviceRef.current}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [next.track.uri] }),
      });
      if (!res.ok && res.status !== 204) {
        pendingRef.current = next;
        throw new Error(
          connect && res.status === 404
            ? 'The Spotify Connect device is not reachable. Open the Spotify app on it; BeatVote keeps trying.'
            : `Playback failed (${res.status})`,
        );
      }
      uriRef.current = next.track.uri;
      startedAtRef.current = Date.now();
      nextPollRef.current = Date.now() + CONNECT_POLL_MS;
      playedRef.current = false;
      setStatus('running');
      setError(null);
    } catch (e) {
      // Retrying counts as running, so Stop stays available.
      if (runningRef.current && !problem(e instanceof Error ? e.message : String(e))) {
        setStatus('waiting');
        retryLater();
      }
    } finally {
      advancingRef.current = false;
    }
  }, []);

  /** Position on the active output; null if nothing is known (yet), or a Connect poll isn't due. */
  const readState = useCallback(async () => {
    if (!outputRef.current) {
      const state = await playerRef.current?.getCurrentState();
      if (!state) return null;
      return { uri: uriRef.current, position: state.position, duration: state.duration, paused: state.paused };
    }
    if (Date.now() < nextPollRef.current) return null;
    nextPollRef.current = Date.now() + CONNECT_POLL_MS;
    const res = await spotify('/me/player');
    if (res.status !== 200) return null;
    const data = (await res.json()) as {
      is_playing: boolean;
      progress_ms: number | null;
      item: { uri: string; duration_ms: number } | null;
    };
    if (!data.item) return null;
    const position = data.progress_ms ?? 0;
    if (data.item.duration_ms - position < 5000) nextPollRef.current = Date.now() + CONNECT_POLL_NEAR_END_MS;
    return { uri: data.item.uri, position, duration: data.item.duration_ms, paused: !data.is_playing };
  }, []);

  // Fade + end-of-track watcher.
  useEffect(() => {
    const timer = setInterval(async () => {
      // While a retry is pending the player sits paused at 0, which would look like "ended".
      if (!runningRef.current || advancingRef.current || retryRef.current) return;
      const connect = outputRef.current;
      const state = await readState().catch(() => null);
      if (!runningRef.current || advancingRef.current) return;
      const sinceStart = Date.now() - startedAtRef.current;
      // Some devices never report a state for a track they can't play.
      if (!state) {
        if (!connect && !playedRef.current && sinceStart > PLAYED_MS) failedOrNext();
        return;
      }
      // Something else plays on the Connect device (Spotify's autoplay, or someone used the app): the DJ takes over.
      if (connect && state.uri !== uriRef.current) {
        if (sinceStart > 5000) void playNext();
        return;
      }
      setProgress({ positionMs: state.position, durationMs: state.duration, paused: state.paused });
      const remaining = state.duration - state.position;
      if (!connect) {
        const factor = Math.min(1, sinceStart / FADE_IN_MS) * Math.min(1, remaining / FADE_OUT_MS);
        fadeRef.current = Math.max(0, factor);
        await playerRef.current?.setVolume(volumeRef.current * fadeRef.current);
      }
      if (state.position >= PLAYED_MS && !state.paused) {
        playedRef.current = true;
        failedRef.current = 0;
      }
      const ended =
        remaining < (connect ? CONNECT_END_MS : 700) ||
        (state.paused && state.position === 0 && sinceStart > (connect ? 6000 : 3000));
      if (ended) failedOrNext();
    }, 400);
    // Ended before it really played: Spotify couldn't play it (e.g. its copy protection fails on this device).
    const failedOrNext = () => {
      const notPlayed = outputRef.current
        ? "The Spotify Connect device didn't play the track."
        : "Spotify couldn't play the track on this device. Some devices, e.g. Android TV boxes, aren't supported " +
          'by Spotify’s web player: choose the Spotify app under “Play on” instead.';
      if (!playedRef.current && problem(notPlayed)) return;
      void playNext();
    };
    return () => clearInterval(timer);
  }, [playNext, readState]);

  /**
   * Takes over the Connect device if it is still playing the party's current track (e.g. BeatVote restarted in the
   * middle of a song), instead of starting a new one. Returns whether it did.
   */
  const adopt = useCallback(async () => {
    const connect = outputRef.current;
    const uri = currentUriRef.current();
    if (!connect || !uri || runningRef.current) return false;
    const res = await spotify('/me/player').catch(() => null);
    if (res?.status !== 200) return false;
    const data = (await res.json()) as {
      is_playing: boolean;
      progress_ms: number | null;
      device: { id: string | null } | null;
      item: { uri: string } | null;
    };
    if (!data.is_playing || data.device?.id !== connect || data.item?.uri !== uri || runningRef.current) return false;
    const position = data.progress_ms ?? 0;
    uriRef.current = uri;
    startedAtRef.current = Date.now() - position;
    playedRef.current = position >= PLAYED_MS;
    failedRef.current = 0;
    nextPollRef.current = 0;
    runningRef.current = true;
    setStatus('running');
    setError(null);
    return true;
  }, []);

  const start = useCallback(async () => {
    if (await adopt()) return;
    if (!outputRef.current) await playerRef.current?.activateElement(); // needed for browser autoplay rules
    runningRef.current = true;
    failedRef.current = 0;
    void playNext();
  }, [playNext, adopt]);

  const skip = useCallback(() => void playNext(), [playNext]);

  const setVolume = useCallback((volume: number) => {
    volumeRef.current = volume;
    const connect = outputRef.current;
    if (!connect) {
      if (runningRef.current) void playerRef.current?.setVolume(volume * fadeRef.current);
      return;
    }
    // Connect devices take whole percent and are rate-limited: only the value the slider settles on is sent.
    clearTimeout(volumeTimerRef.current);
    volumeTimerRef.current = setTimeout(() => {
      void spotify(`/me/player/volume?volume_percent=${Math.round(volume * 100)}&device_id=${connect}`, {
        method: 'PUT',
      }).catch(() => undefined);
    }, 300);
  }, []);

  /** Plays the given track right away, starting the DJ if it is not running yet. */
  const playNow = useCallback(
    async (fetchTrack: FetchTrack) => {
      if (!runningRef.current) {
        if (!outputRef.current) await playerRef.current?.activateElement();
        runningRef.current = true;
      }
      void playNext(fetchTrack);
    },
    [playNext],
  );

  const stop = useCallback(async () => {
    runningRef.current = false;
    pendingRef.current = null;
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = null;
    const connect = outputRef.current;
    if (connect) await spotify(`/me/player/pause?device_id=${connect}`, { method: 'PUT' }).catch(() => undefined);
    else await playerRef.current?.pause();
    setStatus('ready');
  }, []);

  /**
   * Spotify Connect devices of the account, without web players named BeatVote: this page's own one, or a stale one
   * from before a restart (its id changes).
   */
  const devices = useCallback(async (): Promise<ConnectDevice[]> => {
    const res = await spotify('/me/player/devices');
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`Spotify ${res.status} while listing devices`);
    const data = (await res.json()) as { devices: { id: string | null; name: string; type: string }[] };
    return data.devices
      .filter((d): d is ConnectDevice => !!d.id && d.id !== deviceRef.current && d.name !== 'BeatVote')
      .map(({ id, name, type }) => ({ id, name, type }));
  }, []);

  // A Connect device doesn't need this page's player, so the DJ can start where the SDK is still loading or fails.
  const effective: PlayerStatus = output && (status === 'loading' || status === 'error') ? 'ready' : status;
  return { status: effective, error, progress, start, stop, skip, playNow, setVolume, devices, adopt };
}
