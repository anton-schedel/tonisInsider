import { NEWS_TYPE } from "./newsTypes.ts";
import { BOT_MOODS, CLUB, type CoachPost } from "./coachPosts.ts";
import { kickoffDay } from "./format.ts";

/**
 * Bot comments under the coach's posts: an LLM (Morpheus, OpenAI-style chat API) writes them, they're stored as
 * comments dated over the first minutes after the post, so they trickle in like real ones.
 */
export type BotPoll = { question: string; options: string[]; votes: number[] };
/** name: given by botNames (the model named everyone after their comment: PizzaAugenzeuge, Trainerfrage). */
/** at: the comment's number in the model's answer (its slot in the plan). */
export type BotComment = { name: string; text: string; minute: number; replyTo?: number; upvotes?: number; poll?: BotPoll; at?: number };

export const BOT_COUNT = 30;
/** Not always the same number, else it's plain they're bots: 25 to 42 per post. */
export const botCount = (random: () => number = Math.random) => 25 + Math.floor(random() * 18);
const MINUTES = 18;
const TEXT_MAX = 280;

/** What happened before the coach page existed (hand-written posts), newest first. */
const OLD_STORIES = [
  "21.10.: Aufstellung gegen Förderbedarf: Coach – Gerl, Dallwig, Chatfield – Torres, Ellenberger – Loibl; Bank: Enciu, Schedel, Leonhard",
  "21.10.: Nicht im Kader: Kevin Nguyen fehlt gegen Förderbedarf, Gründe unbekannt",
  "14.10.: Aufstellung gegen Tralkörper: Coach – Dallwig, Chatfield, Torres, Ellenberger, Kowol, Nguyen; Bank: Enciu, Gerl, Paule, Schedel, Loibl, Leonhard",
];

/**
 * The club's story so far, for callbacks ("Kowol findet aus dem Klo, aber nicht in den Strafraum"): the coach's
 * earlier posts (lineups in full, news as headline and first sentence), newest first, then the old ones.
 */
export function storiesOf(posts: CoachPost[], post: CoachPost, max = 8): string[] {
  const day = (p: CoachPost) => kickoffDay(p.publishedAt).replace(/^\S+ /, "");
  const told = posts
    .filter((p) => p.id !== post.id && p.type !== "result" && p.publishedAt < post.publishedAt)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, max)
    .map((p) => {
      const l = p.data.lineup;
      if (p.type === "lineup" && l) return `${day(p)}: Aufstellung: ${l.lines.map((r) => r.join(", ")).join(" – ")}${l.bench.length ? `; Bank: ${l.bench.join(", ")}` : ""}`;
      const first = (p.data.text ?? "").split(/(?<=[.!?])\s/)[0]?.trim().slice(0, 160);
      return `${day(p)}: ${p.data.headline}${first ? ` – ${first}` : ""}`;
    });
  return [...told, ...OLD_STORIES];
}

/** Results before the coach page existed (newest first); later ones come from the coach's result posts. */
export const SEASON = [
  "21.10.: 0:2 gegen FC Förderbedarf – deutlich besseres Spiel als zuletzt, aber zwei wichtige Spieler fehlten (u. a. Kevin Nguyen)",
  "14.10.: 1:7 gegen AS Tralkörper – nach der Pause vom Pressing überrollt, Ehrentreffer Ellenberger",
];

/**
 * The hand-written results the coach's result posts don't have yet: the 0:2 against Förderbedarf was in both, and
 * the bots wrote about "den zwei 0:2 gegen Förderbedarf".
 */
export const seasonBefore = (recent: string[]) =>
  SEASON.filter((line) => !recent.some((r) => { const opponent = r.split(" gegen ")[1]; return !!opponent && line.includes(opponent); }));

