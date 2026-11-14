// One authored icon set: 16px grid, 1.5 stroke, round joins. Decorative unless labelled.

const PATHS = {
  bookmark: 'M4.5 2.5h7v11l-3.5-2.6-3.5 2.6z',
  bookmarked: 'M4.5 2.5h7v11l-3.5-2.6-3.5 2.6z M6.5 6.5l1.2 1.2 2.3-2.4',
  download: 'M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10',
  copy: 'M5.5 5.5h7v8h-7zM3.5 10.5v-8h7',
  trash: 'M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.7 9h5.6l.7-9',
  play: 'M5 3.5v9l7-4.5z',
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  step: 'M4.5 3.5v9l6-4.5zM12 3.5v9',
  reset: 'M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.5v2.7h2.7',
  arrow: 'M3 8h10M9 4l4 4-4 4',
  back: 'M13 8H3M7 4 3 8l4 4',
  check: 'M3.5 8.5l3 3 6-7',
  close: 'M4 4l8 8M12 4l-8 8',
  open: 'M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4',
  hint: 'M8 13.5v.01M6 6a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3v.9',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
