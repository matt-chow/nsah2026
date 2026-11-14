/** UTC calendar date (YYYY-MM-DD) for an MJD; display only, ignores the time scale offset. */
export const isoDate = (mjd: number) =>
  new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);
