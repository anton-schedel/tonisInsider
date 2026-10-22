import { NEWS_TYPE } from "./newsTypes.ts";
import { CLUB, type CoachPost } from "./coachPosts.ts";

/**
 * Bot comments under the coach's posts: an LLM (Morpheus, OpenAI-style chat API) writes them, they're stored as
 * comments dated over the first minutes after the post, so they trickle in like real ones.
 */
export type BotComment = { name: string; text: string; minute: number; replyTo?: number };

export const BOT_COUNT = 30;
const MINUTES = 18;
const TEXT_MAX = 280;
const NAME_MAX = 30;

/** Results before the coach page existed (newest first); later ones come from the coach's result posts. */
export const SEASON = [
  "21.10.: 0:2 gegen FC Förderbedarf – deutlich besseres Spiel als zuletzt, aber zwei wichtige Spieler fehlten (u. a. Kevin Nguyen)",
  "14.10.: 1:7 gegen AS Tralkörper – nach der Pause vom Pressing überrollt, Ehrentreffer Ellenberger",
];

/** Rows from the goalkeeper forward, named so the model knows who plays where. */
function positions(lines: string[][]): string[] {
  const labels = lines.length === 1 ? ["Tor"]
    : lines.length === 2 ? ["Tor", "Feld"]
    : lines.length === 3 ? ["Tor", "Abwehr", "Sturm"]
    : lines.length === 4 ? ["Tor", "Abwehr", "Mittelfeld", "Sturm"]
    : ["Tor", "Abwehr", ...lines.slice(2, -1).map(() => "Mittelfeld"), "Sturm"];
  return lines.map((l, i) => `${labels[i]}: ${l.join(", ")}`);
}

export function botPrompt(post: CoachPost, recent: string[]): { system: string; user: string } {
  const d = post.data;
  const about: string[] = [`Überschrift: ${d.headline}`];
  if (post.type === "lineup" && d.lineup) {
    about.unshift("Art: Aufstellung für das nächste Spiel");
    about.push(...positions(d.lineup.lines));
    if (d.lineup.bench.length) about.push(`Bank: ${d.lineup.bench.join(", ")}`);
  } else if (post.type === "result" && d.result) {
    const r = d.result;
    about.unshift("Art: Spielbericht");
    about.push(`Ergebnis: ${CLUB.name} ${r.ours}:${r.theirs} gegen ${r.opponent} (${r.home ? "Heimspiel" : "Auswärtsspiel"})`);
  } else if (post.type === "player" && d.player) {
    about.unshift("Art: Spielernews");
    about.push(`Spieler: ${d.player.name}${NEWS_TYPE[d.player.newsType] ? ` (Status: ${NEWS_TYPE[d.player.newsType]!.label})` : ""}`);
  }
  if (d.text) about.push(`Text: ${d.text}`);

  const system = [
    `Du schreibst Kommentare unter Beiträge über den ${CLUB.name}, eine Freizeit-Fußballmannschaft aus München.`,
    "Die Kommentatoren sind Fans, Freunde und Mitspieler: locker, kurz, umgangssprachlich, manchmal mit Emoji, wie in einem Fußballforum.",
    "Sie reagieren auf genau diesen Beitrag und die Lage der Mannschaft: Sorgen, Hoffnung, Fragen, Tipps, Sprüche.",
    "Regeln: keine Beleidigungen, nichts Verletzendes über Spieler, keine echten Personen außer den genannten Spielern,",
    "verschiedene Namen (Forums-Spitznamen), unterschiedlich lang (meist 1 bis 2 Sätze), etwa ein Drittel antwortet auf einen früheren Kommentar.",
    `Antworte nur mit einem JSON-Array mit ${BOT_COUNT} Objekten: {"name": string, "text": string, "minute": Zahl 0 bis ${MINUTES}, "replyTo": Index eines früheren Kommentars (optional)}.`,
  ].join(" ");

  const user = [
    "Beitrag:",
    ...about,
    "",
    "Letzte Ergebnisse (neueste zuerst):",
    ...[...recent, ...SEASON].map((r) => `- ${r}`),
    ...(d.bots?.context ? ["", `Das sollen die Kommentatoren außerdem wissen: ${d.bots.context}`] : []),
  ].join("\n");
  return { system, user };
}

/** The model's answer → usable comments. Tolerates code fences and prose around the list; junk gives []. */
export function parseBots(answer: string): BotComment[] {
  const start = answer.indexOf("[");
  const end = answer.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try { raw = JSON.parse(answer.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: BotComment[] = [];
  // Index in the model's list → index in ours (some get dropped).
  const kept = new Map<number, number>();
  raw.forEach((c, i) => {
    if (!c || typeof c !== "object") return;
    const { name, text, minute, replyTo } = c as Record<string, unknown>;
    const n = typeof name === "string" ? name.trim() : "";
    const t = typeof text === "string" ? text.trim() : "";
    if (!n || !t || n.length > NAME_MAX || t.length > TEXT_MAX) return;
    const m = typeof minute === "number" && Number.isFinite(minute) ? Math.min(MINUTES, Math.max(0, Math.round(minute))) : 0;
    let parent = typeof replyTo === "number" && replyTo < i ? kept.get(replyTo) : undefined;
    // Threads are one level deep: a reply to a reply goes under the first comment.
    if (parent !== undefined) parent = out[parent].replyTo ?? parent;
    kept.set(i, out.length);
    out.push({ name: n, text: t, minute: m, ...(parent !== undefined ? { replyTo: parent } : {}) });
  });
  return out;
}

/**
 * After a save: a post that isn't out yet gets fresh bot comments (its old ones not out yet are replaced). One
 * that is out keeps the ones it has, else every edit would add another 30; it only gets some if it has none.
 */
export function shouldWriteBots(post: CoachPost, now: Date, existing: number): "write" | "keep" | "clear" {
  if (!post.data.bots?.on) return "clear";
  if (Date.parse(post.publishedAt) <= now.getTime() && existing > 0) return "keep";
  return "write";
}

export type BotRow = { name: string; body: string; createdAt: string; replyTo?: number };

/** When each comment appears: its minute after the post plus a few seconds, replies after their parent. */
export function botRows(publishedAt: string, bots: BotComment[]): BotRow[] {
  const start = Date.parse(publishedAt);
  const times: number[] = [];
  bots.forEach((b, i) => {
    let t = start + b.minute * 60_000 + ((i * 37) % 55 + 3) * 1000;
    if (b.replyTo !== undefined) t = Math.max(t, times[b.replyTo] + 25_000 + ((i * 13) % 40) * 1000);
    times.push(Math.min(t, start + (MINUTES + 1) * 60_000 + i * 1000));
  });
  return bots.map((b, i) => ({ name: b.name, body: b.text, createdAt: new Date(times[i]).toISOString(), ...(b.replyTo !== undefined ? { replyTo: b.replyTo } : {}) }));
}

export type ModelConfig = { url: string; key: string; model: string };

/** One chat completion; the answer's text. */
export async function askModel(cfg: ModelConfig, prompt: { system: string; user: string }, fetcher: typeof fetch = fetch, timeoutMs = 120_000): Promise<string> {
  const res = await fetcher(`${cfg.url.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: cfg.model, stream: false, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`model: HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}
