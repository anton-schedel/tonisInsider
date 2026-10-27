import { NEWS_TYPE } from "./newsTypes.ts";
import { BOT_MOODS, CLUB, type CoachPost } from "./coachPosts.ts";

/**
 * Bot comments under the coach's posts: an LLM (Morpheus, OpenAI-style chat API) writes them, they're stored as
 * comments dated over the first minutes after the post, so they trickle in like real ones.
 */
export type BotPoll = { question: string; options: string[]; votes: number[] };
export type BotComment = { name: string; text: string; minute: number; replyTo?: number; upvotes?: number; poll?: BotPoll };

export const BOT_COUNT = 30;
/** Not always the same number, else it's plain they're bots: 25 to 42 per post. */
export const botCount = (random: () => number = Math.random) => 25 + Math.floor(random() * 18);
const MINUTES = 18;
const TEXT_MAX = 280;
const NAME_MAX = 30;

/** Results before the coach page existed (newest first); later ones come from the coach's result posts. */
export const SEASON = [
  "21.10.: 0:2 gegen FC Förderbedarf – deutlich besseres Spiel als zuletzt, aber zwei wichtige Spieler fehlten (u. a. Kevin Nguyen)",
  "14.10.: 1:7 gegen AS Tralkörper – nach der Pause vom Pressing überrollt, Ehrentreffer Ellenberger",
];

const MOOD_HINT: Record<keyof typeof BOT_MOODS, string> = {
  gemischt: "Mal besorgt, mal hoffnungsvoll, mal witzig, wie echte Fans eben.",
  froehlich: "Gute Laune, Vorfreude, Lob, viel Spaß.",
  frech: "Frech und frotzelig, mit Augenzwinkern, aber nie gemein.",
  wuetend: "Genervt und enttäuscht, fordern mehr Einsatz, schimpfen über das Spiel, nicht über Menschen.",
  traurig: "Niedergeschlagen, enttäuscht, trösten sich gegenseitig.",
};

/** Insults about someone's body, which the model sometimes still writes (e.g. from the coach's notes). */
const BODY_INSULT = /\b(?:fett(?:e[rsn]?)?\s*(?:sau|schwein|sack|kuh|arsch)|fettsack|dick(?:e[rsn]?)?\s+(?:sau|schwein|kuh)|zu\s+dick|wampe|bierbauch\w*|bierwampe|moppel\w*|pummel\w*|speckr[öo]ll\w*|kugelrund|plauze|schwabbel\w*|übergewicht\w*)\b/i;

/** Rows from the goalkeeper forward, named so the model knows who plays where. */
function positions(lines: string[][]): string[] {
  const labels = lines.length === 1 ? ["Tor"]
    : lines.length === 2 ? ["Tor", "Feld"]
    : lines.length === 3 ? ["Tor", "Abwehr", "Sturm"]
    : lines.length === 4 ? ["Tor", "Abwehr", "Mittelfeld", "Sturm"]
    : ["Tor", "Abwehr", ...lines.slice(2, -1).map(() => "Mittelfeld"), "Sturm"];
  return lines.map((l, i) => `${labels[i]}: ${l.join(", ")}`);
}

/** The coach's "what the bots should know": one topic per sentence or line. */
export const topicsOf = (context = "") =>
  context.split(/(?<=[.!?])\s+|\n+|;\s*/).map((t) => t.trim().replace(/[.]$/, "")).filter(Boolean);

/**
 * Comments per request. One request sees all its comments and doesn't repeat itself, so a fast model writes them
 * all at once; a slow one (Morpheus) gets small parallel requests, else the connection drops before it's done.
 */
export function batchPlan(count: number, topics: string[], size = 10): { count: number; topics: string[] }[] {
  const n = Math.max(1, Math.ceil(count / size));
  return Array.from({ length: n }, (_, i) => ({
    count: Math.floor(count / n) + (i < count % n ? 1 : 0),
    topics: topics.filter((_, t) => t % n === i),
  }));
}

/** polls: how many polls this batch may write (pollAllowance). */
/** compare: how many compare a player with a pro; forms: how they put it; earlier: bot comments under other posts. */
export type PromptOptions = {
  count?: number; topics?: string[]; existing?: string[]; polls?: number; batch?: number;
  compare?: number; forms?: string[]; voices?: string[]; earlier?: string[];
};

