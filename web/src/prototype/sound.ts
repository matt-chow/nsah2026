// Quiet, optional interface sounds. Off by default; the AudioContext is created only after the
// visitor turns sound on (a user gesture), and nothing plays while it is off.

let ctx: AudioContext | null = null;
let on = false;

export function setSound(enabled: boolean) {
  on = enabled;
  if (enabled && !ctx && typeof AudioContext !== 'undefined') ctx = new AudioContext();
  if (enabled) void ctx?.resume();
}

const TONES = {
  select: [660],
  arrive: [523.25, 783.99],
  save: [783.99, 1046.5],
} as const;

export function play(kind: keyof typeof TONES) {
  if (!on || !ctx) return;
  const t0 = ctx.currentTime;
  TONES[kind].forEach((hz, i) => {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    const t = t0 + i * 0.09;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.035, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}
