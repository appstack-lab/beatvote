/** A DJ phase keeps to songs released within this many years of the song that started it. */
export const ERA_WINDOW_YEARS = 10;

/** "rock · 1990–2010", or just the genre while the phase has no reference year. */
export function phaseLabel(genre: string | null, era: number | null | undefined): string {
  if (!genre) return '–';
  return era == null ? genre : `${genre} · ${era - ERA_WINDOW_YEARS}–${era + ERA_WINDOW_YEARS}`;
}

/** Genre and/or decade the host has fixed; null fields mean "Any genre" / "Any era". */
export interface Pin {
  genre: string | null;
  /** First year of the decade, e.g. 1990 for the 1990s. */
  decade: number | null;
}

export const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

export const isPinned = (pin: Pin) => pin.genre !== null || pin.decade !== null;

/** Songs without a year count as matching a decade; without a known genre they never match a fixed genre. */
export function matchesPin(pin: Pin, genre: string, year: number | undefined): boolean {
  if (pin.genre !== null && genre !== pin.genre) return false;
  return pin.decade === null || year === undefined || (year >= pin.decade && year <= pin.decade + 9);
}

/** "metal · 1990s", "any genre · 1990s" or "metal". */
export function pinLabel(pin: Pin): string {
  const genre = pin.genre ?? 'any genre';
  return pin.decade === null ? genre : `${genre} · ${pin.decade}s`;
}

/** What the host and guests see as the current phase: the host's pick if there is one. */
export function currentPhaseLabel(pin: Pin, genre: string | null, era: number | null | undefined): string {
  return isPinned(pin) ? `📌 ${pinLabel(pin)}` : phaseLabel(genre, era);
}
