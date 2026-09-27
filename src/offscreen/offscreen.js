import { aiStatus, parseWithAI } from '../ai/nano.js';

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.target !== 'offscreen') return;
  const run = msg.type === 'status' ? aiStatus() : parseWithAI(msg.text, msg.context);
  run.then((result) => send({ result }), (e) => send({ error: String(e?.message ?? e) }));
  return true;
});
