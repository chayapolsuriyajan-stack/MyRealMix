import { createUI } from './ui/bubble.js';
import { parseRules, normalizeIntent, buildQueries, label } from '../core/intent.js';
import { GAP, dedupe, rankCandidates, planBlend, merge } from '../core/blend.js';
import { emptyTaste, addSignal, scoreTrack, shouldTrim, classifyPlay, top } from '../core/taste.js';

const log = (...a) => console.debug('[MyRealMix]', ...a);

// ---------- bridge client ----------
let seq = 0;
const pending = new Map();
const listeners = new Set();
window.addEventListener('message', (e) => {
  const m = e.data;
  if (e.source !== window || m?.src !== 'mrm-bridge') return;
  if (m.event) return listeners.forEach((fn) => fn(m.event));
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
});
function bridge(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    window.postMessage({ src: 'mrm-cs', id, type, payload }, location.origin);
    setTimeout(() => pending.delete(id) && reject(new Error('timeout')), 15000);
  });
}

// ---------- storage ----------
const store = {
  taste: emptyTaste(),
  settings: { smartTrim: false, pill: null },
};
const saved = await chrome.storage.local.get(['taste', 'settings']);
Object.assign(store.taste, saved.taste);
Object.assign(store.settings, saved.settings);
let saveTimer = 0;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ taste: store.taste, settings: store.settings }), 500);
};
const signal = (s) => {
  store.taste = addSignal(store.taste, s);
  log('signal', s.kind, s.artists, s.seed ?? '');
  save();
};

// ---------- AI ----------
const ask = (msg) => chrome.runtime.sendMessage({ target: 'bg', ...msg }).catch((e) => ({ error: String(e) }));
async function refreshAI() {
  const r = await ask({ type: 'status' });
  ui.setAI(r?.result ?? 'unavailable');
}
async function understand(text, current) {
  // A cold model can take a while; don't make the user wait on it.
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: 'AI timeout' }), 6000));
  const r = await Promise.race([ask({ type: 'parse', text, context: { current } }), timeout]);
  if (r?.result) return { intent: normalizeIntent(r.result, text), source: 'ai' };
  if (r?.error) log('AI fallback:', r.error);
  return { intent: parseRules(text), source: 'rules' };
}

// ---------- queue helpers ----------
// Upcoming = queued tracks after the current one, then the autoplay list.
function upcomingOf(snap) {
  return [
    ...snap.items.slice(snap.selected + 1).filter(Boolean).map((t) => ({ ...t, src: 'q' })),
    ...snap.automix.filter(Boolean).map((t) => ({ ...t, src: 'a' })),
  ];
}
// Only rebuild as much of the queue as the plan reaches, plus any tracks already queued.
function sequenceFor(upcoming, plan) {
  const queued = upcoming.filter((t) => t.src === 'q').length;
  const reach = Math.max(queued, plan.at(-1)?.at ?? 0);
  return merge(upcoming.slice(0, reach), plan);
}

// ---------- state ----------
let draft = null; // {text, intent, pool, snap, ratio, plan}
let session = null; // {intent, label, ratio, pool, added:Set}
let busy = false;

const ui = createUI({
  onOpen: () => (refreshAI(), refreshSuggestions()),
  onSubmit: (text) => prepare(text).catch(fail),
  onRatio: (r) => draft && replan(r),
  onApply: () => apply().catch(fail),
  onStopSession: () => stopSession(),
  onUndo: () => undo().catch(fail),
  onSmartTrim: (on) => ((store.settings.smartTrim = on), save()),
  onLearned: () => showLearned(),
  onReset: () => ((store.taste = emptyTaste()), save(), showLearned()),
  onPillMove: (pos) => ((store.settings.pill = pos), save()),
});
ui.setSmartTrim(store.settings.smartTrim);
if (store.settings.pill) requestAnimationFrame(() => ui.placePill(store.settings.pill));

function fail(e) {
  busy = false;
  log(e);
  ui.error(e.message === 'stale' ? 'The song changed — try again.' : `Something went wrong: ${e.message}`);
}

