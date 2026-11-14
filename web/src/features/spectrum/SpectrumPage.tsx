import { useState } from 'react';
import type { PageProps } from '../../app/App.tsx';
import { Icon } from '../../components/Icon.tsx';
import { BANDS, channelAt, CHANNELS, FEATURES, type Band, type Channel } from './channels.ts';
import '../../styles/pages.css';

const W = 960;
const H = 260;
const PAD = 24;
const LO = Math.log(0.35);
const HI = Math.log(5.3);
const x = (um: number) => PAD + ((Math.log(um) - LO) / (HI - LO)) * (W - 2 * PAD);
const BAR_TOP = 70;
const BAR_BOTTOM = 190;
const TICKS = [0.4, 0.5, 0.7, 1, 1.5, 2, 3, 4, 5];

// approximate hues of the visible band, for the eye only
const VISIBLE: [number, string][] = [
  [0.38, '#5b2a86'],
  [0.45, '#2f4fd8'],
  [0.5, '#1fa3a3'],
  [0.55, '#4dbb3b'],
  [0.58, '#e3d23a'],
  [0.62, '#ec8a2c'],
  [0.7, '#c9302c'],
  [0.75, '#5a1512'],
];

export function SpectrumPage({ fields }: PageProps) {
  const start = fields?.find((f) => f.data_kind === 'real');
  const [index, setIndex] = useState(() => channelAt(start?.wavelength_um ?? 1.45)?.index ?? 20);
  const ch = CHANNELS[index] ?? (CHANNELS[0] as Channel);
  const band = BANDS.find((b) => b.detector === ch.detector) ?? (BANDS[0] as Band);
  const near = FEATURES.filter((f) => f.um >= band.min && f.um <= band.max);
  const inBand = (fields ?? []).filter(
    (f) => f.wavelength_um >= band.min && f.wavelength_um < band.max,
  );

  return (
    <main className="page spectrum-page">
      <header className="page-head">
        <h1>Colours the eye cannot see</h1>
        <p className="lede">
          Your eyes see light from about 0.38 to 0.75 micrometres (µm). SPHEREx starts where red
          ends and keeps going to 5 µm, splitting that range into 102 narrow colours. Different
          gases, ices and dust leave fingerprints at particular colours.
        </p>
      </header>

      <figure className="spectrum-figure panel">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="spectrum-svg"
          role="img"
          aria-label={`Wavelength scale from 0.35 to 5.3 µm. The visible band is followed by SPHEREx's 102 infrared channels; channel ${index + 1} at ${ch.center.toFixed(3)} µm is selected.`}
        >
          <defs>
            <linearGradient id="visible" x1="0" x2="1">
              {VISIBLE.map(([um, c]) => (
                <stop key={um} offset={(x(um) - x(0.38)) / (x(0.75) - x(0.38))} stopColor={c} />
              ))}
            </linearGradient>
          </defs>
          <rect
            x={x(0.38)}
            y={BAR_TOP}
            width={x(0.75) - x(0.38)}
            height={BAR_BOTTOM - BAR_TOP}
            fill="url(#visible)"
            opacity="0.85"
          />
          <text x={(x(0.38) + x(0.75)) / 2} y={BAR_TOP - 10} className="svg-label">
            visible
          </text>
          <text x={(x(0.75) + x(5)) / 2} y={BAR_TOP - 10} className="svg-label">
            SPHEREx infrared, 102 channels
          </text>

          {CHANNELS.map((c) => (
            <rect
              key={c.index}
              x={x(c.lo) + 0.4}
              y={BAR_TOP}
              width={Math.max(0.8, x(c.hi) - x(c.lo) - 0.8)}
              height={BAR_BOTTOM - BAR_TOP}
              className="chan"
              data-band={c.detector % 2}
              data-on={c.index === index}
              onClick={() => setIndex(c.index)}
            />
          ))}

          {BANDS.map((b) => (
            <text
              key={b.detector}
              x={(x(b.min) + x(b.max)) / 2}
              y={BAR_BOTTOM + 16}
              className="svg-label"
            >
              band {b.detector}
            </text>
          ))}

          {FEATURES.map((f) => (
            <g key={f.name} className="feature">
              <line x1={x(f.um)} x2={x(f.um)} y1={BAR_TOP - 4} y2={BAR_BOTTOM} />
            </g>
          ))}

          {(fields ?? []).map((f) => (
            <path
              key={f.manifest_id}
              d={`M${x(f.wavelength_um)} ${BAR_BOTTOM + 2}l-5 9h10z`}
              className={f.data_kind === 'real' ? 'field-mark' : 'field-mark sim'}
            />
          ))}

          <line x1={PAD} x2={W - PAD} y1={H - 36} y2={H - 36} className="axis" />
          {TICKS.map((t) => (
            <text key={t} x={x(t)} y={H - 18} className="svg-label">
              {t}
            </text>
          ))}
          <text x={W - PAD} y={H - 2} className="svg-label" textAnchor="end">
            wavelength, µm (log scale)
          </text>
        </svg>
        <figcaption className="small dim">
          Visible hues are approximate and shown for the eye. Infrared channels are drawn in grey
          because infrared has no colour we can see; observatory images are brightness only.
          Triangles mark the wavelength of each field in this release.
        </figcaption>
      </figure>

      <div className="spectrum-layout">
        <section className="panel channel-panel">
          <label className="channel-pick">
            <span>
              Channel <span className="mono">{index + 1}</span> of 102
            </span>
            <input
              type="range"
              min={0}
              max={CHANNELS.length - 1}
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
              aria-valuetext={`Channel ${index + 1}, ${ch.center.toFixed(3)} micrometres, band ${ch.detector}`}
            />
          </label>
          <dl className="facts">
            <dt>Centre</dt>
            <dd className="mono">{ch.center.toFixed(3)} µm</dd>
            <dt>Covers</dt>
            <dd className="mono">
              {ch.lo.toFixed(3)}–{ch.hi.toFixed(3)} µm
            </dd>
            <dt>Detector band</dt>
            <dd className="mono">
              {band.detector} ({band.min}–{band.max} µm, R ≈ {band.resolvingPower})
            </dd>
          </dl>
          <details className="depth">
            <summary>What is a channel, exactly?</summary>
            <p>
              Each detector sits under a linear variable filter, so wavelength changes smoothly
              across it. Dividing each band into 17 steps of equal resolving power (R = λ/Δλ) is a
              convention for showing it; real observations record their own wavelength from the
              pixel position, and PARALLAX uses that.
            </p>
          </details>
        </section>

        <section className="panel">
          <h2>Fingerprints in band {band.detector}</h2>
          {near.length ? (
            <ul className="feature-list">
              {near.map((f) => (
                <li key={f.name}>
                  <span className="mono">{f.um.toFixed(3)} µm</span> <strong>{f.name}</strong>
                  <span className="dim"> {f.plain}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dim">
              No common fingerprint falls in this band; it mostly traces the smooth light of stars
              and galaxies.
            </p>
          )}
        </section>

        <section className="panel">
          <h2>Real observations in this band</h2>
          {inBand.length ? (
            <ul className="feature-list">
              {inBand.map((f) => (
                <li key={f.manifest_id}>
                  <a href={`#${f.manifest_id}`} className="inline-link">
                    {f.title} <Icon name="arrow" />
                  </a>
                  {f.data_kind === 'simulated' && <span className="sim-tag">Simulated</span>}
                  <span className="mono dim small">
                    {' '}
                    measured at {f.wavelength_um.toFixed(3)} µm
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dim">
              This release has no field at these wavelengths yet. Real fields sit in bands{' '}
              {[
                ...new Set(
                  (fields ?? [])
                    .filter((f) => f.data_kind === 'real')
                    .map((f) => channelAt(f.wavelength_um)?.detector),
                ),
              ].join(' and ')}
              .
            </p>
          )}
          <p className="small dim">
            Each field here is a series of images at a single wavelength, in MJy/sr. PARALLAX
            compares brightness between dates; it does not extract spectra.
          </p>
        </section>
      </div>
    </main>
  );
}
