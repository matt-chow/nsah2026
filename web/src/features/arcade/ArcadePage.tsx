import { useEffect, useMemo, useState } from 'react';
import type { PageProps } from '../../app/App.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SkyCanvas, type Layer } from '../../components/SkyCanvas.tsx';
import { KIND, STATUS_LABEL } from '../candidates/CandidatesPanel.tsx';
import { LightCurve } from '../candidates/LightCurve.tsx';
import { journal } from '../journal/store.ts';
import { changeEntry, upsert } from '../../lib/journal.ts';
import { loadManifest } from '../../lib/manifest.ts';
import { tanWcs } from '../../lib/sky.ts';
import { longDate } from '../../lib/time.ts';
import type { Candidate, Manifest } from '../../types/manifest.ts';
import {
  agrees,
  fairCases,
  findCases,
  finish,
  glitchDeck,
  judgeClick,
  nextCase,
  readProgress,
  writeProgress,
  type FairCase,
  type FindCase,
  type Guess,
  type MissionId,
  type Progress,
} from './missions.ts';
import '../../styles/pages.css';

const BASE = import.meta.env.BASE_URL;
const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const measure = (c: Candidate, name: string) => c.measurements.find((m) => m.name === name);
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));
const shortId = (c: Candidate) => c.candidate_id.split('-').at(-1) ?? c.candidate_id;

const MISSIONS: { id: MissionId; title: string; text: string; data: 'real' | 'simulated' }[] = [
  {
    id: 'appeared',
    title: 'The one that appeared',
    text: 'Find a spot of light that was not there before, weigh the evidence, and decide what you would tell an astronomer.',
    data: 'real',
  },
  {
    id: 'glitch',
    title: 'Glitch or genuine?',
    text: 'Six marked changes, one at a time. Read the clues and sort detector glitches from changes worth a second look.',
    data: 'real',
  },
  {
    id: 'fair',
    title: 'Fair comparison?',
    text: 'Before comparing two images, check they were taken the same way. Spot the pairs that would mislead you.',
    data: 'simulated',
  },
];

const STEPS = ['Observe', 'Compare', 'Identify', 'Evaluate', 'Conclude'] as const;

