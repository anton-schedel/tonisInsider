import { describe, it, expect } from "vitest";
import { fromCookieResponse, isAppRequest, toCookieRequest } from "./appSession.ts";
import { seal, unseal } from "./vault.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const URL_ = "https://site.example/api/scout/";
const app = (token?: string, url = URL_) =>
  new Request(url, { headers: { "x-toninsider-app": "1", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
const jarOf = async (res: Response) => JSON.parse((await unseal(res.headers.get("x-app-token")!, KEY))!);

describe("app session", () => {
  it("leaves browser requests alone", () => {
    expect(isAppRequest(new Request(URL_))).toBe(false);
    expect(isAppRequest(app(undefined, "https://site.example/mein-team/"))).toBe(false);
    expect(isAppRequest(app())).toBe(true);
    expect(isAppRequest(app(undefined, "https://site.example/data/app-feed.json"))).toBe(true);
  });

  it("turns the token into cookies and the site's own origin", async () => {
    const { request, jar } = await toCookieRequest(app(await seal(JSON.stringify({ kb: "t1", kbc: "s1" }), KEY)), KEY);
    expect(request.headers.get("cookie")).toBe("kb=t1; kbc=s1");
    expect(request.headers.get("origin")).toBe("https://site.example");
    expect(request.headers.get("authorization")).toBeNull();
    expect(jar).toEqual({ kb: "t1", kbc: "s1" });
  });

  it("starts empty without a token", async () => {
    const { request, jar } = await toCookieRequest(app(), KEY);
    expect(request.headers.get("cookie")).toBeNull();
    expect(jar).toEqual({});
  });

  it("treats a bad token as an empty session", async () => {
    const { request, jar } = await toCookieRequest(app("garbage"), KEY);
    expect(jar).toEqual({});
    expect(request.headers.get("cookie")).toBeNull();
  });

  it("keeps the body and method of a POST", async () => {
    const post = new Request(URL_, { method: "POST", body: JSON.stringify({ add: [1] }), headers: { "x-toninsider-app": "1", "content-type": "application/json" } });
    const { request } = await toCookieRequest(post, KEY);
    expect(request.method).toBe("POST");
    expect(await request.json()).toEqual({ add: [1] });
  });

  it("rotates the token when a cookie is set", async () => {
    const res = new Response("{}", { headers: [["set-cookie", "kb=t2; Path=/; HttpOnly"]] });
    const out = await fromCookieResponse(res, { kb: "t1", kbc: "s1" }, KEY);
    expect(out.headers.get("set-cookie")).toBeNull();
    expect(await jarOf(out)).toEqual({ kb: "t2", kbc: "s1" });
  });

  it("drops deleted cookies", async () => {
    const res = new Response("{}", {
      headers: [
        ["set-cookie", "kbc=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"],
        ["set-cookie", "kb=deleted; Path=/; Max-Age=0"],
      ],
    });
    expect(await jarOf(await fromCookieResponse(res, { kb: "t1", kbc: "s1", lis: "x" }, KEY))).toEqual({ lis: "x" });
  });

  it("no token header when nothing changed", async () => {
    const out = await fromCookieResponse(new Response("{}"), { kb: "t1" }, KEY);
    expect(out.headers.get("x-app-token")).toBeNull();
    expect(await out.text()).toBe("{}");
  });

  it("keeps redirects", async () => {
    const res = new Response(null, { status: 303, headers: [["location", "/mein-team/"], ["set-cookie", "kb=t2; Path=/"]] });
    const out = await fromCookieResponse(res, {}, KEY);
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/mein-team/");
    expect(await jarOf(out)).toEqual({ kb: "t2" });
  });
});
