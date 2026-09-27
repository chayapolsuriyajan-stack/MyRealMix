import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBlend, merge, dedupe, rankCandidates, normTitle, relevance } from '../src/core/blend.js';

const t = (id, title, artists = ['X'], album = '') => ({ videoId: id, title, artists, album });
const upcoming = Array.from({ length: 12 }, (_, i) => t(`u${i}`, `Up ${i}`, [`A${i}`]));
const cands = Array.from({ length: 10 }, (_, i) => t(`c${i}`, `Cand ${i}`, ['Evan Call']));
const noJitter = () => 0.5; // floor(0.5*3)-1 = 0

test('medium ratio inserts one track after every two originals, starting after the next song', () => {
  const plan = planBlend({ upcoming, candidates: cands, ratio: 'medium', maxInserts: 10, rng: noJitter });
  assert.deepEqual(plan.map((p) => p.at), [1, 3, 5, 7, 9, 11]); // cap is floor(12*.4/.6)=8, so positions run out first
});

test('light and heavy spacing', () => {
  assert.deepEqual(planBlend({ upcoming, candidates: cands, ratio: 'light', rng: noJitter }).map((p) => p.at), [1, 4, 7, 10]);
  assert.deepEqual(planBlend({ upcoming, candidates: cands, ratio: 'heavy', rng: noJitter }).map((p) => p.at), [1, 2, 3, 4, 5]);
});

test('never places two blended tracks adjacent, even with jitter', () => {
  for (const r of [0, 0.34, 0.99]) {
    const plan = planBlend({ upcoming, candidates: cands, ratio: 'medium', maxInserts: 10, rng: () => r });
    const merged = merge(upcoming, plan);
    for (let i = 1; i < merged.length; i++) assert.ok(!(merged[i].blended && merged[i - 1].blended));
  }
});

test('respects the share cap on short queues', () => {
  const plan = planBlend({ upcoming: upcoming.slice(0, 3), candidates: cands, ratio: 'heavy' });
  assert.equal(plan.length, 2); // floor(3*.4/.6)=2
});

test('avoids same artist next to an original track when possible', () => {
  const up = [t('a', 'A', ['Evan Call']), t('b', 'B', ['Other'])];
  const plan = planBlend({ upcoming: up, candidates: [t('c1', 'C1', ['Evan Call']), t('c2', 'C2', ['Kensuke'])], maxInserts: 1 });
  assert.equal(plan[0].track.videoId, 'c2');
});

test('merge puts tracks at the planned positions', () => {
  const m = merge(upcoming.slice(0, 3), [{ at: 1, track: cands[0] }, { at: 3, track: cands[1] }]);
  assert.deepEqual(m.map((x) => x.videoId), ['u0', 'c0', 'u1', 'u2', 'c1']);
});

test('dedupe drops queue duplicates and alternate versions', () => {
  const out = dedupe(
    [t('1', 'Violet Snow'), t('2', 'Violet Snow (Piano Ver.)'), t('3', 'Never Coming Back'), t('q', 'whatever')],
    [t('q', 'In The Pool')],
    [t('9', 'Never Coming Back - Remastered')],
  );
  assert.deepEqual(out.map((x) => x.videoId), ['1']);
});

test('normTitle strips version noise but keeps non-latin text', () => {
  assert.equal(normTitle('Violet Snow (Piano ver.)'), 'violet snow');
  assert.equal(normTitle('鸟之诗(钢琴版)'), '鸟之诗');
  assert.equal(normTitle('Song - 2019 Remaster'), 'song');
});

test('ranking prefers the requested work over the same artist\'s other OST', () => {
  const intent = { query: 'violet evergarden', works: ['Violet Evergarden'], artists: ['Evan Call'] };
  const frieren = t('f', 'Hero of the South', ['Evan Call'], "Frieren: Beyond Journey's End OST");
  const ve = t('v', 'Always With You', ['Evan Call'], 'Violet Evergarden Original Soundtrack');
  assert.ok(relevance(ve, intent) > relevance(frieren, intent));
  const ranked = rankCandidates([frieren, ve, t('v2', 'Violet Evergarden Theme', ['Evan Call']), t('v3', 'x', [], 'Violet Evergarden OST')], intent);
  assert.ok(!ranked.includes(frieren));
});
