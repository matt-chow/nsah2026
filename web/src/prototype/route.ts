// Destinations live in the URL hash so browser Back/Forward move between them. The state of
// each view lives in the app (and the saved session), not in the URL.

export type Route = 'welcome' | 'sky' | 'flipbook' | 'analysis' | 'spacecraft' | 'notebook';
const ROUTES: Route[] = ['sky', 'flipbook', 'analysis', 'spacecraft', 'notebook'];

export function parseRoute(hash: string): Route {
  const r = hash.replace(/^#\/?/, '').split(/[?/]/)[0] as Route;
  return ROUTES.includes(r) ? r : 'welcome';
}

export const routeHash = (r: Route) => (r === 'welcome' ? '#/' : `#/${r}`);

export const DESTINATIONS: { id: Route; label: string }[] = [
  { id: 'sky', label: 'Sky' },
  { id: 'flipbook', label: 'Flipbook' },
  { id: 'spacecraft', label: 'Spacecraft' },
  { id: 'notebook', label: 'Notebook' },
];
