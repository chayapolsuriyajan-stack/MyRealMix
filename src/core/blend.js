// Interleaves requested tracks into the upcoming queue at a steady, non-intrusive rate.

// Originals between inserted tracks: medium = O O T, light = O O O T, heavy = O T.
export const GAP = { light: 3, medium: 2, heavy: 1 };
export const MAX_SHARE = 0.4;

const artistKey = (a) => a.trim().toLowerCase();

// Strip version/edition noise so "Song (Piano ver.)" and "Song - Remastered" dedupe against "Song".
export function normTitle(title = '') {
  return title
    .toLowerCase()
    .replace(/[([【「].*?[)\]】」]/g, ' ')
    .replace(/\s[-–—]\s.*$/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const tokens = (s = '') => normTitle(s).split(' ').filter((t) => t.length > 1);

// How well a search hit matches what was asked for. Search ranking alone is not enough:
// "evan call violet evergarden" returns Evan Call's Frieren tracks first.
export function relevance(track, intent) {
  const wanted = new Set([...intent.works, intent.query].flatMap(tokens));
  const hay = new Set([track.title, track.album].flatMap(tokens));
  let hits = 0;
  for (const t of wanted) if (hay.has(t)) hits++;
  const workScore = wanted.size ? hits / wanted.size : 0;
  const wantArtists = intent.artists.map(artistKey);
  const artistScore = track.artists.some((a) => wantArtists.includes(artistKey(a))) ? 1 : 0;
  // Artist alone (0.4) stays under the 0.5 "strong match" bar in rankCandidates.
  return workScore + 0.4 * artistScore;
}

// Order candidates: relevance first, taste as a tiebreaker-plus, search position as a gentle prior.
export function rankCandidates(candidates, intent, score = () => 0) {
  const scored = candidates.map((t, i) => ({ t, r: relevance(t, intent), s: score(t) - i * 0.02 }));
  const strong = scored.filter((x) => x.r >= 0.5);
  // Only drop weak matches when enough strong ones exist to fill a blend.
  const pool = strong.length >= 3 ? strong : scored;
  return pool.sort((a, b) => b.r + 0.25 * b.s - (a.r + 0.25 * a.s)).map((x) => x.t);
}

export function dedupe(candidates, upcoming, exclude = []) {
  const seenIds = new Set([...upcoming, ...exclude].map((t) => t.videoId));
  const seenTitles = new Set([...upcoming, ...exclude].map((t) => normTitle(t.title)));
  const out = [];
  for (const t of candidates) {
    const nt = normTitle(t.title);
    if (seenIds.has(t.videoId) || seenTitles.has(nt)) continue;
    seenIds.add(t.videoId);
    seenTitles.add(nt);
    out.push(t);
  }
  return out;
}

/**
 * Plan where to insert tracks.
 * @param upcoming   tracks after the current one, in play order
 * @param candidates ranked, deduped tracks to blend in
 * @param first      originals to leave before the first insert (1 = right after the next song)
 * @returns [{at, track}] — `at` = number of upcoming originals that play before this track
 */
export function planBlend({ upcoming, candidates, ratio = 'medium', maxInserts = 5, first = 1, rng = Math.random }) {
  const gap = GAP[ratio] ?? GAP.medium;
  const cap = Math.min(maxInserts, Math.max(1, Math.floor((upcoming.length * MAX_SHARE) / (1 - MAX_SHARE))));
  const pool = [...candidates];
  const plan = [];
  let at = Math.min(first, upcoming.length);

  while (plan.length < cap && pool.length && at <= upcoming.length) {
    const neighbors = [upcoming[at - 1], upcoming[at]].filter(Boolean).flatMap((t) => t.artists.map(artistKey));
    const pick = pool.findIndex((t) => !t.artists.some((a) => neighbors.includes(artistKey(a))));
    const [track] = pool.splice(pick === -1 ? 0 : pick, 1);
    plan.push({ at, track });
    // ±1 jitter keeps it from feeling mechanical, but always leaves at least one original between inserts.
    const jitter = gap >= 2 ? Math.floor(rng() * 3) - 1 : 0;
    at += Math.max(1, gap + jitter);
  }
  return plan;
}

// Final upcoming order after applying a plan.
export function merge(upcoming, plan) {
  const out = [];
  let p = 0;
  for (let i = 0; i <= upcoming.length; i++) {
    while (p < plan.length && plan[p].at === i) out.push({ ...plan[p++].track, blended: true });
    if (i < upcoming.length) out.push(upcoming[i]);
  }
  return out;
}
