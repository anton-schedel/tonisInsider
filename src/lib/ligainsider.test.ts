import { describe, it, expect } from "vitest";
import {
  LigaInsiderAuthError,
  LigaInsiderRejectedError,
  LigaInsiderUnavailableError,
  createComment,
  createPoll,
  login,
  reply,
  upvote,
  votePoll,
} from "./ligainsider.ts";

type Call = { url: string; init: RequestInit };

function scripted(steps: { status: number; body?: string; location?: string; cookies?: string[] }[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const step = steps[i++] ?? { status: 500, body: "no more steps" };
    const headers = new Headers();
    if (step.location) headers.set("location", step.location);
    for (const c of step.cookies ?? []) headers.append("set-cookie", c);
    return new Response(step.body ?? "", { status: step.status, headers });
  }) as typeof fetch;
  return { fn, calls };
}

const bodyOf = (init: RequestInit) => String(init.body);
const cookieOf = (init: RequestInit) => new Headers(init.headers).get("cookie");

describe("ligainsider login", () => {
  it("keeps the session cookies from the login page and the login response", async () => {
    const { fn, calls } = scripted([
      { status: 200, cookies: ["PHPSESSID=abc; path=/; HttpOnly"] },
      { status: 302, location: "/", cookies: ["li_at=tok; path=/; HttpOnly", "li_rt=rt; path=/; HttpOnly"] },
    ]);
    expect(await login(fn, "ManagerAnton", "pw")).toEqual({ cookie: "PHPSESSID=abc; li_at=tok; li_rt=rt" });
    expect(calls[1].url).toBe("https://www.ligainsider.de/user/login/");
    expect(calls[1].init.method).toBe("POST");
    expect(calls[1].init.redirect).toBe("manual");
    expect(bodyOf(calls[1].init)).toContain("username=ManagerAnton");
    expect(bodyOf(calls[1].init)).toContain("password=pw");
    expect(cookieOf(calls[1].init)).toBe("PHPSESSID=abc");
  });

  it("rejects a redirect back to the login page", async () => {
    const { fn } = scripted([
      { status: 200, cookies: ["PHPSESSID=abc; path=/"] },
      { status: 302, location: "/login/", cookies: [] },
    ]);
    await expect(login(fn, "a", "b")).rejects.toBeInstanceOf(LigaInsiderAuthError);
  });

  it("treats a network failure as unavailable", async () => {
    const fn = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await expect(login(fn, "a", "b")).rejects.toBeInstanceOf(LigaInsiderUnavailableError);
  });
});

describe("ligainsider writes", () => {
  const session = { cookie: "li_at=tok" };
  const csrf = `<input type="hidden" name="csrf_token" value="TOK">`;

  it("posts a comment on the article", async () => {
    const { fn, calls } = scripted([
      { status: 200, body: csrf },
      { status: 200, body: JSON.stringify({ success: true, commentID: "9" }) },
    ]);
    expect(await createComment(fn, session, 418778, "Hallo")).toEqual({ commentId: "9" });
    expect(calls[0].url).toContain("newsid=418778");
    expect(cookieOf(calls[0].init)).toBe("li_at=tok");
    const sent = bodyOf(calls[1].init);
    expect(sent).toContain("action=create");
    expect(sent).toContain("newsID=418778");
    expect(sent).toContain("body=Hallo");
    expect(sent).toContain("csrf_token=TOK");
    expect(sent).toContain("csrf_form=comment_graph");
  });

  it("posts a reply against the parent comment", async () => {
    const { fn, calls } = scripted([
      { status: 200, body: csrf },
      { status: 200, body: JSON.stringify({ success: true, commentID: "10" }) },
    ]);
    expect(await reply(fn, session, 418778, 9, "Antwort")).toEqual({ commentId: "10" });
    const sent = bodyOf(calls[1].init);
    expect(sent).toContain("commentID=9");
    expect(sent).toContain("body=Antwort");
    expect(sent).not.toContain("newsID=");
  });

  it("posts an upvote with the current vote", async () => {
    const { fn, calls } = scripted([
      { status: 200, body: csrf },
      { status: 200, body: JSON.stringify({ success: true, userVote: 1 }) },
    ]);
    await upvote(fn, session, 418778, 9, 0);
    const sent = bodyOf(calls[1].init);
    expect(sent).toContain("action=vote");
    expect(sent).toContain("direction=up");
    expect(sent).toContain("currentVote=0");
    expect(sent).toContain("commentID=9");
  });

  it("posts a poll vote", async () => {
    const { fn, calls } = scripted([
      { status: 200, body: csrf },
      { status: 200, body: JSON.stringify({ success: true }) },
    ]);
    await votePoll(fn, session, 418778, 133652, 339164);
    const sent = bodyOf(calls[1].init);
    expect(sent).toContain("action=poll_vote");
    expect(sent).toContain("votingID=133652");
    expect(sent).toContain("optionID=339164");
  });

  it("posts a poll whose options are the labels the user typed", async () => {
    const { fn, calls } = scripted([
      { status: 200, body: csrf },
      { status: 200, body: JSON.stringify({ success: true, commentID: "11" }) },
    ]);
    expect(await createPoll(fn, session, 418778, "Startet er?", ["Ja", "Nein"])).toEqual({ commentId: "11" });
    const sent = new URLSearchParams(bodyOf(calls[1].init));
    expect(sent.get("body")).toBe("Startet er?");
    expect(JSON.parse(sent.get("poll")!)).toEqual({
      question: "Startet er?",
      multiSelect: false,
      options: [
        { elements: [{ type: "Plaintext", value: "Ja" }] },
        { elements: [{ type: "Plaintext", value: "Nein" }] },
      ],
    });
  });

  it("treats a missing token as a dead session", async () => {
    const { fn } = scripted([{ status: 200, body: "<div>Melde dich an</div>" }]);
    await expect(createComment(fn, session, 1, "Hallo")).rejects.toBeInstanceOf(LigaInsiderAuthError);
  });

  it("surfaces LigaInsider's rejection", async () => {
    const { fn } = scripted([
      { status: 200, body: csrf },
      { status: 200, body: JSON.stringify({ success: false, message: "Zu kurz" }) },
    ]);
    await expect(createComment(fn, session, 1, "Hallo")).rejects.toThrow(new LigaInsiderRejectedError("Zu kurz"));
  });

  it("treats a redirect to login during the post as a dead session", async () => {
    const { fn } = scripted([
      { status: 200, body: csrf },
      { status: 302, location: "/login/" },
    ]);
    await expect(upvote(fn, session, 1, 9, 0)).rejects.toBeInstanceOf(LigaInsiderAuthError);
  });
});
