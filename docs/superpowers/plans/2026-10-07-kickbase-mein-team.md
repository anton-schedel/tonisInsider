# Mein Team (Kickbase login) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends log in with Kickbase and see their squad with LigaInsider start chances and only their players' news. Also a calmer page transition and no "Vereine" tab.

**Architecture:** Astro gets the official Cloudflare adapter. All existing pages stay prerendered (in Node, because they read `store/` via `node:fs`). `/mein-team/`, `/api/login/` and `/api/logout/` run on the Worker. The Worker calls the Kickbase v4 API with the user's token, which lives in an HttpOnly cookie. It reads our own `/data/snapshot.json` through the `ASSETS` binding and matches Kickbase players to LigaInsider lineups with pure, tested TypeScript.

**Tech Stack:** Astro 7.3 + @astrojs/cloudflare 14.3, wrangler 4.148, Vitest 5, TypeScript 7.

**Spec:** `docs/superpowers/specs/2026-10-07-kickbase-mein-team-design.md` (builds on `2026-10-07-tonisinsider-design.md`)

**Provenance:** every block below ran in a prototype before this plan was written:
- 82 tests passed.
- A real login with the test account worked against a local Worker: 13 players, with 9 "Startelf", 1 "Fraglich" and 3 "Nicht in der Startelf".
- Logout cleared all cookies.
- CSRF tests passed: a missing origin, a foreign origin and `Origin: null` all got 403.
- A wrong password redirected to `?error=credentials`.
- `wrangler deploy --dry-run` showed only the `ASSETS` binding.

Copy the code verbatim. If something differs, the plan is wrong: stop and report.

## Global Constraints

