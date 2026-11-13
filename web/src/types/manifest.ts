// Mirrors science/src/parallax_science/models.py (schema 1.0.0). Keep in sync; the Python
// models are the source of truth and data/manifests/manifest.schema.json is generated from them.

export type DataKind = 'real' | 'simulated';
export type TimeScale = 'utc' | 'tt' | 'tai' | 'tdb';
export type CompatibilityStatus = 'compatible' | 'incompatible' | 'unknown';
export type CandidateStatus =
  'unreviewed' | 'needs_followup' | 'known_object' | 'likely_artifact' | 'rejected';

export interface Target {
  label: string;
  ra_deg: number;
  dec_deg: number;
  frame: 'icrs';
  radius_arcsec: number;
}

export interface Dataset {
  mission: 'SPHEREx' | 'SIMULATED';
  archive: string | null;
  collection: string | null;
  data_release: string | null;
  citation: string;
  acknowledgement: string;
}

export interface Observation {
  observation_id: string;
  data_kind: DataKind;
  epoch: {
    mjd_mid: number;
    time_scale: TimeScale;
    exposure_s: number | null;
    source_keyword: string | null;
  };
  spectral: {
    detector: number | null;
    wavelength_center_um: number;
    wavelength_min_um: number;
    wavelength_max_um: number;
    basis: 'spectral-wcs' | 'header' | 'simulated';
  };
  image: {
    width_px: number;
    height_px: number;
    pixel_scale_arcsec: number;
    units: string;
    wcs: Record<string, string | number | boolean>;
  };
  quality: {
    flags_available: boolean;
    variance_available: boolean;
    masked_fraction: number | null;
    notes: string[];
  };
  assets: { science_fits: string | null; display_png: string; display_stretch: string };
  provenance: {
    source_url: string | null;
    source_id: string;
    retrieved_utc: string | null;
    source_sha256: string | null;
    calibration_version: string | null;
    processing: string;
    cache_key: string;
  };
}

export interface Comparison {
  reference_id: string;
  target_id: string;
  status: CompatibilityStatus;
  reasons: string[];
}

export interface Candidate {
  candidate_id: string;
  status: CandidateStatus;
  observation_ids: string[];
  ra_deg: number;
  dec_deg: number;
  evidence: string[];
  method: string;
}

export interface Manifest {
  schema_version: '1.0.0';
  manifest_id: string;
  data_kind: DataKind;
  title: string;
  notice: string | null;
  target: Target;
  dataset: Dataset;
  observations: Observation[];
  comparisons: Comparison[];
  candidates: Candidate[];
  generated_by: { tool: string; version: string; command: string };
}
