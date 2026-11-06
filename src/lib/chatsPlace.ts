import type { AppFeed } from "./appFeed.ts";
import type { LiAction } from "./ligainsider.ts";
import { threadKey } from "./comments.ts";
import { textStart } from "./chats.ts";
import type { ChatPlace, ChatWrite } from "./chatsDb.ts";

/** What a chat's row says about where it hangs, from the deploy's feed (the article, or the club's lineup page). */
export function chatPlace(feed: AppFeed | undefined, thread: string): ChatPlace {
  const club = (c?: { name: string; slug: string; crest?: string }) => (c ? { club: { name: c.name, slug: c.slug, ...(c.crest ? { crest: c.crest } : {}) } } : {});
  if (/^\d+$/.test(thread)) {
    const a = feed?.articles.find((x) => x.id === Number(thread));
    if (a) return { title: a.headline, href: `/artikel/${a.id}/`, ...club(a.club), ...(a.own ? { own: true } : {}) };
  } else {
    const l = feed?.lineups.find((x) => x.comments && threadKey(x.comments) === thread);
    if (l) return { title: `Aufstellung ${l.club.name}`, href: `/vereine/${l.club.slug}/`, ...club(l.club) };
  }
  return { title: "Beitrag", href: "/" };
}

const validId = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1_000_000_000 ? v : undefined);

/**
 * A write in a LigaInsider thread as a chat entry. `root` is the conversation the page says the answer is in
 * (an answer can answer an answer); without it, the answered comment is taken. Votes aren't writes.
 */
export function ligaWrite(action: LiAction, thread: string, commentId: number | undefined, root: unknown): Omit<ChatWrite, "place"> | undefined {
  if (!commentId) return undefined;
  switch (action.kind) {
    case "comment": return { thread, root: commentId, id: commentId, kind: "comment", text: textStart(action.body) };
    case "poll": return { thread, root: commentId, id: commentId, kind: "poll", text: textStart(action.question) };
    case "reply": return { thread, root: validId(root) ?? action.commentId, id: commentId, kind: "answer", text: textStart(action.body) };
    default: return undefined;
  }
}