- **Passwords:** never stored, logged, echoed or put in URLs. Only the Kickbase token is kept, in cookie `kb` (HttpOnly, Secure, SameSite=Lax, Path=/, expiring at Kickbase's `tknex`).
- **Test credentials:** live in `.env.kickbase` (git-ignored, and never read by Astro or Vite). Never in `.env`, which the adapter copies into `dist/server/.dev.vars`.
- **Repo:** stays public and code-only. Kickbase fixtures (`scraper/__fixtures__/kickbase-*.json`, `scraper/__fixtures__/lineups/`) are git-ignored via the existing `scraper/__fixtures__/` rule.
- **Worker bindings:** `ASSETS` only. No KV, no Images (`session: false`, `imageService: "passthrough"`).
- **Prerendering:** in Node (`prerenderEnvironment: "node"`). Otherwise pages render empty, because workerd can't read `store/`.
- **CSRF:** POST endpoints require `Origin` to equal the site origin. `Referrer-Policy` must be `same-origin`; `no-referrer` makes Chrome send `Origin: null` and breaks login.
- **Trailing slashes:** all URLs end with "/", including the form actions `/api/login/` and `/api/logout/`.
- **German UI copy** exactly as in the code blocks.
- **Kickbase calls:** at most 3 per Mein Team visit (leagues, squad, plus the club table once per isolate per 24 h), each with an 8 s timeout.

## Review Focus

1. **Expired or revoked Kickbase token.** Expected: redirect to `/login/?error=expired`, with all session cookies cleared and no error page. `mein-team.astro` handles `KickbaseAuthError`. Pinned by `kickbase.test.ts` "throws KickbaseAuthError on 401" and by the manual E2E in Task 5 (delete `kb` in devtools, then reload).
2. **Kickbase down or its API changed.** Expected: Mein Team shows "Kickbase ist gerade nicht erreichbar…" and the rest of the site is unaffected. Pinned by `kickbase.test.ts` "throws KickbaseUnavailableError on 5xx, invalid JSON or network failure".
3. **Ambiguous names (two Nmechas at one club).** Expected: "Unbekannt", never the wrong player. Pinned by `match.test.ts` "refuses to guess".
4. **A Kickbase club name that doesn't map** (renamed or promoted club). Expected: that club's players show "Unbekannt" and nothing crashes. A test lists all 18 so a regression is visible. Pinned by `match.test.ts` "maps all 18 Kickbase teams".
5. **Cross-site login or logout posts.** Expected: 403. Pinned by `session.test.ts` and the curl checks in Task 4.

---

### Task 1: Calmer page transitions, Mein Team tab, remove the Vereine list

**Files:**
- Modify (replace whole file): `src/layouts/Base.astro`, `src/styles/global.css`
- Delete: `src/pages/vereine/index.astro`

**Interfaces:**
- Produces: `Base.astro` prop `tab?: "news" | "aufstellungen" | "mein-team"`. The tab bar label `[data-label]` on the `mein-team` tab reads "Mein Team" when cookie `kbin=1` is present, "Login" otherwise. `html[data-navigated]` is set after the first client-side navigation.
- Note: the Mein Team tab links to `/mein-team/`, which returns 404 until Task 5. Nothing is deployed before Task 6.

What changes:
- The old page disappears instantly and the new page fades in once (180 ms). Before, the old page faded out, the new one faded in, and every row replayed its entrance animation on top.
- Row entrance animations now run only on a fresh page load.
- `<html transition:animation="none">` stops the root cross-fade.

- [ ] **Step 1: Replace the layout and styles**

`src/layouts/Base.astro`:

````astro
---
import "../styles/global.css";
import { ClientRouter } from "astro:transitions";
import { lastUpdate } from "../lib/data.ts";
import { fullDate } from "../lib/format.ts";

interface Props {
  title: string;
  tab?: "news" | "aufstellungen" | "mein-team";
  back?: { href: string; label: string };
  /** Hide the big page title (article pages show their own headline). */
  hideHeading?: boolean;
}
const { title, tab, back, hideHeading = false } = Astro.props;
const updated = lastUpdate();
// Old page disappears instantly, new page fades in once (no cross-fade, no double animation).
const swapIn = { old: { name: "none", duration: "0s" }, new: { name: "astroFadeIn", duration: "180ms", easing: "ease-out", fillMode: "both" } };
const pageSwap = { forwards: swapIn, backwards: swapIn };
const tabs = [
  { id: "news", href: "/", label: "News", icon: "M4 5h16M4 12h16M4 19h10" },
  { id: "aufstellungen", href: "/aufstellungen/", label: "Aufstellungen", icon: "M12 3v18M3 12h18M7 7h10v10H7z" },
  { id: "mein-team", href: "/mein-team/", label: "Mein Team", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" },
] as const;
---
<!doctype html>
<html lang="de" transition:animation="none">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <title>{title} · tonisInsider</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>" />
    <script is:inline>
      // Runs on first load and again after every client-side navigation (which swaps <html> attributes).
      if (!window.__themeInit) {
        window.__themeInit = true;
        const apply = (doc) => {
          try {
            const t = localStorage.getItem("theme");
            if (t === "light" || t === "dark") doc.documentElement.dataset.theme = t;
          } catch {}
        };
        apply(document);
        // The tab bar persists across navigations, so its highlight is updated here instead of re-rendered.
        document.addEventListener("astro:page-load", () => {
          const tab = document.querySelector("[data-active-tab]")?.dataset.activeTab;
          document.querySelectorAll("nav [data-tab]").forEach((a) => {
            a.classList.toggle("text-accent", a.dataset.tab === tab);
            a.classList.toggle("text-muted", a.dataset.tab !== tab);
          });
          // "kbin" is a non-secret flag cookie set at login (the token itself is HttpOnly).
          const label = document.querySelector('nav [data-tab="mein-team"] [data-label]');
          if (label) label.textContent = /(?:^|; )kbin=1/.test(document.cookie) ? "Mein Team" : "Login";
        });
        document.addEventListener("astro:before-swap", (e) => {
          apply(e.newDocument);
          e.newDocument.documentElement.dataset.navigated = "";
        });
        document.addEventListener("click", (e) => {
          if (!e.target.closest?.("#theme-toggle")) return;
          const root = document.documentElement;
          const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
          root.dataset.theme = dark ? "light" : "dark";
          try { localStorage.setItem("theme", root.dataset.theme); } catch {}
        });
      }
    </script>
    <ClientRouter />
  </head>
  <body class="min-h-dvh bg-bg font-sans text-fg">
    <div class="mx-auto max-w-[720px] px-4 pb-28 sm:px-6" transition:animation={pageSwap} data-active-tab={tab}>
      <header class="flex items-end justify-between pt-6 pb-3">
        <div class="min-w-0">
          {back && (
            <a
              href={back.href}
              class="press mb-2 inline-block text-[15px] text-accent"
              onclick="if (history.state && history.state.index > 0) { history.back(); return false; }"
            >‹ {back.label}</a>
          )}
          {!hideHeading && <h1 class="truncate text-[28px] font-bold tracking-[-0.03em]">{title}</h1>}
        </div>
        <button
          id="theme-toggle"
          type="button"
          aria-label="Hell/Dunkel umschalten"
          class="press flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-sm"
        >◐</button>
      </header>
      <slot />
      <footer class="mt-10 border-t border-hairline pt-4 text-xs text-muted">
        {updated && <p>Stand: {fullDate(updated)} Uhr</p>}
        <p class="mt-1">Inhalte von <a class="underline" href="https://www.ligainsider.de/" target="_blank" rel="noopener noreferrer">ligainsider.de</a> · privates Projekt, nicht öffentlich.</p>
      </footer>
    </div>
    <nav class="fixed inset-x-0 bottom-0 border-t border-hairline bg-[var(--tabbar)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl" transition:persist="tabbar">
      <div class="mx-auto flex max-w-[720px] justify-around pt-2 pb-2">
        {tabs.map((t) => (
          <a href={t.href} data-tab={t.id} class:list={["press flex flex-col items-center gap-0.5 px-4 text-[10px] font-medium transition-colors duration-200", tab === t.id ? "text-accent" : "text-muted"]}>
            <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={t.icon} /></svg>
            <span data-label>{t.label}</span>
          </a>
        ))}
      </div>
    </nav>
  </body>
</html>
````

`src/styles/global.css`:

````css
@import "tailwindcss";

/* Colours follow iOS system colours. Light is the default; dark via system setting or data-theme="dark". */
:root {
  --bg: #ffffff;
  --surface: #f2f2f7;
  --surface-raised: #ffffff;
  --fg: #1d1d1f;
  --muted: #86868b;
  --hairline: #e5e5ea;
  --accent: #248a3d;
  --tabbar: rgba(250, 250, 252, 0.94);
  --pitch-from: #f3f8f2;
  --pitch-to: #e8f2e6;
  --pitch-line: rgba(36, 138, 61, 0.22);
  --red-bg: #ffebe9; --red-fg: #d70015;
  --yellow-bg: #fff4d6; --yellow-fg: #a05a00; --yellow-dot: #ffcc00;
  --green-bg: #e3f7e8; --green-fg: #248a3d; --green-dot: #30d158;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #000000; --surface: #1c1c1e; --surface-raised: #2c2c2e; --fg: #f5f5f7; --muted: #8e8e93;
    --hairline: #2c2c2e; --accent: #30d158; --tabbar: rgba(22, 22, 24, 0.92);
    --pitch-from: #0f1a12; --pitch-to: #0b140d; --pitch-line: rgba(48, 209, 88, 0.18);
    --red-bg: rgba(255, 69, 58, 0.16); --red-fg: #ff6961;
    --yellow-bg: rgba(255, 214, 10, 0.14); --yellow-fg: #ffd60a; --yellow-dot: #ffd60a;
    --green-bg: rgba(48, 209, 88, 0.16); --green-fg: #30d158; --green-dot: #30d158;
    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
  --bg: #000000; --surface: #1c1c1e; --surface-raised: #2c2c2e; --fg: #f5f5f7; --muted: #8e8e93;
  --hairline: #2c2c2e; --accent: #30d158; --tabbar: rgba(22, 22, 24, 0.92);
  --pitch-from: #0f1a12; --pitch-to: #0b140d; --pitch-line: rgba(48, 209, 88, 0.18);
  --red-bg: rgba(255, 69, 58, 0.16); --red-fg: #ff6961;
  --yellow-bg: rgba(255, 214, 10, 0.14); --yellow-fg: #ffd60a; --yellow-dot: #ffd60a;
  --green-bg: rgba(48, 209, 88, 0.16); --green-fg: #30d158; --green-dot: #30d158;
  color-scheme: dark;
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-raised: var(--surface-raised);
  --color-fg: var(--fg);
  --color-muted: var(--muted);
  --color-hairline: var(--hairline);
  --color-accent: var(--accent);
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif;
}

html {
  background: var(--bg);
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}

/* Article body comes from the sanitiser: only p, h3, b, strong, i, em, br, a. */
.prose-body p { margin: 0 0 1em; }
.prose-body h3 { font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em; margin: 1.6em 0 0.6em; }
.prose-body a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

/* ---------- Motion ---------- */
@keyframes fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@keyframes pop-in {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: none; }
}

/* Staggered entrance; the element sets --i (its index). Capped so long lists don't wait. */
/* Only on a fresh page load, not on in-app navigation (the page fade already covers that). */
html:not([data-navigated]) .enter {
  animation: fade-up 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: calc(min(var(--i, 0), 10) * 30ms);
}
.pop {
  animation: pop-in 380ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: calc(var(--i, 0) * 60ms);
}

/* Native-feeling tap feedback. */
.press {
  transition: transform 160ms ease, opacity 160ms ease;
  -webkit-user-select: none;
  user-select: none;
}
.press:active { transform: scale(0.97); opacity: 0.75; }

@media (prefers-reduced-motion: reduce) {
  .enter, .pop { animation: none; }
  .press, .press:active { transition: none; transform: none; }
}
````

- [ ] **Step 2: Delete the Vereine list page**

Run: `git rm src/pages/vereine/index.astro`

- [ ] **Step 3: Verify**

Run: `npm test` → all pass (64). Run: `npm run typecheck` → no output. Run: `npm run build` → about 77 pages, with no `/vereine/index.html` (`ls dist/vereine/index.html` fails).
Run `npm run preview`, open `/` at 390 px width, and check the following:
- Tap Aufstellungen → a crest → Zurück → News.
- Each page change is a single quick fade, with no flash of the old page and no rows sliding in again.
- The tab bar shows **News · Aufstellungen · Login**.
- The highlight follows the page.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/Base.astro src/styles/global.css
git commit -m "fix: single quick page fade; Mein Team tab; drop Vereine list"
```


### Task 2: Kickbase API client

**Files:**
- Create: `src/lib/kickbase.ts`
- Test: `src/lib/kickbase.test.ts`

**Interfaces:**
- Produces:
  - `KICKBASE_API`
  - `class KickbaseAuthError` (thrown on 401/403)
  - `class KickbaseUnavailableError` (thrown on network errors, timeouts, other non-2xx responses and invalid JSON)
  - Types `KbLogin {token, expires, userId}`, `KbLeague {id, name}`, `KbPlayer {id, name, teamId, position: 1|2|3|4, image?}` and `KbTeam {id, name}`
  - Functions `login(fetch, email, password)`, `leagues(fetch, token)`, `squad(fetch, token, leagueId)` and `clubTable(fetch, token)`. Each takes `fetch` as its first parameter.

- [ ] **Step 1: Write the failing test**

`src/lib/kickbase.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { clubTable, KickbaseAuthError, KickbaseUnavailableError, leagues, login, squad } from "./kickbase.ts";

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe("kickbase client", () => {
  it("logs in with em/pass and returns token, expiry and user id", async () => {
    const { fn, calls } = fakeFetch(200, { tkn: "T", tknex: "2026-10-14T10:00:00Z", u: { id: "42" } });
    expect(await login(fn, "a@b.de", "pw")).toEqual({ token: "T", expires: "2026-10-14T10:00:00Z", userId: "42" });
    expect(calls[0].url).toBe("https://api.kickbase.com/v4/user/login");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ em: "a@b.de", pass: "pw" });
  });

  it("throws KickbaseAuthError on 401 (wrong password or expired token)", async () => {
    await expect(login(fakeFetch(401, { err: 1 }).fn, "a", "b")).rejects.toBeInstanceOf(KickbaseAuthError);
    await expect(leagues(fakeFetch(401, {}).fn, "T")).rejects.toBeInstanceOf(KickbaseAuthError);
  });

  it("throws KickbaseUnavailableError on 5xx, invalid JSON or network failure", async () => {
    await expect(leagues(fakeFetch(503, {}).fn, "T")).rejects.toBeInstanceOf(KickbaseUnavailableError);
    await expect(leagues(fakeFetch(200, "<html>").fn, "T")).rejects.toBeInstanceOf(KickbaseUnavailableError);
    const broken = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await expect(leagues(broken, "T")).rejects.toBeInstanceOf(KickbaseUnavailableError);
  });

  it("sends the token as Bearer and maps leagues, squad and table", async () => {
    const l = fakeFetch(200, { it: [{ i: "7", n: "Liga" }] });
    expect(await leagues(l.fn, "T")).toEqual([{ id: "7", name: "Liga" }]);
    expect((l.calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer T");

    const s = fakeFetch(200, { it: [{ i: "118", n: "Grifo", tid: "5", pos: 3, pim: "content/file/x.png" }] });
    expect(await squad(s.fn, "T", "7")).toEqual([
      { id: "118", name: "Grifo", teamId: "5", position: 3, image: "https://kickbase.b-cdn.net/content/file/x.png" },
    ]);
    expect(s.calls[0].url).toBe("https://api.kickbase.com/v4/leagues/7/squad");

    const t = fakeFetch(200, { it: [{ tid: "3", tn: "Dortmund" }] });
    expect(await clubTable(t.fn, "T")).toEqual([{ id: "3", name: "Dortmund" }]);
  });
});
````

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/kickbase.test.ts` → FAIL, cannot find module `./kickbase.ts`.

- [ ] **Step 3: Implement**

`src/lib/kickbase.ts`:

````ts
export const KICKBASE_API = "https://api.kickbase.com";
const TIMEOUT_MS = 8000;

/** Kickbase rejected the credentials or the token (HTTP 401/403). */
export class KickbaseAuthError extends Error {}
/** Kickbase is unreachable or answered unexpectedly. */
export class KickbaseUnavailableError extends Error {}

export type KbLogin = { token: string; expires: string; userId: string };
export type KbLeague = { id: string; name: string };
/** pos: 1 = TW, 2 = ABW, 3 = MF, 4 = ST */
export type KbPlayer = { id: string; name: string; teamId: string; position: 1 | 2 | 3 | 4; image?: string };
export type KbTeam = { id: string; name: string };

type Fetch = typeof fetch;

async function call<T>(fetchFn: Fetch, path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(`${KICKBASE_API}${path}`, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new KickbaseUnavailableError("network error or timeout");
  }
  if (res.status === 401 || res.status === 403) throw new KickbaseAuthError(`HTTP ${res.status}`);
  if (!res.ok) throw new KickbaseUnavailableError(`HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new KickbaseUnavailableError("invalid JSON");
  }
}

