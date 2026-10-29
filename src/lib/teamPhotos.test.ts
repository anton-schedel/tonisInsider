import { describe, expect, it } from "vitest";
import { findTeamPhoto, validateTeamPhoto, type OwnPostJson } from "./teamPhotos.ts";
import { ownPosts } from "./data.ts";

const ID = "ab12cd34ef56ab78";

describe("validateTeamPhoto", () => {
  it("takes a name of 2 to 40 characters, tidied, and a 16-hex image id", () => {
    expect(validateTeamPhoto({ player: "  Luca   Loibl ", imageId: ID })).toEqual({ player: "Luca Loibl", imageId: ID });
    expect(validateTeamPhoto({ player: "L", imageId: ID })).toHaveProperty("error");
    expect(validateTeamPhoto({ player: "x".repeat(41), imageId: ID })).toHaveProperty("error");
    expect(validateTeamPhoto({ player: "Luca Loibl", imageId: "AB12CD34EF56AB78" })).toHaveProperty("error");
    expect(validateTeamPhoto({ player: "Luca Loibl", imageId: "ab12" })).toHaveProperty("error");
    expect(validateTeamPhoto(null)).toHaveProperty("error");
  });
});

describe("findTeamPhoto", () => {
  const team = [{ player: "Luca Loibl" }, { player: "Daniel Torres" }, { player: "Kevin Nguyen" }, { player: "Tim Gerl" }, { player: "Tom Gerl" }];
  it("finds the same name in any case", () => {
    expect(findTeamPhoto(" luca  LOIBL", team)?.player).toBe("Luca Loibl");
  });
  it("finds a player by his last name alone", () => {
    expect(findTeamPhoto("Loibl", team)?.player).toBe("Luca Loibl");
    expect(findTeamPhoto("torres", team)?.player).toBe("Daniel Torres");
  });
  it("leaves a shared last name, another first name and a part of a name alone", () => {
    expect(findTeamPhoto("Gerl", team)).toBeUndefined();
    expect(findTeamPhoto("Max Loibl", team)).toBeUndefined();
    expect(findTeamPhoto("Loi", team)).toBeUndefined();
    expect(findTeamPhoto("Luca", team)).toBeUndefined();
    expect(findTeamPhoto("", team)).toBeUndefined();
  });
});

describe("ownPosts (content/posts/ with team photos)", () => {
  const NOW = new Date("2026-10-29T12:00:00.000Z");
  const post = (over: Partial<OwnPostJson> = {}): OwnPostJson => ({
    id: 900_000_004, url: "/tus-schnoeselmob/x-900000004/", headline: "Nguyen fehlt", listHeadline: "Nguyen fehlt", category: "bundesliga",
    player: { id: 900_000_101, slug: "kevin-nguyen", name: "Kevin Nguyen", teamPhoto: "Kevin Nguyen" },
    publishedAt: "2026-10-21T15:35:00.000Z", fetchedAt: "2026-10-21T15:35:00.000Z", bodyHtml: "", own: true, ...over,
  } as OwnPostJson);

  it("uses the player's team photo as his picture and the banner", () => {
    const [a] = ownPosts([post()], { "Kevin Nguyen": { photo: `/img/custom/coach/${ID}.jpg`, width: 1024, height: 1024 } }, NOW);
    expect(a.player).toEqual({ id: 900_000_101, slug: "kevin-nguyen", name: "Kevin Nguyen", photo: `/img/custom/coach/${ID}.jpg` });
    expect(a.banner).toBe(`/img/custom/coach/${ID}.jpg`);
    expect(a.bannerSize).toEqual({ width: 1024, height: 1024 });
  });

  it("keeps a banner the post brings itself", () => {
    const [a] = ownPosts([post({ banner: "/img/custom/schnoeselmob-banner.jpg" })], { "kevin nguyen": { photo: `/img/custom/coach/${ID}.jpg`, width: 800, height: 1000 } }, NOW);
    expect(a.player?.photo).toBe(`/img/custom/coach/${ID}.jpg`);
    expect(a.banner).toBe("/img/custom/schnoeselmob-banner.jpg");
  });

  it("shows no photo and the club's banner while none is stored", () => {
    const [a] = ownPosts([post({ bannerSize: { width: 1, height: 1 } })], {}, NOW);
    expect(a.player).toEqual({ id: 900_000_101, slug: "kevin-nguyen", name: "Kevin Nguyen" });
    expect(a.banner).toBe("/img/custom/schnoeselmob-banner.jpg");
    expect(a.bannerSize).toBeUndefined();
  });

  it("leaves posts without a team photo as written and keeps later ones out", () => {
    const plain = post({ player: { id: 1, slug: "a", name: "A", photo: "/x.jpg" }, banner: "/b.jpg" });
    expect(ownPosts([plain, post({ publishedAt: "2026-10-30T12:00:00.000Z" })], {}, NOW)).toEqual([plain]);
  });
});
