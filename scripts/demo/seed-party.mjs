// Writes a demo party (fictional requests and history, no personal data) for README screenshots.
// Usage: node scripts/demo/seed-party.mjs /tmp/demo-sessions.json
//        PORT=4173 DJ_WEB_DIR=web/dist DJ_DATA_FILE=/tmp/demo-sessions.json npx tsx server/src/index.ts
// Host page: localStorage dj.party = {"code":"8F3A21","hostKey":"5eed…5eed"} plus demo dj.tokens; see QWEN.md.
import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const now = Date.now();
const min = 60_000;
const palette = [['#8b5cf6', '#ec4899'], ['#0ea5e9', '#22c55e'], ['#f97316', '#ef4444'], ['#14b8a6', '#6366f1'], ['#eab308', '#f97316'], ['#64748b', '#0f172a']];
let n = 0;
const cover = () => {
  const [a, b] = palette[n++ % palette.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" rx="6" fill="url(#g)"/><circle cx="32" cy="32" r="13" fill="none" stroke="white" stroke-opacity=".7" stroke-width="3"/><circle cx="32" cy="32" r="3" fill="white" fill-opacity=".8"/></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
};
const track = (id, name, artists, year, sec) => ({ id, uri: `spotify:track:${id}`, name, artists, artistId: `a-${id}`, durationMs: sec * 1000, year, image: cover() });
const wish = (t, genre, votes, agoMin) => ({ id: `w-${t.id}`, track: t, genre, voters: Array.from({ length: votes }, (_, i) => `demo-guest-${i + 1}`), addedAt: now - agoMin * min });

const current = track('brightside', 'Mr. Brightside', 'The Killers', 2004, 222);
const history = [
  { track: track('song2', 'Song 2', 'Blur', 1997, 122), genre: 'rock', playedAt: now - 24 * min, auto: true },
  { track: track('chopsuey', 'Chop Suey!', 'System Of A Down', 2001, 210), genre: 'metal', playedAt: now - 21 * min, auto: false, skipped: true },
  { track: track('intheend', 'In the End', 'Linkin Park', 2000, 216), genre: 'metal', playedAt: now - 19 * min, auto: false },
  { track: track('feelgood', 'Feel Good Inc.', 'Gorillaz', 2005, 222), genre: 'rock', playedAt: now - 15 * min, auto: false },
  { track: track('usesomebody', 'Use Somebody', 'Kings of Leon', 2008, 231), genre: 'rock', playedAt: now - 11 * min, auto: true },
  { track: track('takemeout', 'Take Me Out', 'Franz Ferdinand', 2004, 237), genre: 'rock', playedAt: now - 7 * min, auto: false },
  { track: current, genre: 'rock', playedAt: now - 72_000, auto: false },
];
const session = {
  code: '8F3A21',
  hostKey: '5eed5eed5eed5eed5eed5eed5eed5eed',
  wishes: [
    wish(track('sevennation', 'Seven Nation Army', 'The White Stripes', 2003, 232), 'rock', 4, 6),
    wish(track('lastnite', 'Last Nite', 'The Strokes', 2001, 193), 'rock', 3, 5),
    wish(track('heyya', 'Hey Ya!', 'OutKast', 2003, 235), 'hip hop', 2, 4),
    wish(track('toxic', 'Toxic', 'Britney Spears', 2003, 198), 'pop', 1, 3),
    wish(track('backinblack', 'Back In Black', 'AC/DC', 1980, 255), 'rock', 1, 2),
  ],
  currentGenre: 'rock',
  currentEra: 2004,
  songsInGenre: 3,
  nowPlaying: { track: current, genre: 'rock', startedAt: now - 72_000, auto: false, skipVoters: ['demo-guest-1'], progress: { positionMs: 72_000, paused: false, at: now } },
  history,
  lastSwitch: { from: 'metal', to: 'rock', at: now - 15 * min, fromEra: 2000, toEra: 2005 },
  updatedAt: now,
  volume: 65,
  guestVolume: true,
  pinnedGenre: null,
  pinnedDecade: null,
};
writeFileSync(out, JSON.stringify([session]));
console.log('demo party', session.code, 'written to', out);
