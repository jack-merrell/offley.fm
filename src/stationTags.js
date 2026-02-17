export const STATION_TAG_OPTIONS = [
  'house',
  'strictly vinyl',
  'disco',
  'techno',
  'balearic',
  'ambient',
  'dub',
  'trance',
  'groovy',
  'deep house',
  'tech house'
];

const TAG_LOOKUP = new Map(STATION_TAG_OPTIONS.map((tag) => [tag.toLowerCase(), tag]));

export function normalizeStationTags(input) {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,\n]/g)
      : [];

  const unique = new Set();
  for (const value of values) {
    const lowered = String(value || '').trim().toLowerCase();
    if (!lowered || !TAG_LOOKUP.has(lowered) || unique.has(lowered)) {
      continue;
    }
    unique.add(lowered);
  }

  return [...unique].map((key) => TAG_LOOKUP.get(key));
}
