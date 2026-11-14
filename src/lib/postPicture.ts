import type { Article } from "../../scraper/types.ts";
import { LOGO, NAME } from "./brand.ts";

/** The picture beside a post (feed row, article header): the player's photo, else his club's crest, else our logo. */
export type PostPicture =
  | { kind: "player"; photo?: string; name: string; top: boolean; crest?: string }
  | { kind: "crest"; src: string; name: string }
  | { kind: "logo"; src: string; name: string };

/**
 * Our own player news without a photo shows the crest, not initials; a club without a crest (LigaInsider files the
 * national teams' news under one) shows our logo, never initials or an empty space.
 */
export function postPicture(a: Pick<Article, "player" | "club" | "own">): PostPicture {
  if (a.player && (a.player.photo || !a.own)) {
    return { kind: "player", photo: a.player.photo, name: a.player.name, top: !!a.own, ...(a.club?.crest ? { crest: a.club.crest } : {}) };
  }
  if (a.club?.crest) return { kind: "crest", src: a.club.crest, name: a.club.name };
  return { kind: "logo", src: LOGO, name: NAME };
}
