/** Photo size on the pitch, in px. */
export const AVATAR = 54;

/**
 * Position of player j (of n) in line i (of rows): goalkeeper at the bottom, attack at the top.
 * The point marks the photo's centre; names grow downwards, so every photo in a line sits at the same height.
 * mirror: LigaInsider lists each line as seen with the goalkeeper at the top; viewed from our end
 * (goalkeeper at the bottom) left and right swap.
 */
export function slotStyle(i: number, rows: number, j: number, n: number, opts: { mirror?: boolean } = {}): string {
  const top = rows <= 1 ? 50 : 84 - (i * 74) / (rows - 1);
  const left = (((opts.mirror ? n - 1 - j : j) + 1) * 100) / (n + 1);
  return `top:${top}%;left:${left}%;transform:translate(-50%,-${AVATAR / 2}px)`;
}
