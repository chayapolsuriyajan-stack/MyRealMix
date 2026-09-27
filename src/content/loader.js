// Content scripts can't be ES modules; load the real entry point as one.
import(chrome.runtime.getURL('src/content/app.js')).catch((e) => console.error('[MyRealMix]', e));