function refreshSuggestions() {
  const seeds = top(store.taste.seeds, 3).map((s) => s.name);
  const artists = top(store.taste.artists, 3).map((a) => `more ${a.name}`);
  const base = ['more like this', 'a little Ghibli piano', 'Violet Evergarden'];
  ui.setSuggestions([...new Set([...seeds, ...artists, ...base])].slice(0, 6));
}

function showLearned() {
  ui.showLearned({
    liked: top(store.taste.artists, 6),
    disliked: top(store.taste.artists, 4, Date.now(), -1),
    seeds: top(store.taste.seeds, 8),
  });
}

async function searchAll(queries) {
  const results = await Promise.allSettled(queries.map((query) => bridge('search', { query })));
  // Interleave results so the most specific query leads but others still contribute.
  const lists = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const out = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

async function prepare(text) {
  if (busy) return;
  busy = true;
  ui.hidePreview();
  ui.busy(true, 'Understanding…');
  let snap = await bridge('snapshot');
  if (!snap?.current) throw new Error('start playing something first');

  const { intent, source } = await understand(text, snap.current);
  if (intent.mode === 'more-like-this') {
    intent.artists = snap.current.artists;
    intent.query = snap.current.artists.join(' ');
    intent.works = snap.current.album ? [snap.current.album] : [];
  }
  ui.busy(true, `Finding ${label(intent)}…`);
  const found = await searchAll(buildQueries(intent));
  snap = await bridge('snapshot');
  const upcoming = upcomingOf(snap);
  const played = snap.items.slice(0, snap.selected + 1).filter(Boolean);
  const pool = rankCandidates(dedupe(found, upcoming, played), intent, (t) => scoreTrack(store.taste, t));
  log('intent', source, intent, 'candidates', pool.length);
  busy = false;
  if (!pool.length) return ui.error(`Couldn't find anything new for “${label(intent)}”.`);

  draft = { text, intent, pool, snap, upcoming };
  ui.busy(false);
  replan(intent.ratio);
}

function replan(ratio) {
  draft.ratio = ratio;
  draft.plan = planBlend({ upcoming: draft.upcoming, candidates: draft.pool, ratio });
  const rows = merge(draft.upcoming, draft.plan);
  const last = rows.findLastIndex((t) => t.blended);
  ui.showPreview({
    text: draft.text,
    rows: rows.slice(0, Math.max(last + 2, 8)),
    count: draft.plan.length,
    ratio,
    label: label(draft.intent),
  });
}

async function apply() {
  if (!draft?.plan?.length || busy) return;
  busy = true;
  ui.busy(true, 'Blending…');
  const { plan, snap, upcoming, intent, pool, ratio } = draft;
  const sequence = sequenceFor(upcoming, plan).map((t) => ({ videoId: t.videoId, src: t.blended ? 'new' : t.src }));
  const { added } = await bridge('applyUpcoming', { expectCurrent: snap.current.videoId, sequence });
  const used = new Set(plan.map((p) => p.track.videoId));
  const name = label(intent);
  session = {
    intent,
    label: name,
    ratio,
    pool: pool.filter((t) => !used.has(t.videoId)),
    added: new Set(added),
    lastBatch: added,
  };
  signal({ artists: intent.artists, seed: name, kind: 'request' });
  draft = null;
  busy = false;
  ui.busy(false);
  ui.hidePreview();
  ui.setSession(`${name} · ${ratio}`);
  ui.close();
  ui.toast(`Blended ${added.length} ${name} track${added.length === 1 ? '' : 's'} into Up Next`, { undo: true });
}

async function undo() {
  if (!session) return;
  await bridge('remove', { videoIds: session.lastBatch });
  stopSession(false);
  ui.toast('Blend undone');
}

function stopSession(announce = true) {
  if (!session) return;
  if (announce) ui.toast(`Stopped blending ${session.label}`);
  session = null;
  ui.setSession(null);
}

// Keep the ratio going as the queue advances; trim tracks the user keeps skipping.
async function maintain() {
  if (busy) return;
  const snap = await bridge('snapshot').catch(() => null);
  if (!snap?.current) return;
  let upcoming = upcomingOf(snap);

  if (store.settings.smartTrim) {
    const doomed = upcoming
      .slice(0, 6)
      .filter((t) => !session?.added.has(t.videoId) && shouldTrim(store.taste, t))
      .slice(0, 2);
    if (doomed.length) {
      await bridge('remove', { videoIds: doomed.map((t) => t.videoId) });
      ui.toast(`Smart trim skipped ${doomed.map((t) => t.artists[0]).join(', ')}`);
      return; // the removal fires another change event
    }
  }

  if (!session) return;
  const oursAhead = upcoming.filter((t) => session.added.has(t.videoId)).length;
  if (oursAhead >= 2) return;
  if (!session.pool.length) {
    ui.toast(`Ran out of new ${session.label} tracks — blend finished`);
    return stopSession(false);
  }
  const lastOurs = upcoming.findLastIndex((t) => session.added.has(t.videoId));
  const offset = lastOurs + 1;
  const pool = dedupe(session.pool, upcoming, snap.items.filter(Boolean));
  const rel = planBlend({
    upcoming: upcoming.slice(offset),
    candidates: pool,
    ratio: session.ratio,
    maxInserts: 3,
    first: lastOurs >= 0 ? GAP[session.ratio] : 1,
  });
  if (!rel.length) return;
  const plan = rel.map((p) => ({ ...p, at: p.at + offset }));
  busy = true;
  try {
    const sequence = sequenceFor(upcoming, plan).map((t) => ({ videoId: t.videoId, src: t.blended ? 'new' : t.src }));
    const { added } = await bridge('applyUpcoming', { expectCurrent: snap.current.videoId, sequence });
    added.forEach((id) => session.added.add(id));
    session.lastBatch = added;
    const used = new Set(plan.map((p) => p.track.videoId));
    session.pool = session.pool.filter((t) => !used.has(t.videoId));
    log('topped up', added);
  } finally {
    busy = false;
  }
}

// ---------- listening signals ----------
const video = () => document.querySelector('video');
let playing = null; // {track, maxTime, duration, liked}
function trackChanged(current) {
  if (playing && playing.track.videoId !== current?.videoId) {
    const kind = classifyPlay({ played: playing.maxTime, duration: playing.duration });
    const seed = session?.added.has(playing.track.videoId) ? session.label : undefined;
    if (kind) signal({ artists: playing.track.artists, seed, kind });
  }
  if (current && playing?.track.videoId !== current.videoId) {
    playing = { track: current, maxTime: 0, duration: 0, liked: null };
  }
}
document.addEventListener(
  'timeupdate',
  (e) => {
    if (!playing || e.target !== video()) return;
    playing.maxTime = Math.max(playing.maxTime, e.target.currentTime);
    playing.duration = e.target.duration || playing.duration;
  },
  true,
);
// Thumbs up/down on the player bar.
new MutationObserver(() => {
  const status = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer')?.getAttribute('like-status');
  if (!playing || !status || status === playing.liked) return;
  const prev = playing.liked;
  playing.liked = status;
  if (prev === null) return; // initial state for this track, not a user action
  if (status === 'LIKE') signal({ artists: playing.track.artists, kind: 'like' });
  if (status === 'DISLIKE') signal({ artists: playing.track.artists, kind: 'dislike' });
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['like-status'] });

listeners.add(async (event) => {
  if (event !== 'changed' && event !== 'ready') return;
  const snap = await bridge('snapshot').catch(() => null);
  if (snap?.current) {
    trackChanged(snap.current);
    if (playing && playing.liked === null) {
      playing.liked = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer')?.getAttribute('like-status') ?? null;
    }
  }
  maintain().catch((e) => log('maintain', e));
});

// ---------- hotkey ----------
window.addEventListener(
  'keydown',
  (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyK') {
      e.preventDefault();
      e.stopPropagation();
      ui.toggle();
    }
  },
  true,
);

listeners.forEach((fn) => fn('ready')); // the bridge may have announced itself before we loaded
log('ready');
