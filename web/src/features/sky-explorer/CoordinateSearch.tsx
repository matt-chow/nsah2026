import { memo, useId, useState, type FormEvent } from 'react';
import { parseDegrees, separationDeg } from '../../lib/coords.ts';
import type { Target } from '../../types/manifest.ts';

interface Props {
  target: Target;
}

export const CoordinateSearch = memo(function CoordinateSearch({ target }: Props) {
  const id = useId();
  const [ra, setRa] = useState(String(target.ra_deg));
  const [dec, setDec] = useState(String(target.dec_deg));
  const [errors, setErrors] = useState<{ ra?: string; dec?: string }>({});
  const [result, setResult] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = parseDegrees(ra, 0, 360, false);
    const d = parseDegrees(dec, -90, 90, true);
    setErrors({ ...(r.ok ? {} : { ra: r.error }), ...(d.ok ? {} : { dec: d.error }) });
    if (!r.ok || !d.ok) return setResult('');
    const sepArcsec = separationDeg(r.value, d.value, target.ra_deg, target.dec_deg) * 3600;
    setResult(
      sepArcsec <= target.radius_arcsec
        ? `Inside the loaded field "${target.label}" (${sepArcsec.toFixed(1)}″ from center).`
        : 'No loaded observations cover this position. Live SPHEREx archive search is not available in this build.',
    );
  }

  const field = (
    key: 'ra' | 'dec',
    label: string,
    value: string,
    set: (v: string) => void,
    hint: string,
  ) => (
    <div className="field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={`${id}-${key}-hint`}
      />
      <span id={`${id}-${key}-hint`} className={errors[key] ? 'hint error' : 'hint'}>
        {errors[key] ?? hint}
      </span>
    </div>
  );

  return (
    <section className="panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Sky position</h2>
      <form onSubmit={onSubmit} noValidate>
        {field('ra', 'Right ascension (°)', ra, setRa, 'ICRS, 0 to 360')}
        {field('dec', 'Declination (°)', dec, setDec, 'ICRS, −90 to +90')}
        <button type="submit">Search</button>
      </form>
      <p className="result" aria-live="polite">
        {result}
      </p>
    </section>
  );
});
