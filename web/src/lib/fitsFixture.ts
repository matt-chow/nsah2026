// Synthetic FITS bytes for tests (not bundled: only test files import it).

/** A FITS file from header cards and big-endian data units, padded to 2880-byte blocks. */
export function fitsFile(hdus: { cards: string[]; data?: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const pad = (n: number) => Math.ceil(n / 2880) * 2880;
  for (const h of hdus) {
    const text = [...h.cards, 'END'].map((c) => c.padEnd(80)).join('');
    const head = new Uint8Array(pad(text.length)).fill(32);
    for (let i = 0; i < text.length; i++) head[i] = text.charCodeAt(i);
    parts.push(head);
    if (h.data) {
      const d = new Uint8Array(pad(h.data.length));
      d.set(h.data);
      parts.push(d);
    }
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function be32(values: number[], float: boolean): Uint8Array {
  const b = new Uint8Array(values.length * 4);
  const v = new DataView(b.buffer);
  values.forEach((x, i) => (float ? v.setFloat32(i * 4, x) : v.setInt32(i * 4, x)));
  return b;
}
