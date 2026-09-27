// Relays intent-parsing requests from the content script to the offscreen document, where the
// Prompt API (Gemini Nano) is available. Content scripts on a web origin can't use it directly.

const OFFSCREEN = 'src/offscreen/offscreen.html';
let creating = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN,
      reasons: ['DOM_PARSER'],
      justification: 'Runs the on-device Prompt API to understand music requests.',
    })
    .finally(() => (creating = null));
  await creating;
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.target !== 'bg') return;
  ensureOffscreen()
    .then(() => chrome.runtime.sendMessage({ ...msg, target: 'offscreen' }))
    .then(send, (e) => send({ error: String(e?.message ?? e) }));
  return true;
});
