import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { checkPair, type PairCheck } from '../lib/compare.ts';
import { parseManifest } from '../lib/manifest.ts';

// Node strips TypeScript but not JSX; use the project's compiler for component render checks.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    return {
      format: 'module',
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
  },
});

const { Timeline } = await import('../features/timeline/Timeline.tsx');
const { AnalyzePanel } = await import('../features/analysis/AnalyzePanel.tsx');
const { buildStory } = await import('../features/discover/DiscoverPanel.tsx');
const load = (id: string) =>
  parseManifest(
    JSON.parse(
      readFileSync(new URL(`../../../data/manifests/${id}.json`, import.meta.url), 'utf8'),
    ),
  );
const noop = () => {};

test('timeline distinguishes A, B and pipeline-refused dates without disabling inspection', () => {
  const m = load('synthetic-fixture');
  const a = m.observations[0]!;
  const b = m.observations[2]!;
  const html = renderToStaticMarkup(
    createElement(Timeline, {
      observations: m.observations,
      differences: new Map(),
      selectedId: a.observation_id,
      referenceId: b.observation_id,
      comparingDates: true,
      onSelect: noop,
      onReferenceSelect: noop,
      highlight: new Set([b.observation_id]),
      quiet: false,
      getCompatibility: (id, role) =>
        checkPair(m, role === 'A' ? b.observation_id : a.observation_id, id),
    }),
  );
  assert.match(html, /observation A/);
  assert.match(html, /reference B/);
  assert.match(html, /comparison incompatible/);
  assert.match(html, /selected change detected/);
  assert.match(html, /data-unavailable="true"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('a combined template is labelled without assigning it a fabricated date B', () => {
  const m = load('nep-d2');
  const html = renderToStaticMarkup(
    createElement(Timeline, {
      observations: m.observations,
      differences: new Map(),
      selectedId: m.observations[0]!.observation_id,
      referenceId: null,
      comparingDates: true,
      onSelect: noop,
      onReferenceSelect: noop,
      highlight: new Set<string>(),
      quiet: true,
      getCompatibility: (): PairCheck => ({ status: 'compatible' }),
    }),
  );
  assert.match(html, /combined typical sky/);
  assert.doesNotMatch(html, /data-b="true"/);
  assert.match(html, /aria-live="off"/);
});

test('Analyze keeps refused reasons, calibration rows and provenance in the inspector', () => {
  const m = load('synthetic-fixture');
  const a = m.observations[0]!;
  const b = m.observations[2]!;
  const pair = checkPair(m, a.observation_id, b.observation_id);
  const html = renderToStaticMarkup(
    createElement(AnalyzePanel, {
      manifest: m,
      observations: m.observations,
      differences: new Map(),
      epoch: a,
      refName: b.observation_id,
      pair,
      onSelectEpoch: noop,
    }),
  );
  assert.match(html, /incompatible/);
  assert.ok('reasons' in pair && pair.reasons.every((reason) => html.includes(reason)));
  assert.match(html, /Per-date calibration &amp; noise checks/);
  assert.match(html, /metadata and provenance/);
  assert.equal((html.match(/<tr/g) ?? []).length, m.observations.length + 1);
});

test('every story has five tasks and never asks for a nonexistent selected ring', () => {
  for (const id of ['nep-d2', 'sep-d4', 'synthetic-fixture']) {
    const m = load(id);
    const chapters = buildStory(m, m.observations);
    assert.equal(chapters.length, 5);
    assert.ok(chapters.every((chapter) => chapter.task.length > 0));
    if (m.candidates.length === 0) assert.doesNotMatch(chapters[3]!.task, /selected ring/);
  }
});

test('a change map keeps the pipeline reference and does not show unrelated pair verdicts', () => {
  const m = load('nep-d2');
  const html = renderToStaticMarkup(
    createElement(Timeline, {
      observations: m.observations,
      differences: new Map(
        m.differences.map((difference) => [difference.observation_id, difference]),
      ),
      selectedId: m.observations[0]!.observation_id,
      referenceId: null,
      comparingDates: false,
      onSelect: noop,
      onReferenceSelect: noop,
      highlight: new Set<string>(),
      quiet: false,
      getCompatibility: () => {
        throw new Error('Pair checks do not describe a change map');
      },
    }),
  );
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /data-b="true"|data-unavailable="true"/);
  assert.match(html, /change map: validated/);
});
