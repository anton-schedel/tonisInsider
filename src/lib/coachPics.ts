import type { Crop } from "./coachCrop.ts";
import type { CoachThumb } from "./coachPosts.ts";
import type { TeamPhoto } from "./teamPhotos.ts";

/**
 * The two pictures of a coach post, chosen apart in the editor's preview (coachClient): the article's photo (its
 * banner) and the feed's circle (also the small one on top of the article). Plain state, no DOM.
 *
 * Each spot remembers who filled it: "auto" (the typed player name found his team photo; it follows the name) or
 * "coach" (picked, uploaded or framed: never replaced by the name). Picking for one spot never touches the other.
 */
export type Pic = { id: string; url: string };
export type Feed =
  /** His team-photo crest picture as it is (id the picture, source the team photo it was made from). */
  | { kind: "preset"; id: string; source: string }
  /** A square of a photo (crop unset: the default head framing). */
  | { kind: "cut"; src: Pic; crop?: Crop };
export type By = "auto" | "coach";
export type Pics = { article?: Pic; articleBy?: By; feed?: Feed; feedBy?: By };

type Url = (id: string) => string;

export const teamArticle = (t: TeamPhoto, url: Url): Pic => ({ id: t.imageId, url: url(t.imageId) });
/** A team photo in the feed: its crest picture if it has one, else the photo cut at the head. */
export const teamFeed = (t: TeamPhoto, url: Url): Feed =>
  t.avatarId ? { kind: "preset", id: t.avatarId, source: t.imageId } : { kind: "cut", src: teamArticle(t, url) };

/**
 * The feed picture as the readers will see it: the one chosen, else (like the site without a cut) the article photo
 * cut at the head, else none (the crest).
 */
export const feedOf = (s: Pics): Feed | undefined => s.feed ?? (s.article ? { kind: "cut", src: s.article } : undefined);

/** The typed name's team photo (or none) fills every spot the coach hasn't chosen; a spot it filled empties again. */
export function byName(s: Pics, t: TeamPhoto | undefined, url: Url): Pics {
  const out: Pics = { ...s };
  if (s.articleBy !== "coach") {
    if (t) { out.article = teamArticle(t, url); out.articleBy = "auto"; }
    else if (s.articleBy === "auto") { delete out.article; delete out.articleBy; }
  }
  if (s.feedBy !== "coach") {
    if (t) {
      // The same team photo again keeps its framing.
      const same = s.feedBy === "auto" && s.feed && JSON.stringify(teamFeed(t, url)) === JSON.stringify({ ...s.feed, crop: undefined });
      if (!same) { out.feed = teamFeed(t, url); out.feedBy = "auto"; }
    } else if (s.feedBy === "auto") { delete out.feed; delete out.feedBy; }
  }
  return out;
}

/** The article's photo (undefined: the club's banner). The feed stays as it is. */
export const pickArticle = (s: Pics, pic: Pic | undefined): Pics => ({ ...s, article: pic, articleBy: "coach" });

/** The feed picture (the article stays as it is). */
export const pickFeed = (s: Pics, feed: Feed): Pics => ({ ...s, feed, feedBy: "coach" });

/** "Wie Artikelfoto": the article photo, cut at the head, as the feed's own picture from now on. */
export const feedFromArticle = (s: Pics): Pics => (s.article ? pickFeed(s, { kind: "cut", src: s.article }) : s);

/** Framing the circle (only a cut has a framing): a choice of the coach. */
export function cropFeed(s: Pics, crop: Crop): Pics {
  const f = feedOf(s);
  return f?.kind === "cut" ? pickFeed(s, { ...f, crop }) : s;
}

/**
 * A saved post: its pictures count as chosen, even none (the club's banner, the crest) and a feed that shows the
 * article photo, so opening it and touching the name never changes what readers already see.
 */
export function fromPost(image: Pic | undefined, thumb: CoachThumb | undefined, url: Url): Pics {
  const s: Pics = { articleBy: "coach", feedBy: "coach" };
  if (image) s.article = image;
  if (thumb) {
    s.feed = thumb.preset
      ? { kind: "preset", id: thumb.imageId, source: thumb.source }
      : { kind: "cut", src: image?.id === thumb.source ? image : { id: thumb.source, url: url(thumb.source) }, crop: { x: thumb.x, y: thumb.y, zoom: thumb.zoom } };
  }
  return s;
}

/**
 * Which choice in the feed sheet is the current one: "article" (Wie Artikelfoto), "team:<photo id>", "own" (a
 * picture of its own) or "" (none: the crest).
 */
export function feedChoice(s: Pics, team: Pick<TeamPhoto, "imageId" | "avatarId">[]): string {
  const f = feedOf(s);
  if (!f) return "";
  if (!s.feed) return "article";
  if (f.kind === "preset") return team.some((t) => t.imageId === f.source && t.avatarId === f.id) ? `team:${f.source}` : "own";
  if (team.some((t) => t.imageId === f.src.id && !t.avatarId)) return `team:${f.src.id}`;
  return s.article?.id === f.src.id ? "article" : "own";
}

/** Which choice in the article sheet is the current one: "club" (the club's banner), "team:<photo id>" or "own". */
export function articleChoice(s: Pics, team: Pick<TeamPhoto, "imageId">[]): string {
  if (!s.article) return "club";
  const id = s.article.id;
  return team.some((t) => t.imageId === id) ? `team:${id}` : "own";
}
