import { useEffect, useRef, useState } from 'react';
import { HIPS_URL } from '../features/atlas/hips.ts';

// Aladin Lite v3 from jsDelivr, pinned, loaded only when this panel opens (~2.4 MB incl. WebAssembly).
const ALADIN = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
const WISE_HIPS = 'https://alasky.cds.unistra.fr/AllWISE/RGB-W4-W2-W1/';

type Layer = 'spherex' | 'wise';

interface AladinView {
  setBaseImageLayer(l: unknown): void;
  addCatalog(c: unknown): void;
  gotoRaDec(ra: number, dec: number): void;
  setFoV(deg: number): void;
}
interface AladinLib {
  init: Promise<void>;
  aladin(el: HTMLElement, o: Record<string, unknown>): AladinView;
  HiPS(url: string, o: Record<string, unknown>): unknown;
  catalogFromVizieR(
    id: string,
    target: string,
    radius: number,
    o: Record<string, unknown>,
  ): unknown;
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
export default function SkyPanel(props: { ra: number; dec: number; sizeArcmin: number }) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<{ a: AladinLib; v: AladinView } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [layer, setLayer] = useState<Layer>('spherex');
  const { ra, dec, sizeArcmin } = props;

  useEffect(() => {
    let gone = false;
    const el = box.current;
    loadAladin().then(
      (a) => {
        if (gone || !el) return;
        const v = a.aladin(el, {
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
        const target = `${ra} ${dec}`;
        const r = (sizeArcmin * 1.5) / 60;
        v.addCatalog(
          a.catalogFromVizieR('I/355/gaiadr3', target, r, {
            name: 'Gaia DR3 (J2016.0 positions)',
            shape: 'square',
            sourceSize: 10,
            color: '#ece4d3',
            onClick: 'showTable',
          }),
        );
        v.addCatalog(
          a.catalogFromVizieR('II/328/allwise', target, r, {
            name: 'AllWISE',
            shape: 'circle',
            sourceSize: 12,
            color: '#f0a840',
            onClick: 'showTable',
          }),
        );
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
    cur.v.setBaseImageLayer(
      layer === 'spherex'
        ? cur.a.HiPS(HIPS_URL, { name: 'SPHEREx DR1 all-sky (IRSA)' })
        : cur.a.HiPS(WISE_HIPS, { name: 'AllWISE colour (W1, W2, W4)' }),
    );
  }, [layer, state]);

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
        (CDS) and are absent when it is down. Map: Aladin Lite (CDS), SPHEREx imagery from IRSA.
      </p>
    </div>
  );
}
