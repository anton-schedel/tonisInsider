/** The round feed picture of a coach post: which square of the photo it shows (coachClient's editor). */
export type Crop = { x: number; y: number; zoom: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const ZOOM = { min: 1, max: 4 };

/** The square the circle shows, in the photo's pixels (zoom 1: as wide as the photo's short side). */
export function square(w: number, h: number, c: Crop) {
  const side = Math.min(w, h) / c.zoom;
  return { side, left: c.x * w - side / 2, top: c.y * h - side / 2 };
}

/** Kept inside the photo: the circle never shows anything beyond its edges. */
export function fit(w: number, h: number, c: Crop): Crop {
  const zoom = clamp(c.zoom, ZOOM.min, ZOOM.max);
  const half = Math.min(w, h) / zoom / 2;
  return { zoom, x: clamp(c.x, half / w, 1 - half / w), y: clamp(c.y, half / h, 1 - half / h) };
}

/** Untouched: centred, a tall photo framed near its top (the circle's top 8 % down), where the head usually is. */
export const defaultCrop = (w: number, h: number): Crop => fit(w, h, { x: 0.5, y: h > w ? 0.08 + w / h / 2 : 0.5, zoom: 1 });

export const sameCrop = (a: Crop, b: Crop) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.zoom - b.zoom) < 0.002;

/** Rounded for storing (the server keeps 4 places too). */
export const rounded = (c: Crop): Crop => ({ x: +c.x.toFixed(4), y: +c.y.toFixed(4), zoom: +c.zoom.toFixed(4) });
