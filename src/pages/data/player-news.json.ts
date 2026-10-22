import { articles } from "../../lib/data.ts";

/** Player id → his newest article's time, for the badge on the Scouting tab (small, cached by the browser). */
export function GET() {
  const latest: Record<number, string> = {};
  for (const a of articles()) if (a.player && !(a.player.id in latest)) latest[a.player.id] = a.publishedAt;
  return Response.json(latest);
}
