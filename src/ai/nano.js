// Gemini Nano via Chrome's built-in Prompt API. Returns raw intent objects; callers validate
// them with normalizeIntent. Returns null whenever the model isn't ready so callers fall back.

const OPTS = {
  expectedInputs: [{ type: 'text', languages: ['en', 'ja', 'es'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

const SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    artists: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    works: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    mood: { type: 'string' },
    ratio: { enum: ['light', 'medium', 'heavy'] },
    mode: { enum: ['blend', 'more-like-this'] },
  },
  required: ['query', 'artists', 'works', 'ratio', 'mode'],
};

const SYSTEM = `You convert a listener's request into a search plan for YouTube Music.
Fields:
- query: the best YouTube Music song search for what they want.
- artists: composers/performers strongly associated with it (only if you are confident).
- works: the anime, film, game, album or series they named, spelled canonically.
- mood: optional short mood words.
- ratio: "light" if they want a little, "heavy" if a lot/mostly, else "medium".
- mode: "more-like-this" only when they ask for more of what is playing now, else "blend".

Examples:
"violet evergarden" -> {"query":"Violet Evergarden OST","artists":["Evan Call"],"works":["Violet Evergarden"],"mood":"","ratio":"medium","mode":"blend"}
"a bit of ghibli piano" -> {"query":"Studio Ghibli piano","artists":["Joe Hisaishi"],"works":["Studio Ghibli"],"mood":"calm","ratio":"light","mode":"blend"}
"mostly lofi to study" -> {"query":"lofi study beats","artists":[],"works":[],"mood":"focus","ratio":"heavy","mode":"blend"}
"more like this" -> {"query":"","artists":[],"works":[],"mood":"","ratio":"medium","mode":"more-like-this"}`;

let base = null;
let warming = false;

export async function aiStatus() {
  if (typeof LanguageModel === 'undefined') return 'unavailable';
  try {
    return await LanguageModel.availability(OPTS);
  } catch {
    return 'unavailable';
  }
}

export async function parseWithAI(text, context = {}) {
  const status = await aiStatus();
  if (status !== 'available') {
    // Start the one-time model download in the background; this request uses the rules parser.
    if ((status === 'downloadable' || status === 'downloading') && !warming) {
      warming = true;
      LanguageModel.create(OPTS).then((s) => s.destroy(), () => {}).finally(() => (warming = false));
    }
    return null;
  }
  base ??= await LanguageModel.create({ ...OPTS, initialPrompts: [{ role: 'system', content: SYSTEM }] });
  const session = await base.clone();
  try {
    const now = context.current ? `\nNow playing: "${context.current.title}" by ${context.current.artists.join(', ')}.` : '';
    const out = await session.prompt(`Request: "${text}"${now}`, { responseConstraint: SCHEMA });
    return JSON.parse(out);
  } finally {
    session.destroy();
  }
}
