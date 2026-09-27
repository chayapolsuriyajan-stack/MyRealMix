// Local taste model: per-artist and per-seed weights that decay over time.

export const HALF_LIFE_MS = 30 * 24 * 3600 * 1000;
export const SIGNAL = { complete: 1, skip: -1, like: 3, dislike: -3, request: 0.5 };

export const emptyTaste = () => ({ artists: {}, seeds: {} });

const key = (s) => s.trim().toLowerCase();

export function decayed(entry, now) {
  if (!entry) return 0;
  return entry.w * Math.pow(0.5, (now - entry.t) / HALF_LIFE_MS);
}

function bump(map, name, delta, now) {
  const k = key(name);
  if (!k) return;
  const prev = map[k];
  map[k] = { w: decayed(prev, now) + delta, t: now, name: prev?.name ?? name.trim() };
}

// Returns a new model; `kind` is a SIGNAL key.
export function addSignal(model, { artists = [], seed, kind }, now = Date.now()) {
  const delta = SIGNAL[kind];
  if (!delta) return model;
  const next = { artists: { ...model.artists }, seeds: { ...model.seeds } };
  // Split credit across collaborators so features don't dominate.
  const share = artists.length ? delta / artists.length : 0;
  for (const a of artists) bump(next.artists, a, share, now);
  if (seed) bump(next.seeds, seed, delta, now);
  return next;
}

// Roughly in [-1, 1]; tanh keeps one obsession from swamping relevance.
export function scoreTrack(model, track, now = Date.now()) {
  const sum = track.artists.reduce((s, a) => s + decayed(model.artists[key(a)], now), 0);
  return Math.tanh(sum / 4);
}

export function shouldTrim(model, track, now = Date.now(), threshold = -2) {
  const sum = track.artists.reduce((s, a) => s + decayed(model.artists[key(a)], now), 0);
  return sum <= threshold;
}

export function classifyPlay({ played, duration }) {
  if (!duration || duration < 45) return null;
  if (played / duration >= 0.7) return 'complete';
  if (played < 30) return 'skip';
  return null;
}

export function top(map, n = 6, now = Date.now(), dir = 1) {
  return Object.values(map)
    .map((e) => ({ name: e.name, w: decayed(e, now) }))
    .filter((e) => e.w * dir > 0.25)
    .sort((a, b) => (b.w - a.w) * dir)
    .slice(0, n);
}