/** Each parallel batch draws its comparisons from another pool, else they all pick the same pro (Kahn, Neuer). */
const PRO_POOLS = [
  "aktuelle Bundesliga-Profis",
  "internationale Stars aus Premier League, La Liga oder Serie A",
  "Legenden der 90er und 2000er",
  "Kultspieler und Typen, die jeder kennt",
];

/**
 * Ways to put a comparison. Each post gets two at random; with one fixed example every post said
 * "X erinnert mich an Y – nur mit …".
 */
const COMPARE_FORMS = [
  "als Spitzname, der im Satz einfach so fällt",
  "über eine bestimmte, bekannte Szene dieses Profis",
  "als ironische Frage an die anderen",
  "als das genaue Gegenteil des Profis",
  "als kurzer Einwurf von ein paar Wörtern",
  "als Antwort auf einen anderen Kommentar, der den Vergleich weiterspinnt oder zerlegt",
  "über eine typische Geste oder Angewohnheit des Profis",
  "als maßlose Übertreibung, über die die anderen lachen",
];

/** Who comments. Each post gets a few at random, so the comments differ in what they say, not only in wording. */
// Said as "jemand, der …": labels like "Nörgler" or "Kabinen-Insider" ended up in the bots' names (Nörgelmax, KabineKlaus).
const VOICES = [
  "jemand, der alles schon vorher wusste",
  "jemand mit (frei erfundenen, harmlosen) Zahlen aus der Saison",
  "jemand, der angeblich mehr weiß als die anderen",
  "jemand mit einem schrägen Bild oder Wortspiel",
  "jemand, den nichts erschüttert",
  "jemand mit einer konkreten Idee zur Aufstellung",
  "jemand, der nur kurz reagiert (ein Wort, ein Emoji, eine Frage)",
  "jemand vom Gegner, der stichelt",
  "jemand, der seit Jahren dabei ist und von früher erzählt",
  "jemand, der vom Thema abschweift (Wetter, Platz, Trikots, drittes Halbzeit)",
  "jemand, der dem Coach eine direkte Frage stellt",
  "jemand, der alles maßlos übertreibt",
];

/** The goalkeepers every bot compared everyone with; and names that give a bot's part away (KabineKlaus, StatistikSepp). */
const WORN_PROS = /\b(?:kahn|tom starke|manuel neuer|neuer im tor|krake)\b/i;
const ROLE_NAME = /n[öo]rgl|nörgel|kabine|statisti|drama|witz|taktik|optimist|veteran|haudegen|insider|pessimist/i;

/** Comparisons for a post: none on some posts, one or two on the others, never one per ten like clockwork. */
export function comparePlan(random: () => number = Math.random): { count: number; forms: string[]; voices: string[] } {
  const r = random();
  const count = r < 0.3 ? 0 : r < 0.8 ? 1 : 2;
  const pick = <T,>(list: T[], n: number) => [...list].sort(() => random() - 0.5).slice(0, n);
  return { count, forms: pick(COMPARE_FORMS, 2), voices: pick(VOICES, 6) };
}

/** n things dealt out at random over the batches (polls, comparisons). */
export function spread(n: number, batches: number, random: () => number = Math.random): number[] {
  const out = Array.from({ length: batches }, () => 0);
  for (let i = 0; i < n; i++) out[Math.floor(random() * batches) % batches]++;
  return out;
}

/** Which batches of a post may write a poll: one or two in all, minus the polls the post has already. */
export function pollAllowance(batches: number, existingPolls: number, random: () => number = Math.random): number[] {
  return spread(Math.max(0, (random() < 0.5 ? 1 : 2) - existingPolls), batches, random);
}

