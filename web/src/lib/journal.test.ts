import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  changeEntry,
  observationEntry,
  readEntries,
  toMarkdown,
  upsert,
  writeEntries,
} from './journal.ts';
import { parseManifest } from './manifest.ts';

const load = (id: string) =>
  parseManifest(
    JSON.parse(
      readFileSync(new URL(`../../../data/manifests/${id}.json`, import.meta.url), 'utf8'),
    ),
  );

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

test('a saved change keeps the pipeline record apart from the reader’s hypothesis', () => {
  const m = load('nep-d2');
  const c = m.candidates.find((x) => x.status === 'needs_followup');
  assert.ok(c);
  const e = changeEntry(m, c);
  assert.equal(e.link, `#nep-d2/${c.candidate_id.split('-').at(-1)}`);
  assert.equal(e.pipeline?.status, 'needs_followup');
  assert.ok(e.sources.every((s) => s.startsWith('https://')));
  const store = memory();
  const mine = upsert([], { ...e, hypothesis: 'a flare?' });
  assert.ok(writeEntries(store, mine));
  // re-saving refreshes the record but never erases what the reader wrote
  const again = upsert(readEntries(store), changeEntry(m, c));
  assert.equal(again.length, 1);
  assert.equal(again[0]?.hypothesis, 'a flare?');
  const md = toMarkdown(again, 'https://example.org/');
  assert.match(md, /My hypothesis \(not verified\):\*\* a flare\?/);
  assert.match(md, /Pipeline record\*\* \(needs_followup/);
  assert.match(md, /Reproduce: `.*build-field nep-d2/);
});

test('simulated entries say so in the export, and bad storage reads as empty', () => {
  const m = load('synthetic-fixture');
  const md = toMarkdown([observationEntry(m, m.observations[0]!)], '');
  assert.match(md, /SIMULATED DATA/);
  assert.deepEqual(readEntries({ getItem: () => '{oops', setItem: () => {} }), []);
  assert.deepEqual(readEntries(null), []);
});
