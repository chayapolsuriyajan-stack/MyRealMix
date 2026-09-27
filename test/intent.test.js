import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRules, normalizeIntent, buildQueries } from '../src/core/intent.js';

test('bare title becomes the query at medium ratio', () => {
  const i = parseRules('violet evergarden');
  assert.equal(i.query, 'violet evergarden');
  assert.equal(i.ratio, 'medium');
  assert.equal(i.mode, 'blend');
});

test('strips filler and detects light ratio', () => {
  const i = parseRules('I want a little bit of violet evergarden ost please');
  assert.equal(i.query, 'violet evergarden ost');
  assert.equal(i.ratio, 'light');
});

test('detects heavy ratio and "by" artists', () => {
  const i = parseRules('lots of piano songs by Ryuichi Sakamoto and Joe Hisaishi');
  assert.equal(i.ratio, 'heavy');
  assert.deepEqual(i.artists, ['Ryuichi Sakamoto', 'Joe Hisaishi']);
  assert.equal(i.query, 'piano');
});

test('more-like-this mode', () => {
  assert.equal(parseRules('more like this').mode, 'more-like-this');
});

test('keeps non-latin queries', () => {
  assert.equal(parseRules('鸟之诗').query, '鸟之诗');
});

test('normalizeIntent sanitizes AI output', () => {
  const i = normalizeIntent({ ratio: 'extreme', mode: 'nuke', artists: 'Evan Call', works: [' Violet Evergarden ', ''] }, 've');
  assert.equal(i.ratio, 'medium');
  assert.equal(i.mode, 'blend');
  assert.deepEqual(i.artists, []);
  assert.deepEqual(i.works, ['Violet Evergarden']);
  assert.equal(i.query, 've');
});

test('buildQueries puts artist+work first and dedupes', () => {
  const qs = buildQueries(normalizeIntent({ query: 'violet evergarden', artists: ['Evan Call'], works: ['Violet Evergarden'] }));
  assert.deepEqual(qs, ['Evan Call Violet Evergarden', 'violet evergarden', 'Evan Call']);
});