export function ArcadePage({ fields }: PageProps) {
  const [manifests, setManifests] = useState<Manifest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mission, setMission] = useState<MissionId | null>(null);
  const [progress, setProgress] = useState<Progress>(() => readProgress(storage()));

  useEffect(() => {
    if (!fields) return;
    const ctrl = new AbortController();
    Promise.all(fields.map((f) => loadManifest(`${BASE}${f.path}`, ctrl.signal))).then(
      setManifests,
      (e: unknown) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => ctrl.abort();
  }, [fields]);

  const done = (id: MissionId, caseIds: string[]) => {
    const p = finish(progress, id, caseIds);
    setProgress(p);
    writeProgress(storage(), p);
  };

  const real = useMemo(() => manifests?.filter((m) => m.data_kind === 'real') ?? [], [manifests]);
  const sim = manifests?.find((m) => m.data_kind === 'simulated');

  if (mission && manifests) {
    const exit = () => setMission(null);
    return (
      <main className="page arcade-page">
        <button type="button" className="back-link" onClick={exit}>
          <Icon name="back" /> All investigations
        </button>
        {mission === 'appeared' && (
          <Appeared cases={findCases(real)} progress={progress} onDone={done} onExit={exit} />
        )}
        {mission === 'glitch' && <Glitch deck={glitchDeck(real)} onDone={done} onExit={exit} />}
        {mission === 'fair' && sim && (
          <Fair cases={fairCases(sim)} notice={sim.notice} onDone={done} onExit={exit} />
        )}
      </main>
    );
  }

  return (
    <main className="page arcade-page">
      <header className="page-head">
        <h1>Discovery Arcade</h1>
        <p className="lede">
          Short investigations built from the same images and measurements as the observatory. You
          work through each one like an astronomer would: observe, compare, identify, evaluate,
          conclude. There are no points. Feedback tells you whether the pipeline&apos;s automatic
          triage agrees with you, and the triage is not the final word either.
        </p>
      </header>
      {error && (
        <p className="warn" role="alert">
          The investigations could not load: {error}
        </p>
      )}
      <ul className="mission-grid">
        {MISSIONS.map((m, i) => (
          <li key={m.id} className="mission panel">
            <span className="mission-num mono" aria-hidden="true">
              0{i + 1}
            </span>
            <h2>{m.title}</h2>
            <p className="dim">{m.text}</p>
            <p className="mission-meta small">
              {m.data === 'real' ? (
                <span className="data-tag">Real SPHEREx data</span>
              ) : (
                <span className="sim-tag">Simulated exercise</span>
              )}
              {progress.finished[m.id] ? (
                <span className="dim">
                  <Icon name="check" /> Finished {progress.finished[m.id]}×
                </span>
              ) : null}
            </p>
            <button
              type="button"
              className="primary"
              disabled={!manifests}
              onClick={() => setMission(m.id)}
            >
              {manifests ? (progress.finished[m.id] ? 'Play again' : 'Start') : 'Loading…'}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** The closing moment: one drawn check mark, static under reduced motion. */
function Complete({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="complete panel" aria-live="polite">
      <svg viewBox="0 0 48 48" className="complete-mark" aria-hidden="true">
        <circle cx="24" cy="24" r="21" />
        <path d="M14 25l7 7 13-15" />
      </svg>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="stepper" aria-label="Investigation steps">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === step ? 'step' : undefined} data-done={i < step}>
          <span className="mono">{i + 1}</span> {s}
        </li>
      ))}
    </ol>
  );
}

interface AppearedProps {
  cases: FindCase[];
  progress: Progress;
  onDone: (id: MissionId, caseIds: string[]) => void;
  onExit: () => void;
}

const CONCLUSIONS = [
  { id: 'followup', text: 'A real change: worth asking for follow-up observations' },
  { id: 'glitch', text: 'Probably a glitch in the detector' },
  { id: 'unsure', text: 'Cannot tell yet: it needs a second detection' },
] as const;

function Appeared({ cases, progress, onDone, onExit }: AppearedProps) {
  const [current, setCurrent] = useState(() => nextCase(cases, progress.seen));
  const [step, setStep] = useState(0);
  const [flip, setFlip] = useState(false);
  const [found, setFound] = useState(false);
  const [misses, setMisses] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [count, setCount] = useState<'one' | 'many' | null>(null);
  const [conclusion, setConclusion] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [focus, setFocus] = useState<{ x: number; y: number; nonce: number } | null>(null);

  if (!current)
    return <p className="dim">No real changes with a validated change map are available.</p>;
  const { field: m, candidate: c, observation: o, diff } = current;
  const date = longDate(o.epoch.mjd_mid);
  const seenOn = c.observation_ids.length;
  const peak = measure(c, 'peak significance');
  const flux = measure(c, 'aperture flux change');
  const ref = measure(c, 'reference flux');

  const layer: Layer =
    step === 0 || (step === 1 && !flip)
      ? { kind: 'image', src: `${BASE}${o.assets.display_png}` }
      : step === 1
        ? { kind: 'image', src: `${BASE}${m.template?.display_png ?? ''}` }
        : {
            kind: 'difference',
            src: `${BASE}${diff.display_png}`,
            range: diff.display_range_sigma,
          };

  const reveal = () => {
    setFound(true);
    setFocus({ x: c.pixel_x, y: c.pixel_y, nonce: Date.now() });
  };

  const onPoint = (x: number, y: number) => {
    if (step !== 2 || found) return;
    const j = judgeClick(current, x, y);
    if (j.result === 'hit') {
      reveal();
      setFeedback(
        `Found it. A ${peak && peak.value > 0 ? 'brightening' : 'change'} of ${peak ? fmt(peak.value) : '?'}σ at this spot on ${date}.`,
      );
      return;
    }
    setMisses((n) => n + 1);
    if (j.result === 'other')
      setFeedback(
        `That is a different marked change (change ${shortId(j.candidate)}, triaged "${STATUS_LABEL[j.candidate.status].toLowerCase()}"). Keep looking for the strongest spot that stands alone.`,
      );
    else
      setFeedback(
        misses === 0
          ? 'Nothing marked there. Orange means brighter than usual, blue fainter; grey is unchanged. Zoom in to look closely.'
          : 'Not there either. Look for a compact orange spot; you can also ask to be shown.',
      );
  };

  const restart = () => {
    const next = nextCase(cases, [...progress.seen, current.id], current.id);
    setCurrent(next);
    setStep(0);
    setFlip(false);
    setFound(false);
    setMisses(0);
    setFeedback('');
    setCount(null);
    setConclusion(null);
    setSaved(false);
    setFocus(null);
  };

  const outcome = CONCLUSIONS.find((k) => k.id === conclusion)?.text ?? null;
  const save = () => {
    journal.set(
      upsert(journal.get(), {
        ...changeEntry(m, c),
        id: `arcade:${c.candidate_id}`,
        kind: 'mission',
        title: `Investigation: change ${shortId(c)} in ${m.target.label}`,
        outcome,
      }),
    );
    setSaved(true);
  };

  return (
    <article className="investigation">
      <header className="page-head">
        <h1>The one that appeared</h1>
        <p className="lede">
          {m.target.label}, {o.spectral.wavelength_center_um.toFixed(2)} µm.{' '}
          <span className="data-tag">Real SPHEREx data</span>
        </p>
      </header>
      <Stepper step={step} />

      <div className="investigation-layout">
        <div className="investigation-view">
          <SkyCanvas
            layer={layer}
            label={`${STEPS[step]} step. ${step < 2 ? 'Sky image' : 'Change map'} of ${m.target.label}.`}
            width={o.image.width_px}
            height={o.image.height_px}
            wcs={tanWcs(o.image.wcs)}
            candidates={found ? [c] : []}
            activeEpochId={o.observation_id}
            selectedId={found ? c.candidate_id : null}
            onPick={() => {}}
            pin={null}
            focus={focus}
            pixelScale={o.image.pixel_scale_arcsec}
            stretch="archive"
            loupe={false}
            onPoint={onPoint}
          />
          <p className="small dim view-note">
            {step === 1
              ? flip
                ? 'Showing the typical sky: the median of all dates.'
                : `Showing ${date}.`
              : step >= 2
                ? 'Change map: orange is brighter than the typical sky, blue fainter, grey unchanged.'
                : `Showing ${date}. Drag to pan, scroll to zoom.`}
          </p>
        </div>

        <section className="task panel" aria-live="polite">
          {step === 0 && (
            <>
              <h2>Observe</h2>
              <p>
                This is one infrared photograph from {date}. Each dot is a star or a distant galaxy,
                shown as brightness only. Take a look around before comparing.
              </p>
              <button type="button" className="primary" onClick={() => setStep(1)}>
                Next: compare <Icon name="arrow" />
              </button>
            </>
          )}
          {step === 1 && (
            <>
              <h2>Compare</h2>
              <p>
                Flip between this date and the typical sky built from all {m.observations.length}{' '}
                dates. Astronomers call this blinking. Something here is different.
              </p>
              <button type="button" aria-pressed={flip} onClick={() => setFlip((f) => !f)}>
                {flip ? `Show ${date}` : 'Show the typical sky'}
              </button>
              <button type="button" className="primary" onClick={() => setStep(2)}>
                Next: identify <Icon name="arrow" />
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <h2>Identify</h2>
              <p>
                The change map subtracts the typical sky from {date}, so only differences remain.
                Click the spot that appeared. Keyboard: pan with the arrows, press Enter on the
                centre of the view.
              </p>
              {feedback && (
                <p className="feedback" data-ok={found}>
                  {feedback}
                </p>
              )}
              {!found && misses >= 2 && (
                <button type="button" onClick={reveal}>
                  <Icon name="hint" /> Show me
                </button>
              )}
              {found && (
                <button type="button" className="primary" onClick={() => setStep(3)}>
                  Next: evaluate <Icon name="arrow" />
                </button>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <h2>Evaluate</h2>
              <dl className="facts">
                <dt>Looks like</dt>
                <dd>{KIND[c.kind].label}</dd>
                {peak && (
                  <>
                    <dt>Strength</dt>
                    <dd className="mono">{fmt(peak.value)}σ above the noise</dd>
                  </>
                )}
                {flux && (
                  <>
                    <dt>Extra light</dt>
                    <dd className="mono">
                      {fmt(flux.value)}
                      {flux.uncertainty != null && ` ± ${fmt(flux.uncertainty)}`} {flux.unit}
                    </dd>
                  </>
                )}
                {ref && (
                  <>
                    <dt>Usually here</dt>
                    <dd className="mono">
                      {fmt(ref.value)}
                      {ref.uncertainty != null && ` ± ${fmt(ref.uncertainty)}`} {ref.unit}
                    </dd>
                  </>
                )}
              </dl>
              <p>
                <strong>On how many of the {m.observations.length} dates does it show up?</strong>
              </p>
              <div className="choices">
                {(['one', 'many'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={count === k}
                    onClick={() => setCount(k)}
                  >
                    {k === 'one' ? 'Only this one' : 'More than one'}
                  </button>
                ))}
              </div>
              {count && (
                <>
                  <p className="feedback" data-ok={(count === 'one') === (seenOn === 1)}>
                    {(count === 'one') === (seenOn === 1) ? 'Yes. ' : 'Look again. '}
                    The pipeline detected it on {seenOn} date{seenOn > 1 ? 's' : ''}. The chart
                    shows the brightness at this spot on every date, with error bars.
                  </p>
                  <div className="lightcurve">
                    <LightCurve
                      candidate={c}
                      activeEpochId={o.observation_id}
                      onSelectEpoch={() => {}}
                    />
                  </div>
                  <button type="button" className="primary" onClick={() => setStep(4)}>
                    Next: conclude <Icon name="arrow" />
                  </button>
                </>
              )}
            </>
          )}
          {step === 4 && !conclusion && (
            <>
              <h2>Conclude</h2>
              <p>What would you tell an astronomer?</p>
              <div className="choices column">
                {CONCLUSIONS.map((k) => (
                  <button key={k.id} type="button" onClick={() => setConclusion(k.id)}>
                    {k.text}
                  </button>
                ))}
              </div>
            </>
          )}
          {step === 4 && conclusion && (
            <Complete title="Investigation complete">
              <dl className="facts">
                <dt>You said</dt>
                <dd>{outcome}</dd>
                <dt>Pipeline triage</dt>
                <dd>
                  {STATUS_LABEL[c.status]} <span className="dim">(automatic, unconfirmed)</span>
                </dd>
              </dl>
              <p className="dim small">
                {seenOn === 1
                  ? 'Seen on one date only. A cosmic-ray hit, a detector event and a real flash or a passing asteroid can all look like this. Astronomers would need a second detection before calling it real, so "cannot tell yet" is a perfectly scientific answer.'
                  : 'Seen on more than one date, which makes a one-off glitch less likely. It still has to be checked against catalogues and other telescopes.'}
              </p>
              <div className="choices">
                <button type="button" onClick={save} disabled={saved}>
                  <Icon name={saved ? 'bookmarked' : 'bookmark'} />{' '}
                  {saved ? 'In your journal' : 'Save to journal'}
                </button>
                <a className="button-link" href={`#${m.manifest_id}/${shortId(c)}`}>
                  <Icon name="open" /> Open in the observatory
                </a>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    onDone('appeared', [current.id]);
                    restart();
                  }}
                >
                  Another case <Icon name="arrow" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDone('appeared', [current.id]);
                    onExit();
                  }}
                >
                  Finish
                </button>
              </div>
            </Complete>
          )}
        </section>
      </div>
    </article>
  );
}

