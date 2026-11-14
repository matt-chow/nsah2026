import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseManifest } from '../../lib/manifest.ts';
import {
  agrees,
  fairCases,
  findCases,
  finish,
  glitchDeck,
  judgeClick,
  nextCase,
  readProgress,
} from './missions.ts';

const load = (id: string) =>
  parseManifest(
    JSON.parse(
      readFileSync(new URL(`../../../../data/manifests/${id}.json`, import.meta.url), 'utf8'),
    ),
  );
const real = [load('nep-d2'), load('sep-d4')];

test('find cases are real follow-up changes on validated change maps', () => {
  const cases = findCases([...real, load('synthetic-fixture')]);
  assert.ok(cases.length >= 2);
  for (const c of cases) {
    assert.equal(c.field.data_kind, 'real');
    assert.equal(c.candidate.status, 'needs_followup');
    assert.equal(c.diff.status, 'validated');
    assert.equal(c.diff.observation_id, c.observation.observation_id);
  }
});

test('clicks are judged against the published pixel positions', () => {
  const c = findCases(real)[0]!;
  const { pixel_x: x, pixel_y: y } = c.candidate;
  assert.deepEqual(judgeClick(c, x + 2, y - 2), { result: 'hit' });
  assert.equal(judgeClick(c, x + 200, y + 200).result === 'hit', false);
  const other = c.field.candidates.find(
    (k) =>
      k !== c.candidate &&
      k.observation_ids.includes(c.observation.observation_id) &&
      Math.hypot(k.pixel_x - x, k.pixel_y - y) > 10,
  );
  if (other) {
    const j = judgeClick(c, other.pixel_x, other.pixel_y);
    assert.equal(j.result, 'other');
  }
});

test('glitch deck mixes both triage piles and agreement follows the triage', () => {
  const deck = glitchDeck(real);
  assert.equal(deck.length, 6);
  assert.equal(new Set(deck).size, 6);
  assert.ok(deck.some((c) => c.status === 'likely_artifact'));
  assert.ok(deck.some((c) => c.status === 'needs_followup'));
  for (const c of deck) assert.notEqual(agrees('artifact', c), agrees('worth', c));
});

test('fair-comparison cases come from the simulated fixture with their reasons', () => {
  const cases = fairCases(load('synthetic-fixture'));
  assert.equal(cases.length, 3);
  const refused = cases.filter((c) => c.comparison.status === 'incompatible');
  assert.equal(refused.length, 2);
  assert.ok(refused.every((c) => c.comparison.reasons.some((r) => r.includes('detectors'))));
});

test('progress counts finishes, remembers cases and cycles', () => {
  const p = finish(finish(readProgress(null), 'appeared', ['a']), 'appeared', ['b']);
  assert.equal(p.finished.appeared, 2);
  const cases = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(nextCase(cases, p.seen)?.id, 'c');
  assert.equal(nextCase(cases, ['a', 'b', 'c'], 'c')?.id, 'a');
  assert.deepEqual(readProgress({ getItem: () => '{bad', setItem: () => {} }), {
    finished: {},
    seen: [],
  });
});