export function botPrompt(post: CoachPost, recent: string[], opts: PromptOptions = {}): { system: string; user: string } {
  const count = opts.count ?? BOT_COUNT;
  const compare = opts.compare ?? 0;
  const polls = opts.polls ?? 0;
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
    `Stimmung: ${BOT_MOODS[d.bots?.mood ?? "gemischt"]}. ${MOOD_HINT[d.bots?.mood ?? "gemischt"]}`,
    "Sprüche und Frotzeleien nur über Fußball, das Spiel und die Geschichten aus dem Beitrag.",
    "Niemals über Aussehen, Gewicht, Herkunft, Religion, Sexualität, Krankheit oder Privates lästern und keine Schimpfwörter gegen Personen, auch wenn es in den Infos steht.",
    "Keine echten Personen außer den genannten Spielern (und Profis für Vergleiche),",
    "Namen bunt gemischt wie in einem echten Forum: mal Vorname mit Zahl, mal Spitzname, mal kleingeschrieben, mal „Max B.“, mal etwas Albernes; kein Muster (nicht immer Fan_von_X oder Vereinsname im Namen) und nie die Namen unserer Spieler im eigenen Namen.",
    "Jeder Kommentar sagt etwas Eigenes: keine zwei mit derselben Aussage, demselben Witz oder demselben Anfang.",
    "Unterschiedlich lang (meist 1 bis 2 Sätze, manche nur ein paar Wörter), höchstens ein Drittel antwortet auf einen früheren Kommentar, höchstens 3 Antworten unter demselben.",
    ...(compare
      ? [
        `${compare === 1 ? "Genau 1 Kommentar vergleicht" : `Genau ${compare} Kommentare vergleichen`} einen unserer Spieler mit einem bekannten Profi, die anderen nicht.`,
        // The bots compared everyone to goalkeepers (Neuer, Kahn, Starke), and always the same way.
        `Der Profi passt zur Position (Torhüter mit Torhütern, Stürmer mit Stürmern usw.) und kommt aus diesem Bereich: ${PRO_POOLS[(opts.batch ?? 0) % PRO_POOLS.length]}; kein Neuer, Kahn oder Starke.`,
        `Mit dem echten Namen eines Spielers aus dem Beitrag (keine Platzhalter), ${(opts.forms ?? COMPARE_FORMS.slice(0, 2)).join(" oder ")}. Die Wörter „erinnert“ und „wie ein junger“ kommen darin nicht vor, und kein „– nur mit/ohne …“ am Ende.`,
      ]
      : ["Keine Vergleiche mit Profis."]),
    ...(opts.voices?.length ? [`Unter den Kommentatoren sind diesmal u. a.: ${opts.voices.join("; ")}. Jeder hat seinen eigenen Blick, kein Satzanfang kommt mehr als zweimal vor. Die Typen stehen nie im Namen (kein „Nörgler82“, „Taktik-Fuchs“).`] : []),
    "Keine Floskeln, die man unter jedem Beitrag liest (Kopf hoch Jungs, nicht schon wieder, hoffentlich zünden die); lieber konkret, schräg, überraschend.",
    "Jeder Kommentar bekommt \"upvotes\": wie viele Daumen hoch er bekommt (0 bis 40, ungleich verteilt: viele 0 bis 5, gute Sprüche mehr).",
    polls
      ? `Genau ${polls === 1 ? "1 Kommentar ist eine Umfrage" : `${polls} Kommentare sind Umfragen`}: "poll": {"question": kurze Frage zum Beitrag, "options": 2 bis 4 kurze Antworten, "votes": Stimmen je Antwort (zusammen 6 bis 30)}; der "text" ist dann die Frage.`
      : "Keine Umfragen.",
    `Antworte nur mit einem JSON-Array mit ${count} Objekten: {"name": string, "text": string, "minute": Zahl 0 bis ${MINUTES}, "upvotes": Zahl, "replyTo": Index eines früheren Kommentars (optional), "poll": nur bei Umfragen}.`,
  ].join(" ");

  // Each thing the coach wants them to know is one topic; only a few comments take each up, else all 30 sound alike.
  const topics = opts.topics ?? topicsOf(d.bots?.context);
  const user = [
    "Beitrag:",
    ...about,
    "",
    "Letzte Ergebnisse (neueste zuerst; höchstens 5 Kommentare erwähnen sie, die anderen reden über diesen Beitrag):",
    ...[...recent, ...SEASON].map((r) => `- ${r}`),
    ...(topics.length
      ? ["", "Was einige Kommentatoren wissen (Jedes Thema greifen nur 3 bis 5 Kommentare auf, verteilt über die Liste; die meisten Kommentare reden über den Beitrag selbst):", ...topics.map((t) => `- ${t}`)]
      : []),
    ...(opts.earlier?.length
      ? ["", "So klangen die Bots unter früheren Beiträgen; klingt anders (andere Wörter, andere Witze, anderer Satzbau):", ...opts.earlier.map((c) => `- ${c}`)]
      : []),
    ...(opts.existing?.length
      ? ["", "Diese Kommentare stehen schon da (nicht wiederholen; ihr dürft darauf eingehen):", ...opts.existing.map((c) => `- ${c}`)]
      : []),
  ].join("\n");
  return { system, user };
}