interface GlitchProps {
  deck: Candidate[];
  onDone: (id: MissionId, caseIds: string[]) => void;
  onExit: () => void;
}

function Glitch({ deck, onDone, onExit }: GlitchProps) {
  const [i, setI] = useState(0);
  const [guess, setGuess] = useState<Guess | null>(null);
  const [agreed, setAgreed] = useState(0);
  const c = deck[i];

  if (!c)
    return (
      <Complete title="All six sorted">
        <p>
          You and the pipeline&apos;s triage agreed on {agreed} of {deck.length}. The triage follows
          simple rules (flagged pixels, single-pixel spikes, weak signals), so where you disagreed,
          your reasoning may well be worth a closer look.
        </p>
        <div className="choices">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setI(0);
              setAgreed(0);
              setGuess(null);
            }}
          >
            Sort them again
          </button>
          <button type="button" onClick={onExit}>
            Finish
          </button>
        </div>
      </Complete>
    );

  const peak = measure(c, 'peak significance');
  const area = measure(c, 'area above 3 sigma');
  const ok = guess != null && agrees(guess, c);

  return (
    <article className="investigation">
      <header className="page-head">
        <h1>Glitch or genuine?</h1>
        <p className="lede">
          Case {i + 1} of {deck.length}. <span className="data-tag">Real SPHEREx data</span>
        </p>
      </header>
      <div className="clue-layout">
        <section className="panel">
          <h2>The clues</h2>
          <dl className="facts">
            {peak && (
              <>
                <dt>Strength</dt>
                <dd className="mono">{fmt(peak.value)}σ</dd>
              </>
            )}
            {area && (
              <>
                <dt>Size</dt>
                <dd className="mono">
                  {fmt(area.value)} {area.unit}
                </dd>
              </>
            )}
            <dt>Dates seen</dt>
            <dd className="mono">{c.observation_ids.length}</dd>
          </dl>
          <ul className="clues small">
            {c.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </section>
        <section className="panel task" aria-live="polite">
          {!guess ? (
            <>
              <h2>Your call</h2>
              <p className="dim small">
                Hints: flagged pixels and single-pixel spikes point to the detector; strong, compact
                signals a few pixels wide point to the sky.
              </p>
              <div className="choices column">
                <button type="button" onClick={() => setGuess('artifact')}>
                  Probably a glitch
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGuess('worth');
                  }}
                >
                  Worth a second look
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="feedback" data-ok={ok}>
                {ok ? 'The pipeline’s triage agrees with you.' : 'The pipeline’s triage differs.'}{' '}
                It filed this as <strong>{STATUS_LABEL[c.status].toLowerCase()}</strong>:{' '}
                {KIND[c.kind].plain}
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (ok) setAgreed((n) => n + 1);
                  setGuess(null);
                  if (i + 1 === deck.length)
                    onDone(
                      'glitch',
                      deck.map((d) => d.candidate_id),
                    );
                  setI(i + 1);
                }}
              >
                {i + 1 === deck.length ? 'See the summary' : 'Next case'} <Icon name="arrow" />
              </button>
            </>
          )}
        </section>
      </div>
    </article>
  );
}