export async function login(fetchFn: Fetch, email: string, password: string): Promise<KbLogin> {
  const r = await call<{ tkn?: string; tknex?: string; u?: { id?: string } }>(fetchFn, "/v4/user/login", {
    method: "POST",
    body: { em: email, pass: password, loy: false, rep: {} },
  });
  if (!r.tkn) throw new KickbaseUnavailableError("login response without token");
  return { token: r.tkn, expires: r.tknex ?? new Date(Date.now() + 86_400_000).toISOString(), userId: r.u?.id ?? "" };
}

export async function leagues(fetchFn: Fetch, token: string): Promise<KbLeague[]> {
  const r = await call<{ it?: { i: string; n: string }[] }>(fetchFn, "/v4/leagues/selection", { token });
  return (r.it ?? []).map((l) => ({ id: String(l.i), name: l.n }));
}

export async function squad(fetchFn: Fetch, token: string, leagueId: string): Promise<KbPlayer[]> {
  const r = await call<{ it?: { i: string; n: string; tid: string; pos: number; pim?: string }[] }>(
    fetchFn, `/v4/leagues/${encodeURIComponent(leagueId)}/squad`, { token },
  );
  return (r.it ?? []).map((p) => ({
    id: String(p.i),
    name: p.n,
    teamId: String(p.tid),
    position: ([1, 2, 3, 4].includes(p.pos) ? p.pos : 3) as KbPlayer["position"],
    image: p.pim ? `https://kickbase.b-cdn.net/${p.pim}` : undefined,
  }));
}

export async function clubTable(fetchFn: Fetch, token: string): Promise<KbTeam[]> {
  const r = await call<{ it?: { tid: string; tn: string }[] }>(fetchFn, "/v4/competitions/1/table", { token });
  return (r.it ?? []).map((t) => ({ id: String(t.tid), name: t.tn }));
}
````

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/kickbase.test.ts` → PASS (4 tests). Run: `npm run typecheck` → no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kickbase.ts src/lib/kickbase.test.ts
git commit -m "feat: typed Kickbase v4 client"
```


### Task 3: Fixture recorder and squad matching

**Files:**
- Create: `scripts/record-kickbase-fixtures.mjs`, `src/lib/match.ts`
- Test: `src/lib/match.test.ts`
- Fixtures (git-ignored, already recorded on 2026-10-07): `scraper/__fixtures__/kickbase-{leagues,squad,table}.json`. `scraper/__fixtures__/lineups/` is created by the recorder.

