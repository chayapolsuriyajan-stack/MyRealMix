// Spotlight-style glass bubble + floating pill, rendered in a closed-off Shadow DOM.

const SPARK = `<svg class="spark" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z" fill="currentColor"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" fill="currentColor" opacity=".6"/></svg>`;

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const AI_LABEL = {
  available: 'On-device AI',
  downloadable: 'AI model not downloaded · basic mode',
  downloading: 'AI model downloading · basic mode',
  unavailable: 'Basic mode',
};

export function createUI(h) {
  const host = document.createElement('myrealmix-root');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <link rel="stylesheet" href="${chrome.runtime.getURL('src/content/ui/bubble.css')}">
    <div class="wrap">
      <div class="scrim"></div>
      <div class="bubble" role="dialog" aria-modal="true" aria-label="MyRealMix">
        <div class="bar">${SPARK}
          <input type="text" spellcheck="false" autocomplete="off" placeholder="Blend something into your queue…" aria-label="What do you want to hear?">
          <kbd>esc</kbd>
        </div>
        <div class="body">
          <div class="chips"></div>
          <div class="status" role="status"></div>
          <div class="preview" hidden>
            <div class="preview-head">
              <div class="preview-title"></div>
              <div class="seg" role="group" aria-label="How much">
                <button data-r="light">Light</button><button data-r="medium">Medium</button><button data-r="heavy">Heavy</button>
              </div>
            </div>
            <ol class="rows"></ol>
            <div class="actions">
              <button class="btn cancel">Cancel</button>
              <button class="btn primary apply">Blend in<span class="k">↵</span></button>
            </div>
          </div>
          <div class="learned" hidden></div>
        </div>
        <div class="foot">
          <span class="ai"><span class="dot"></span><span class="ai-t">…</span></span>
          <span class="spacer"></span>
          <label class="toggle" title="Quietly drop upcoming autoplay tracks from artists you keep skipping"><input type="checkbox" class="trim"><span class="track"></span>Smart trim</label>
          <button class="link learned-btn">What I've learned</button>
        </div>
      </div>
      <div class="pill" role="button" tabindex="0" aria-label="Open MyRealMix (Ctrl+Shift+K)">${SPARK}<span>Mix</span><span class="session" hidden><span class="session-t"></span><button class="x" aria-label="Stop blend">✕</button></span></div>
      <div class="toast" role="status"><span class="toast-t"></span><button class="link toast-a" hidden>Undo</button></div>
    </div>`;
  document.documentElement.append(host);

  const $ = (s) => root.querySelector(s);
  const wrap = $('.wrap');
  const input = $('input');
  const bubble = $('.bubble');
  const preview = $('.preview');
  const learned = $('.learned');
  const chips = $('.chips');
  const status = $('.status');
  const pill = $('.pill');
  let lastFocus = null;
  let previewFor = null; // input text the current preview was built from

  // Keep keystrokes away from YouTube Music's own shortcuts (space = play/pause, etc.).
  for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation());

  function open() {
    if (wrap.classList.contains('open')) return input.focus();
    lastFocus = document.activeElement;
    wrap.classList.add('open');
    setTimeout(() => (input.focus(), input.select()), 30);
    h.onOpen?.();
  }
  function close() {
    wrap.classList.remove('open');
    lastFocus?.focus?.();
  }
  const isOpen = () => wrap.classList.contains('open');

  $('.scrim').addEventListener('click', close);
  bubble.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return close();
    if (e.key === 'Tab') {
      // Focus trap
      const f = [...root.querySelectorAll('input:not(.trim), button:not([hidden])')].filter((el) => el.offsetParent && bubble.contains(el));
      const i = f.indexOf(root.activeElement);
      if (e.shiftKey && i <= 0) (e.preventDefault(), f.at(-1).focus());
      else if (!e.shiftKey && i === f.length - 1) (e.preventDefault(), f[0].focus());
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const text = input.value.trim();
    if (!preview.hidden && text === previewFor) h.onApply();
    else if (text) h.onSubmit(text);
  });
  input.addEventListener('input', () => {
    learned.hidden = true;
    chips.hidden = !!input.value.trim();
  });

  chips.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    input.value = c.dataset.q;
    h.onSubmit(c.dataset.q);
  });
  $('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) h.onRatio(b.dataset.r);
  });
  $('.apply').addEventListener('click', () => h.onApply());
  $('.cancel').addEventListener('click', () => (hidePreview(), input.focus()));
  $('.trim').addEventListener('change', (e) => h.onSmartTrim(e.target.checked));
  $('.learned-btn').addEventListener('click', () => {
    if (!learned.hidden) return void (learned.hidden = true);
    preview.hidden = true;
    learned.hidden = false;
    h.onLearned();
  });
  learned.addEventListener('click', (e) => e.target.closest('.reset') && h.onReset());
  $('.x').addEventListener('click', (e) => (e.stopPropagation(), h.onStopSession()));
  $('.toast-a').addEventListener('click', () => (hideToast(), h.onUndo()));

  // Draggable pill; a click without movement opens the bubble.
  let drag = null;
  pill.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.x')) return;
    const r = pill.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
    pill.setPointerCapture(e.pointerId);
  });
  pill.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    placePill({ left: drag.left + dx, top: drag.top + dy });
  });
  pill.addEventListener('pointerup', () => {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    if (moved) h.onPillMove(pillPos());
    else open();
  });
  pill.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), open()));

  function placePill(pos) {
    const r = pill.getBoundingClientRect();
    const left = Math.min(Math.max(8, pos.left), innerWidth - r.width - 8);
    const top = Math.min(Math.max(8, pos.top), innerHeight - r.height - 8);
    Object.assign(pill.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
  }
  const pillPos = () => {
    const r = pill.getBoundingClientRect();
    return { left: r.left, top: r.top };
  };
  // Default: bottom-right, above the player bar.
  Object.assign(pill.style, { right: '24px', bottom: '96px' });

  function hidePreview() {
    preview.hidden = true;
    previewFor = null;
  }

  let toastTimer = 0;
  function hideToast() {
    $('.toast').classList.remove('show');
  }

  return {
    open,
    close,
    toggle: () => (isOpen() ? close() : open()),
    isOpen,
    placePill,
    busy(on, msg = '') {
      bubble.classList.toggle('busy', on);
      status.classList.remove('error');
      status.textContent = msg;
    },
    error(msg) {
      bubble.classList.remove('busy');
      status.classList.add('error');
      status.textContent = msg;
    },
    setAI(state) {
      $('.ai').dataset.state = state;
      $('.ai-t').textContent = AI_LABEL[state] ?? AI_LABEL.unavailable;
    },
    setSmartTrim(on) {
      $('.trim').checked = on;
    },
    setSuggestions(list) {
      chips.innerHTML = list.length
        ? `<div class="chips-label">Try</div>` + list.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')
        : '';
      chips.hidden = !list.length || !!input.value.trim();
    },
    /** rows: merged upcoming list; items with .blended are new. */
    showPreview({ text, rows, count, ratio, label }) {
      previewFor = text;
      learned.hidden = true;
      chips.hidden = true;
      preview.hidden = false;
      $('.preview-title').innerHTML = `Adding <b>${count}</b> from <b>${esc(label)}</b> to your next ${rows.length}`;
      for (const b of root.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.r === ratio));
      $('.rows').innerHTML = rows
        .map(
          (t, i) => `<li class="row${t.blended ? ' new' : ''}">
            <span class="n">${i + 1}</span>
            ${t.thumb ? `<img src="${esc(t.thumb)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
            <div class="meta"><div class="t">${esc(t.title)}${t.blended ? '<span class="tag">MIX</span>' : ''}</div><div class="a">${esc(t.artists.join(', '))}</div></div>
            <span class="d">${esc(t.duration)}</span>
          </li>`,
        )
        .join('');
      input.focus();
    },
    hidePreview,
    showLearned({ liked, disliked, seeds }) {
      const max = Math.max(1, ...liked.map((x) => x.w), ...disliked.map((x) => -x.w));
      const bars = (list, neg) =>
        list.length
          ? `<div class="bars">${list
              .map((x) => `<div class="barrow"><span>${esc(x.name)}</span><div class="barfill${neg ? ' neg' : ''}" style="width:${Math.max(6, (Math.abs(x.w) / max) * 100)}%"></div></div>`)
              .join('')}</div>`
          : `<div class="muted">Nothing yet — keep listening.</div>`;
      learned.innerHTML = `
        <section><h4>Artists you lean into</h4>${bars(liked)}</section>
        <section><h4>Artists you skip</h4>${bars(disliked, true)}</section>
        <section><h4>Blends you ask for</h4>${seeds.length ? seeds.map((s) => `<span class="chip">${esc(s.name)}</span>`).join(' ') : '<div class="muted">None yet.</div>'}</section>
        <div class="actions"><button class="btn reset">Reset what I've learned</button></div>`;
    },
    setSession(text) {
      $('.session').hidden = !text;
      $('.session-t').textContent = text ?? '';
    },
    toast(msg, { undo = false } = {}) {
      clearTimeout(toastTimer);
      $('.toast-t').textContent = msg;
      $('.toast-a').hidden = !undo;
      $('.toast').classList.add('show');
      toastTimer = setTimeout(hideToast, undo ? 7000 : 3500);
    },
    get text() {
      return input.value.trim();
    },
  };
}
