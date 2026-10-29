/**
 * A team photo's crest picture, made in the coach's browser (like scripts/team-avatar.py on the owner's Mac): the
 * player cut out with MediaPipe's selfie segmenter, his head and shoulders on white, our crest at 60 % behind him,
 * 480×480 JPEG. The segmenter (about 16 MB with its wasm) loads only when the coach asks for one.
 *
 * The geometry (headBox) and the sharpening are plain functions on arrays; the rest needs a browser.
 */

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
/** The picture's size: the feed circle is 64 pt, 192 px on a 3x iPhone, so there's room to spare. */
export const AVATAR = 480;

export type HeadBox = { x0: number; y0: number; side: number };

/**
 * The square around the head, in the cut-out's pixels (alpha 0..255, row by row, w×h), as team-avatar.py frames it:
 * 70 % of the photo wide around the face's middle (the rows 6–14 % of the height below the top of the hair), the hair
 * 2 % of the height below the top edge. Undefined when there is no person.
 */
export function headBox(alpha: ArrayLike<number>, w: number, h: number): HeadBox | undefined {
  const solid = (x: number, y: number) => alpha[y * w + x] > 128;
  let top = -1;
  for (let y = 0; y < h && top < 0; y++) for (let x = 0; x < w; x++) if (solid(x, y)) { top = y; break; }
  if (top < 0) return undefined;
  // The face's left and right edge (PIL's getbbox: right is one past the last column).
  const span = (y0: number, y1: number) => {
    let left = w, right = -1;
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = 0; x < w; x++) if (solid(x, y)) { left = Math.min(left, x); right = Math.max(right, x); }
    return right < 0 ? undefined : { left, right: right + 1 };
  };
  const row = span(top + Math.trunc(0.06 * h), top + Math.trunc(0.14 * h)) ?? span(top, h)!;
  const cx = Math.floor((row.left + row.right) / 2);
  const side = Math.trunc(0.7 * w);
  return { x0: cx - Math.floor(side / 2), y0: top - Math.trunc(0.02 * h), side };
}

/** The segmenter's background confidence (0..1) as the person's alpha (0..255), without the faint halo around him. */
export function personAlpha(background: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(background.length);
  for (let i = 0; i < background.length; i++) {
    const a = Math.min(1, Math.max(0, (1 - background[i] - 0.35) / 0.4));
    out[i] = Math.round(a * 255);
  }
  return out;
}

/**
 * A light unsharp mask (3×3 Gaussian, like PIL's UnsharpMask(radius≈1, percent 70, threshold 2)) on RGBA pixels, in
 * place; the outermost pixels stay as they are.
 */
export function sharpen(px: Uint8ClampedArray, w: number, h: number, amount = 0.7, threshold = 2) {
  const src = new Uint8ClampedArray(px);
  const K = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let blur = 0;
        for (let k = 0; k < 9; k++) blur += K[k] * src[((y + Math.floor(k / 3) - 1) * w + x + (k % 3) - 1) * 4 + c];
        const i = (y * w + x) * 4 + c;
        const diff = src[i] - blur / 16;
        if (Math.abs(diff) >= threshold) px[i] = src[i] + amount * diff;
      }
    }
  }
}

// --- In the browser --------------------------------------------------------------------------------------------

type Mask = { width: number; height: number; getAsFloat32Array(): Float32Array };
type Segmenter = { segment(image: CanvasImageSource): { confidenceMasks?: Mask[]; close?(): void } };
let segmenter: Promise<Segmenter> | undefined;

/** MediaPipe's segmenter, loaded once (a failed load is tried again next time). */
function loadSegmenter(): Promise<Segmenter> {
  segmenter ??= (async () => {
    const vision = await import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
    return vision.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL },
      runningMode: "IMAGE",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    }) as Promise<Segmenter>;
  })();
  segmenter.catch(() => (segmenter = undefined));
  return segmenter;
}

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
const loadImage = async (src: string) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
};

/** Why it didn't work, in words for the coach. */
export class AvatarError extends Error {}

/**
 * The crest picture for a photo (its URL, same origin): a 480×480 JPEG. Throws AvatarError with a sentence to show
 * (the cutting tool didn't load, no person found).
 */
export async function makeTeamAvatar(photoUrl: string, crestUrl: string): Promise<Blob> {
  const seg = await loadSegmenter().catch(() => {
    throw new AvatarError("Das Werkzeug zum Freistellen hat nicht geladen.");
  });
  const [photo, crest] = await Promise.all([loadImage(photoUrl), loadImage(crestUrl)]);
  const W = photo.naturalWidth;
  const H = photo.naturalHeight;

  // The person's alpha, at the mask's size; smoothed a little on the way up to the photo's.
  const result = seg.segment(photo);
  const mask = result.confidenceMasks?.[0];
  if (!mask) throw new AvatarError("Auf dem Foto war niemand zu erkennen.");
  const alpha = personAlpha(mask.getAsFloat32Array());
  const m = canvas(mask.width, mask.height);
  const md = new ImageData(mask.width, mask.height);
  for (let i = 0; i < alpha.length; i++) md.data[i * 4 + 3] = alpha[i];
  m.getContext("2d")!.putImageData(md, 0, 0);
  result.close?.();

  const person = canvas(W, H);
  const pc = person.getContext("2d", { willReadFrequently: true })!;
  pc.drawImage(photo, 0, 0);
  pc.globalCompositeOperation = "destination-in";
  pc.imageSmoothingQuality = "high";
  pc.filter = "blur(1px)";
  pc.drawImage(m, 0, 0, W, H);
  pc.filter = "none";
  pc.globalCompositeOperation = "source-over";

  const rgba = pc.getImageData(0, 0, W, H).data;
  const a = new Uint8ClampedArray(W * H);
  for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3];
  const box = headBox(a, W, H);
  if (!box) throw new AvatarError("Auf dem Foto war niemand zu erkennen.");

  // White, the crest at 60 % (660/720 of the side, 30/40 in), the player on top; k: output px per photo px.
  const out = canvas(AVATAR, AVATAR);
  const oc = out.getContext("2d", { willReadFrequently: true })!;
  oc.imageSmoothingQuality = "high";
  oc.fillStyle = "#fff";
  oc.fillRect(0, 0, AVATAR, AVATAR);
  oc.globalAlpha = 0.6;
  const s = AVATAR / 720;
  oc.drawImage(crest, 30 * s, 40 * s, 660 * s, 660 * s);
  oc.globalAlpha = 1;
  const k = AVATAR / box.side;
  oc.drawImage(person, -box.x0 * k, -box.y0 * k, W * k, H * k);
  const pixels = oc.getImageData(0, 0, AVATAR, AVATAR);
  sharpen(pixels.data, AVATAR, AVATAR);
  oc.putImageData(pixels, 0, 0);

  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new AvatarError("Das Bild konnte nicht gespeichert werden.");
  return blob;
}