**Interfaces:**
- Consumes: `KbPlayer`, `KbTeam` (Task 2); `Lineup`, `LineupPlayer`, `Article`, `Ref` (`scraper/types.ts`).
- Produces:
  - `type StartStatus = "start" | "doubtful" | "alternative" | "bench" | "unknown"`
  - `type MyPlayer = { kickbase, club?, lineup?, ligainsider?, status, statusLabel? }`
  - `normalize(s)`
  - `mapClubs(table, lineups): Map<kickbaseTeamId, Lineup>`
  - `matchPlayer(p, lineup?)`
  - `matchSquad(squad, clubMap)`
  - `squadNews(players, articles)`

- [ ] **Step 1: Add the recorder and record the fixtures**

`scripts/record-kickbase-fixtures.mjs`:

````js
// Records Kickbase API responses into scraper/__fixtures__/ (git-ignored) for the matching tests.
// Reads KICKBASE_EMAIL / KICKBASE_PASSWORD from .env.kickbase (git-ignored; never read by the build).
// Never prints credentials or the token. Usage: node scripts/record-kickbase-fixtures.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.kickbase", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const OUT = "scraper/__fixtures__";
const API = "https://api.kickbase.com";
const H = { accept: "application/json", "content-type": "application/json" };

const login = await fetch(`${API}/v4/user/login`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ em: env.KICKBASE_EMAIL, pass: env.KICKBASE_PASSWORD, loy: false, rep: {} }),
});
if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
const { tkn } = await login.json();
const get = async (path) => {
  const r = await fetch(API + path, { headers: { ...H, authorization: `Bearer ${tkn}` } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
};

mkdirSync(`${OUT}/lineups`, { recursive: true });
const selection = await get("/v4/leagues/selection");
writeFileSync(`${OUT}/kickbase-leagues.json`, JSON.stringify({ it: selection.it.map((l) => ({ ...l, n: `Testliga ${l.i.slice(-3)}` })) }, null, 1));
writeFileSync(`${OUT}/kickbase-squad.json`, JSON.stringify(await get(`/v4/leagues/${selection.it[0].i}/squad`), null, 1));
writeFileSync(`${OUT}/kickbase-table.json`, JSON.stringify(await get("/v4/competitions/1/table"), null, 1));
// The matching tests run against the lineups that belong to the same moment as the squad.
for (const f of readdirSync("store/lineups")) copyFileSync(`store/lineups/${f}`, `${OUT}/lineups/${f}`);
console.log("recorded kickbase-leagues.json, kickbase-squad.json, kickbase-table.json and lineups/");
````

Run: `node scripts/record-kickbase-fixtures.mjs` (requires `.env.kickbase` and a populated `store/`).
Expected: the script prints "recorded kickbase-leagues.json, kickbase-squad.json, kickbase-table.json and lineups/". `ls scraper/__fixtures__/lineups | wc -l` → 18. `git status --short scraper/` shows nothing (git-ignored).

- [ ] **Step 2: Write the failing test**

`src/lib/match.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalize, mapClubs, matchPlayer, matchSquad, squadNews } from "./match.ts";
import type { KbPlayer, KbTeam } from "./kickbase.ts";
import type { Article, Lineup, LineupPlayer } from "../../scraper/types.ts";

const FX = join(import.meta.dirname, "..", "..", "scraper", "__fixtures__");
const json = <T>(name: string) => JSON.parse(readFileSync(join(FX, name), "utf8")) as T;
const table: KbTeam[] = json<{ it: { tid: string; tn: string }[] }>("kickbase-table.json").it.map((t) => ({ id: t.tid, name: t.tn }));
const lineups: Lineup[] = readdirSync(join(FX, "lineups")).map((f) => JSON.parse(readFileSync(join(FX, "lineups", f), "utf8")));

const lp = (id: number, slug: string, name: string, extra: Partial<LineupPlayer> = {}): LineupPlayer => ({ id, slug, name, status: "set", ...extra });
const kb = (name: string, teamId = "3"): KbPlayer => ({ id: "1", name, teamId, position: 3 });
const bvb: Lineup = {
  club: { id: 14, slug: "borussia-dortmund", name: "Borussia Dortmund" },
  formation: "",
  updatedAt: "x",
  lines: [[
    lp(9357, "gregor-kobel", "Kobel"),
    lp(20052, "nico-schlotterbeck", "N. Schlotterbeck", { status: "doubtful", statusLabel: "Angeschlagen", alternative: { id: 7791, slug: "ramy-bensebaini", name: "Bensebaini" } }),
    lp(1, "felix-nmecha", "F. Nmecha"),
    lp(2, "lukas-nmecha", "L. Nmecha"),
  ]],
};

describe("normalize", () => {
  it("strips accents, punctuation and case", () => {
    expect(normalize("Kramarić")).toBe("kramaric");
    expect(normalize("M'gladbach")).toBe("m gladbach");
    expect(normalize("Köln")).toBe("koln");
    expect(normalize("Groß")).toBe("gross");
  });
});

describe("mapClubs", () => {
  it("maps all 18 Kickbase teams to exactly one LigaInsider club each", () => {
    const map = mapClubs(table, lineups);
    expect(map.size).toBe(18);
    expect(new Set([...map.values()].map((l) => l.club.slug)).size).toBe(18);
    expect(map.get("15")?.club.slug).toBe("borussia-moenchengladbach");
    expect(map.get("6")?.club.slug).toBe("hamburger-sv");
    expect(map.get("3")?.club.slug).toBe("borussia-dortmund");
  });
});

describe("matchPlayer", () => {
  it("marks a set starter as start, matched by last name", () => {
    expect(matchPlayer(kb("Kobel"), bvb)).toMatchObject({ status: "start", ligainsider: { id: 9357 } });
  });
  it("marks a doubtful starter with its label", () => {
    expect(matchPlayer(kb("Schlotterbeck"), bvb)).toMatchObject({ status: "doubtful", statusLabel: "Angeschlagen" });
  });
  it("marks an alternative", () => {
    expect(matchPlayer(kb("Bensebaini"), bvb)).toMatchObject({ status: "alternative", ligainsider: { id: 7791 } });
  });
  it("marks a known club's player outside the XI as bench", () => {
    expect(matchPlayer(kb("Can"), bvb).status).toBe("bench");
  });
  it("refuses to guess between two players with the same last name", () => {
    expect(matchPlayer(kb("Nmecha"), bvb).status).toBe("unknown");
  });
  it("matches by full name and accents", () => {
    expect(matchPlayer(kb("Felix Nmecha"), bvb)).toMatchObject({ status: "start", ligainsider: { id: 1 } });
  });
  it("is unknown without a lineup", () => {
    expect(matchPlayer(kb("Kobel"), undefined).status).toBe("unknown");
  });
});

describe("matchSquad on the recorded squad", () => {
  it("finds a club for every player and LigaInsider ids for those in a predicted XI", () => {
    const squad = json<{ it: { i: string; n: string; tid: string; pos: number }[] }>("kickbase-squad.json").it
      .map((p) => ({ id: p.i, name: p.n, teamId: p.tid, position: p.pos as 1 }));
    const result = matchSquad(squad, mapClubs(table, lineups));
    expect(result.every((p) => p.club)).toBe(true);
    expect(result.filter((p) => p.status !== "bench" && p.status !== "unknown").length).toBeGreaterThanOrEqual(8);
  });
});

describe("squadNews", () => {
  const article = (id: number, player: { id: number; slug: string; name: string }, clubId: number, at: string) =>
    ({ id, player, club: { id: clubId, slug: "c", name: "C" }, publishedAt: at }) as Article;

  it("finds articles by matched id and by name at the same club, newest first", () => {
    const players = [matchPlayer(kb("Kobel"), bvb), matchPlayer(kb("Can"), bvb)];
    const news = squadNews(players, [
      article(1, { id: 9357, slug: "gregor-kobel", name: "Gregor Kobel" }, 14, "2026-10-07T07:00:00Z"),
      article(2, { id: 1812, slug: "emre-can", name: "Emre Can" }, 14, "2026-10-07T09:00:00Z"),
      article(3, { id: 5, slug: "x-can", name: "Xaver Can" }, 99, "2026-10-07T10:00:00Z"),
      article(4, { id: 6, slug: "other", name: "Other Player" }, 14, "2026-10-07T11:00:00Z"),
    ]);
    expect(news.map((a) => a.id)).toEqual([2, 1]);
  });
});
````

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/match.test.ts` → FAIL, cannot find module `./match.ts`.

- [ ] **Step 4: Implement**

`src/lib/match.ts`:

````ts
import type { Article, Lineup, LineupPlayer, Ref } from "../../scraper/types.ts";
import type { KbPlayer, KbTeam } from "./kickbase.ts";

export type StartStatus = "start" | "doubtful" | "alternative" | "bench" | "unknown";

export type MyPlayer = {
  kickbase: KbPlayer;
  club?: Lineup["club"];
  lineup?: Lineup;
  ligainsider?: Ref & { photo?: string };
  status: StartStatus;
  statusLabel?: string;
};

/** Lowercase, strip accents, ß → ss, keep only a–z, 0–9 and single spaces. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Kickbase short names that are not contained in LigaInsider's full club name. Keys are normalised. */
const CLUB_ALIASES: Record<string, string> = {
  "m gladbach": "borussia-moenchengladbach",
  hamburg: "hamburger-sv",
  hsv: "hamburger-sv",
};

function containsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Kickbase team id → LigaInsider lineup (via club). Teams that map to zero or several clubs are left out. */
export function mapClubs(table: KbTeam[], lineups: Lineup[]): Map<string, Lineup> {
  const map = new Map<string, Lineup>();
  for (const team of table) {
    const key = normalize(team.name);
    const alias = CLUB_ALIASES[key];
    const hits = alias
      ? lineups.filter((l) => l.club.slug === alias)
      : lineups.filter((l) => containsWords(normalize(l.club.name), key));
    if (hits.length === 1) map.set(team.id, hits[0]);
  }
  return map;
}

function nameMatches(kickbaseName: string, candidate: Ref): boolean {
  const kb = normalize(kickbaseName);
  const name = normalize(candidate.name);
  if (kb === name || kb === name.split(" ").pop()) return true;
  const slug = ` ${candidate.slug.split("-").join(" ")} `;
  return slug.includes(` ${kb} `);
}

/** Matches one Kickbase player against a club's predicted lineup and derives the start status. */
export function matchPlayer(p: KbPlayer, lineup: Lineup | undefined): MyPlayer {
  if (!lineup) return { kickbase: p, status: "unknown" };
  const starters: LineupPlayer[] = lineup.lines.flat();
  const alternatives = starters.flatMap((s) => (s.alternative ? [s.alternative] : []));
  const starterHits = starters.filter((s) => nameMatches(p.name, s));
  const altHits = alternatives.filter((a) => nameMatches(p.name, a));
  const base = { kickbase: p, club: lineup.club, lineup };
  if (starterHits.length + altHits.length > 1) return { ...base, status: "unknown" };
  const s = starterHits[0];
  if (s) {
    return {
      ...base,
      ligainsider: { id: s.id, slug: s.slug, name: s.name, photo: s.photo },
      status: s.status === "doubtful" ? "doubtful" : "start",
      statusLabel: s.statusLabel,
    };
  }
  const a = altHits[0];
  if (a) return { ...base, ligainsider: { id: a.id, slug: a.slug, name: a.name, photo: a.photo }, status: "alternative" };
  return { ...base, status: "bench" };
}

export function matchSquad(squad: KbPlayer[], clubs: Map<string, Lineup>): MyPlayer[] {
  return squad.map((p) => matchPlayer(p, clubs.get(p.teamId)));
}

/** Articles about the squad: by matched LigaInsider id, or by name at the same club. Newest first. */
export function squadNews(players: MyPlayer[], articles: Article[]): Article[] {
  const ids = new Set(players.flatMap((p) => (p.ligainsider ? [p.ligainsider.id] : [])));
  const byClub = new Map<number, string[]>();
  for (const p of players) {
    if (!p.club) continue;
    byClub.set(p.club.id, [...(byClub.get(p.club.id) ?? []), normalize(p.kickbase.name)]);
  }
  return articles
    .filter((a) => {
      if (!a.player) return false;
      if (ids.has(a.player.id)) return true;
      const names = a.club ? byClub.get(a.club.id) : undefined;
      if (!names) return false;
      const full = normalize(a.player.name);
      return names.some((n) => full === n || full.split(" ").pop() === n || containsWords(full, n));
    })
    .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
}
````

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/lib/match.test.ts` → PASS (11 tests). Run: `npm run typecheck` → no output.
If the "recorded squad" test fails because the squad was re-recorded and fewer than 8 players are in a predicted XI, check by hand that the unmatched ones really aren't in their club's lineup before changing anything.

- [ ] **Step 6: Commit**

```bash
git add scripts/record-kickbase-fixtures.mjs src/lib/match.ts src/lib/match.test.ts
git commit -m "feat: match Kickbase squads to LigaInsider lineups and news"
```


### Task 4: Cloudflare adapter, session helpers, login/logout endpoints

**Files:**
- Modify (replace whole file): `astro.config.mjs`, `public/_headers`
- Create: `wrangler.jsonc`, `src/lib/session.ts`, `src/pages/api/login.ts`, `src/pages/api/logout.ts`
- Test: `src/lib/session.test.ts`

**Interfaces:**
- Consumes: `login`, `KickbaseAuthError` (Task 2).
- Produces:
  - `TOKEN_COOKIE = "kb"`, `LOGGED_IN_COOKIE = "kbin"`, `LEAGUE_COOKIE = "kbleague"`
  - `isSameOrigin(request)`, `setSession(cookies, token, expires)`, `clearSession(cookies)`
  - `POST /api/login/` (form fields `email`, `password`) → 303 to `/mein-team/`, `/login/?error=credentials` or `/login/?error=unavailable`; 403 on a foreign origin
  - `POST /api/logout/` → 303 to `/`
  - Build output: `dist/client/` (assets) and `dist/server/` (Worker + generated `wrangler.json`)

- [ ] **Step 1: Write the failing test**

`src/lib/session.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { isSameOrigin } from "./session.ts";

const req = (origin?: string) =>
  new Request("https://ti.example/api/login/", { method: "POST", headers: origin ? { origin } : {} });

describe("isSameOrigin (CSRF guard)", () => {
  it("accepts our own origin", () => expect(isSameOrigin(req("https://ti.example"))).toBe(true));
  it("rejects a foreign origin", () => expect(isSameOrigin(req("https://evil.example"))).toBe(false));
  it("rejects a missing or null origin", () => {
    expect(isSameOrigin(req())).toBe(false);
    expect(isSameOrigin(req("null"))).toBe(false);
  });
});
````

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/session.test.ts` → FAIL, cannot find module `./session.ts`.

- [ ] **Step 3: Install the adapter**

Run: `npm i @astrojs/cloudflare@^14.3.4`

- [ ] **Step 4: Implement the configuration, session helpers and endpoints**

`astro.config.mjs`:

````js
// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "static",
  // Only /mein-team/ and /api/* run on the Worker. No Astro sessions (our session is the Kickbase
  // token cookie) and no image service, so the adapter adds no KV namespace or Images binding.
  // Static pages prerender in Node because they read the scraped data from store/ via node:fs.
  adapter: cloudflare({ imageService: "passthrough", prerenderEnvironment: "node" }),
  session: false,
  trailingSlash: "always",
  build: { format: "directory" },
  // Load pages in the background as links scroll into view, so taps feel instant.
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
  vite: { plugins: [tailwindcss()] },
});
````

`wrangler.jsonc`:

````jsonc
{
  "name": "tonisinsider",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-10-01",
  "assets": { "directory": "./dist", "binding": "ASSETS" }
}
````

`public/_headers`:

````text
/*
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: same-origin
````

`src/lib/session.ts`:

````ts
import type { AstroCookies } from "astro";

/** Kickbase token. HttpOnly: page scripts can never read it. */
export const TOKEN_COOKIE = "kb";
/** Readable flag so the tab bar can say "Mein Team" vs "Login". Contains no secret. */
export const LOGGED_IN_COOKIE = "kbin";
/** Last chosen league id. */
export const LEAGUE_COOKIE = "kbleague";

/** CSRF guard for POST endpoints: the browser must send our own origin. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export function setSession(cookies: AstroCookies, token: string, expires: Date): void {
  cookies.set(TOKEN_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires });
  cookies.set(LOGGED_IN_COOKIE, "1", { httpOnly: false, secure: true, sameSite: "lax", path: "/", expires });
}

export function clearSession(cookies: AstroCookies): void {
  for (const name of [TOKEN_COOKIE, LOGGED_IN_COOKIE, LEAGUE_COOKIE]) cookies.delete(name, { path: "/" });
}
````

`src/pages/api/login.ts`:

````ts
import type { APIRoute } from "astro";
import { KickbaseAuthError, login } from "../../lib/kickbase.ts";
import { isSameOrigin, setSession } from "../../lib/session.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return redirect("/login/?error=credentials", 303);
  try {
    const session = await login(fetch, email, password);
    setSession(cookies, session.token, new Date(session.expires));
    return redirect("/mein-team/", 303);
  } catch (err) {
    // Never log the request body or Kickbase's response: they contain credentials/tokens.
    return redirect(`/login/?error=${err instanceof KickbaseAuthError ? "credentials" : "unavailable"}`, 303);
  }
};
````

`src/pages/api/logout.ts`:

````ts
import type { APIRoute } from "astro";
import { clearSession, isSameOrigin } from "../../lib/session.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  clearSession(cookies);
  return redirect("/", 303);
};
````

`wrangler.jsonc`'s `name` is a placeholder: the real Worker name is always passed with `--name` and lives only in the repo variable.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/lib/session.test.ts` → PASS (3 tests). Run: `npm test` → all pass. Run: `npm run typecheck` → no output.
Run: `npm run build`. Then check:
- `grep -o 'href="/artikel/[0-9]*/"' dist/client/index.html | wc -l` → above 40. If it's 0, the pages prerendered without data: check `prerenderEnvironment: "node"`.
- `ls -a dist/server | grep -c dev.vars` → 0.
- `npx wrangler deploy --config dist/server/wrangler.json --name test --dry-run` lists only `env.ASSETS`.

Run `npm run preview` (Worker at http://localhost:4321) and in another shell:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -d "email=a&password=b" http://localhost:4321/api/login/                                   # 403
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example" -X POST -d "email=a&password=b" http://localhost:4321/api/login/   # 403
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -H "Origin: http://localhost:4321" -X POST -d "email=nobody@example.com&password=wrong" http://localhost:4321/api/login/   # 303 …/login/?error=credentials
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json astro.config.mjs wrangler.jsonc public/_headers src/lib/session.ts src/lib/session.test.ts src/pages/api
git commit -m "feat: Cloudflare Worker adapter with Kickbase login/logout endpoints"
```


### Task 5: Login page and Mein Team page

**Files:**
- Create: `src/components/StartBadge.astro`, `src/components/MyPlayerRow.astro`, `src/pages/login.astro`, `src/pages/mein-team.astro`

**Interfaces:**
- Consumes: Tasks 1–4. `env.ASSETS` comes from `cloudflare:workers`, and `Snapshot` from `scraper/snapshot.ts`.
- Produces: `/login/` (static; shows `?error=` messages client-side) and `/mein-team/` (on demand; redirects to `/login/` without a token and to `/login/?error=expired` on 401).

- [ ] **Step 1: Create the components**

`src/components/StartBadge.astro`:

````astro
---
import type { StartStatus } from "../lib/match.ts";

interface Props { status: StartStatus; label?: string }
const STYLES: Record<StartStatus, { text: string; tone: "green" | "yellow" | "grey" }> = {
  start: { text: "Startelf", tone: "green" },
  doubtful: { text: "Fraglich", tone: "yellow" },
  alternative: { text: "Alternative", tone: "yellow" },
  bench: { text: "Nicht in der Startelf", tone: "grey" },
  unknown: { text: "Unbekannt", tone: "grey" },
};
const { status, label } = Astro.props;
const s = STYLES[status];
const style = s.tone === "grey"
  ? "background:var(--surface);color:var(--muted)"
  : `background:var(--${s.tone}-bg);color:var(--${s.tone}-fg)`;
---
<span class="rounded-full px-[7px] py-[2px] text-[10.5px] font-semibold whitespace-nowrap" style={style}>
  {s.text}{status === "doubtful" && label ? ` · ${label}` : ""}
</span>
````

`src/components/MyPlayerRow.astro`:

````astro
---
import type { MyPlayer } from "../lib/match.ts";
import Avatar from "./Avatar.astro";
import StartBadge from "./StartBadge.astro";
import { kickoffDay, time } from "../lib/format.ts";

interface Props { player: MyPlayer; index?: number }
const { player: p, index = 0 } = Astro.props;
const name = p.ligainsider?.name ?? p.kickbase.name;
const l = p.lineup;
const match = l?.opponent
  ? `${l.opponent.home ? "vs" : "@"} ${l.opponent.name}${l.kickoff ? ` · ${kickoffDay(l.kickoff)} ${time(l.kickoff)}` : ""}`
  : undefined;
const href = p.club ? `/vereine/${p.club.slug}/` : undefined;
const Tag = href ? "a" : "div";
---
<Tag href={href} class="press enter flex items-center gap-3 py-3" style={`--i:${index}`}>
  <span class="relative">
    <Avatar src={p.ligainsider?.photo ?? p.kickbase.image} name={name} size={44} />
    {p.club?.crest && <img src={p.club.crest} alt="" class="absolute -right-1 -bottom-1 size-[18px] rounded-full bg-bg object-contain p-[1px]" />}
  </span>
  <span class="min-w-0 flex-1">
    <span class="block truncate text-[15px] font-semibold tracking-[-0.01em]">{name}</span>
    {match && <span class="block truncate text-xs text-muted">{match}</span>}
  </span>
  <StartBadge status={p.status} label={p.statusLabel} />
</Tag>
````

- [ ] **Step 2: Create the pages**

`src/pages/login.astro`:

````astro
---
import Base from "../layouts/Base.astro";
---
<Base title="Login" tab="mein-team">
  <p class="mb-6 text-[15px] text-muted">Melde dich mit deinem Kickbase-Account an, um dein Team mit den voraussichtlichen Aufstellungen und passenden News zu sehen.</p>
  <p id="login-error" class="mb-4 hidden rounded-xl px-4 py-3 text-sm font-medium" style="background:var(--red-bg);color:var(--red-fg)"></p>
  <form method="post" action="/api/login/" class="flex flex-col gap-3" data-astro-reload>
    <input name="email" type="email" required autocomplete="username" placeholder="Kickbase E-Mail"
      class="rounded-xl bg-surface px-4 py-3 text-[16px] outline-none focus:ring-2 focus:ring-[var(--accent)]" />
    <input name="password" type="password" required autocomplete="current-password" placeholder="Passwort"
      class="rounded-xl bg-surface px-4 py-3 text-[16px] outline-none focus:ring-2 focus:ring-[var(--accent)]" />
    <button type="submit" class="press mt-2 rounded-xl py-3 text-[16px] font-semibold text-white" style="background:var(--accent)">Anmelden</button>
  </form>
  <p class="mt-4 text-xs text-muted">Dein Passwort wird nur an Kickbase weitergeleitet und nirgends gespeichert. Wir speichern nur das Kickbase-Login-Token in einem sicheren Cookie in deinem Browser.</p>
  <script is:inline>
    (() => {
      const msg = {
        credentials: "E-Mail oder Passwort falsch.",
        expired: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
        unavailable: "Kickbase ist gerade nicht erreichbar. Versuch es gleich nochmal.",
      }[new URLSearchParams(location.search).get("error")];
      const el = document.getElementById("login-error");
      if (msg && el) { el.textContent = msg; el.classList.remove("hidden"); }
    })();
  </script>
</Base>
````

`src/pages/mein-team.astro`:

````astro
---
import Base from "../layouts/Base.astro";
import MyPlayerRow from "../components/MyPlayerRow.astro";
import ArticleRow from "../components/ArticleRow.astro";
import { env } from "cloudflare:workers";
import { clubTable, KickbaseAuthError, leagues as fetchLeagues, squad as fetchSquad, type KbLeague, type KbTeam } from "../lib/kickbase.ts";
import { mapClubs, matchSquad, squadNews, type MyPlayer } from "../lib/match.ts";
import { clearSession, LEAGUE_COOKIE, TOKEN_COOKIE } from "../lib/session.ts";
import type { Article } from "../../scraper/types.ts";
import type { Snapshot } from "../../scraper/snapshot.ts";

export const prerender = false;

const token = Astro.cookies.get(TOKEN_COOKIE)?.value;
if (!token) return Astro.redirect("/login/");

// The club table rarely changes; keep it per Worker isolate for a day.
const g = globalThis as unknown as { __kbTable?: { at: number; teams: KbTeam[] } };

let error: string | undefined;
let leagues: KbLeague[] = [];
let league: KbLeague | undefined;
let players: MyPlayer[] = [];
let news: Article[] = [];
try {
  leagues = await fetchLeagues(fetch, token);
  const wanted = Astro.url.searchParams.get("league") ?? Astro.cookies.get(LEAGUE_COOKIE)?.value;
  league = leagues.find((l) => l.id === wanted) ?? leagues[0];
  if (league) {
    Astro.cookies.set(LEAGUE_COOKIE, league.id, { path: "/", secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    if (!g.__kbTable || Date.now() - g.__kbTable.at > 86_400_000) {
      g.__kbTable = { at: Date.now(), teams: await clubTable(fetch, token) };
    }
    const [squad, snapshot] = await Promise.all([
      fetchSquad(fetch, token, league.id),
      env.ASSETS.fetch(new URL("/data/snapshot.json", Astro.url))
        .then((r: Response) => (r.ok ? (r.json() as Promise<Snapshot>) : undefined))
        .catch(() => undefined),
    ]);
    const lineups = snapshot?.lineups ?? [];
    players = matchSquad(squad, mapClubs(g.__kbTable.teams, lineups));
    news = squadNews(players, snapshot?.articles ?? []);
  }
} catch (err) {
  if (err instanceof KickbaseAuthError) {
    clearSession(Astro.cookies);
    return Astro.redirect("/login/?error=expired");
  }
  error = "Kickbase ist gerade nicht erreichbar. Versuch es gleich nochmal.";
}

const GROUPS = [
  { pos: 1, label: "Torwart" },
  { pos: 2, label: "Abwehr" },
  { pos: 3, label: "Mittelfeld" },
  { pos: 4, label: "Sturm" },
] as const;
let index = 0;
---
<Base title="Mein Team" tab="mein-team">
  {error && <p class="mb-4 rounded-xl px-4 py-3 text-sm font-medium" style="background:var(--red-bg);color:var(--red-fg)">{error}</p>}

  {leagues.length > 1 && (
    <nav class="mb-4 flex overflow-x-auto rounded-[10px] bg-surface p-[2px] text-[13px] font-semibold">
      {leagues.map((l) => (
        <a href={`/mein-team/?league=${encodeURIComponent(l.id)}`}
          class:list={["flex-1 rounded-lg px-3 py-1.5 text-center whitespace-nowrap", league?.id === l.id ? "bg-raised text-fg shadow-sm" : "text-muted"]}>{l.name}</a>
      ))}
    </nav>
  )}

  {!error && league && players.length === 0 && <p class="py-10 text-center text-muted">Keine Spieler in dieser Liga.</p>}
  {!error && !league && <p class="py-10 text-center text-muted">Du bist in keiner Kickbase-Liga.</p>}

  {GROUPS.map((group) => {
    const inGroup = players.filter((p) => p.kickbase.position === group.pos);
    return inGroup.length > 0 && (
      <section class="mb-3">
        <h2 class="py-2 text-xs font-semibold tracking-wide text-muted uppercase">{group.label}</h2>
        <div class="divide-y divide-hairline">
          {inGroup.map((p) => <MyPlayerRow player={p} index={index++} />)}
        </div>
      </section>
    );
  })}

  {news.length > 0 && (
    <section class="mt-6">
      <h2 class="py-2 text-xs font-semibold tracking-wide text-muted uppercase">News zu deinen Spielern</h2>
      <div class="divide-y divide-hairline">
        {news.map((a, i) => <ArticleRow article={a} index={i} />)}
      </div>
    </section>
  )}

  <form method="post" action="/api/logout/" class="mt-8" data-astro-reload>
    <button type="submit" class="press w-full rounded-xl bg-surface py-3 text-sm font-semibold" style="color:var(--red-fg)">Abmelden</button>
  </form>
</Base>
````

- [ ] **Step 3: Verify end to end with the test account**

Run `npm test`, then `npm run typecheck`, then `npm run build`; all must pass. Then run `npm run preview` and use a phone-width browser:
1. `/mein-team/` → redirected to `/login/`. The tab reads "Login".
2. Wrong password → "E-Mail oder Passwort falsch."
3. Log in with the `.env.kickbase` account (type it in yourself; never paste it anywhere else). You should land on `/mein-team/` with:
   - Players grouped Torwart / Abwehr / Mittelfeld / Sturm, each with a badge (expect most "Startelf", some "Nicht in der Startelf").
   - "News zu deinen Spielern".
   - The tab reading "Mein Team".
4. In devtools → Application → Cookies, check:
   - `kb` is HttpOnly + Secure + Lax, expiring in about 7 days.
   - `kbin` = 1.
   - `kbleague` is set.
5. Delete `kb` only and reload `/mein-team/` → redirected to `/login/`.
6. Log in again, tap a player → that club's page. Then tap Abmelden → `/`, all three cookies gone, and the tab reads "Login".
7. Dark and light mode both look right, with no horizontal scrolling.

- [ ] **Step 4: Commit**

```bash
git add src/components/StartBadge.astro src/components/MyPlayerRow.astro src/pages/login.astro src/pages/mein-team.astro
git commit -m "feat: Kickbase login page and Mein Team page"
```


### Task 6: Deploy step, README, go live

**Files:**
- Modify (replace whole file): `.github/workflows/scrape.yml`, `README.md`

**Interfaces:**
- Consumes: build output from Task 4 (`dist/server/wrangler.json`).

- [ ] **Step 1: Replace the workflow and README**

`.github/workflows/scrape.yml`:

````yaml
name: scrape-and-deploy

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:
  push:
    branches: [main]

# Never run two scrapes at once; queue instead of cancelling (a cancelled run would lose its cache save).
concurrency:
  group: scrape
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false # keep the token away from npm dependencies

      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - name: Typecheck (code changes only)
        if: github.event_name != 'schedule'
        run: npm run typecheck

      - name: Restore data cache
        uses: actions/cache/restore@v4
        with:
          path: |
            store
            public/img
          key: data-${{ github.run_id }}
          restore-keys: data-

      - name: Restore from our own site if the cache was lost
        run: npm run restore
        env:
          SITE_URL: ${{ vars.SITE_URL }}

      - name: Scrape
        id: scrape
        run: npm run scrape

      - name: Save data cache
        if: steps.scrape.outputs.save_cache == 'true'
        uses: actions/cache/save@v4
        with:
          path: |
            store
            public/img
          key: data-${{ github.run_id }}

      - name: Build
        if: steps.scrape.outputs.changed == 'true' || github.event_name != 'schedule'
        run: npm run build

      # The site is a Cloudflare Worker (Astro adapter): static pages as assets, /mein-team/ and /api/*
      # rendered on request. The name comes from a repo variable so the URL never appears in this repo.
      - name: Deploy to Cloudflare
        if: steps.scrape.outputs.changed == 'true' || github.event_name != 'schedule'
        run: npx wrangler deploy --config dist/server/wrangler.json --name "${{ vars.CF_PAGES_PROJECT }}"
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Fail if the scraper reported problems (GitHub emails you)
        if: steps.scrape.outputs.problems != '0'
        run: |
          echo "The scraper reported problems; see the Scrape step log. LigaInsider may have changed their HTML."
          exit 1

  # GitHub pauses scheduled workflows in public repos after 60 days without activity.
  # Re-enabling (idempotent) during the midnight-UTC hour resets that timer. Separate job so that
  # only this tiny step, which runs no npm code, holds the actions:write token.
  keep-alive:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    timeout-minutes: 2
    permissions:
      actions: write
    steps:
      - name: Re-enable this workflow
        run: |
          if [ "$(date -u +%H)" = "00" ]; then
            gh api -X PUT "repos/${{ github.repository }}/actions/workflows/scrape.yml/enable" \
              || echo "::warning::keep-alive call failed; will retry next run"
          fi
        env:
          GH_TOKEN: ${{ github.token }}
````

`README.md`:

````text
# tonisInsider

Private, ad-free reader for ligainsider.de news and predicted Bundesliga XIs. Only for me and friends: not indexed, not public.

## How it works

A GitHub Actions cron (every 5 min) scrapes LigaInsider. Data lives in the Actions cache, never in git. When something changed, it builds the Astro site and deploys it to Cloudflare (Workers static assets). See `docs/superpowers/specs/2026-10-07-tonisinsider-design.md`.

## Local development

```bash
npm install
npm run scrape     # first run: ~5–8 min backfill; later runs: seconds
npm run dev        # http://localhost:4321
npm test           # needs scraper/__fixtures__/ (git-ignored, real pages + recorded Kickbase responses)
npm run build && npm run preview   # local Worker incl. Kickbase login at http://localhost:4321/login/
```

## One-time setup (owner)

The site is a Cloudflare Worker built with Astro's Cloudflare adapter: static pages are served as assets, while `/mein-team/` and `/api/login|logout/` run on the Worker (Kickbase login). Deploy: `npm run build && npx wrangler deploy --config dist/server/wrangler.json --name <name>`.

1. **Cloudflare:** create an API token with "Workers Scripts: Edit" (plus "Account Settings: Read"), and note your account ID.
2. **Pick an unguessable name**, e.g. `ligainsider-ba52`. The site URL becomes `https://<name>.<your-subdomain>.workers.dev`. Don't connect the Worker to GitHub in the Cloudflare dashboard: the workflow deploys it, and a Git-connected build would publish an empty site.
3. **GitHub:** a **public** repo (public = unlimited free Actions minutes; it only contains code).
4. In the repo settings → Secrets and variables → Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables: `CF_PAGES_PROJECT` = `<name>`, `SITE_URL` = `https://<name>.<your-subdomain>.workers.dev`
5. Actions tab → `scrape-and-deploy` → "Run workflow" once. The first run backfills (~8 min).

## When GitHub emails "run failed"

The Scrape step log lists `PROBLEM:` lines. Usually LigaInsider changed their HTML. Save the affected page into `scraper/__fixtures__/`, update the parser until `npm test` passes, then push.
````

- [ ] **Step 2: Verify locally**

Run: `npm test && npm run typecheck && npm run build` → all green. Run: `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/scrape.yml")'` → no error.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/scrape.yml README.md
git commit -m "ci: deploy the Astro Cloudflare Worker build"
```

- [ ] **Step 4: Merge, push and verify live (outward-facing: the owner has asked for deploys on push)**

Merge the feature branch into `main` and push. Wait for the `scrape-and-deploy` run (push event) to finish green. Then check:
- `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $SITE_URL/mein-team/` → `302 …/login/`
- `curl -sI $SITE_URL/ | grep -i referrer-policy` → `same-origin`
- The owner logs in on their phone and sees their team.
