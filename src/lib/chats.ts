/**
 * "Deine Chats": the conversations you wrote in through TonInsider (a top-level comment and everything under it),
 * what's happening in them and what's new since you last looked. Pure: the storage is chatsDb.ts, the endpoints
 * chatsApi.ts. The row texts are made here, so the website and the app say the same.
 */

/** A comment as both kinds of thread give it (LigaInsider's Comment, our own posts' OwnComment). */
export type ConvComment = {
  id: number;
  user: string;
  date: string;
  text: string;
  score: number;
  poll?: { question: string; total: number; options: { label: string; pct: number }[] };
  replies: ConvComment[];
};

/** Where a conversation stands, as last read. */
export type ChatState = {
  /** Your top comment's votes, when you started the conversation. */
  score?: number;
  /** Votes on each comment of yours in it, by id. */
  mine: Record<string, number>;
  /** All answers under the top comment. */
  answers: number;
  /** Ids of the others' answers. */
  others: number[];
  /** The newest answer from someone else. */
  latest?: { user: string; text: string; date: string };
  /** Your Umfrage, when you started one. */
  poll?: { total: number; leader?: { label: string; pct: number } };
  /** Whom your newest answer answers. */
  to?: string;
  /** The top comment isn't in the thread any more. */
  gone?: true;
};

/** What changed since you last looked. */
export type ChatNews = { answers: number; votes: number; poll: number };
/** Your last write in the conversation. */
export type ChatKind = "comment" | "poll" | "answer";
/** ok; gone (comment or article no longer there); over (a lineup page that moved on to the next match). */
export type ChatStatus = "ok" | "gone" | "over";

export function conversationState(root: ConvComment, mine: number[], started: boolean): ChatState {
  const ids = new Set(mine);
  const scores: Record<string, number> = {};
  const others: number[] = [];
  let answers = 0;
  let latest: ConvComment | undefined;
  // Your newest write and what it answers.
  let newest: { at: string; to?: string } | undefined;
  const visit = (c: ConvComment, parent?: ConvComment) => {
    if (parent) answers++;
    if (ids.has(c.id)) {
      scores[c.id] = c.score;
      if (!newest || c.date > newest.at) newest = { at: c.date, to: parent?.user };
    } else if (parent) {
      others.push(c.id);
      if (!latest || c.date > latest.date) latest = c;
    }
    for (const r of c.replies) visit(r, c);
  };
  visit(root);
  const state: ChatState = { mine: scores, answers, others };
  if (started) state.score = root.score;
  if (latest) state.latest = { user: latest.user, text: latest.text, date: latest.date };
  if (started && root.poll) state.poll = { total: root.poll.total, ...(root.poll.total > 0 ? { leader: leader(root.poll.options) } : {}) };
  if (newest?.to) state.to = newest.to;
  return state;
}

/** The answer with the most votes; the first one on a tie. */
function leader(options: { label: string; pct: number }[]) {
  const best = options.reduce((a, b) => (b.pct > a.pct ? b : a));
  return { label: best.label, pct: best.pct };
}

export function chatNews(state: ChatState | undefined, seen: ChatState | undefined): ChatNews | undefined {
  if (!state || !seen || state.gone) return undefined;
  const known = new Set(seen.others);
  const answers = state.others.filter((id) => !known.has(id)).length;
  let votes = 0;
  for (const [id, score] of Object.entries(state.mine)) {
    const before = seen.mine[id];
    if (before !== undefined) votes += score - before;
  }
  const poll = state.poll && seen.poll ? Math.max(0, state.poll.total - seen.poll.total) : 0;
  return answers || votes || poll ? { answers, votes, poll } : undefined;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const leaderText = (l?: { label: string; pct: number }) => (l ? ` · ${l.label} ${l.pct} %` : "");

export function chatLines(c: { kind: ChatKind; text: string; started: boolean; state?: ChatState; news?: ChatNews; status: ChatStatus }): { mine: string; status: string } {
  const { state, news } = c;
  const mine = c.kind === "poll" ? `Umfrage: ${c.text}` : c.kind === "answer" && state?.to ? `Du antwortest ${state.to}: ${c.text}` : `Du: ${c.text}`;
  if (c.status === "gone") return { mine, status: "nicht mehr verfügbar" };
  if (!state) return { mine, status: "" };
  if (news && c.status === "ok") {
    const parts: string[] = [];
    if (news.answers === 1 && state.latest) parts.push(`${state.latest.user}: „${textStart(state.latest.text, 40)}“`);
    else if (news.answers > 0) parts.push(`${news.answers} neue Antworten`);
    if (news.votes) parts.push(`▲ ${news.votes > 0 ? "+" : "−"}${Math.abs(news.votes)}`);
    if (news.poll) parts.push(`+${plural(news.poll, "Stimme", "Stimmen")}${leaderText(state.poll?.leader)}`);
    return { mine, status: parts.join(" · ") };
  }
  const parts: string[] = [];
  if (state.poll) parts.push(`${plural(state.poll.total, "Stimme", "Stimmen")}${leaderText(state.poll.leader)}`);
  else if (state.score !== undefined) parts.push(`▲ ${state.score}`);
  parts.push(state.answers ? plural(state.answers, "Antwort", "Antworten") : "keine Antworten");
  const summary = parts.join(" · ");
  return { mine, status: c.status === "over" ? `Spiel vorbei · ${summary}` : summary };
}

/** One line of text, at most `max` characters, cut at a word with "…". */
export function textStart(s: string, max = 80): string {
  const line = s.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  let cut = line.slice(0, max - 1);
  if (line[max - 1] !== " " && cut.includes(" ")) cut = cut.slice(0, cut.lastIndexOf(" "));
  return `${cut.trimEnd()}…`;
}

/** The account a LigaInsider login stands for, without keeping its name: HMAC with the Worker's secret. */
export async function chatAccount(username: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const hmac = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", hmac, enc.encode(`chats:${username.trim().toLowerCase()}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
