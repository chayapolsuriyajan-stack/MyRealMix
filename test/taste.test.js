import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTaste, addSignal, scoreTrack, decayed, classifyPlay, shouldTrim, top, HALF_LIFE_MS } from '../src/core/taste.js';

const now = 1_700_000_000_000;

test('likes raise and skips lower an artist score', () => {
  let m = addSignal(emptyTaste(), { artists: ['Evan Call'], kind: 'like' }, now);
  assert.ok(scoreTrack(m, { artists: ['evan call'] }, now) > 0);
  m = addSignal(m, { artists: ['Evan Call'], kind: 'skip' }, now);
  m = addSignal(m, { artists: ['Evan Call'], kind: 'skip' }, now);
  m = addSignal(m, { artists: ['Evan Call'], kind: 'skip' }, now);
  m = addSignal(m, { artists: ['Evan Call'], kind: 'skip' }, now);
  assert.ok(scoreTrack(m, { artists: ['Evan Call'] }, now) < 0);
});

test('weights halve after one half-life', () => {
  const m = addSignal(emptyTaste(), { artists: ['A'], kind: 'like' }, now);
  assert.equal(decayed(m.artists.a, now + HALF_LIFE_MS), 1.5);
});

test('collaborators split credit', () => {
  const m = addSignal(emptyTaste(), { artists: ['A', 'B'], kind: 'like' }, now);
  assert.equal(m.artists.a.w, 1.5);
});

test('does not mutate the input model', () => {
  const m0 = emptyTaste();
  addSignal(m0, { artists: ['A'], kind: 'like' }, now);
  assert.deepEqual(m0, emptyTaste());
});

test('classifyPlay', () => {
  assert.equal(classifyPlay({ played: 200, duration: 240 }), 'complete');
  assert.equal(classifyPlay({ played: 10, duration: 240 }), 'skip');
  assert.equal(classifyPlay({ played: 100, duration: 240 }), null);
  assert.equal(classifyPlay({ played: 5, duration: 20 }), null);
});

test('shouldTrim after repeated dislikes; top lists names', () => {
  let m = addSignal(emptyTaste(), { artists: ['Meh'], kind: 'dislike' }, now);
  assert.ok(shouldTrim(m, { artists: ['Meh'] }, now));
  m = addSignal(m, { artists: ['Evan Call'], kind: 'like' }, now);
  assert.deepEqual(top(m.artists, 5, now).map((e) => e.name), ['Evan Call']);
  assert.deepEqual(top(m.artists, 5, now, -1).map((e) => e.name), ['Meh']);
});
