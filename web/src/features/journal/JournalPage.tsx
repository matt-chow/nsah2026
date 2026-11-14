import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { toMarkdown, type JournalEntry } from '../../lib/journal.ts';
import { displayTitle, isSafeRelativePath } from '../../lib/manifest.ts';
import { isoDate } from '../../lib/time.ts';
import { journal, useJournal } from './store.ts';
import '../../styles/pages.css';

const origin = () => `${location.origin}${location.pathname}`;
const BASE = import.meta.env.BASE_URL;

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const KIND_LABEL: Record<JournalEntry['kind'], string> = {
  observation: 'Observation',
  change: 'Marked change',
  mission: 'Arcade investigation',
};

export function JournalPage() {
  const entries = useJournal();
  const [status, setStatus] = useState('');

  const edit = (id: string, patch: Partial<Pick<JournalEntry, 'hypothesis' | 'notes'>>) => {
    const ok = journal.set(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    if (!ok) setStatus('This browser would not save the change (private mode or storage full).');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(entries, origin()));
      setStatus('Summary copied to the clipboard.');
    } catch {
      setStatus('Copying was blocked; use “Download Markdown” instead.');
    }
  };

  return (
    <main className="page journal-page">
      <header className="page-head">
        <h1>Your field notebook</h1>
        <p className="lede">
          Observations and changes you save, kept in this browser only. Nothing is uploaded and
          there is no account. Each entry keeps the pipeline&apos;s record apart from your own
          thinking, so a hunch never reads like a finding.
        </p>
      </header>

      {entries.length > 0 && (
        <div className="journal-bar">
          <button type="button" onClick={() => void copy()}>
            <Icon name="copy" /> Copy summary
          </button>
          <button
            type="button"
            onClick={() =>
              download('parallax-notebook.md', toMarkdown(entries, origin()), 'text/markdown')
            }
          >
            <Icon name="download" /> Download Markdown
          </button>
          <button
            type="button"
            onClick={() =>
              download(
                'parallax-notebook.json',
                JSON.stringify(entries, null, 2),
                'application/json',
              )
            }
          >
            <Icon name="download" /> Download JSON
          </button>
          <p className="small dim" role="status">
            {status}
          </p>
        </div>
      )}

      {entries.length === 0 ? (
        <section className="panel journal-empty">
          <h2>Nothing saved yet</h2>
          <p className="dim">
            In the observatory, press <strong>Save</strong> beside an image or a marked change. It
            lands here with its coordinates, dates, archive links and the pipeline&apos;s
            measurements, ready for your notes.
          </p>
          <a className="button-link" href="#nep-d2">
            Open the observatory <Icon name="arrow" />
          </a>
        </section>
      ) : (
        <ol className="journal-list">
          {entries.map((e) => (
            <li key={e.id} className="entry panel">
              <header className="entry-head">
                <div>
                  <p className="small dim">
                    {KIND_LABEL[e.kind]} · saved {e.saved_utc.slice(0, 10)}
                  </p>
                  <h2>{displayTitle(e.title)}</h2>
                  {e.data_kind === 'simulated' && (
                    <span className="sim-tag">Simulated, not NASA data</span>
                  )}
                </div>
                <div className="entry-actions">
                  <a className="button-link" href={e.link}>
                    <Icon name="open" /> Reopen
                  </a>
                  <button
                    type="button"
                    onClick={() => journal.set(entries.filter((x) => x.id !== e.id))}
                  >
                    <Icon name="trash" /> Remove
                    <span className="visually-hidden"> {e.title}</span>
                  </button>
                </div>
              </header>

              <div className="entry-body">
                {e.preview && isSafeRelativePath(e.preview) && (
                  <figure className="entry-plate">
                    <img
                      src={`${BASE}${e.preview}`}
                      alt=""
                      loading="lazy"
                      width={160}
                      height={160}
                    />
                    <figcaption className="small dim">
                      {e.data_kind === 'simulated' ? 'Simulated image' : 'SPHEREx image'}, first
                      date; display stretch only
                    </figcaption>
                  </figure>
                )}
                <section className="record" aria-label="Pipeline record">
                  <h3>Record</h3>
                  <dl className="facts">
                    <dt>Position</dt>
                    <dd className="mono">
                      RA {e.ra_deg.toFixed(5)}° Dec {e.dec_deg.toFixed(5)}°
                    </dd>
                    {e.wavelength_um != null && (
                      <>
                        <dt>Wavelength</dt>
                        <dd className="mono">{e.wavelength_um.toFixed(3)} µm</dd>
                      </>
                    )}
                    <dt>Dates</dt>
                    <dd className="mono">{e.dates.map((d) => isoDate(d.mjd_mid)).join(', ')}</dd>
                    {e.release && (
                      <>
                        <dt>Release</dt>
                        <dd>{e.release}</dd>
                      </>
                    )}
                    {e.sources.length > 0 && (
                      <>
                        <dt>Archive</dt>
                        <dd className="source-links">
                          {e.sources.map((s, i) => (
                            <a
                              key={s}
                              href={s}
                              className="inline-link"
                              rel="noreferrer"
                              target="_blank"
                            >
                              IRSA archive file{e.sources.length > 1 ? `, date ${i + 1}` : ''}{' '}
                              <Icon name="open" />
                              <span className="visually-hidden"> (opens in a new tab)</span>
                            </a>
                          ))}
                        </dd>
                      </>
                    )}
                  </dl>
                  {e.pipeline && (
                    <div className="triage">
                      <p className="small">
                        <strong>Pipeline triage:</strong> {e.pipeline.status.replace(/_/g, ' ')},{' '}
                        {e.pipeline.kind.replace(/_/g, ' ')}.{' '}
                        <span className="dim">Automatic and unconfirmed.</span>
                      </p>
                      <ul className="small mono">
                        {e.pipeline.measurements.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {e.outcome && (
                    <p className="small">
                      <strong>Your conclusion in the Arcade:</strong> {e.outcome}
                    </p>
                  )}
                </section>

                <section className="mine" aria-label="Your notes">
                  <label>
                    <span>
                      Your hypothesis <span className="dim">(not verified)</span>
                    </span>
                    <textarea
                      rows={3}
                      defaultValue={e.hypothesis}
                      placeholder="What do you think this is, and what would test it?"
                      onBlur={(ev) =>
                        ev.target.value !== e.hypothesis &&
                        edit(e.id, { hypothesis: ev.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Notes</span>
                    <textarea
                      rows={2}
                      defaultValue={e.notes}
                      onBlur={(ev) =>
                        ev.target.value !== e.notes && edit(e.id, { notes: ev.target.value })
                      }
                    />
                  </label>
                </section>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
