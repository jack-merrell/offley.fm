const CANONICAL_STATION_TAGS = [
  'House',
  'Strictly Vinyl',
  'Disco',
  'Techno',
  'Balearic',
  'Ambient',
  'Dub',
  'Trance',
  'Groovy',
  'Deep House',
  'Tech House'
];

export const STATION_TAG_OPTIONS = Object.freeze([...CANONICAL_STATION_TAGS]);

function normalizeTagKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function toTitleCase(value) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const TAG_ALIAS_ENTRIES = [
  ...CANONICAL_STATION_TAGS.map((tag) => [normalizeTagKey(tag), tag]),
  ['strict vinyl', 'Strictly Vinyl'],
  ['vinyl', 'Strictly Vinyl'],
  ['vinyl only', 'Strictly Vinyl'],
  ['deephouse', 'Deep House'],
  ['techhouse', 'Tech House'],
  ['house music', 'House']
];

const TAG_ALIAS_LOOKUP = new Map(TAG_ALIAS_ENTRIES);
const TAG_ORDER_LOOKUP = new Map(CANONICAL_STATION_TAGS.map((tag, index) => [tag, index]));

function parseInputValues(input) {
  if (Array.isArray(input)) {
    return input;
  }

  if (typeof input !== 'string') {
    return [];
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_error) {
    // Fallback to delimited string parsing.
  }

  return trimmed.split(/[,\n;]/g);
}

function canonicalizeTag(rawValue) {
  const key = normalizeTagKey(rawValue);
  if (!key) {
    return null;
  }

  const canonical = TAG_ALIAS_LOOKUP.get(key);
  if (canonical) {
    return canonical;
  }

  return toTitleCase(key);
}

function compareTags(a, b) {
  const aKnownOrder = TAG_ORDER_LOOKUP.get(a);
  const bKnownOrder = TAG_ORDER_LOOKUP.get(b);

  const aKnown = Number.isInteger(aKnownOrder);
  const bKnown = Number.isInteger(bKnownOrder);

  if (aKnown && bKnown) {
    return aKnownOrder - bKnownOrder;
  }

  if (aKnown) {
    return -1;
  }

  if (bKnown) {
    return 1;
  }

  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

export function normalizeStationTags(input) {
  const values = parseInputValues(input);
  const deduped = new Map();

  for (const value of values) {
    const canonicalTag = canonicalizeTag(value);
    if (!canonicalTag) {
      continue;
    }
    const dedupeKey = normalizeTagKey(canonicalTag);
    if (deduped.has(dedupeKey)) {
      continue;
    }
    deduped.set(dedupeKey, canonicalTag);
  }

  return [...deduped.values()].sort(compareTags);
}

