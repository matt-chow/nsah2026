import { memo, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { useJournal } from '../features/journal/store.ts';

export type Section = 'observatory' | 'sky' | 'spacecraft' | 'spectrum' | 'journal' | 'arcade';

const LINKS: { id: Exclude<Section, 'observatory' | 'arcade'>; label: string }[] = [
  { id: 'sky', label: 'Sky Globe' },
  { id: 'spacecraft', label: 'Spacecraft' },
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'journal', label: 'Journal' },
];

interface Props {
  section: Section;
  fieldId: string;
  inert: boolean;
}

/** The site-wide path between the observatory, the learning pages and the Arcade. */
export const SiteNav = memo(function SiteNav({ section, fieldId, inert }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const saved = useJournal().length;
  const cur = (s: Section) => (section === s ? 'page' : undefined);
  return (
    <header className="sitenav" inert={inert} data-menu-open={menuOpen}>
      <a className="wordmark" href={`#${fieldId}`}>
        PARALLAX
      </a>
      <button
        className="nav-toggle"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="global-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Icon name={menuOpen ? 'close' : 'menu'} /> Menu
      </button>
      <nav
        id="global-navigation"
        aria-label="Site"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setMenuOpen(false);
        }}
      >
        <ul>
          <li>
            <a href={`#${fieldId}`} aria-current={cur('observatory')}>
              Observatory
            </a>
          </li>
          {LINKS.map((l) => (
            <li key={l.id}>
              <a href={`#/${l.id}`} aria-current={cur(l.id)}>
                {l.label}
                {l.id === 'journal' && saved > 0 && (
                  <span className="count mono" aria-label={`, ${saved} saved`}>
                    {saved}
                  </span>
                )}
              </a>
            </li>
          ))}
          <li className="arcade-link">
            <a href="#/arcade" aria-current={cur('arcade')}>
              Discovery Arcade
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
});