const MOOD_HINT: Record<keyof typeof BOT_MOODS, string> = {
  gemischt: "Mal besorgt, mal hoffnungsvoll, mal witzig, mal wütend, wie echte Fans eben.",
  froehlich: "Gute Laune, Vorfreude, Lob, viel Spaß.",
  frech: "Frech und frotzelig, mit Augenzwinkern, kann auch mal etwas Schlimmes schreiben.",
  wuetend: "Genervt und enttäuscht, fordern mehr Einsatz, schimpfen über das Spiel, beleidigen die Menschen.",
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
/** plan: what each comment is about (commentPlan); earlier: bot comments under other posts; stories: storiesOf. */
export type PromptOptions = {
  count?: number; topics?: string[]; existing?: string[]; polls?: number; batch?: number;
  compare?: number; forms?: string[]; earlier?: string[]; stories?: string[]; plan?: Slot[];
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
  "jemand, der mit den echten Ergebnissen der Saison rechnet (es gab erst die paar Spiele unten)",
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

/** The goalkeepers every bot compared everyone with. */
const WORN_PROS = /\b(?:kahn|tom starke|manuel neuer|neuer im tor|krake)\b/i;

const FIRST = ["Max", "Flo", "Basti", "Toni", "Kalle", "Michi", "Luki", "Seppi", "Hansi", "Andi", "Domi", "Jonas", "Felix", "Tobi", "Simon", "Lena", "Jule", "Caro", "Nico", "Paul", "Ben", "Moritz", "Vroni", "Resi", "Schorsch", "Wastl", "Ferdl", "Steffi", "Chris", "Jakob", "Korbi", "Quirin", "Marco", "Sandro", "Deniz", "Mehmet", "Ivan", "Anna", "Sophie", "Lisa", "Benni", "Jojo", "Matze", "Olli", "Rudi", "Fabi", "Vinc", "Elias", "Mia", "Hias"];
const PLACES = ["Giesing", "Haidhausen", "Schwabing", "Sendling", "Pasing", "Moosach", "der Au", "Bogenhausen", "Garching", "Freising", "Laim", "Neuhausen"];
const HANDLES = ["Bolzplatzlegende", "Weißbierwade", "Grätschenkönig", "Isarkicker", "Kreisligakaiser", "Sonntagskicker", "Abseitsfalle", "Flankengott", "Breznsalzer", "Tribünenhocker", "Seitenauslinie", "Pfostenschuss", "Rasenmäher", "Eckfahne", "Kabinenduft", "Stollenschuh"];

/**
 * Forum names, mixed like real ones (kalle86, Max B., Flo aus Giesing, Weißbierwade): never a player's name
 * (a bot posing as a teammate isn't a joke anymore), now and then the same person twice.
 */
export function botNames(n: number, playerWords: string[] = [], random: () => number = Math.random): string[] {
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length) % list.length];
  const num = () => String(Math.floor(random() * 99) + 1).padStart(random() < 0.5 ? 2 : 1, "0");
  const letter = () => "ABCDEFGHKLMNPRSTW"[Math.floor(random() * 17) % 17];
  const forms = [
    (f: string) => `${f.toLowerCase()}${num()}`,
    (f: string) => `${f}${num()}`,
    (f: string) => `${f}_${num()}`,
    (f: string) => `${f} ${letter()}.`,
    (f: string) => `${f.toLowerCase()}.${letter().toLowerCase()}`,
    (f: string) => `${f} aus ${pick(PLACES)}`,
    (f: string) => f,
    () => pick(HANDLES),
    () => `${pick(HANDLES)}${num()}`,
  ];
  const out: string[] = [];
  // Each first name or handle once (Anna_83, Anna_94 and Anna07 under one post read like a bot farm).
  const used = new Set<string>();
  while (out.length < n) {
    if (out.length > 3 && random() < 0.08) { out.push(pick(out)); continue; }
    for (let tries = 0; ; tries++) {
      const first = pick(FIRST);
      const name = pick(forms)(first);
      const base = HANDLES.find((h) => name.startsWith(h)) ?? first;
      if ((used.has(base) && tries < 50) || out.includes(name) || playerWords.some((w) => name.toLowerCase().includes(w))) continue;
      used.add(base);
      out.push(name);
      break;
    }
  }
  return out;
}

/** Comparisons for a post: none on some posts, one or two on the others, never one per ten like clockwork. */
export function comparePlan(random: () => number = Math.random): { count: number; forms: string[] } {
  const r = random();
  const count = r < 0.3 ? 0 : r < 0.8 ? 1 : 2;
  return { count, forms: shuffle(COMPARE_FORMS, random).slice(0, 2) };
}

