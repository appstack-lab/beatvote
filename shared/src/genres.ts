// Maps Spotify's many micro-genres ("deep house", "german techno") onto a few families,
// so that genre stickiness works on "house" rather than on exact tags.
// Tags go to the first family with a matching key, so metal comes first: "rap metal" or "post-hardcore" must not
// end up in hip hop or rock. Keys match anywhere in a tag; a leading "=" means the whole tag must match.
// Plain "hardcore" (Knocked Loose, Terror) is heavy music, "hardcore punk" (Black Flag) stays with rock via "punk",
// and "hardcore hip hop" or "happy hardcore" must not count as metal.
export const GENRE_FAMILIES: [string, string[]][] = [
  [
    'metal',
    [
      'metal',
      'deathcore',
      'djent',
      'grindcore',
      'post-hardcore',
      'screamo',
      'neue deutsche härte',
      '=hardcore',
      'beatdown',
      'mathcore',
      'metallic hardcore',
      'chaotic hardcore',
      'tough guy hardcore',
    ],
  ],
  ['hip hop', ['hip hop', 'rap', 'trap', 'drill', 'grime']],
  ['techno', ['techno', 'minimal', 'hard techno', 'acid']],
  ['house', ['house', 'disco', 'garage', 'tech house']],
  ['trance', ['trance', 'psytrance']],
  ['drum and bass', ['drum and bass', 'dnb', 'jungle', 'dubstep', 'breakbeat']],
  ['edm', ['edm', 'electro', 'big room', 'dance', 'electronic']],
  ['rock', ['rock', 'punk', 'grunge']],
  ['indie', ['indie', 'alternative', 'shoegaze']],
  ['pop', ['pop', 'schlager', 'k-pop']],
  ['r&b', ['r&b', 'soul', 'funk', 'neo soul']],
  ['reggae', ['reggae', 'dancehall', 'dub', 'reggaeton', 'afrobeat']],
  ['latin', ['latin', 'salsa', 'bachata', 'cumbia']],
  ['jazz', ['jazz', 'swing', 'bebop']],
  ['classical', ['classical', 'orchestra', 'opera']],
  ['country', ['country', 'folk', 'bluegrass']],
];

/** Family names, e.g. for the host's genre picker. */
export const GENRE_NAMES = GENRE_FAMILIES.map(([name]) => name);
