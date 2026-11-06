import { describe, expect, it } from "vitest";
import { chatPlace, ligaWrite } from "./chatsPlace.ts";
import type { AppFeed } from "./appFeed.ts";

const club = { id: 1, slug: "bayer-leverkusen", name: "Leverkusen", crest: "/img/crests/b04.png" };
const feed = {
  articles: [
    { id: 420300, headline: "Wirtz zurück im Training", club },
    { id: 900001001, headline: "Schnöselmob: Spieltag 9", own: true },
  ],
  lineups: [{ club, comments: { tmid: 185708, optauuid: "5ju4n8wsoc85fnut62uav3i8k", teamid: 14 } }],
} as unknown as AppFeed;

describe("chatPlace", () => {
  it("an article: its headline, link and club", () => {
    expect(chatPlace(feed, "420300")).toEqual({
      title: "Wirtz zurück im Training",
      href: "/artikel/420300/",
      club: { name: "Leverkusen", slug: "bayer-leverkusen", crest: "/img/crests/b04.png" },
    });
  });

  it("one of our own posts", () => {
    expect(chatPlace(feed, "900001001")).toEqual({ title: "Schnöselmob: Spieltag 9", href: "/artikel/900001001/", own: true });
  });

  it("a club's lineup page", () => {
    expect(chatPlace(feed, "t185708-5ju4n8wsoc85fnut62uav3i8k-14")).toEqual({
      title: "Aufstellung Leverkusen",
      href: "/vereine/bayer-leverkusen/",
      club: { name: "Leverkusen", slug: "bayer-leverkusen", crest: "/img/crests/b04.png" },
    });
  });

  it("unknown or no feed: a plain row", () => {
    expect(chatPlace(feed, "1")).toEqual({ title: "Beitrag", href: "/" });
    expect(chatPlace(undefined, "420300")).toEqual({ title: "Beitrag", href: "/" });
  });
});

describe("ligaWrite", () => {
  it("a comment or an Umfrage starts its own conversation", () => {
    expect(ligaWrite({ kind: "comment", body: "Der startet  sicher" }, "420300", 77, undefined))
      .toEqual({ thread: "420300", root: 77, id: 77, kind: "comment", text: "Der startet sicher" });
    expect(ligaWrite({ kind: "poll", question: "Wer startet?", options: ["A", "B"] }, "420300", 78, 5))
      .toEqual({ thread: "420300", root: 78, id: 78, kind: "poll", text: "Wer startet?" });
  });

  it("an answer belongs to the conversation the page says, else to the comment it answers", () => {
    const reply = { kind: "reply" as const, commentId: 12, body: "Nie im Leben" };
    expect(ligaWrite(reply, "420300", 90, 10)).toEqual({ thread: "420300", root: 10, id: 90, kind: "answer", text: "Nie im Leben" });
    expect(ligaWrite(reply, "420300", 90, undefined)).toMatchObject({ root: 12 });
    expect(ligaWrite(reply, "420300", 90, "x")).toMatchObject({ root: 12 });
    expect(ligaWrite(reply, "420300", 90, -3)).toMatchObject({ root: 12 });
  });

  it("votes aren't writes, and without LigaInsider's id there's nothing to find later", () => {
    expect(ligaWrite({ kind: "vote", commentId: 12, currentVote: 0 }, "420300", undefined, undefined)).toBeUndefined();
    expect(ligaWrite({ kind: "pollvote", votingId: 3, optionId: 4 }, "420300", undefined, undefined)).toBeUndefined();
    expect(ligaWrite({ kind: "comment", body: "Hallo" }, "420300", undefined, undefined)).toBeUndefined();
  });
});
