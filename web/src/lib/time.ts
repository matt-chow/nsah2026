/** UTC calendar date (YYYY-MM-DD) for an MJD; display only, ignores the time scale offset. */
export const isoDate = (mjd: number) =>
  new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);

const LONG = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "12 Jun 2025": the reader-facing date. The MJD stays in technical details. */
export const longDate = (mjd: number) => LONG.format(new Date((mjd - 40587) * 86400000));

/** "3 days", "5 months", "1.2 years" between two MJDs. */
export function interval(days: number) {
  const d = Math.abs(days);
  if (d < 1.5) return `${Math.round(d * 24)} hours`;
  if (d < 60) return `${Math.round(d)} days`;
  if (d < 548) return `${Math.round(d / 30.44)} months`;
  return `${(d / 365.25).toFixed(1)} years`;
}
