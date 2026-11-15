import { useEffect, useRef } from 'react';

// One stack for every transient panel, so Escape closes only the topmost one.
const stack: { close: () => void }[] = [];
// a panel that autofocuses its own field has already taken focus when it registers
let lastBlurred: HTMLElement | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('focusout', (e) => (lastBlurred = e.target as HTMLElement));
  window.addEventListener('keydown', (e) => {
    const top = stack.at(-1);
    if (e.key !== 'Escape' || !top || e.defaultPrevented) return;
    e.preventDefault();
    top.close();
  });
}

/**
 * While `open`, Escape calls `onClose`. Focus returns to whatever had it when the panel opened
 * (the trigger) once the panel closes, by any means.
 */
export function useEscape(open: boolean, onClose: () => void) {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const triggers = [document.activeElement as HTMLElement | null, lastBlurred];
    const entry = { close: () => latest.current() };
    stack.push(entry);
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      // only if focus was lost with the panel; never steal it from where the visitor moved it
      requestAnimationFrame(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost) triggers.find((t) => t?.isConnected)?.focus();
      });
    };
  }, [open]);
}
