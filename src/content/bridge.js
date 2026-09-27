// Runs in the page's MAIN world so it can reach ytcfg and the queue's Redux store.
// Talks to the isolated content script via window.postMessage ({src:'mrm-cs'} in, {src:'mrm-bridge'} out).
// Everything here depends on undocumented YouTube Music internals, verified against the live app 2026-09.
(() => {
  const OUT = 'mrm-bridge';
  const SONGS_FILTER = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';

  const queueEl = () => document.querySelector('ytmusic-player-queue#queue');
  const store = () => queueEl()?.queue?.store?.store ?? null;
  const dispatch = (action) => queueEl().dispatch(action);
  const qstate = () => store()?.getState().queue;

  const renderer = (item) =>
    item?.playlistPanelVideoRenderer ??
    item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer ??
    null;
  const text = (t) => t?.runs?.map((r) => r.text).join('') ?? t?.simpleText ?? '';
  const pageType = (run) =>
    run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  const splitNames = (s) => s.split(/\s*(?:,|&|\s和\s)\s*/).map((x) => x.trim()).filter(Boolean);

  // Byline runs look like: [Artist, " • ", Album, " • ", "3:24" | "2019"]
  function parseByline(runs = []) {
    const artistRuns = runs.filter((r) => pageType(r) === 'MUSIC_PAGE_TYPE_ARTIST').map((r) => r.text);
    const segments = runs.map((r) => r.text).join('').split(' • ');
    const albumRun = runs.find((r) => pageType(r) === 'MUSIC_PAGE_TYPE_ALBUM');
    return {
      artists: artistRuns.length ? artistRuns : splitNames(segments[0] ?? ''),
      album: albumRun?.text ?? '',
      duration: segments.find((s) => /^\d+:\d\d(:\d\d)?$/.test(s.trim()))?.trim() ?? '',
    };
  }

  function fromQueueItem(item) {
    const r = renderer(item);
    if (!r) return null;
    const by = parseByline(r.longBylineText?.runs ?? r.shortBylineText?.runs);
    return {
      videoId: r.videoId,
      title: text(r.title),
      artists: by.artists,
      album: by.album,
      duration: text(r.lengthText) || by.duration,
      thumb: r.thumbnail?.thumbnails?.[0]?.url ?? '',
      selected: !!r.selected,
    };
  }

  function fromSearchItem(r) {
    const col = (i) => r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text;
    const videoId =
      r.playlistItemData?.videoId ??
      r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    if (!videoId) return null;
    const by = parseByline(col(1)?.runs);
    return {
      videoId,
      title: text(col(0)),
      artists: by.artists,
      album: by.album,
      duration: by.duration,
      thumb: r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url ?? '',
    };
  }

  async function innertube(endpoint, body) {
    const key = window.ytcfg.get('INNERTUBE_API_KEY');
    const context = window.ytcfg.get('INNERTUBE_CONTEXT');
    const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false&key=${key}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context, ...body }),
    });
    if (!res.ok) throw new Error(`${endpoint} ${res.status}`);
    return res.json();
  }

  async function search({ query }) {
    const json = await innertube('search', { query, params: SONGS_FILTER });
    const found = [];
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (o.musicResponsiveListItemRenderer) return void found.push(o.musicResponsiveListItemRenderer);
      for (const k in o) walk(o[k]);
    })(json);
    return found.map(fromSearchItem).filter(Boolean);
  }

  function snapshot() {
    const s = qstate();
    if (!s) return null;
    const items = s.items.map(fromQueueItem);
    let selected = items.findIndex((t) => t?.selected);
    if (selected < 0) selected = s.selectedItemIndex ?? 0;
    return {
      selected,
      current: items[selected] ?? null,
      items,
      automix: (s.automixItems ?? []).map(fromQueueItem),
    };
  }

  /**
   * Rebuild the upcoming queue. `sequence` is the desired order of the first N upcoming tracks:
   * every queue item after the current one plus a prefix of the autoplay list, with new tracks
   * interleaved. src: 'q' (already queued), 'a' (from autoplay), 'new' (fetched here).
   */
  async function applyUpcoming({ expectCurrent, sequence }) {
    const newIds = sequence.filter((x) => x.src === 'new').map((x) => x.videoId);
    const fetched = new Map();
    if (newIds.length) {
      const json = await innertube('music/get_queue', { videoIds: newIds });
      for (const qd of json.queueDatas ?? []) {
        const r = renderer(qd.content);
        if (r) fetched.set(r.videoId, qd.content);
      }
    }

    // Re-read after the await: the track may have changed while we were fetching.
    const s = qstate();
    const snap = snapshot();
    if (!s || snap.current?.videoId !== expectCurrent) throw new Error('stale');
    const queued = new Map(s.items.slice(snap.selected + 1).map((it) => [renderer(it)?.videoId, it]));
    const auto = s.automixItems ?? [];
    const autoTaken = sequence.filter((x) => x.src === 'a').length;
    const autoIds = new Set(auto.slice(0, autoTaken).map((it) => renderer(it)?.videoId));

    const raw = sequence
      .map((x) => (x.src === 'new' ? fetched.get(x.videoId) : x.src === 'q' ? queued.get(x.videoId) : autoIds.has(x.videoId) ? auto.find((it) => renderer(it)?.videoId === x.videoId) : null))
      .filter(Boolean);

    for (let i = s.items.length - 1; i > snap.selected; i--) dispatch({ type: 'REMOVE_ITEM', payload: i });
    for (let i = 0; i < autoTaken; i++) dispatch({ type: 'REMOVE_AUTOMIX_ITEM', payload: 0 });
    // Keep anything already queued that the caller didn't mention rather than silently dropping it.
    const mentioned = new Set(sequence.map((x) => x.videoId));
    for (const [id, it] of queued) if (!mentioned.has(id)) raw.push(it);

    dispatch({
      type: 'ADD_ITEMS',
      payload: {
        nextQueueItemId: qstate().nextQueueItemId,
        index: snap.selected + 1,
        items: raw,
        shuffleEnabled: false,
        shouldAssignIds: true,
      },
    });
    return { added: newIds.filter((id) => fetched.has(id)) };
  }

  function remove({ videoIds }) {
    const ids = new Set(videoIds);
    const s = qstate();
    const snap = snapshot();
    let removed = 0;
    for (let i = s.items.length - 1; i > snap.selected; i--) {
      if (ids.has(renderer(s.items[i])?.videoId)) (dispatch({ type: 'REMOVE_ITEM', payload: i }), removed++);
    }
    const auto = s.automixItems ?? [];
    for (let i = auto.length - 1; i >= 0; i--) {
      if (ids.has(renderer(auto[i])?.videoId)) (dispatch({ type: 'REMOVE_AUTOMIX_ITEM', payload: i }), removed++);
    }
    return { removed };
  }

  const handlers = { search, snapshot, applyUpcoming, remove };

  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (e.source !== window || m?.src !== 'mrm-cs' || !handlers[m.type]) return;
    try {
      const result = await handlers[m.type](m.payload ?? {});
      window.postMessage({ src: OUT, id: m.id, ok: true, result }, location.origin);
    } catch (err) {
      window.postMessage({ src: OUT, id: m.id, ok: false, error: String(err?.message ?? err) }, location.origin);
    }
  });

  // Emit a lightweight change event whenever the queue or current track changes.
  let lastSig = '';
  let timer = 0;
  function onStore() {
    const s = qstate();
    if (!s) return;
    const sig = `${s.items.length}|${s.automixItems?.length}|${s.selectedItemIndex}|${renderer(s.items[s.selectedItemIndex])?.videoId}`;
    if (sig === lastSig) return;
    lastSig = sig;
    clearTimeout(timer);
    timer = setTimeout(() => window.postMessage({ src: OUT, event: 'changed' }, location.origin), 400);
  }

  const wait = setInterval(() => {
    if (!store() || !window.ytcfg) return;
    clearInterval(wait);
    store().subscribe(onStore);
    window.postMessage({ src: OUT, event: 'ready' }, location.origin);
    onStore();
  }, 500);
})();
