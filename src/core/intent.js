// Turns a free-text request into a structured blend intent. The AI path (ai/nano.js) produces the
// same shape; normalizeIntent validates either source.

export const RATIOS = ['light', 'medium', 'heavy'];
export const MODES = ['blend', 'more-like-this'];

const LIGHT = /\b(a (little )?(bit|touch|hint)( of)?|a little( of)?|a few|light(ly)?|sprinkle( in)?|occasional(ly)?|rarely|subtle)\b/gi;
const HEAVY = /\b(lots( of)?|a lot( of)?|heavy|heavily|mostly|tons( of)?|loads( of)?|only)\b/gi;
const MORE_LIKE = /\b(more like (this|that)|similar( to this)?|same vibe)\b/i;
const FILLER =
  /\b(i('d| would)? (want|like|love)( to)?|can you|please|let'?s|play|put|add|blend|mix|throw|queue|listen to|hear|in(to)?|some|more|of|the|my|queue|songs?|tracks?|music|stuff)\b/gi;

export function parseRules(text) {
  const raw = text.trim();
  let ratio = 'medium';
  if (LIGHT.test(raw)) ratio = 'light';
  else if (HEAVY.test(raw)) ratio = 'heavy';
  LIGHT.lastIndex = HEAVY.lastIndex = 0;

  if (MORE_LIKE.test(raw)) return normalizeIntent({ mode: 'more-like-this', ratio }, raw);

  let rest = raw.replace(LIGHT, ' ').replace(HEAVY, ' ');
  const artists = [];
  const by = rest.match(/\bby\s+(.+)$/i);
  if (by) {
    artists.push(...by[1].split(/\s*(?:,|&|\band\b)\s*/i).filter(Boolean));
    rest = rest.slice(0, by.index);
  }
  const query = rest.replace(FILLER, ' ').replace(/[^\p{L}\p{N}'&.\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return normalizeIntent({ query: query || artists.join(' '), artists, ratio, mode: 'blend' }, raw);
}

export function normalizeIntent(obj = {}, text = '') {
  const list = (v) => (Array.isArray(v) ? v : []).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  return {
    query: String(obj.query ?? '').trim() || text.trim(),
    artists: list(obj.artists),
    works: list(obj.works),
    mood: obj.mood ? String(obj.mood) : '',
    ratio: RATIOS.includes(obj.ratio) ? obj.ratio : 'medium',
    mode: MODES.includes(obj.mode) ? obj.mode : 'blend',
  };
}

// Search strings to run, most specific first.
export function buildQueries(intent) {
  const qs = [];
  for (const w of intent.works) {
    qs.push(intent.artists.length ? `${intent.artists[0]} ${w}` : w);
  }
  if (intent.query) qs.push(intent.query);
  for (const a of intent.artists) qs.push(a);
  return [...new Set(qs.map((q) => q.trim()).filter(Boolean))].slice(0, 3);
}

// Short human label for the active-blend chip.
export function label(intent) {
  return intent.works[0] || intent.query || intent.artists[0] || 'Blend';
}
