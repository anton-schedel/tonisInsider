import { describe, expect, it } from "vitest";
import { postPicture } from "./postPicture.ts";
import { LOGO, NAME } from "./brand.ts";

const bayern = { id: 1, slug: "fc-bayern-muenchen", name: "FC Bayern München", crest: "/img/clubs/1.png" };
// LigaInsider files the national teams' news under a "club" we have no crest for.
const germany = { id: 6998, slug: "deutschland", name: "Deutschland" };
const kiala = { id: 9, slug: "cassiano-kiala", name: "Cassiano Kiala", photo: "/img/players/9.jpg" };

describe("postPicture", () => {
  it("a player's news: his photo, his club's crest on it", () => {
    expect(postPicture({ player: kiala, club: bayern })).toEqual({ kind: "player", photo: kiala.photo, name: kiala.name, top: false, crest: bayern.crest });
  });

  it("a club's news: its crest", () => {
    expect(postPicture({ club: bayern })).toEqual({ kind: "crest", src: bayern.crest, name: bayern.name });
  });

  it("a club we have no crest for (the national teams): our logo, not its initials or an empty space", () => {
    expect(postPicture({ club: germany })).toEqual({ kind: "logo", src: LOGO, name: NAME });
  });

  it("neither player nor club: our logo", () => {
    expect(postPicture({})).toEqual({ kind: "logo", src: LOGO, name: NAME });
  });

  it("our own player news without a photo: the crest, else our logo (no initials)", () => {
    const noPhoto = { id: 9, slug: "x", name: "Kevin Loibl" };
    expect(postPicture({ player: noPhoto, club: bayern, own: true })).toMatchObject({ kind: "crest" });
    expect(postPicture({ player: noPhoto, club: germany, own: true })).toMatchObject({ kind: "logo" });
  });
});
