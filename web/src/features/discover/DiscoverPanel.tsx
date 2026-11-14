import { memo, useEffect, useRef, type ReactNode } from 'react';
import { Term } from '../../components/Term.tsx';
import { displayTitle } from '../../lib/manifest.ts';
import { interval, longDate } from '../../lib/time.ts';
import type { Candidate, Manifest, Observation } from '../../types/manifest.ts';
import { StoryArt, StorySigns } from './StoryArt.tsx';

export interface StoryView {
  mode: 'blink' | 'difference';
  epochId: string;
  candId: string | null;
  playing: boolean;
}

export interface Chapter {
  title: string;
  body: ReactNode;
  view: StoryView;
  task: string;
}

const measure = (c: Candidate, name: string) => c.measurements.find((m) => m.name === name);

/** The change the story leads with: worth a follow-up, preferring a lone new source, then the strongest. */
export function storyCandidate(manifest: Manifest): Candidate | null {
  const peak = (c: Candidate) => measure(c, 'peak significance')?.value ?? 0;
  const rank = (c: Candidate) => (c.kind === 'new_source_like' ? 1000 : 0) + peak(c);
  const pool = manifest.candidates.filter((c) => c.status === 'needs_followup');
  return [...pool].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

/** Five chapters, every sentence filled from this field's manifest; nothing is pre-written about the sky. */
export function buildStory(manifest: Manifest, observations: Observation[]): Chapter[] {
  const first = observations[0] as Observation;
  const last = observations.at(-1) ?? first;
  const sim = manifest.data_kind === 'simulated';
  const widthArcmin = (first.image.width_px * first.image.pixel_scale_arcsec) / 60;
  const wl = first.spectral.wavelength_center_um;
  const c = storyCandidate(manifest);
  const seen = c && observations.find((o) => o.observation_id === c.observation_ids[0]);
  const diff = c && manifest.differences.find((d) => d.observation_id === c.observation_ids[0]);
  const flux = c && measure(c, 'aperture flux change');
  const ref = c && measure(c, 'reference flux');
  const peak = c && measure(c, 'peak significance');
  const all = manifest.candidates.length;
  const artifacts = manifest.candidates.filter((x) => x.status === 'likely_artifact').length;
  const base: StoryView = {
    mode: 'blink',
    epochId: first.observation_id,
    candId: null,
    playing: false,
  };
  const source = sim
    ? 'simulated images (not real telescope data)'
    : 'real images from NASA’s archive';

  return [
    {
      title: 'A patch of sky',
      task: 'Inspect the image: find a bright spot, then zoom in and fit the image again.',
      body: (
        <>
          <p>
            This is <strong>{displayTitle(manifest.target.label)}</strong>, a square of sky about{' '}
            {widthArcmin.toFixed(0)} arcminutes across (the full Moon is about 31).
          </p>
          <p>
            You are seeing it in <Term k="infrared">infrared light</Term> through{' '}
            {sim ? <strong>a simulation</strong> : <Term k="spherex">SPHEREx</Term>}. Our eyes
            cannot see infrared, so the picture turns it into shades of grey: whiter means more
            light.
          </p>
          <p>
            Many bright spots are stars or distant galaxies; dark areas show less infrared light,
            not necessarily empty space. Zoom in and the picture breaks into small squares, the{' '}
            <Term k="pixel">pixels</Term>. Drag the image to look around, scroll to zoom.
          </p>
        </>
      ),
      view: base,
    },
    {
      title: 'The same sky, on different dates',
      task: 'Choose a date on the timeline. Look at the same patch of sky each time.',
      body: (
        <>
          <p>
            We have {observations.length} {source} of this spot, taken between{' '}
            <strong>{longDate(first.epoch.mjd_mid)}</strong> and{' '}
            <strong>{longDate(last.epoch.mjd_mid)}</strong>,{' '}
            {interval(last.epoch.mjd_mid - first.epoch.mjd_mid)} apart.
          </p>
          {sim ? (
            <p>
              The simulated dates use different detectors and colours on purpose, so you can see
              PARALLAX refuse comparisons it cannot trust.
            </p>
          ) : (
            <p>
              All of them were taken at the same <Term k="wavelength">wavelength</Term>,{' '}
              {wl.toFixed(2)} µm, on the same detector, so they can be fairly compared. Each mark on
              the timeline below is one date.
            </p>
          )}
        </>
      ),
      view: { ...base, epochId: last.observation_id },
    },
    {
      title: 'Switch between dates',
      task: 'Flip the images: does a spot brighten, disappear, or shift position?',
      body: (
        <>
          <p>
            Use Flip A ↔ B to switch between one date and the typical sky (the middle value of all
            dates at each <Term k="pixel">pixel</Term>), or Play A ↔ B to animate. Astronomers have
            hunted for changes this way for a century; Pluto was found by flipping between two
            photographs.
          </p>
          <p>
            Much of the flicker is <Term k="noise">noise</Term> or an imaging artifact. A brightness
            change may blink in the same place; a moving object may appear at different positions.
            A shift can also mean the images are slightly misaligned. Appearance alone cannot tell
            us the cause.
          </p>
        </>
      ),
      view: { ...base, epochId: seen?.observation_id ?? first.observation_id, playing: true },
    },
    {
      title: 'Highlight what changed',
      task: c
        ? 'Find the selected ring and compare it with the surrounding speckle.'
        : 'Read whether change detection is available. No flagged lead does not prove that nothing changed.',
      body:
        c && seen && peak ? (
          <>
            <p>
              Now the typical sky is <Term k="subtraction">subtracted</Term>. Gold means brighter
              than usual, blue fainter, and dark grey is too uncertain to judge.
            </p>
            <p>
              On <strong>{longDate(seen.epoch.mjd_mid)}</strong>, the ringed spot stood{' '}
              <Term k="confidence">{peak.value.toFixed(1)}σ</Term> above the noise, and nothing that
              strong appears there on the other {observations.length - 1} dates.
            </p>
          </>
        ) : (
          <p>
            {manifest.differences.length === 0
              ? 'Change detection has not been run on this field, so nothing here has been evaluated. That is not the same as “nothing changed”.'
              : 'No spot in this field passed the threshold for a change worth a second look.'}
          </p>
        ),
      view: c
        ? {
            mode: 'difference',
            epochId: c.observation_ids[0] ?? first.observation_id,
            candId: c.candidate_id,
            playing: false,
          }
        : { ...base, mode: manifest.differences.length ? 'difference' : 'blink' },
    },
    {
      title: 'Weigh the evidence',
      task: 'Describe what you see, then check the evidence before suggesting a cause.',
      body:
        c && flux && diff ? (
          <>
            {diff.status === 'validated' ? (
              <p>
                The extra light measures{' '}
                <strong className="mono">
                  {flux.value.toFixed(0)} ± {flux.uncertainty?.toFixed(0)} µJy
                </strong>{' '}
                (<Term k="uncertainty">uncertainty</Term> included)
                {ref?.uncertainty && Math.abs(ref.value) < 3 * ref.uncertainty
                  ? ', at a spot where the typical sky shows nothing measurable'
                  : ''}
                .
              </p>
            ) : (
              <p>
                This date failed the noise <Term k="calibration">calibration</Term> check, so its
                numbers are withheld. Treat the picture as illustration only.
              </p>
            )}
            <p>
              It could be a star flaring, an asteroid passing through, or a cosmic ray hitting the
              detector: from one date, they look alike. It stays <strong>unconfirmed</strong> until
              someone sees it again.
            </p>
            <StorySigns />
            <p className="dim">
              For honesty: {artifacts} of the {all} spots flagged in this field are probably
              artifacts, mostly bright stars that do not subtract cleanly.
            </p>
          </>
        ) : (
          <p>
            With no change to examine, the evidence is the comparison itself: Explore lets you blink
            and fade between any two compatible dates.
          </p>
        ),
      view: c
        ? {
            mode: 'difference',
            epochId: c.observation_ids[0] ?? first.observation_id,
            candId: c.candidate_id,
            playing: false,
          }
        : base,
    },
  ];
}

interface Props {
  chapters: Chapter[];
  index: number;
  onIndex: (i: number) => void;
  onExplore: () => void;
  onAnalyze: () => void;
  hasCandidate: boolean;
}

export const DiscoverPanel = memo(function DiscoverPanel(props: Props) {
  const { chapters, index, onIndex, onExplore, onAnalyze, hasCandidate } = props;
  const ch = chapters[index] ?? chapters[0];
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    // move focus with the story only after the reader acts, never on first render
    if (moved.current && document.activeElement?.closest('.story')) heading.current?.focus();
    moved.current = true;
  }, [index]);
  if (!ch) return null;
  const lastStep = index === chapters.length - 1;
  return (
    <section className="story" aria-labelledby="story-h">
      <ol className="story-steps" aria-label="Investigation steps">
        {chapters.map((x, i) => (
          <li key={x.title}>
            <button
              type="button"
              aria-current={i === index ? 'step' : undefined}
              onClick={() => onIndex(i)}
            >
              <span className="story-num mono">{i + 1}</span>
              <span className="story-step-title">{x.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="story-body" key={index}>
        <div
          className="story-progress"
          role="progressbar"
          aria-label="Story progress"
          aria-valuemin={1}
          aria-valuemax={chapters.length}
          aria-valuenow={index + 1}
          aria-valuetext={`Step ${index + 1} of ${chapters.length}`}
        >
          {chapters.map((x, i) => (
            <span key={x.title} data-done={i <= index || undefined} />
          ))}
        </div>
        <StoryArt index={index} />
        <p className="small dim">Illustration · not observation data</p>
        <h2 id="story-h" ref={heading} tabIndex={-1}>
          {ch.title}
        </h2>
        {ch.body}
      </div>
      <div className="story-nav">
        <button type="button" onClick={() => onIndex(index - 1)} disabled={index === 0}>
          Back
        </button>
        {lastStep ? (
          <>
            <button type="button" className="primary" onClick={onExplore}>
              Explore on your own
            </button>
            {hasCandidate && (
              <button type="button" className="link" onClick={onAnalyze}>
                See every measurement
              </button>
            )}
          </>
        ) : (
          <button type="button" className="primary" onClick={() => onIndex(index + 1)}>
            Next
          </button>
        )}
      </div>
    </section>
  );
});