/** The model's answer → usable comments. Tolerates code fences and prose around the list; junk gives []. */
/** Our players (from the posts so far); bots never comment under their names. */
const SQUAD = ["Coach", "Gerl", "Dallwig", "Chatfield", "Daniel Torres", "Ellenberger", "Luca Loibl", "Enciu", "Schedel", "Leonhard", "Kevin Nguyen", "Oliver Kowol"];

/** Lower-case name parts (4+ letters) of the squad and of the players in this post. */
export function playerNames(post: CoachPost): string[] {
  const all = [...SQUAD, ...(post.data.lineup?.lines.flat() ?? []), ...(post.data.lineup?.bench ?? []), post.data.player?.name ?? ""];
  return [...new Set(all.flatMap((n) => n.toLowerCase().split(/[^a-zäöüß]+/)).filter((w) => w.length >= 4))];
}

/** A bot's poll: 2 to 4 answers, votes 0–40 each; dropped if its text breaks the rules. */
function parsePoll(raw: unknown): BotPoll | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { question?: unknown; options?: unknown; votes?: unknown };
  const question = typeof r.question === "string" ? r.question.trim().slice(0, 200) : "";
  const options = (Array.isArray(r.options) ? r.options : []).map((o) => (typeof o === "string" ? o.trim().slice(0, 80) : "")).filter(Boolean).slice(0, 4);
  if (question.length < 3 || options.length < 2) return undefined;
  if ([question, ...options].some((t) => BODY_INSULT.test(t))) return undefined;
  // Players may be named in a poll ("Loibl raus?"), unlike in bot names.
  const votes = options.map((_, i) => {
    const v = Array.isArray(r.votes) ? Number(r.votes[i]) : NaN;
    return Number.isFinite(v) ? Math.min(40, Math.max(0, Math.round(v))) : 0;
  });
  return { question, options, votes };
}

export function parseBots(answer: string, playerWords: string[] = []): BotComment[] {
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
    const { name, text, minute, replyTo, upvotes, poll } = c as Record<string, unknown>;
    const n = typeof name === "string" ? name.trim() : "";
    const t = typeof text === "string" ? text.trim() : "";
    if (!n || !t || n.length > NAME_MAX || t.length > TEXT_MAX || BODY_INSULT.test(t) || BODY_INSULT.test(n)) return;
    if (WORN_PROS.test(t) || ROLE_NAME.test(n)) return;
    // A bot posing as a teammate ("KevinN88: last time I was missing") isn't a joke anymore.
    if (playerWords.some((w) => n.toLowerCase().includes(w))) return;
    const m = typeof minute === "number" && Number.isFinite(minute) ? Math.min(MINUTES, Math.max(0, Math.round(minute))) : 0;
    let parent = typeof replyTo === "number" && replyTo < i ? kept.get(replyTo) : undefined;
    // Threads are one level deep: a reply to a reply goes under the first comment.
    if (parent !== undefined) parent = out[parent].replyTo ?? parent;
    kept.set(i, out.length);
    const up = typeof upvotes === "number" && Number.isFinite(upvotes) ? Math.min(40, Math.max(0, Math.round(upvotes))) : undefined;
    const p = parsePoll(poll);
    out.push({ name: n, text: t, minute: m, ...(parent !== undefined ? { replyTo: parent } : {}), ...(up !== undefined ? { upvotes: up } : {}), ...(p ? { poll: p } : {}) });
  });
  return out;
}

