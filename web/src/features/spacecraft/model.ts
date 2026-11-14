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
