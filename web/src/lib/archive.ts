export interface ArchiveCount {
  collection: string;
  exposures: number;
  /** True when IRSA's row cap cut the list short: counts and dates are then lower bounds. */
  truncated: boolean;
  latest_mjd: number | null;
  latest_release: string | null;
}

/** Live exposure listing from the FastAPI function (IRSA has no CORS). null = unavailable. */
export async function archiveLookup(
  ra: number,
  dec: number,
  signal?: AbortSignal,
): Promise<ArchiveCount[] | null> {
  try {
    const res = await fetch(`api/sia?ra=${ra}&dec=${dec}`, {
      signal: signal ?? AbortSignal.timeout(25000),
    });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const body = (await res.json()) as { collections?: ArchiveCount[] };
    return Array.isArray(body.collections) ? body.collections : null;
  } catch {
    return null;
  }
}
