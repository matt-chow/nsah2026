import { memo, useEffect, useRef, useState } from 'react';
import { loadImage } from '../lib/imageCache.ts';

interface Props {
  src: string;
  label: string;
}

type Loaded = { src: string; image: HTMLImageElement | null; error: boolean };

/**
 * Draws one display PNG with nearest-neighbour scaling (pixels stay pixels).
 * Redraws only when the image or container size changes; there is no render loop.
 */
export const ImageCanvas = memo(function ImageCanvas({ src, label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = loaded?.src === src ? loaded : null;
  const image = current?.image ?? null;

  useEffect(() => {
    let live = true;
    loadImage(src).then(
      (img) => live && setLoaded({ src, image: img, error: false }),
      () => live && setLoaded({ src, image: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [src]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !image) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(wrap.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(wrap.clientHeight * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      const fit = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const scale = fit >= 1 ? Math.floor(fit) : fit; // integer zoom keeps pixel sizes uniform
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        image,
        Math.floor((canvas.width - w) / 2),
        Math.floor((canvas.height - h) / 2),
        w,
        h,
      );
    };
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [image]);

  return (
    <div className="viewer" ref={wrapRef}>
      <canvas ref={canvasRef} role="img" aria-label={label} hidden={!image} />
      {!current && <p className="viewer-status">Loading display image…</p>}
      {current?.error && (
        <p className="viewer-status error" role="alert">
          Display image could not be loaded.
        </p>
      )}
    </div>
  );
});
