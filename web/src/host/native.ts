/** Media volume bridge of the Android app (MainActivity.VolumeBridge); missing in a normal browser. */
interface BeatVoteNative {
  /** Device media volume, 0–100. */
  getVolume(): number;
  setVolume(percent: number): void;
  /** Android TV; missing in app versions before 0.1.4. */
  isTv?(): boolean;
}

declare global {
  interface Window {
    BeatVoteNative?: BeatVoteNative;
  }
}

export const nativeVolume = (): BeatVoteNative | undefined => window.BeatVoteNative;

export const isTv = (): boolean => window.BeatVoteNative?.isTv?.() ?? false;

/** Fired by the app when the device volume changes (hardware buttons, other apps); detail is 0–100. */
export const NATIVE_VOLUME_EVENT = 'beatvote-volume';