interface FairProps {
  cases: FairCase[];
  notice: string | null;
  onDone: (id: MissionId, caseIds: string[]) => void;
  onExit: () => void;
}

function Fair({ cases, notice, onDone, onExit }: FairProps) {
  const [i, setI] = useState(0);
  const [guess, setGuess] = useState<boolean | null>(null);
  const k = cases[i];

  if (!k)
    return (
      <Complete title="Every pair checked">
        <p>
          A fair comparison needs the same detector, the same wavelength, the same units and
          calibration, and the same pixel size. PARALLAX checks all of these before it lets you
          compare two real images, and refuses with its reasons when they differ.
        </p>
        <div className="choices">
          <button type="button" className="primary" onClick={() => setI(0)}>
            Check them again
          </button>
          <button type="button" onClick={onExit}>
            Finish
          </button>
        </div>
      </Complete>
    );

  const fair = k.comparison.status === 'compatible';
  const rows: [string, (o: FairCase['a']) => string][] = [
    ['Detector', (o) => String(o.spectral.detector ?? 'unknown')],
    ['Wavelength', (o) => `${o.spectral.wavelength_center_um.toFixed(3)} µm`],
    ['Units', (o) => o.image.units],
    ['Calibration', (o) => o.provenance.calibration_version ?? 'unknown'],
    ['Pixel size', (o) => `${o.image.pixel_scale_arcsec}″`],
  ];

  return (
    <article className="investigation">
      <header className="page-head">
        <h1>Fair comparison?</h1>
        <p className="lede">
          Pair {i + 1} of {cases.length}. <span className="sim-tag">Simulated exercise</span>
        </p>
        <p className="small dim">{notice}</p>
      </header>
      <div className="clue-layout">
        <section className="panel">
          <table className="pair-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Property</span>
                </th>
                <th scope="col">Image A</th>
                <th scope="col">Image B</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, get]) => (
                <tr key={name} data-differs={get(k.a) !== get(k.b)}>
                  <th scope="row">{name}</th>
                  <td className="mono">{get(k.a)}</td>
                  <td className="mono">{get(k.b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel task" aria-live="polite">
          {guess === null ? (
            <>
              <h2>Can these two be compared pixel by pixel?</h2>
              <div className="choices">
                <button type="button" onClick={() => setGuess(true)}>
                  Yes, it is fair
                </button>
                <button type="button" onClick={() => setGuess(false)}>
                  No, it would mislead
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="feedback" data-ok={guess === fair}>
                {guess === fair ? 'Agreed with the compatibility check. ' : 'Look again. '}
                {fair
                  ? 'Everything matches within tolerance, so differences would be real changes.'
                  : `The check refuses this pair: ${k.comparison.reasons.join('; ')}. Different filters see different light, so the images would differ even if nothing changed.`}
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setGuess(null);
                  if (i + 1 === cases.length)
                    onDone(
                      'fair',
                      cases.map((c) => `${c.a.observation_id}|${c.b.observation_id}`),
                    );
                  setI(i + 1);
                }}
              >
                {i + 1 === cases.length ? 'Finish' : 'Next pair'} <Icon name="arrow" />
              </button>
            </>
          )}
        </section>
      </div>
    </article>
  );
}
