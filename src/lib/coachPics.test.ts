import { describe, expect, it } from "vitest";
import { articleChoice, byName, cropFeed, feedChoice, feedFromArticle, feedOf, fromPost, pickArticle, pickFeed, type Pics } from "./coachPics.ts";
import type { TeamPhoto } from "./teamPhotos.ts";

const url = (id: string) => `/i/${id}/`;
const loibl: TeamPhoto = { player: "Luca Loibl", imageId: "1111111111111111", width: 1024, height: 1024, avatarId: "aaaaaaaaaaaaaaaa" };
const torres: TeamPhoto = { player: "Daniel Torres", imageId: "2222222222222222", width: 1024, height: 1024, avatarId: "bbbbbbbbbbbbbbbb" };
const gerl: TeamPhoto = { player: "Tim Gerl", imageId: "3333333333333333", width: 800, height: 1200 };
const team = [loibl, torres, gerl];
const own = { id: "4444444444444444", url: "blob:own" };

describe("byName", () => {
  it("fills both empty spots with the player's team photo: the photo in the article, his crest picture in the feed", () => {
    const s = byName({}, loibl, url);
    expect(s.article).toEqual({ id: loibl.imageId, url: url(loibl.imageId) });
    expect(s.feed).toEqual({ kind: "preset", id: loibl.avatarId, source: loibl.imageId });
    expect([s.articleBy, s.feedBy]).toEqual(["auto", "auto"]);
  });
  it("cuts the photo for the feed when there is no crest picture", () => {
    expect(byName({}, gerl, url).feed).toEqual({ kind: "cut", src: { id: gerl.imageId, url: url(gerl.imageId) } });
  });
  it("follows the name while nothing was chosen, and empties again without a match", () => {
    const a = byName({}, loibl, url);
    expect(byName(a, torres, url).article?.id).toBe(torres.imageId);
    expect(byName(a, undefined, url)).toEqual({});
  });
  it("never replaces a choice of the coach, in either spot", () => {
    const article = byName(pickArticle({}, own), torres, url);
    expect(article.article).toEqual(own);
    expect(article.feed).toEqual({ kind: "preset", id: torres.avatarId, source: torres.imageId });
    const feed = byName(pickFeed({}, { kind: "preset", id: loibl.avatarId!, source: loibl.imageId }), torres, url);
    expect(feed.feed).toEqual({ kind: "preset", id: loibl.avatarId, source: loibl.imageId });
    expect(feed.article?.id).toBe(torres.imageId);
    // The club's banner on purpose is a choice too.
    const club = byName(pickArticle({}, undefined), torres, url);
    expect(club.article).toBeUndefined();
    expect(byName(club, undefined, url).articleBy).toBe("coach");
  });
  it("keeps the framing when the same name matches again", () => {
    const s: Pics = { ...byName({}, gerl, url), feed: { kind: "cut", src: { id: gerl.imageId, url: url(gerl.imageId) }, crop: { x: 0.5, y: 0.3, zoom: 2 } } };
    expect(byName(s, gerl, url).feed).toEqual(s.feed);
  });
});

describe("picking", () => {
  it("changes only its own spot", () => {
    const s = byName({}, loibl, url);
    const feed = pickFeed(s, { kind: "preset", id: torres.avatarId!, source: torres.imageId });
    expect(feed.article).toEqual(s.article);
    expect(feed.feed).toEqual({ kind: "preset", id: torres.avatarId, source: torres.imageId });
    const article = pickArticle(feed, own);
    expect(article.feed).toEqual(feed.feed);
    expect(pickArticle(feed, undefined).feed).toEqual(feed.feed);
  });
  it("Wie Artikelfoto: the article photo becomes the feed's own picture, later article photos leave it", () => {
    const s = feedFromArticle(pickArticle({}, own));
    expect(s.feed).toEqual({ kind: "cut", src: own });
    expect(feedOf(pickArticle(s, { id: torres.imageId, url: "x" }))).toEqual({ kind: "cut", src: own });
    expect(feedFromArticle({})).toEqual({});
  });
  it("framing a cut is a choice; a crest picture has no framing", () => {
    const s = cropFeed(pickArticle({}, own), { x: 0.4, y: 0.3, zoom: 1.5 });
    expect(s.feed).toEqual({ kind: "cut", src: own, crop: { x: 0.4, y: 0.3, zoom: 1.5 } });
    expect(s.feedBy).toBe("coach");
    const p = byName({}, loibl, url);
    expect(cropFeed(p, { x: 0.4, y: 0.3, zoom: 1.5 })).toEqual(p);
  });
});

describe("feedOf", () => {
  it("is the chosen picture, else the article photo cut at the head (as the site shows it), else none", () => {
    expect(feedOf({})).toBeUndefined();
    expect(feedOf({ article: own })).toEqual({ kind: "cut", src: own });
    expect(feedOf({ article: own, feed: { kind: "preset", id: "a", source: "b" } })).toEqual({ kind: "preset", id: "a", source: "b" });
  });
});

describe("fromPost", () => {
  it("takes the saved photo and feed picture as chosen", () => {
    const image = { id: own.id, url: url(own.id) };
    expect(fromPost(image, { imageId: "c", source: own.id, x: 0.5, y: 0.2, zoom: 1.2 }, url)).toEqual({
      article: image, articleBy: "coach", feed: { kind: "cut", src: image, crop: { x: 0.5, y: 0.2, zoom: 1.2 } }, feedBy: "coach",
    });
    expect(fromPost(undefined, { imageId: loibl.avatarId!, source: loibl.imageId, x: 0.5, y: 0.5, zoom: 1, preset: true }, url)).toEqual({
      articleBy: "coach", feed: { kind: "preset", id: loibl.avatarId, source: loibl.imageId }, feedBy: "coach",
    });
  });
  it("never lets the name change a saved post's pictures, not even none", () => {
    expect(byName(fromPost(undefined, undefined, url), loibl, url)).toEqual({ articleBy: "coach", feedBy: "coach" });
    const image = { id: own.id, url: url(own.id) };
    const s = byName(fromPost(image, undefined, url), loibl, url);
    expect(feedOf(s)).toEqual({ kind: "cut", src: image });
  });
});

describe("choices", () => {
  it("names the feed sheet's current choice", () => {
    expect(feedChoice({}, team)).toBe("");
    expect(feedChoice({ article: own }, team)).toBe("article");
    expect(feedChoice(byName({}, loibl, url), team)).toBe(`team:${loibl.imageId}`);
    expect(feedChoice(byName({}, gerl, url), team)).toBe(`team:${gerl.imageId}`);
    expect(feedChoice(feedFromArticle(pickArticle({}, own)), team)).toBe("article");
    expect(feedChoice(pickFeed({}, { kind: "cut", src: own }), team)).toBe("own");
    expect(feedChoice(pickFeed({}, { kind: "preset", id: "made", source: own.id }), team)).toBe("own");
  });
  it("names the article sheet's current choice", () => {
    expect(articleChoice({}, team)).toBe("club");
    expect(articleChoice(byName({}, torres, url), team)).toBe(`team:${torres.imageId}`);
    expect(articleChoice(pickArticle({}, own), team)).toBe("own");
  });
});
