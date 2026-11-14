import { memo } from 'react';
import { Glyph } from '../features/candidates/CandidatesPanel.tsx';
import { Term } from '../components/Term.tsx';

interface Props {
  mode: 'blink' | 'overlay' | 'split' | 'difference';
  comparable: boolean;
  simulated: boolean;
  pixelScale: number;
  dates: number;
  markers: boolean;
}

/** A plain-language key to whatever is on screen, rewritten for each view. */
export const ViewGuide = memo(function ViewGuide(props: Props) {
  const { mode, comparable, simulated, pixelScale, dates, markers } = props;
  return (
    <details className="guide" open>
      <summary>What am I looking at?</summary>
      <div className="guide-body">
        {mode === 'difference' ? (
          <>
            <p>
              <strong>This is not a photograph.</strong> It is a map of <em>change</em>: one date
              with the typical sky <Term k="subtraction">subtracted</Term> from it. Anything that
              stayed the same cancels out.
            </p>
            <ul>
              <li>
                <span className="swatch" data-c="none" /> Near-black: no change, the usual case.
              </li>
              <li>
                <span className="swatch" data-c="gold" /> Gold: brighter than usual on this date.
              </li>
              <li>
                <span className="swatch" data-c="blue" /> Blue: fainter than usual.
              </li>
              <li>
                <span className="swatch" data-c="grey" /> Flat grey: a bad or edge pixel the
                pipeline would not judge.
              </li>
            </ul>
            <p>
              A speckle of faint gold and blue everywhere is <Term k="noise">noise</Term>, and that
              is expected. Gold-and-blue pairs on bright stars usually mean the star landed on the
              pixels slightly differently, not that it changed. A real change looks like a single
              round spot that is strong compared to the speckle.
            </p>
          </>
        ) : (
          <>
            <p>
              <strong>
                This is a photograph in {simulated ? 'simulated ' : ''}infrared light.
              </strong>{' '}
              Our eyes cannot see <Term k="infrared">infrared</Term>, so brightness is shown as
              shades of grey: the more light, the whiter.
            </p>
            <ul>
              <li>White dots: stars in our galaxy, or distant galaxies.</li>
              <li>Larger fuzzy blobs: usually galaxies or very bright stars.</li>
              <li>Black: empty sky, with a little grainy noise.</li>
              <li>
                Each small square is one <Term k="pixel">pixel</Term>, {pixelScale.toFixed(2)}{' '}
                arcseconds wide. Zoom in and you will see stars are only a few pixels across.
              </li>
            </ul>
            {!comparable ? (
              <p>
                Only one date is shown because the two you picked cannot be compared fairly. The
                warning below says why.
              </p>
            ) : mode === 'blink' ? (
              <p>
                <strong>Switch dates</strong> flips between image A and image B, like a cartoon
                flipbook. Your eye is very good at spotting anything that jumps, appears or
                vanishes. Most stars should sit perfectly still.
              </p>
            ) : mode === 'overlay' ? (
              <p>
                <strong>Fade</strong> lays image B over image A. Move the B slider: at 0% you see
                only A, at 100% only B. A star that fades in or out as you slide is different on the
                two dates.
              </p>
            ) : (
              <p>
                <strong>Split</strong> shows A on the left of the orange line and B on the right.
                Drag the Divider slider across a star to compare the same spot on both dates.
              </p>
            )}
          </>
        )}
        {markers && (
          <>
            <p>
              <strong>Marks on the image</strong> are spots the software flagged for a closer look.
              They are not discoveries.
            </p>
            <ul className="guide-glyphs">
              <li>
                <Glyph kind="variable_like" /> got brighter or fainter
              </li>
              <li>
                <Glyph kind="new_source_like" /> appeared where nothing was before
              </li>
              <li>
                <Glyph kind="dipole_like" /> shifted, or the images are slightly misaligned
              </li>
              <li>
                <Glyph kind="artifact_like" /> probably a glitch, not real
              </li>
            </ul>
            <p>
              A solid mark was flagged on the date on screen; a dashed one on another date. The
              orange one is the change you selected.
            </p>
          </>
        )}
        <p>
          <strong>The timeline</strong> below the image has one tick per date ({dates} in all),
          spaced by real time, so gaps mean months when SPHEREx was looking elsewhere. Click a tick,
          or press ← →, to change date A.
        </p>
        <p>
          <strong>The bar</strong> in the corner shows a distance on the sky (′ is an arcminute, a
          thirtieth of the full Moon’s width). N ↑ E ← shows which way is north and east.
        </p>
      </div>
    </details>
  );
});
