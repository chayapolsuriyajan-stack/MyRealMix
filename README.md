# MyRealMix

A Chrome extension that steers YouTube Music's **Up Next**. Ask for something ("violet evergarden", "a little Ghibli piano", "more like this") and it blends a measured dose of matching tracks into the queue that's already playing, about one in every three songs by default. It never takes the queue over. Over time it learns which artists you finish, skip, like, and dislike.

## Install (unpacked)
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
2. Open https://music.youtube.com and play anything.
3. Press **Ctrl+Shift+K** (⌘⇧K on Mac) or click the floating **✦ Mix** pill.

## Using it
- Type a request → **Enter** to preview where tracks will land → **Enter** again (or *Blend in*) to apply.
- **Light / Medium / Heavy** = one blended track per 4 / 3 / 2 songs. Blended tracks are capped at 40% of the upcoming queue.
- The blend stays active as the queue advances and tops itself up. Stop it with the ✕ on the pill; **Undo** in the toast removes the last batch.
- **Smart trim** quietly removes upcoming autoplay tracks by artists you keep skipping or thumbing down.
- **What I've learned** shows the taste model and has a reset button. Everything is stored locally (`chrome.storage.local`).

## AI
The extension uses Chrome's built-in Gemini Nano (Prompt API, Chrome 138+) to turn requests into a search plan. For example, "violet evergarden" becomes artist Evan Call and the Violet Evergarden OST. If the model isn't available or hasn't downloaded yet, a rules-based parser takes over. The footer shows which mode is active.

## Layout
| Path | Role |
|---|---|
| `src/content/bridge.js` | MAIN-world script: YouTube Music search + queue store (`ADD_ITEMS`, `REMOVE_ITEM`, `REMOVE_AUTOMIX_ITEM`) |
| `src/content/app.js` | Orchestration: intent → search → rank → plan → apply, top-ups, listening signals |
| `src/content/ui/` | Glass bubble + pill (Shadow DOM) |
| `src/core/` | Pure logic: `blend.js`, `intent.js`, `taste.js` |
| `src/ai/nano.js`, `src/offscreen/` | Gemini Nano, run in an offscreen document |
| `dev/preview.html` | UI preview with sample data (`python -m http.server 5510`, open `/dev/preview.html?state=preview`) |

## Tests
```bash
npm test
```

The bridge depends on undocumented YouTube Music internals (verified 2026-09). If YouTube Music changes, `bridge.js` is the only file that should need updating.
