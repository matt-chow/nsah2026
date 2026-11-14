import { memo } from 'react';

/** Small line drawings for each story step. Illustration only: nothing here is data. */
const ART = [
  // a patch of sky: framed field of stars
  <>
    <rect x="30" y="6" width="60" height="60" className="a-frame" />
    {[
      [42, 20, 1.6],
      [70, 16, 1.2],
      [58, 34, 2.6],
      [80, 44, 1.4],
      [40, 52, 1.8],
      [64, 56, 1.1],
      [50, 26, 1],
    ].map(([x, y, r]) => (
      <circle key={`${x}${y}`} cx={x} cy={y} r={r} className="a-star" />
    ))}
    <path d="M30 14h-5M30 36h-5M30 58h-5M38 66v5M60 66v5M82 66v5" className="a-tick" />
  </>,
  // the same sky on several dates: stacked frames over a time ruler
  <>
    <rect x="42" y="4" width="44" height="44" className="a-frame dim" />
    <rect x="36" y="10" width="44" height="44" className="a-frame dim" />
    <rect x="30" y="16" width="44" height="44" className="a-frame" />
    <circle cx="44" cy="30" r="1.6" className="a-star" />
    <circle cx="60" cy="44" r="2.2" className="a-star" />
    <path d="M14 68h92M24 64v8M58 64v8M66 64v8M98 64v8" className="a-tick" />
  </>,
  // switching between dates: A and B with a flip arrow; the new dot only in B
  <>
    <rect x="10" y="14" width="40" height="40" className="a-frame" />
    <rect x="70" y="14" width="40" height="40" className="a-frame" />
    <circle cx="24" cy="28" r="1.6" className="a-star" />
    <circle cx="84" cy="28" r="1.6" className="a-star" />
    <circle cx="96" cy="42" r="2.4" className="a-gold" />
    <path d="M52 26q8-8 16 0M68 42q-8 8-16 0" className="a-line" />
    <path d="M64 22l4 4-5 2M56 46l-4-4 5-2" className="a-line" />
    <text x="30" y="66" className="a-label">
      A
    </text>
    <text x="90" y="66" className="a-label">
      B
    </text>
  </>,
  // highlight what changed: gold brighter, blue fainter, ring on the lead change
  <>
    <rect x="30" y="6" width="60" height="60" className="a-frame" />
    <circle cx="48" cy="26" r="3" className="a-gold" />
    <circle cx="48" cy="26" r="8" className="a-ring" />
    <circle cx="74" cy="50" r="2.4" className="a-blue" />
    <circle cx="62" cy="40" r="0.8" className="a-star dim" />
    <circle cx="40" cy="54" r="0.8" className="a-star dim" />
  </>,
  // weigh the evidence: measurements with error bars against zero
  <>
    <path d="M14 52h92" className="a-tick dashed" />
    {[
      [26, 50, 8],
      [42, 54, 7],
      [58, 49, 9],
      [90, 51, 8],
    ].map(([x, y, e]) => (
      <g key={x}>
        <path d={`M${x} ${(y ?? 0) - (e ?? 0)}v${(e ?? 0) * 2}`} className="a-line" />
        <circle cx={x} cy={y} r="2" className="a-star" />
      </g>
    ))}
    <path d="M74 12v16" className="a-line gold" />
    <rect x="71" y="17" width="6" height="6" className="a-gold" />
  </>,
];

export const StoryArt = memo(function StoryArt({ index }: { index: number }) {
  return (
    <svg className="story-art" viewBox="0 0 120 74" aria-hidden="true">
      {ART[index] ?? ART[0]}
    </svg>
  );
});

const SIGNS = [
  {
    name: 'Brighter',
    text: 'More light in the same place: a gold spot in the change map.',
    art: (
      <>
        <circle cx="16" cy="20" r="2" className="a-star" />
        <path d="M24 20h10M31 17l3 3-3 3" className="a-line" />
        <circle cx="46" cy="20" r="5" className="a-gold" />
      </>
    ),
  },
  {
    name: 'Moved',
    text: 'An asteroid is a gold spot in a different place on each date.',
    art: (
      <>
        <circle cx="12" cy="30" r="3" className="a-gold" />
        <circle cx="30" cy="21" r="3" className="a-gold dim" />
        <circle cx="48" cy="12" r="3" className="a-gold dim" />
        <path d="M16 28l10-5M34 19l10-5" className="a-line dashed" />
      </>
    ),
  },
  {
    name: 'Artifact',
    text: 'Residue round a bright star, or one hot pixel: the instrument, not the sky.',
    art: (
      <>
        <path d="M22 13a7 7 0 0 1 0 14" className="a-arc gold" />
        <path d="M22 27a7 7 0 0 1 0-14" className="a-arc blue" />
        <circle cx="22" cy="20" r="2.2" className="a-star" />
        <rect x="42" y="18" width="4" height="4" className="a-star" />
      </>
    ),
  },
  {
    name: 'Uncertainty',
    text: 'The bar is the likely error. If it reaches zero, the change may be nothing.',
    art: (
      <>
        <path d="M8 28h48" className="a-tick dashed" />
        <path d="M20 16v16" className="a-line" />
        <circle cx="20" cy="24" r="2" className="a-star" />
        <path d="M42 6v12" className="a-line gold" />
        <rect x="39" y="9" width="6" height="6" className="a-gold" />
      </>
    ),
  },
];

/** What different kinds of change look like, drawn rather than described. */
export function StorySigns() {
  return (
    <figure className="story-signs">
      <figcaption>What a flagged spot can turn out to be (drawings, not data)</figcaption>
      <ul>
        {SIGNS.map((s) => (
          <li key={s.name}>
            <svg viewBox="0 0 64 40" aria-hidden="true">
              {s.art}
            </svg>
            <strong>{s.name}</strong>
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
