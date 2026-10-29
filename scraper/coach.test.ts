import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pullCoachPosts } from "./coach.ts";

const post = (over = {}) => ({
  id: 900_001_000, type: "player", publishedAt: "2026-10-24T17:00:00.000Z", updatedAt: "2026-10-24T12:00:00.000Z",
  data: { headline: "Nguyen fehlt", player: { name: "Kevin Nguyen", newsType: "angeschlagen" } },
  image: { id: "ab12cd34ef56ab78", width: 900, height: 1200 }, ...over,
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "coach-"));
  return { file: join(dir, "store", "coach-posts.json"), imgDir: join(dir, "public", "img", "custom", "coach") };
}

const fake = (posts: unknown[], calls: string[] = []) => (async (url: string, init?: RequestInit) => {
  calls.push(`${url} ${new Headers(init?.headers).get("x-export-token")}`);
  if (url.endsWith("/api/coach/export/")) return Response.json({ posts });
  if (url.includes("/api/coach/images/")) return new Response(new Uint8Array([0xff, 0xd8, 1, 2]), { headers: { "content-type": "image/jpeg" } });
  return new Response(null, { status: 404 });
}) as typeof fetch;

describe("pullCoachPosts", () => {
  it("saves the posts and their photos and reports a change", async () => {
    const { file, imgDir } = setup();
    const calls: string[] = [];
    const r = await pullCoachPosts({ site: "https://site.example", token: "t", file, imgDir, fetcher: fake([post()], calls) });
    expect(r.changed).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(1);
    expect(existsSync(join(imgDir, "ab12cd34ef56ab78.jpg"))).toBe(true);
    expect(calls).toEqual(["https://site.example/api/coach/export/ t", "https://site.example/api/coach/images/ab12cd34ef56ab78/ t"]);
  });

  it("also saves the feed picture cut from a photo", async () => {
    const { file, imgDir } = setup();
    const withThumb = post({ data: { ...post().data, thumb: { imageId: "0123456789abcdef", source: "ab12cd34ef56ab78", x: 0.5, y: 0.3, zoom: 1 } } });
    const r = await pullCoachPosts({ site: "https://site.example", token: "t", file, imgDir, fetcher: fake([withThumb]) });
    expect(r.changed).toBe(true);
    expect(existsSync(join(imgDir, "ab12cd34ef56ab78.jpg")) && existsSync(join(imgDir, "0123456789abcdef.jpg"))).toBe(true);
  });

  it("sees no change for the same posts and skips photos it has", async () => {
    const { file, imgDir } = setup();
    await pullCoachPosts({ site: "https://site.example", token: "t", file, imgDir, fetcher: fake([post()]) });
    const calls: string[] = [];
    const r = await pullCoachPosts({ site: "https://site.example", token: "t", file, imgDir, fetcher: fake([post()], calls) });
    expect(r.changed).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("reports an edit or a delete as a change", async () => {
    const { file, imgDir } = setup();
    await pullCoachPosts({ site: "https://site.example", token: "t", file, imgDir, fetcher: fake([post()]) });
    expect((await pullCoachPosts({ site: "https://site.example", token: "t", file, imgDir, fetcher: fake([post({ updatedAt: "2026-10-24T13:00:00.000Z" })]) })).changed).toBe(true);
    expect((await pullCoachPosts({ site: "https://site.example", token: "t", file, imgDir, fetcher: fake([]) })).changed).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([]);
  });

  it("keeps the last posts when the export fails", async () => {
    const { file, imgDir } = setup();
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify([post()]));
    const failing = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const r = await pullCoachPosts({ site: "https://site.example", token: "t", file, imgDir, fetcher: failing });
    expect(r).toMatchObject({ changed: false });
    expect(r.problem).toMatch(/503/);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(1);
  });

  it("doesn't throw when a photo can't be fetched", async () => {
    const { file, imgDir } = setup();
    const flaky = (async (url: string) => {
      if (url.endsWith("/api/coach/export/")) return Response.json({ posts: [post()] });
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const r = await pullCoachPosts({ site: "https://site.example", token: "t", file, imgDir, fetcher: flaky });
    expect(r.changed).toBe(false);
    expect(r.problem).toMatch(/fetch failed/);
  });
});
