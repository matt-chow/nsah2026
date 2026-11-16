import { useEffect, useRef, useState } from 'react';
import { HIPS_URL } from '../features/atlas/hips.ts';
import { allwiseSources, gaiaStars, type Star } from './catalog.ts';

// Aladin Lite v3 from jsDelivr, pinned, loaded only when this panel opens (~2.4 MB incl. WebAssembly).
const ALADIN = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
// IRSA's mirror of the CDS AllWISE colour HiPS (CORS-enabled); alasky itself was answering 404
const WISE_HIPS = 'https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1/';

type Layer = 'spherex' | 'wise';

interface AladinView {
  setBaseImageLayer(l: unknown): void;
  addCatalog(c: AladinCatalog): void;
  gotoRaDec(ra: number, dec: number): void;
  setFoV(deg: number): void;
}
interface AladinLib {
  init: Promise<void>;
  aladin(el: HTMLElement, o: Record<string, unknown>): AladinView;
  HiPS(url: string, o: Record<string, unknown>): unknown;
  catalog(o: Record<string, unknown>): AladinCatalog;
  source(ra: number, dec: number, data?: Record<string, unknown>): unknown;
}
interface AladinHiPS {
  setSliceNumber(n: number): void;
}
interface AladinCatalog {
  addSources(s: unknown[]): void;
}

let lib: Promise<AladinLib> | null = null;
const loadAladin = () =>
  (lib ??= import(/* @vite-ignore */ ALADIN).then(async (m: { default: AladinLib }) => {
    await m.default.init;
    return m.default;
  })).catch((e: unknown) => {
    lib = null;
    throw e;
  });

/**
 * The wider sky around the flipbook point in Aladin Lite (CDS): SPHEREx DR1 or AllWISE imagery,
 * with Gaia DR3 and AllWISE catalogue markers. Context only; nothing here is measured.
 */
export default function SkyPanel(props: {
  ra: number;
  dec: number;
  sizeArcmin: number;
  band: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<{ a: AladinLib; v: AladinView } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [markers, setMarkers] = useState<{ key: string; ok: boolean } | null>(null);
  const [layer, setLayer] = useState<Layer>('spherex');
  const { ra, dec, sizeArcmin, band } = props;
  const det = Number(band.slice(1)) || 1;

  useEffect(() => {
    let gone = false;
    const el = box.current;
    loadAladin().then(
      (a) => {
        if (gone || !el) return;
        const v = a.aladin(el, {
          survey: HIPS_URL, // not the default DSS from CDS, which may be down
          target: `${ra} ${dec}`,
          fov: (sizeArcmin * 2.5) / 60,
          cooFrame: 'ICRS',
          showReticle: true,
          showCooGridControl: false,
          showSimbadPointerControl: false,
          showProjectionControl: false,
          showFullscreenControl: false,
          showFrame: true,
        });
        // markers from our own VizieR queries, which fall back to the CfA mirror when CDS is down
        const box = sizeArcmin * 3;
        const add = (stars: Star[], o: Record<string, unknown>, mag: string) => {
          const c = a.catalog({ ...o, onClick: 'showTable' });
          c.addSources(
            stars.map((s) => a.source(s.ra, s.dec, { ra: s.ra, dec: s.dec, [mag]: s.g })),
          );
          if (!gone) v.addCatalog(c);
        };
        const key = `${ra},${dec},${sizeArcmin}`;
        Promise.allSettled([
          gaiaStars(ra, dec, box).then((s) =>
            add(
              s,
              {
                name: 'Gaia DR3 (J2016.0 positions)',
                shape: 'square',
                sourceSize: 10,
                color: '#ece4d3',
              },
              'G',
            ),
          ),
          allwiseSources(ra, dec, box).then((s) =>
            add(s, { name: 'AllWISE', shape: 'circle', sourceSize: 12, color: '#f0a840' }, 'W1'),
          ),
        ]).then((r) => !gone && setMarkers({ key, ok: r.every((x) => x.status === 'fulfilled') }));
        view.current = { a, v };
        setState('ready');
      },
      () => !gone && setState('failed'),
    );
    return () => {
      gone = true;
      view.current = null;
      el?.replaceChildren();
    };
  }, [ra, dec, sizeArcmin]);

  useEffect(() => {
    const cur = view.current;
    if (state !== 'ready' || !cur) return;
    if (layer === 'wise')
      return cur.v.setBaseImageLayer(
        cur.a.HiPS(WISE_HIPS, { name: 'AllWISE colour (W1, W2, W4)' }),
      );
    cur.v.setBaseImageLayer(
      cur.a.HiPS(HIPS_URL, {
        name: `SPHEREx DR1 all-sky, detector ${det} (IRSA)`,
        // the middle channel of the cube's frames 17 × (detector − 1) + channel − 1; Aladin's
        // default can land on a blank one, and it ignores a slice set before the layer is added
        successCallback: (h: AladinHiPS) => h.setSliceNumber(17 * (det - 1) + 8),
      }),
    );
  }, [layer, state, det]);

  return (
    <div className="sky-panel">
      <div className="seg" role="radiogroup" aria-label="Background image">
        {(
          [
            ['spherex', 'SPHEREx'],
            ['wise', 'WISE'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="radio" aria-checked={layer === id} onClick={() => setLayer(id)}>
            {label}
          </button>
        ))}
      </div>
      <div
        ref={box}
        className="aladin"
        role="application"
        aria-label="Interactive sky map (Aladin Lite). Drag to pan, scroll to zoom."
      />
      {state === 'loading' && (
        <p className="note" role="status">
          Loading the sky map…
        </p>
      )}
      {state === 'ready' && markers?.key === `${ra},${dec},${sizeArcmin}` && !markers.ok && (
        <p className="note" role="status">
          Some catalogue markers are missing: the VizieR service did not answer.
        </p>
      )}
      {state === 'failed' && (
        <p className="note" role="alert">
          The sky map could not load (it needs WebGL 2 and the jsDelivr CDN). The flipbook itself is
          unaffected.
        </p>
      )}
      <p className="note">
        Squares are Gaia DR3 stars at their 2016 positions; amber circles are AllWISE sources. Both
        are other surveys’ catalogues, shown for context only: they are not SPHEREx measurements,
        and a source missing from them is not a new discovery. Catalogue markers come from VizieR
        (CDS) and are absent when it is down. Map: Aladin Lite (CDS); SPHEREx and AllWISE imagery
        from IRSA.
      </p>
    </div>
  );
}