// Words that say nothing about what a comment means; the rest are compared by their first six letters (Testspiel/Testspiels).
const FILLER = new Set("aber alle auch beim bitte dann dass denn diese doch eine einen einer echt eben erst etwas gegen gerade gibt hier immer jetzt kein keine klar macht mach mehr mich mein meine nach nicht noch nur oder schon sein seine sich sind soll unser unsere viel wenn wieder wird wirds wäre ganz einfach wohl haben habe hatte mann leute endlich hoffentlich richtig".split(" "));
const gist = (t: string) => new Set(t.toLowerCase().replace(/[^a-zäöüß0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !FILLER.has(w)).map((w) => w.slice(0, 6)));

/** Two comments say about the same: at least 3 words in common, half of the shorter one's. */
export function similar(a: string, b: string): boolean {
  const A = gist(a), B = gist(b);
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared >= 3 && shared >= Math.min(A.size, B.size) / 2;
}

/** Drops comments that repeat an earlier one (polls stay); replies to a dropped one go under the one it repeats. */
export function dropSimilar(bots: BotComment[]): BotComment[] {
  const out: BotComment[] = [];
  const to = new Map<number, number>();
  bots.forEach((b, i) => {
    const parent = b.replyTo !== undefined ? to.get(b.replyTo) : undefined;
    const twin = b.poll ? -1 : out.findIndex((o) => !o.poll && similar(o.text, b.text));
    if (twin >= 0) { to.set(i, out[twin].replyTo ?? twin); return; }
    to.set(i, out.length);
    const { replyTo: _, ...rest } = b;
    out.push(parent !== undefined ? { ...rest, replyTo: parent } : rest);
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

/** "Jetzt veröffentlichen": planned comments moved so the first comes in a few seconds, the gaps kept. */
export function startNow(rows: { id: number; created_at: string }[], now: Date): { id: number; created_at: string }[] {
  const planned = rows.filter((r) => Date.parse(r.created_at) > now.getTime()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!planned.length) return [];
  const shift = Date.parse(planned[0].created_at) - (now.getTime() + 5000);
  return planned.map((r) => ({ id: r.id, created_at: new Date(Date.parse(r.created_at) - shift).toISOString() }));
}

export type BotRow = { name: string; body: string; createdAt: string; replyTo?: number; upvotes?: number; poll?: BotPoll };

/** When each comment appears: its minute after the post plus a few seconds, replies after their parent. */
export function botRows(publishedAt: string, bots: BotComment[]): BotRow[] {
  const start = Date.parse(publishedAt);
  const times: number[] = [];
  bots.forEach((b, i) => {
    let t = start + b.minute * 60_000 + ((i * 37) % 55 + 3) * 1000;
    if (b.replyTo !== undefined) t = Math.max(t, times[b.replyTo] + 25_000 + ((i * 13) % 40) * 1000);
    times.push(Math.min(t, start + (MINUTES + 1) * 60_000 + i * 1000));
  });
  return bots.map((b, i) => ({
    name: b.name, body: b.text, createdAt: new Date(times[i]).toISOString(),
    ...(b.replyTo !== undefined ? { replyTo: b.replyTo } : {}),
    ...(b.upvotes !== undefined ? { upvotes: b.upvotes } : {}),
    ...(b.poll ? { poll: b.poll } : {}),
  }));
}

/** batch: comments per request (see batchPlan). */
export type ModelConfig = { url: string; key: string; model: string; batch: number };

type ModelEnv = Partial<Record<"LLM_API_KEY" | "LLM_BASE_URL" | "LLM_MODEL" | "MORPHEUS_API_KEY" | "MORPHEUS_BASE_URL" | "MORPHEUS_MODEL", string>>;

/** The model for bot comments: LLM_* (e.g. Grok at xAI) if set, else Morpheus; undefined if neither is complete. */
export function modelFromEnv(e: ModelEnv): ModelConfig | undefined {
  if (e.LLM_API_KEY && e.LLM_BASE_URL && e.LLM_MODEL) return { url: e.LLM_BASE_URL, key: e.LLM_API_KEY, model: e.LLM_MODEL, batch: 50 };
  if (e.MORPHEUS_API_KEY && e.MORPHEUS_BASE_URL && e.MORPHEUS_MODEL) return { url: e.MORPHEUS_BASE_URL, key: e.MORPHEUS_API_KEY, model: e.MORPHEUS_MODEL, batch: 10 };
  return undefined;
}

/** One chat completion; the answer's text. */
export async function askModel(cfg: ModelConfig, prompt: { system: string; user: string }, fetcher: typeof fetch = fetch, timeoutMs = 300_000): Promise<string> {
  const res = await fetcher(`${cfg.url.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json" },
    // Streamed: the answer comes in pieces, so no proxy on the way drops the connection as idle while it thinks.
    body: JSON.stringify({ model: cfg.model, stream: true, temperature: 1, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`model: HTTP ${res.status}`);
  if (!res.headers.get("content-type")?.includes("event-stream")) {
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
  let text = "";
  for (const line of (await res.text()).split("\n")) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    try {
      text += (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? "";
    } catch { /* a keep-alive or a line we don't know */ }
  }
  return text;
}
