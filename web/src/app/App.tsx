import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageCanvas } from '../components/ImageCanvas.tsx';
import { ObservationDetails } from '../components/ObservationDetails.tsx';
import { CandidatesPanel } from '../features/candidates/CandidatesPanel.tsx';
import { ComparisonPanel } from '../features/comparison/ComparisonPanel.tsx';
import { CoordinateSearch } from '../features/sky-explorer/CoordinateSearch.tsx';
import { Timeline } from '../features/timeline/Timeline.tsx';
import { loadManifest } from '../lib/manifest.ts';
import type { Manifest } from '../types/manifest.ts';

const BASE = import.meta.env.BASE_URL;
const MANIFEST_URL = `${BASE}manifests/synthetic-fixture.json`;

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; manifest: Manifest };

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    loadManifest(MANIFEST_URL, ctrl.signal).then(
      (manifest) => setState({ status: 'ready', manifest }),
      (err: unknown) => {
        if (!ctrl.signal.aborted)
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => ctrl.abort();
  }, []);

  return (
    <div className="shell">
      <header className="masthead">
        <h1>PARALLAX</h1>
        <p className="subtitle">An open observatory for the changing infrared sky</p>
      </header>
      {state.status === 'loading' && <p className="state">Loading observation manifest…</p>}
      {state.status === 'error' && (
        <div className="state error" role="alert">
          <strong>Observations could not be loaded.</strong> {state.message}
        </div>
      )}
      {state.status === 'ready' && <Workspace manifest={state.manifest} />}
    </div>
  );
}

function Workspace({ manifest }: { manifest: Manifest }) {
  const observations = useMemo(
    () => [...manifest.observations].sort((a, b) => a.epoch.mjd_mid - b.epoch.mjd_mid),
    [manifest],
  );
  const [selectedId, setSelectedId] = useState(observations[0]?.observation_id ?? '');
  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  const selected = observations.find((o) => o.observation_id === selectedId) ?? observations[0];
  if (!selected) return <p className="state">This manifest contains no observations.</p>;

  return (
    <>
      {manifest.data_kind === 'simulated' && (
        <div className="notice" role="note">
          <strong>Simulated data.</strong> {manifest.notice}
        </div>
      )}
      <main className="workspace">
        <div className="column">
          <CoordinateSearch target={manifest.target} />
          <Timeline
            observations={observations}
            selectedId={selected.observation_id}
            onSelect={onSelect}
          />
        </div>
        <section className="stage" aria-labelledby="stage-h">
          <h2 id="stage-h" className="stage-title">
            {manifest.title}
            <span className="muted"> · {selected.observation_id}</span>
          </h2>
          <ImageCanvas
            src={`${BASE}${selected.assets.display_png}`}
            label={`${selected.data_kind === 'simulated' ? 'Simulated' : 'Observed'} image ${selected.observation_id}, ${selected.spectral.wavelength_center_um} micron`}
          />
        </section>
        <div className="column">
          <ObservationDetails obs={selected} />
          <ComparisonPanel
            selectedId={selected.observation_id}
            comparisons={manifest.comparisons}
          />
          <CandidatesPanel candidates={manifest.candidates} />
        </div>
      </main>
      <footer className="footer">
        <p>{manifest.dataset.citation}</p>
        <p>{manifest.dataset.acknowledgement}</p>
        <p>A NASA Space Apps Challenge 2026 project. Not affiliated with or endorsed by NASA.</p>
      </footer>
    </>
  );
}
