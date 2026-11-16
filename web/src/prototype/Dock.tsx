import { DESTINATIONS, type Route } from './route.ts';
import { SkyDome, type Palette } from './SkyDome.tsx';
import type { View } from './projection.ts';

/** The four destinations and the deep-dive pages. Collapsed, it keeps Home, Sky, the current view and the expand control. */
export function Dock(props: {
  route: Route;
  open: boolean;
  onOpen: (open: boolean) => void;
  onGo: (r: Route) => void;
  notes: number;
}) {
  const shown = props.open
    ? DESTINATIONS
    : DESTINATIONS.filter((d) => d.id === 'welcome' || d.id === 'sky' || d.id === props.route);
  return (
    <nav className="dock" data-open={props.open ? '' : undefined} aria-label="Destinations">
      {shown.map((d) => (
        <button
          key={d.id}
          aria-current={props.route === d.id ? 'page' : undefined}
          onClick={() => props.onGo(d.id)}
        >
          {d.label}
          {d.id === 'notebook' && props.notes > 0 && (
            <span className="dock-count" aria-label={`, ${props.notes} saved`}>
              {props.notes}
            </span>
          )}
        </button>
      ))}
      {props.open && (
        <a className="dock-link" href="classic.html">
          Classic app
        </a>
      )}
      <button
        className="dock-toggle"
        aria-expanded={props.open}
        aria-label={props.open ? 'Collapse destinations' : 'Show all destinations'}
        onClick={() => props.onOpen(!props.open)}
      >
        <span aria-hidden="true">{props.open ? '‹' : '⋯'}</span>
      </button>
    </nav>
  );
}

/** A small live view of where the sky is pointed; choosing it returns there. */
/** The flipbook's window on the planetarium: the whole-sky map around the target, one click to open it there. */
export function PlanetariumWindow(props: {
  target: { ra: number; dec: number; label: string };
  frame: number;
  palette: Palette;
  onOpen: (t: { ra: number; dec: number }) => void;
}) {
  const { ra, dec, label } = props.target;
  return (
    <button
      className="planet-window"
      onClick={() => props.onOpen(props.target)}
      aria-label={`Open the planetarium at ${label}`}
    >
      <SkyDome
        view={{ ra, dec, fov: 40 }}
        frame={props.frame}
        palette={props.palette}
        resolution={0.75}
        label=""
      >
        <span className="locator-cross" aria-hidden="true" />
      </SkyDome>
      <span className="planet-text">
        <strong>Planetarium</strong>
        <span className="muted">{label} in the whole infrared sky</span>
        <span className="planet-go" aria-hidden="true">
          Open the planetarium →
        </span>
      </span>
    </button>
  );
}

export function Locator(props: {
  view: View;
  frame: number;
  palette: Palette;
  where: string;
  onSky: () => void;
}) {
  return (
    <button
      className="locator"
      onClick={props.onSky}
      aria-label={`Return to the sky at ${props.where}`}
    >
      <SkyDome
        view={{ ...props.view, fov: Math.max(props.view.fov, 4) }}
        frame={props.frame}
        palette={props.palette}
        resolution={0.5}
        label=""
        className="locator-dome"
      >
        <span className="locator-cross" aria-hidden="true" />
      </SkyDome>
      <span className="locator-label">
        <span className="muted">Sky</span> {props.where}
      </span>
    </button>
  );
}