const shuffle = <T,>(list: T[], random: () => number) => list.map((v) => [random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

const LENGTHS = ["ein paar Wörter", "ein Satz", "ein Satz", "ein Satz", "ein bis zwei Sätze", "zwei Sätze"];
/** A bare emoji or word now and then; one in seven was too many. */
const length = (random: () => number) => (random() < 0.04 ? "nur ein Wort oder Emoji" : LENGTHS[Math.floor(random() * LENGTHS.length) % LENGTHS.length]);

/** One comment to write: who, how long, about what; replyTo is another slot's index. */
export type Slot = { voice: string; length: string; about: string; minute: number; replyTo?: number; compare?: string; poll?: boolean };

/**
 * What each comment is about, dealt out in code. Told "only 2–3 per topic, a few callbacks", the model still wrote
 * seven "ohne Gerl wird's wie beim 1:7" under one post; with a plan each comment has its own job: the coach's
 * topics 2–3 times each, a few callbacks to older stories, the results a couple of times, something off-topic, the
 * rest the post itself, each in another voice; about a quarter answer another comment (at most 3 under one).
 */
export function commentPlan(
  n: number,
  input: { topics?: string[]; stories?: string[]; compare?: number; forms?: string[]; polls?: number },
  random: () => number = Math.random,
): Slot[] {
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const replies = n >= 6 ? Math.round(n * (0.18 + random() * 0.12)) : 0;
  const room = n - replies;
  const special = [
    ...(input.topics ?? []).flatMap((t) => Array.from({ length: int(2, 3) }, () => `Thema: ${t}`)),
    ...shuffle(input.stories ?? [], random).slice(0, Math.max(1, Math.round(room / 7))).map((t) => `Anspielung auf: ${t}`),
    ...Array.from({ length: room >= 12 ? int(2, 3) : 1 }, () => "die letzten Ergebnisse"),
    ...Array.from({ length: room >= 12 ? int(1, 2) : 0 }, () => "etwas abseits vom Thema (Training, Platz, Kabine, Trikots, das Bier danach)"),
  ].slice(0, Math.ceil(room * 0.6));
  const abouts = shuffle([...special, ...Array.from({ length: room - special.length }, () => "den Beitrag: eine Einzelheit oder Seite, die sonst keiner aufgreift")], random);
  const voices = shuffle(VOICES, random);
  const slots: Slot[] = abouts.map((about, i) => ({ voice: voices[i % voices.length], length: length(random), about, minute: 0 }));
  // Comparisons and polls go to comments about the post itself.
  const own = shuffle(slots.filter((s) => s.about.startsWith("den Beitrag")), random);
  own.slice(0, input.compare ?? 0).forEach((s, i) => { s.compare = (input.forms ?? COMPARE_FORMS)[i % (input.forms ?? COMPARE_FORMS).length]; });
  own.slice(input.compare ?? 0, (input.compare ?? 0) + (input.polls ?? 0)).forEach((s) => { s.poll = true; s.length = "eine kurze Frage"; });
  const under = new Map<Slot, number>();
  for (let r = 0; r < replies; r++) {
    const targets = slots.filter((s) => s.replyTo === undefined && !s.about.startsWith("antwortet") && (under.get(s) ?? 0) < 3);
    if (!targets.length) break;
    const target = targets[int(0, targets.length - 1)];
    under.set(target, (under.get(target) ?? 0) + 1);
    const reply: Slot & { to?: Slot } = { voice: voices[(slots.length + r) % voices.length], length: LENGTHS[int(0, 3)], about: "antwortet", minute: 0, to: target };
    // Right under it (or nearly): replies far down the list lost track of what they answered.
    const at = slots.indexOf(target) + 1;
    slots.splice(Math.min(slots.length, at + int(0, 1)), 0, reply);
  }
  return slots.map((s, i) => {
    const { to, ...slot } = s as Slot & { to?: Slot };
    const minute = Math.min(MINUTES, Math.round((i / Math.max(1, slots.length - 1)) * MINUTES));
    if (!to) return { ...slot, minute };
    const t = slots.indexOf(to);
    return { ...slot, minute, replyTo: t, about: `antwortet direkt auf Nr. ${t} und geht auf genau das ein, was dort steht (stimmt zu, widerspricht, legt nach oder nimmt es auf die Schippe)` };
  });
}

/** The model's comments put in their slots: time and thread from the plan, a poll only where one was planned. */
export function applyPlan(bots: BotComment[], plan: Slot[]): BotComment[] {
  const out: BotComment[] = [];
  const index = new Map<number, number>();
  for (const b of bots) {
    const slot = b.at !== undefined ? plan[b.at] : undefined;
    const { replyTo: _, at: __, poll, ...rest } = b;
    if (!slot) { out.push({ ...rest, ...(poll ? { poll } : {}) }); continue; }
    index.set(b.at!, out.length);
    const parent = slot.replyTo !== undefined ? index.get(slot.replyTo) : undefined;
    out.push({ ...rest, minute: slot.minute, ...(parent !== undefined ? { replyTo: parent } : {}), ...(poll && slot.poll ? { poll } : {}) });
  }
  return out;
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
  const d = post.data;
  const plan = opts.plan ?? commentPlan(opts.count ?? BOT_COUNT, { topics: opts.topics ?? topicsOf(d.bots?.context), stories: opts.stories, compare: opts.compare, forms: opts.forms, polls: opts.polls });
  const compare = plan.some((s) => s.compare);
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
    "Die Kommentatoren sind Fans, Freunde und Mitspieler: locker, umgangssprachlich, manchmal mit Emoji, wie in einem Fußballforum.",
    `Stimmung: ${BOT_MOODS[d.bots?.mood ?? "gemischt"]}. ${MOOD_HINT[d.bots?.mood ?? "gemischt"]}`,
    "Sprüche und Frotzeleien nur über Fußball, das Spiel und die Geschichten aus dem Beitrag.",
    "Niemals über Aussehen, Gewicht, Herkunft, Religion, Sexualität, Krankheit oder Privates lästern, auch wenn es in den Infos steht.",
    "Keine echten Personen außer den genannten Spielern (und Profis für Vergleiche); Spieler beim Namen, wie er in den Infos steht (keine erfundenen Vornamen), keine erfundenen Statistiken.",
    "Du bekommst einen Plan: jeder Kommentar hat seinen eigenen Absender, seine Länge und sein Thema; halte dich daran, damit keine zwei dasselbe sagen. Kein Satzanfang mehr als zweimal.",
    "Keine Floskeln, die man unter jedem Beitrag liest (Kopf hoch Jungs, nicht schon wieder, hoffentlich zünden die); lieber konkret, schräg, überraschend, vielleicht auch beleidigend.",
    ...(compare
      ? [
        // The bots compared everyone to goalkeepers (Neuer, Kahn, Starke), and always the same way.
        `Vergleiche mit Profis nur, wo der Plan es sagt: der Profi passt zur Position (Torhüter mit Torhütern, Stürmer mit Stürmern usw.) und kommt aus diesem Bereich: ${PRO_POOLS[(opts.batch ?? 0) % PRO_POOLS.length]}; kein Neuer, Kahn oder Starke; mit dem echten Namen unseres Spielers; nie „erinnert mich an“, „wie ein junger“ oder „– nur mit/ohne …“ am Ende.`,
      ]
      : ["Keine Vergleiche mit Profis."]),
    "Jeder Kommentar bekommt \"upvotes\": wie viele Daumen hoch er bekommt (0 bis 40, ungleich verteilt: viele 0 bis 5, gute Sprüche mehr).",
    plan.some((s) => s.poll)
      ? `Umfragen nur, wo der Plan es sagt: {"nr": 4, "text": "Spielt Julian?", "upvotes": 3, "poll": {"question": "Spielt Julian?", "options": 2 bis 4 kurze Antworten, "votes": Stimmen je Antwort, zusammen 6 bis 30}}.`
      : "Keine Umfragen.",
    `Antworte nur mit einem JSON-Array mit ${plan.length} Objekten in der Reihenfolge des Plans: {"nr": Nummer im Plan, "text": string, "upvotes": Zahl, "poll": nur bei Umfragen}.`,
  ].join(" ");

  const user = [
    "Beitrag:",
    ...about,
    "",
    "Letzte Ergebnisse (neueste zuerst):",
    ...[...recent, ...seasonBefore(recent)].map((r) => `- ${r}`),
    ...(opts.earlier?.length
      ? ["", "So klangen die Bots unter früheren Beiträgen; klingt anders (andere Wörter, andere Witze, anderer Satzbau):", ...opts.earlier.map((c) => `- ${c}`)]
      : []),
    ...(opts.existing?.length
      ? ["", "Diese Kommentare stehen schon da (nicht wiederholen). Die neuen kommen später dazu und reagieren auf den Beitrag, wie er jetzt ist (z. B. ein Update im Text):", ...opts.existing.map((c) => `- ${c}`)]
      : []),
    "",
    "Plan (Nr. – wer – wie lang – worüber):",
    ...plan.map((s, i) => `${i}. ${s.voice} – ${s.length} – ${s.about}${s.compare ? ` – vergleicht dabei einen unserer Spieler mit einem Profi, ${s.compare}` : ""}${s.poll ? " – als Umfrage" : ""}`),
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

/**
 * The list's objects one by one, for when the list as a whole isn't valid JSON (one broken item, e.g.
 * {"text": "poll": {…}}, cost all 32 comments): broken ones become null, so the indexes for replyTo stay right.
 */
function eachObject(list: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0, from = -1, inString = false;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{" && depth++ === 0) from = i;
    else if (ch === "}" && --depth === 0) {
      try { out.push(JSON.parse(list.slice(from, i + 1))); } catch { out.push(null); }
    }
  }
  return out;
}

export function parseBots(answer: string): BotComment[] {
  const start = answer.indexOf("[");
  const end = answer.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try { raw = JSON.parse(answer.slice(start, end + 1)); } catch { raw = eachObject(answer.slice(start + 1, end)); }
  if (!Array.isArray(raw)) return [];
  const out: BotComment[] = [];
  // Index in the model's list → index in ours (some get dropped).
  const kept = new Map<number, number>();
  raw.forEach((c, i) => {
    if (!c || typeof c !== "object") return;
    const { text, minute, replyTo, upvotes, poll, nr } = c as Record<string, unknown>;
    const t = typeof text === "string" ? text.trim() : "";
    if (!t || t.length > TEXT_MAX || BODY_INSULT.test(t) || WORN_PROS.test(t)) return;
    const m = typeof minute === "number" && Number.isFinite(minute) ? Math.min(MINUTES, Math.max(0, Math.round(minute))) : 0;
    let parent = typeof replyTo === "number" && replyTo < i ? kept.get(replyTo) : undefined;
    // Threads are one level deep: a reply to a reply goes under the first comment.
    if (parent !== undefined) parent = out[parent].replyTo ?? parent;
    kept.set(i, out.length);
    const up = typeof upvotes === "number" && Number.isFinite(upvotes) ? Math.min(40, Math.max(0, Math.round(upvotes))) : undefined;
    const p = parsePoll(poll);
    const at = typeof nr === "number" && Number.isInteger(nr) ? nr : undefined;
    out.push({ name: "", ...(at !== undefined ? { at } : {}), text: t, minute: m, ...(parent !== undefined ? { replyTo: parent } : {}), ...(up !== undefined ? { upvotes: up } : {}), ...(p ? { poll: p } : {}) });
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

/**
 * A post brought forward keeps its comments (shouldWriteBots: "keep"), but they were written for the old time:
 * scheduled for 20:00, saved as "now" at 19:06, it got its first comment at 20:00. When none is out yet and the
 * first comes over a minute after the post, they start now (startNow).
 */
export function catchUp(rows: { id: number; created_at: string }[], publishedAt: string, now: Date): { id: number; created_at: string }[] {
  if (!rows.length || Date.parse(publishedAt) > now.getTime()) return [];
  const first = Math.min(...rows.map((r) => Date.parse(r.created_at)));
  if (first <= now.getTime() || first - Date.parse(publishedAt) <= 60_000) return [];
  return startNow(rows, now);
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
