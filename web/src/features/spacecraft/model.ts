// A schematic SPHEREx: nested photon shields over a small telescope, a hexagonal bus and one
// solar panel, as wire lines in metres. Proportions are approximate; it is not an engineering
// model. Pure geometry so it can be tested without a browser.

export type P3 = [number, number, number];
export type Part = 'shields' | 'telescope' | 'focal' | 'bus' | 'solar';
export interface Wire {
  part: Part;
  pts: P3[];
}

const ring = (r: number, z: number, n = 40): P3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [r * Math.cos(a), r * Math.sin(a), z];
  });

function cone(
  part: Part,
  r0: number,
  r1: number,
  z0: number,
  z1: number,
  spokes: number,
  sides = 40,
): Wire[] {
  const out: Wire[] = [
    { part, pts: ring(r0, z0, sides) },
    { part, pts: ring(r1, z1, sides) },
  ];
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push({
      part,
      pts: [
        [r0 * c, r0 * s, z0],
        [r1 * c, r1 * s, z1],
      ],
    });
  }
  return out;
}

const box = (part: Part, [x0, y0, z0]: P3, [x1, y1, z1]: P3): Wire[] => [
  {
    part,
    pts: [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z0],
    ],
  },
  {
    part,
    pts: [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
      [x0, y0, z1],
    ],
  },
  ...(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ] as const
  ).map(([x, y]): Wire => ({
    part,
    pts: [
      [x, y, z0],
      [x, y, z1],
    ],
  })),
];

export const WIRES: Wire[] = [
  // three nested conical shields that keep sunlight and Earth's glow off the telescope
  ...cone('shields', 0.72, 1.05, 0.12, 1.55, 12),
  ...cone('shields', 0.8, 1.18, 0.1, 1.68, 12),
  ...cone('shields', 0.88, 1.3, 0.08, 1.8, 12),
  // the telescope tube and its 20 cm primary mirror
  ...cone('telescope', 0.26, 0.26, 0.18, 1.0, 8),
  { part: 'telescope', pts: ring(0.1, 0.22, 24) },
  // focal plane assemblies under the telescope
  ...box('focal', [-0.22, -0.14, 0.02], [0.22, 0.14, 0.14]),
  // hexagonal spacecraft bus
  ...cone('bus', 0.62, 0.62, -0.62, 0, 6, 6),
  // one fixed solar panel on the Sun side
  ...box('solar', [-1.02, -0.75, -0.55], [-1.0, 0.75, 0.05]),
  ...[-0.375, 0, 0.375].map((y): Wire => ({
    part: 'solar',
    pts: [
      [-1.01, y, -0.55],
      [-1.01, y, 0.05],
    ],
  })),
];

/** Where each hotspot sits on the model. */
export const ANCHORS: Record<Part, P3> = {
  shields: [0.95, -0.55, 1.45],
  telescope: [0, 0, 0.95],
  focal: [0.22, 0, 0.08],
  bus: [0.55, 0.3, -0.3],
  solar: [-1.01, 0, -0.25],
};

export interface Camera {
  yaw: number; // radians about the vertical axis
  pitch: number; // radians, positive looks down on the craft
  scale: number; // px per metre
}

const CENTRE_Z = 0.55;
const DISTANCE = 7; // metres; perspective strength

/** Model point → screen offset from the canvas centre (y down) and depth (positive = far). */
export function view([x, y, z]: P3, c: Camera): { x: number; y: number; depth: number } {
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  const x1 = x * cy - y * sy;
  const y1 = x * sy + y * cy;
  const z1 = z - CENTRE_Z;
  const cp = Math.cos(c.pitch);
  const sp = Math.sin(c.pitch);
  const depth = y1 * cp + z1 * sp;
  const up = -y1 * sp + z1 * cp;
  const k = DISTANCE / (DISTANCE + depth);
  return { x: x1 * k * c.scale, y: -up * k * c.scale, depth };
}

// ---- solid schematic: the same parts as faces, lit and painted back to front ----

export interface Face {
  part: Part;
  pts: P3[];
}

function coneFaces(part: Part, r0: number, r1: number, z0: number, z1: number, sides = 40): Face[] {
  const a = ring(r0, z0, sides);
  const b = ring(r1, z1, sides);
  return Array.from({ length: sides }, (_, i) => ({
    part,
    pts: [a[i], a[i + 1], b[i + 1], b[i]] as P3[],
  }));
}

function boxFaces(part: Part, [x0, y0, z0]: P3, [x1, y1, z1]: P3): Face[] {
  const quads: P3[][] = [
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
    ],
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [
      [x0, y0, z0],
      [x0, y1, z0],
      [x0, y1, z1],
      [x0, y0, z1],
    ],
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
  ];
  return quads.map((pts) => ({ part, pts }));
}

export const FACES: Face[] = [
  ...coneFaces('shields', 0.72, 1.05, 0.12, 1.55),
  ...coneFaces('shields', 0.8, 1.18, 0.1, 1.68),
  ...coneFaces('shields', 0.88, 1.3, 0.08, 1.8),
  ...coneFaces('telescope', 0.26, 0.26, 0.18, 1.0, 16),
  { part: 'telescope', pts: ring(0.1, 0.22, 24) },
  ...boxFaces('focal', [-0.22, -0.14, 0.02], [0.22, 0.14, 0.14]),
  ...coneFaces('bus', 0.62, 0.62, -0.62, 0, 6),
  { part: 'bus', pts: ring(0.62, 0, 6) },
  { part: 'bus', pts: ring(0.62, -0.62, 6) },
  ...boxFaces('solar', [-1.02, -0.75, -0.55], [-1.0, 0.75, 0.05]),
];

/** How far each part travels in the exploded view (metres), so inner parts come into sight. */
export const EXPLODE: Record<Part, P3> = {
  shields: [0, 0, 0.75],
  telescope: [0, 0, 0.38],
  focal: [0, 0, 0],
  bus: [0, 0, -0.55],
  solar: [-0.8, 0, 0],
};

export const shift = ([x, y, z]: P3, part: Part, e: number): P3 => {
  const [dx, dy, dz] = EXPLODE[part];
  return [x + dx * e, y + dy * e, z + dz * e];
};

const LIGHT: P3 = [-0.45, -0.55, 0.7]; // from the upper left, in camera space (x right, y down, z toward viewer)

/** Lambert brightness 0..1 of a face for this camera; two-sided, because the cones are thin shells. */
export function shade(pts: P3[], c: Camera): number {
  const s = pts.map((p) => view(p, { ...c, scale: 1 }));
  const [a, b, d] = [s[0], s[1], s[2]];
  if (!a || !b || !d) return 0;
  const u: P3 = [b.x - a.x, b.y - a.y, b.depth - a.depth];
  const v: P3 = [d.x - a.x, d.y - a.y, d.depth - a.depth];
  const n: P3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n) * Math.hypot(...LIGHT);
  return len ? Math.abs(n[0] * LIGHT[0] + n[1] * LIGHT[1] - n[2] * LIGHT[2]) / len : 0;
}
