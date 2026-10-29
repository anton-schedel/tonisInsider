import type { NewsType } from "../../scraper/types.ts";
import type { BotMood, CoachPost, CoachThumb, CoachType } from "./coachPosts.ts";
import { CLUB, CLUB_BANNER, coachBody } from "./coachPosts.ts";
import { localInput, namesOf, statusOf, toBody, type FormValues } from "./coachForm.ts";
import { NEWS_TYPE, toneClass } from "./newsTypes.ts";
import { fullDate, nameMin, time } from "./format.ts";
import { confirmedLineup } from "./lineupNews.ts";
import { defaultCrop, fit, rounded, sameCrop, square, type Crop } from "./coachCrop.ts";
import { EASE_GLIDE } from "./motion.ts";
import { findTeamPhoto, type TeamPhoto } from "./teamPhotos.ts";
import {
  articleChoice, byName, cropFeed, feedChoice, feedFromArticle, feedOf, fromPost, pickArticle, pickFeed, teamArticle, teamFeed,
  type Feed, type Pic, type Pics,
} from "./coachPics.ts";
import { revealIn } from "./commentUi.ts";

/** The coach's page (/schnoeselmob/): sign in, the list of posts, the editor with its preview. */

const LINEUP_HEADLINE = "Aufstellung des TuS Schnöselmob";
/** A lineup's address on the site (toArticle): what makes the feed show it as a confirmed lineup. */
const LINEUP_URL = "/tus-schnoeselmob/aufstellung-des-tus-schnoeselmob-0/";
const TYPE_LABEL: Record<CoachType, string> = { lineup: "Aufstellung", result: "Ergebnis", player: "Spielernews" };
const imageUrl = (id: string) => `/api/coach/images/${id}/`;
/** The feed picture's size as stored (the feed shows it at 64 px, 40 on the article; sharp on 3x screens). */
const THUMB = 256;
/** The circle in the framing box, and the feed's (64 px, like ArticleRow; the article header's is 40). */
const RING = 160;
const FACE = 64;

const jpeg = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string; signedOut?: boolean } }> {
  try {
    const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Keine Verbindung. Versuch es gleich nochmal." } as T & { error: string } };
  }
}

/** Shrinks a photo to at most 1200 px on its long side, as JPEG. */
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  const blob = await jpeg(canvas, 0.82);
  if (!blob) throw new Error("Bild konnte nicht gelesen werden.");
  return { blob, width, height };
}

/** Puts a photo (w×h) under a circle of d px centred in a bw×bh box, showing the crop's square. */
function place(img: HTMLImageElement, w: number, h: number, c: Crop, d: number, bw = d, bh = d) {
  const s = square(w, h, c);
  const k = d / s.side;
  img.style.width = `${w * k}px`;
  img.style.height = `${h * k}px`;
  img.style.transform = `translate(${(bw - d) / 2 - s.left * k}px, ${(bh - d) / 2 - s.top * k}px)`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function setSeg(seg: HTMLElement, attr: string, value: string) {
  const buttons = [...seg.querySelectorAll<HTMLButtonElement>(`[${attr}]`)];
  buttons.forEach((b, i) => {
    const on = b.getAttribute(attr) === value;
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-checked", String(on));
    if (on) seg.style.setProperty("--i", String(i));
  });
}

/** 19:00 today if that's still ahead, else the next full hour. */
function defaultTime(now: Date): string {
  const evening = new Date(now);
  evening.setHours(19, 0, 0, 0);
  if (evening.getTime() > now.getTime() + 10 * 60_000) return localInput(evening.toISOString());
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  return localInput(next.toISOString());
}

export function initCoach() {
  const root = document.querySelector<HTMLElement>("[data-coach]");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";
  const q = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const login = q<HTMLFormElement>('[data-view="login"]');
  const list = q('[data-view="list"]');
  const form = q<HTMLFormElement>('[data-view="edit"]');
  const status = q("[data-status]");
  const posts: CoachPost[] = JSON.parse(document.querySelector("[data-coach-posts]")?.textContent ?? "[]");
  let team: TeamPhoto[] = JSON.parse(document.querySelector("[data-coach-team]")?.textContent ?? "[]");

  let editing: CoachPost | undefined;
  let type: CoachType = "lineup";
  let when: "now" | "later" = "later";
  let home = true;
  let badge: NewsType = "angeschlagen";
  let mood: BotMood = "gemischt";
  /** The article's photo and the feed's picture, each with who chose it (coachPics). */
  let pics: Pics = {};
  /** The feed picture as saved (unchanged, it isn't cut and uploaded again). */
  let savedThumb: CoachThumb | undefined;
  /** The photo the feed's circle is cut from, once loaded: its size, and what the canvas draws when saving. */
  let face: { id: string; url: string; img: HTMLImageElement; ready: Promise<unknown> } | undefined;
  /** Photos uploaded in this editor (offered as the player's team photo) and the pictures of their own, per spot. */
  let uploadedArticle: string | undefined;
  let uploadedFeed: string | undefined;
  let ownArticle: Pic | undefined;
  let ownFeed: Feed | undefined;
  /** Crest pictures made here for a photo that is no team photo (yet). */
  const made = new Map<string, string>();
  /** Set when the cookie ran out while saving: after signing in again, back to the form as it was. */
  let resume = false;

  const show = (view: "login" | "list" | "edit") => {
    login.hidden = view !== "login";
    list.hidden = view !== "list";
    form.hidden = view !== "edit";
    window.scrollTo({ top: 0 });
  };
  const say = (text: string, kind: "" | "ok" | "error" = "") => {
    status.textContent = text;
    status.className = `min-h-5 text-[14px]${kind ? ` is-${kind}` : ""}`;
  };

  // --- Sign in ---------------------------------------------------------------------------------------------
  login.addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = q("[data-error]");
    const button = login.querySelector("button")!;
    button.disabled = true;
    const r = await api("/api/coach/login/", { method: "POST", body: JSON.stringify({ password: (login.elements.namedItem("password") as HTMLInputElement).value }) });
    button.disabled = false;
    if (!r.ok) { error.textContent = r.data.error ?? "Anmelden hat nicht geklappt."; return; }
    if (resume) { resume = false; show("edit"); say("Angemeldet. Jetzt nochmal speichern."); return; }
    location.reload();
  });
  q("[data-logout]").addEventListener("click", async () => {
    await api("/api/coach/login/", { method: "DELETE" });
    location.reload();
  });
  const signedOut = () => {
    resume = true;
    show("login");
    q("[data-error]").textContent = "Bitte melde dich wieder an. Dein Beitrag bleibt erhalten.";
  };

  // --- The list --------------------------------------------------------------------------------------------
  const renderList = () => {
    const ul = q("[data-posts]");
    const now = new Date();
    ul.replaceChildren(...posts.map((p) => {
      const li = el("li");
      const b = el("button", "press-row flex w-full items-center gap-3.5 py-3 text-left");
      b.type = "button";
      const img = el("img", "size-12 shrink-0 rounded-full object-cover");
      img.src = p.data.thumb ? imageUrl(p.data.thumb.imageId) : p.image ? imageUrl(p.image.id) : CLUB.crest;
      img.alt = "";
      const text = el("span", "min-w-0 flex-1");
      const s = statusOf(p.publishedAt, now);
      text.append(
        el("span", "block truncate text-[16px] font-semibold", p.data.headline),
        el("span", `block text-[13px] ${s.planned ? "font-semibold text-[var(--gold)]" : "text-muted"}`, `${TYPE_LABEL[p.type]} · ${s.label}`),
      );
      b.append(img, text);
      b.addEventListener("click", () => openEditor(p));
      li.append(b);
      return li;
    }));
    q("[data-empty]").hidden = posts.length > 0;
  };

  // --- The editor ------------------------------------------------------------------------------------------
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const values = (): FormValues => ({
    type, when, home, badge, mood,
    lines: [0, 1, 2, 3].map((i) => input(`line${i}`).value),
    bench: input("bench").value,
    opponent: input("opponent").value, ours: input("ours").value, theirs: input("theirs").value,
    playerName: input("playerName").value,
    headline: input("headline").value, text: input("text").value,
    at: input("at").value, pin: input("pin").value, bots: input("bots").checked, context: input("context").value,
  });

  const setType = (t: CoachType) => {
    const before = type;
    type = t;
    setSeg(q("[data-type-seg]"), "data-type", t);
    root.querySelectorAll<HTMLElement>("[data-for]").forEach((x) => (x.hidden = x.dataset.for !== t));
    // The name's team photo only in player news (one it filled goes again with another type).
    followName();
    // The lineup's usual headline comes and goes with the type, unless the coach wrote their own.
    const h = input("headline");
    if (t === "lineup" && !h.value.trim()) h.value = LINEUP_HEADLINE;
    else if (before === "lineup" && t !== "lineup" && h.value === LINEUP_HEADLINE) h.value = "";
    render();
  };
  const setWhen = (w: "now" | "later") => {
    when = w;
    setSeg(q("[data-when-seg]"), "data-when", w);
    q("[data-at]").hidden = w === "now";
    render();
  };
  const setHome = (h: boolean) => { home = h; setSeg(q("[data-home-seg]"), "data-home", h ? "1" : "0"); };
  const setBadge = (b: NewsType) => {
    badge = b;
    root.querySelectorAll<HTMLElement>("[data-badge]").forEach((c) => c.classList.toggle("is-on", c.dataset.badge === b));
    render();
  };
  const setMood = (m: BotMood) => {
    mood = m;
    root.querySelectorAll<HTMLElement>("[data-mood]").forEach((c) => c.classList.toggle("is-on", c.dataset.mood === m));
  };

  /** The post's comments with a delete button each (only ones that are out). */
  async function loadComments(postId: number) {
    const box = q("[data-comments-box]");
    const ul = q("[data-comments]");
    type C = { id: number; user: string; text: string; replies: C[] };
    const d = await fetch(`/api/own-comments/${postId}/`).then((r) => (r.ok ? (r.json() as Promise<{ total: number; comments: C[] }>) : undefined)).catch(() => undefined);
    if (!d || editing?.id !== postId) return;
    box.hidden = d.total === 0;
    q("[data-comments-count]").textContent = String(d.total);
    const item = (c: C, reply: boolean) => {
      const li = el("li", `flex items-start gap-3 py-2.5${reply ? " pl-6" : ""}`);
      const text = el("div", "min-w-0 flex-1 text-[14px] leading-snug");
      text.append(el("span", "font-semibold", c.user), document.createTextNode(` ${c.text}`));
      const del = el("button", "press shrink-0 rounded-full px-2.5 py-1 text-[13px] font-semibold text-[var(--red-fg)]", "Löschen");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm(`Kommentar von ${c.user} löschen?${c.replies.length ? " Die Antworten darauf gehen mit." : ""}`)) return;
        const r = await api(`/api/coach/comments/${c.id}/`, { method: "DELETE" });
        if (r.status === 401) return signedOut();
        if (r.ok) void loadComments(postId);
        else say(r.data.error ?? "Löschen hat nicht geklappt.", "error");
      });
      li.append(text, del);
      return li;
    };
    ul.replaceChildren(...d.comments.flatMap((c) => [item(c, false), ...c.replies.map((r) => item(r, true))]));
  }

  /** How many bot comments are still to come, with a button to bring them forward. */
  async function loadPlanned(postId: number) {
    const box = q("[data-planned]");
    const r = await api<{ planned?: number }>(`/api/coach/bots/${postId}/`);
    if (editing?.id !== postId) return;
    const n = r.ok ? r.data.planned ?? 0 : 0;
    box.hidden = n === 0;
    q("[data-planned-text]").textContent = `${n} Bot-Kommentar${n === 1 ? "" : "e"} geplant`;
  }

  // --- The pictures ------------------------------------------------------------------------------------------
  const calm = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lastName = (t: TeamPhoto) => t.player.split(" ").at(-1) ?? t.player;
  const nameMatch = () => (type === "player" ? findTeamPhoto(input("playerName").value, team) : undefined);
  /** The typed name's team photo goes where nothing was chosen (only in player news). */
  const followName = () => { pics = byName(pics, nameMatch(), imageUrl); };

  /** The crest picture there is for a photo: its team photo's, or one made here. */
  const avatarOf = (id: string) => team.find((t) => t.imageId === id)?.avatarId ?? made.get(id);
  /** The feed's square of a photo: the one being framed, its framing (unset: the head), the photo once loaded. */
  const cut = () => { const f = feedOf(pics); return f?.kind === "cut" ? f : undefined; };
  const framing = (): Crop | undefined => {
    const c = cut();
    if (!c || !face?.img.naturalWidth || face.id !== c.src.id) return undefined;
    const { naturalWidth: w, naturalHeight: h } = face.img;
    return c.crop ? fit(w, h, c.crop) : defaultCrop(w, h);
  };
  const stage = q("[data-crop]");
  const stageImg = q<HTMLImageElement>("[data-crop-img]");

  /** The circles cut from the photo (the box's, the feed row's, the article header's), all from the same framing. */
  function drawFace() {
    const c = framing();
    if (!c || !face) return;
    const { naturalWidth: w, naturalHeight: h } = face.img;
    if (stage.clientWidth) place(stageImg, w, h, c, RING, stage.clientWidth, stage.clientHeight);
    form.querySelectorAll<HTMLImageElement>(".coach-face > img").forEach((img) => {
      if (img.getAttribute("src") === face!.url) place(img, w, h, c, img.parentElement!.clientWidth || FACE);
    });
    q<HTMLInputElement>("[data-zoom]").value = String(c.zoom);
  }
  const setCrop = (c: Crop) => {
    if (!face?.img.naturalWidth) return;
    pics = cropFeed(pics, fit(face.img.naturalWidth, face.img.naturalHeight, c));
    drawFace();
  };

  /** Loads the photo the feed's circle is cut from (when it is a new one) and frames it. */
  function loadFace() {
    const c = cut();
    if (!c) { face = undefined; return; }
    if (face?.url === c.src.url) return drawFace();
    const img = new Image();
    img.src = c.src.url;
    const f = { ...c.src, img, ready: img.decode() };
    face = f;
    f.ready.then(() => {
      if (face !== f) return;
      stageImg.src = f.url;
      drawFace();
      // A new photo settles in; dragging after that is immediate.
      if (calm()) stageImg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE_GLIDE });
    }, () => {});
  }

  /**
   * What to save as data.thumb (player news only): the crest picture as it is, the saved cut if nothing changed, else
   * the circle drawn at 256 px and uploaded (null: signed out).
   */
  async function feedThumb(): Promise<CoachThumb | undefined | null> {
    const f = feedOf(pics);
    if (!f) return undefined;
    if (f.kind === "preset") return { imageId: f.id, source: f.source, x: 0.5, y: 0.5, zoom: 1, preset: true };
    loadFace();
    const ff = face!;
    await ff.ready;
    const c = rounded(framing()!);
    if (savedThumb && !savedThumb.preset && savedThumb.source === ff.id && sameCrop(savedThumb, c)) return savedThumb;
    const sq = square(ff.img.naturalWidth, ff.img.naturalHeight, c);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = THUMB;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(ff.img, sq.left, sq.top, sq.side, sq.side, 0, 0, THUMB, THUMB);
    const blob = await jpeg(canvas, 0.86);
    if (!blob) throw new Error("Bild konnte nicht gelesen werden.");
    const id = await upload(blob, THUMB, THUMB);
    return id ? { imageId: id, source: ff.id, ...c } : null;
  }

  /** Stores a JPEG (POST /api/coach/images/) and returns its id; undefined when signed out (the sign-in shows). */
  async function upload(blob: Blob, width: number, height: number): Promise<string | undefined> {
    if (blob.size > 600 * 1024) throw new Error("Bild zu groß.");
    const res = await fetch(`/api/coach/images/?w=${width}&h=${height}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (res.status === 401) { signedOut(); return undefined; }
    if (!res.ok || !data.id) throw new Error(data.error ?? "Foto konnte nicht hochgeladen werden.");
    return data.id;
  }

  function openEditor(p?: CoachPost) {
    editing = p;
    form.reset();
    closeSheet(false);
    uploadedArticle = uploadedFeed = ownArticle = ownFeed = undefined;
    say("");
    q("[data-delete]").hidden = !p;
    const now = new Date();
    if (p) {
      const d = p.data;
      d.lineup?.lines.slice(0, 4).forEach((l, i) => (input(`line${i}`).value = l.join(", ")));
      // A lineup with more than four rows: the extra rows go into the attack field (rare).
      if (d.lineup && d.lineup.lines.length > 4) input("line3").value = d.lineup.lines.slice(3).flat().join(", ");
      input("bench").value = d.lineup?.bench.join(", ") ?? "";
      input("opponent").value = d.result?.opponent ?? "";
      input("ours").value = String(d.result?.ours ?? 0);
      input("theirs").value = String(d.result?.theirs ?? 0);
      input("playerName").value = d.player?.name ?? "";
      input("headline").value = d.headline;
      input("text").value = d.text ?? "";
      input("at").value = localInput(p.publishedAt);
      const hours = p.pinnedUntil ? Math.round((Date.parse(p.pinnedUntil) - Date.parse(p.publishedAt)) / 3_600_000) : 0;
      input("pin").value = String([0, 1, 2, 3, 6, 12, 24].includes(hours) ? hours : 1);
      input("bots").checked = d.bots?.on ?? false;
      input("context").value = d.bots?.context ?? "";
      setMood(d.bots?.mood ?? "gemischt");
      void loadComments(p.id);
      void loadPlanned(p.id);
      type = p.type;
      setHome(d.result?.home ?? true);
      setBadge(d.player?.newsType ?? "angeschlagen");
      // The saved pictures count as chosen; one of their own comes back as a choice in its sheet.
      savedThumb = d.thumb;
      pics = fromPost(p.image ? { id: p.image.id, url: imageUrl(p.image.id) } : undefined, p.type === "player" ? d.thumb : undefined, imageUrl);
      if (articleChoice(pics, team) === "own") ownArticle = pics.article;
      if (feedChoice(pics, team) === "own") ownFeed = pics.feed;
      setWhen(Date.parse(p.publishedAt) > now.getTime() ? "later" : "now");
    } else {
      // A new lineup starts from the last one: usually only a few names change.
      const last = posts.find((x) => x.type === "lineup")?.data.lineup;
      last?.lines.slice(0, 4).forEach((l, i) => (input(`line${i}`).value = l.join(", ")));
      input("bench").value = last?.bench.join(", ") ?? "";
      input("headline").value = LINEUP_HEADLINE;
      input("at").value = defaultTime(now);
      input("pin").value = "1";
      type = "lineup";
      setHome(true);
      setBadge("angeschlagen");
      savedThumb = undefined;
      pics = {};
      setMood("gemischt");
      q("[data-comments-box]").hidden = true;
      q("[data-planned]").hidden = true;
      setWhen("later");
    }
    setType(type);
    show("edit");
  }

  // --- Vorschau: the feed's row and the article as the readers will see them -------------------------------
  const feedSpot = q<HTMLButtonElement>("[data-feed-spot]");
  const feedPic = q("[data-feed-pic]");
  const headPic = q("[data-head-pic]");
  const banner = q<HTMLButtonElement>("[data-banner]");
  const bannerPics = q("[data-banner-pics]");

  /**
   * Puts a new picture over the old one once it has loaded and fades between them (200 ms), so a change shows
   * where it lands; `then` runs as it comes in (the banner takes the photo's shape).
   */
  function swapIn(box: HTMLElement, layer: HTMLElement, then?: (img: HTMLImageElement) => void) {
    const img = layer.querySelector("img")!;
    const old = [...box.querySelectorAll<HTMLElement>(":scope > .coach-layer")];
    layer.style.opacity = "0";
    box.append(layer);
    drawFace();
    img.decode().catch(() => {}).then(() => {
      if (!layer.isConnected || box.lastElementChild !== layer) return;
      then?.(img);
      drawFace();
      layer.style.opacity = "";
      if (!calm()) return old.forEach((o) => o.remove());
      layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease" });
      old.forEach((o) => (o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease" }).onfinish = () => o.remove()));
    });
  }
  const layer = (src: string, cls: string) => {
    const span = el("span", `coach-layer ${cls}`);
    const img = el("img");
    img.alt = "";
    img.draggable = false;
    img.src = src;
    span.append(img);
    return span;
  };
  /** A circle (the feed's 64 px, the article header's 40) as ArticleRow and the article page draw it. */
  function circle(box: HTMLElement, f: Feed | undefined) {
    const key = !f ? "crest" : f.kind === "preset" ? `p:${f.id}` : `c:${f.src.url}`;
    if (box.dataset.key === key) return key;
    box.dataset.key = key;
    swapIn(box, !f ? layer(CLUB.crest, "is-crest") : f.kind === "preset" ? layer(imageUrl(f.id), "is-round") : layer(f.src.url, "is-round coach-face"));
    return key;
  }

  /** Everything the preview shows, from the form and the pictures (cheap when nothing moved). */
  function render() {
    clearTimeout(soon);
    const v = values();
    const player = v.type === "player";
    const at = v.when === "now" || !v.at ? new Date() : new Date(v.at);
    const iso = Number.isNaN(at.getTime()) ? "" : at.toISOString();
    const body = coachBody({ type: v.type, data: toBody(v, new Date()).data });
    // A lineup with players is shown like the site's confirmed lineups: crest, XI and bench right in the row.
    const lineup = v.type === "lineup" ? confirmedLineup({ url: LINEUP_URL, bodyHtml: body }) : undefined;
    const headline = v.headline.trim();
    const pill = player ? NEWS_TYPE[v.badge] : undefined;
    const name = v.playerName.trim();
    const f = player ? feedOf(pics) : undefined;

    // The feed's row (ArticleRow): the player's circle only in player news, else our crest as it is.
    q("[data-vs-row]").classList.toggle("gap-2", !!lineup);
    q("[data-vs-row]").classList.toggle("gap-4", !lineup);
    const size = lineup ? 72 : 64;
    feedPic.style.width = feedPic.style.height = `${size}px`;
    const key = circle(feedPic, f);
    q("[data-feed-badge]").hidden = key === "crest";
    feedSpot.disabled = !player;
    feedSpot.setAttribute("aria-label", player ? "Bild im Feed ändern" : "Vereinswappen im Feed");
    const title = q("[data-feed-title]");
    title.textContent = headline || "Überschrift";
    title.classList.toggle("text-muted", !headline);
    q("[data-feed-meta]").replaceChildren(
      ...(pill ? [el("span", `pill ${toneClass(pill.tone)}`, pill.label)] : []),
      el("span", `truncate ${nameMin(player ? name || "Spieler" : CLUB.name)}`, player ? name || "Spieler" : CLUB.name),
      el("span", "-ml-0.5 shrink-0 tabular-nums", `· ${iso ? time(iso) : ""}`),
    );
    const xi = q("[data-feed-xi]");
    xi.hidden = !lineup;
    xi.textContent = lineup?.xi ?? "";
    const bench = q("[data-feed-bench]");
    bench.hidden = !lineup?.bench;
    bench.textContent = lineup?.bench ? `Bank: ${lineup.bench}` : "";

    // The article page: its header (the feed's picture small, the player and the club), headline, time, photo, text.
    circle(headPic, f);
    const who = q("[data-head-name]");
    who.hidden = !player;
    who.textContent = name || "Spieler";
    who.classList.toggle("text-muted", !name);
    q("[data-head-pill]").replaceChildren(...(pill ? [el("span", `pill ${toneClass(pill.tone)}`, pill.label)] : []));
    const h1 = q("[data-art-title]");
    h1.textContent = headline || "Überschrift";
    h1.classList.toggle("text-muted", !headline);
    q("[data-art-meta]").textContent = `${iso ? `${fullDate(iso)} Uhr` : ""} · Quelle: TonInsider`;
    // The coach's text, escaped by coachBody exactly as the site builds it.
    q("[data-art-body]").innerHTML = body;
    // The photo at its own shape, else the club's banner (16:9), as the article page shows them.
    const photo = pics.article?.url;
    if (banner.dataset.key !== (photo ?? "club")) {
      banner.dataset.key = photo ?? "club";
      swapIn(bannerPics, layer(photo ?? CLUB_BANNER, ""), (img) => {
        const from = banner.offsetHeight;
        banner.style.aspectRatio = photo && img.naturalWidth ? `${img.naturalWidth} / ${img.naturalHeight}` : "16 / 9";
        const to = banner.offsetHeight;
        if (from && from !== to && calm()) banner.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 280, easing: EASE_GLIDE });
      });
    }
    q("[data-vs-hint]").textContent = player ? "Tippe auf ein Bild, um es zu ändern." : "Tippe auf das Foto, um es zu ändern.";

    loadFace();
    drawFace();
    if (open) renderSheet(open);
  }
  /** Typing: the preview follows a moment later (one update per pause, not per key). */
  let soon: ReturnType<typeof setTimeout> | undefined;
  const later = () => { clearTimeout(soon); soon = setTimeout(render, 100); };

  // --- The sheets: one per picture, slid up from it ---------------------------------------------------------
  type Which = "feed" | "article";
  const sheets: Record<Which, HTMLDialogElement> = { feed: q('[data-sheet="feed"]'), article: q('[data-sheet="article"]') };
  let open: Which | undefined;
  let opener: HTMLElement | undefined;
  const sq = (w: Which, s: string) => sheets[w].querySelector<HTMLElement>(s)!;
  const sheetSay = (w: Which, text: string, kind: "" | "error" = "") => {
    const p = sq(w, "[data-sheet-status]");
    p.textContent = text;
    p.classList.toggle("text-[var(--red-fg)]", kind === "error");
    p.classList.toggle("text-muted", kind !== "error");
  };
  const PLUS = '<svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';

  type Tile = { key: string; label: string; aria?: string; src?: string; pos?: string; pick?: () => void; file?: Which };
  /** The choices of a sheet, in order: the feed's starts with the article photo, the article's ends with the club's banner. */
  function tilesOf(w: Which): Tile[] {
    const out: Tile[] = [];
    if (w === "feed") {
      if (pics.article) out.push({ key: "article", label: "Artikelfoto", aria: "Wie Artikelfoto", src: pics.article.url, pos: "50% 15%", pick: () => (pics = feedFromArticle(pics)) });
      for (const t of team) {
        out.push({ key: `team:${t.imageId}`, label: lastName(t), aria: t.player, src: imageUrl(t.avatarId ?? t.imageId), pos: t.avatarId ? "50% 50%" : "50% 15%", pick: () => (pics = pickFeed(pics, teamFeed(t, imageUrl))) });
      }
      const o = ownFeed;
      if (o) out.push({ key: "own", label: "Eigenes", aria: "Eigenes Bild", src: o.kind === "preset" ? imageUrl(o.id) : o.src.url, pos: "50% 15%", pick: () => (pics = pickFeed(pics, o)) });
      out.push({ key: "add", label: "Eigenes Foto", file: "feed" });
    } else {
      for (const t of team) out.push({ key: `team:${t.imageId}`, label: lastName(t), aria: t.player, src: imageUrl(t.imageId), pos: "50% 20%", pick: () => (pics = pickArticle(pics, teamArticle(t, imageUrl))) });
      const o = ownArticle;
      if (o) out.push({ key: "own", label: "Eigenes", aria: "Eigenes Foto", src: o.url, pos: "50% 20%", pick: () => (pics = pickArticle(pics, o)) });
      out.push({ key: "add", label: "Eigenes Foto", file: "article" });
      out.push({ key: "club", label: "Vereinsbanner", src: CLUB_BANNER, pos: "50% 50%", pick: () => (pics = pickArticle(pics, undefined)) });
    }
    return out;
  }

  /** The sheet's tiles (rebuilt only when the choices themselves change), the current one in gold, its actions. */
  function renderSheet(w: Which) {
    const grid = sq(w, "[data-tiles]");
    const tiles = tilesOf(w);
    const sig = tiles.map((t) => `${t.key}=${t.src ?? ""}`).join("|");
    if (grid.dataset.sig !== sig) {
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-tile]")?.dataset.tile;
      grid.dataset.sig = sig;
      grid.replaceChildren(...tiles.map((t) => {
        const pic = el("span", "coach-tile-pic");
        if (t.src) {
          const img = el("img");
          img.src = t.src;
          img.alt = "";
          img.decoding = "async";
          img.draggable = false;
          img.style.objectPosition = t.pos ?? "50% 50%";
          pic.append(img);
        } else pic.innerHTML = PLUS;
        if (t.file) {
          // A label around the file input: a tap opens the photo picker directly (iOS).
          const b = el("label", "press coach-tile cursor-pointer");
          b.dataset.tile = t.key;
          const file = el("input", "sr-only");
          file.type = "file";
          file.accept = "image/*";
          file.dataset.file = t.file;
          file.setAttribute("aria-label", t.label);
          b.append(file, pic, el("span", "coach-tile-name", t.label));
          return b;
        }
        const b = el("button", "press coach-tile");
        b.type = "button";
        b.dataset.tile = t.key;
        if (t.aria) b.setAttribute("aria-label", t.aria);
        b.append(pic, el("span", "coach-tile-name", t.label));
        b.addEventListener("click", () => { t.pick?.(); render(); });
        return b;
      }));
      if (focused) grid.querySelector<HTMLElement>(`[data-tile="${focused}"]`)?.focus({ preventScroll: true });
    }
    const current = w === "feed" ? feedChoice(pics, team) : articleChoice(pics, team);
    grid.querySelectorAll<HTMLElement>("button[data-tile]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tile === current)));

    // Remembering an uploaded photo as the player's team photo (in the sheet it was uploaded in).
    const name = input("playerName").value.trim().replace(/\s+/g, " ");
    const player = findTeamPhoto(name, team)?.player ?? name;
    const c = cut();
    const mine = w === "article" ? pics.article?.id === uploadedArticle && pics.article?.id : c?.src.id === uploadedFeed && c?.src.id;
    const offer = type === "player" && !!mine && player.length >= 2 && player.length <= 40 && !team.some((t) => t.imageId === mine);
    const merken = sq(w, "[data-merken]");
    merken.hidden = !offer;
    if (offer) { merken.textContent = `Als Teamfoto für ${player} merken`; merken.dataset.player = player; merken.dataset.id = mine; }
    if (w === "feed") {
      // Framing and the crest picture only for a square of a photo.
      q("[data-crop-toggle]").hidden = !c;
      q("[data-avatar-make]").hidden = !c || offer || !!avatarOf(c.src.id);
      if (!c) setCropOpen(false, false);
    }
  }

  /** "Zuschneiden": the framing box unfolds in the sheet (and folds back). */
  let cropOpen = false;
  let folding: Animation | undefined;
  function setCropOpen(on: boolean, animate = true) {
    if (on === cropOpen) return;
    cropOpen = on;
    folding?.cancel();
    const box = q("[data-crop-box]");
    const toggle = q("[data-crop-toggle]");
    toggle.setAttribute("aria-expanded", String(on));
    if (on) {
      box.hidden = false;
      drawFace();
      if (animate) revealIn(box);
      // The taller sheet: the circle in the preview stays in view above it.
      setTimeout(keepInView, animate && calm() ? 300 : 0);
      return;
    }
    if (!animate || !calm() || box.hidden) { box.hidden = true; return; }
    box.style.overflow = "clip";
    const a = box.animate([{ height: `${box.offsetHeight}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: 280, easing: EASE_GLIDE });
    folding = a;
    a.onfinish = () => { box.hidden = true; box.style.removeProperty("overflow"); };
    a.oncancel = () => box.style.removeProperty("overflow");
  }

  /** Slides a sheet up (280 ms, the house glide) and keeps the tapped picture in view above it. */
  function openSheet(w: Which, from: HTMLElement) {
    const d = sheets[w];
    if (d.open) return;
    open = w;
    opener = from;
    sheetSay(w, "");
    setCropOpen(false, false);
    renderSheet(w);
    d.showModal();
    if (calm()) d.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 280, easing: EASE_GLIDE });
    keepInView();
  }
  /** Scrolls the page (behind the sheet) so the picture being changed shows above the sheet. */
  function keepInView() {
    const d = open && sheets[open];
    if (!d || !opener) return;
    const r = opener.getBoundingClientRect();
    const room = innerHeight - d.offsetHeight - 16;
    const dy = r.top < 16 ? r.top - 16 : r.bottom > room ? Math.min(r.bottom - room, r.top - 16) : 0;
    if (dy) window.scrollBy({ top: dy, behavior: calm() ? "smooth" : "auto" });
  }
  /** Slides it back down, then closes it (the dialog's own close would make it vanish at once). */
  function closeSheet(animate = true) {
    const w = open;
    if (!w) return;
    const d = sheets[w];
    const done = () => {
      d.close();
      d.classList.remove("is-closing");
      d.style.removeProperty("transform");
      if (open === w) open = undefined;
    };
    if (!d.open || d.classList.contains("is-closing")) return;
    if (!animate || !calm()) { done(); if (animate) opener?.focus({ preventScroll: true }); return; }
    d.classList.add("is-closing");
    const a = d.animate([{ transform: getComputedStyle(d).transform === "none" ? "none" : getComputedStyle(d).transform }, { transform: "translateY(100%)" }], { duration: 240, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    a.onfinish = () => { done(); a.cancel(); opener?.focus({ preventScroll: true }); };
  }
  for (const w of ["feed", "article"] as Which[]) {
    const d = sheets[w];
    // A tap on the dimmed page (the dialog itself, outside its content), "Fertig" or Escape.
    d.addEventListener("click", (e) => { if (e.target === d) closeSheet(); });
    sq(w, "[data-sheet-done]").addEventListener("click", () => closeSheet());
    d.addEventListener("cancel", (e) => { e.preventDefault(); closeSheet(); });
    // Pulled down by its top: follows the finger; far (or fast) enough closes it, else it springs back.
    const head = sq(w, "[data-sheet-drag]");
    let drag: { y: number; t: number; id: number } | undefined;
    head.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest("button")) return;
      drag = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener("pointermove", (e) => {
      if (drag?.id !== e.pointerId) return;
      d.style.transform = `translateY(${Math.max(0, e.clientY - drag.y)}px)`;
    });
    const release = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      const dy = Math.max(0, e.clientY - drag.y);
      const fast = dy > 30 && dy / Math.max(1, e.timeStamp - drag.t) > 0.5;
      drag = undefined;
      if (dy > 90 || fast) return closeSheet();
      if (dy && calm()) d.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 240, easing: EASE_GLIDE });
      d.style.removeProperty("transform");
    };
    head.addEventListener("pointerup", release);
    head.addEventListener("pointercancel", release);

    // A photo of its own, for this spot only (the tile is rebuilt with it, so listened for on the sheet).
    d.addEventListener("change", async (e) => {
      const picker = e.target as HTMLInputElement;
      if (!picker.matches("[data-file]")) return;
      const file = picker.files?.[0];
      picker.value = "";
      if (!file) return;
      sheetSay(w, "Foto wird hochgeladen …");
      try {
        const { blob, width, height } = await shrink(file);
        const id = await upload(blob, width, height);
        if (!id) return;
        sheetSay(w, "");
        const pic = { id, url: URL.createObjectURL(blob) };
        if (w === "article") { uploadedArticle = id; ownArticle = pic; pics = pickArticle(pics, pic); }
        else { uploadedFeed = id; ownFeed = { kind: "cut", src: pic }; pics = pickFeed(pics, ownFeed); }
        render();
        // A new face for the circle: straight to placing it.
        if (w === "feed") setCropOpen(true);
      } catch (err) {
        sheetSay(w, (err as Error).message || "Foto konnte nicht hochgeladen werden.", "error");
      }
    });

    // Remembering the uploaded photo as the player's team photo, with his crest picture made here.
    sq(w, "[data-merken]").addEventListener("click", async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      const { player, id } = b.dataset;
      const pic = w === "article" ? pics.article : cut()?.src;
      if (!id || !player || !pic || pic.id !== id || b.disabled) return;
      b.disabled = true;
      let avatarId = made.get(id);
      let note = "";
      if (!avatarId) {
        const r = await makeAvatar(pic.url, w);
        if (r === null) { b.disabled = false; return; }
        if ("id" in r) { avatarId = r.id; made.set(id, r.id); } else note = r.error;
      }
      const r = await api<{ photos?: TeamPhoto[] }>("/api/coach/team-photos/", { method: "PUT", body: JSON.stringify({ player, imageId: id, ...(avatarId ? { avatarId } : {}) }) });
      b.disabled = false;
      if (r.status === 401) return signedOut();
      if (!r.ok || !r.data.photos) return sheetSay(w, r.data.error ?? "Teamfoto konnte nicht gespeichert werden.", "error");
      team = r.data.photos;
      // It is his team photo now: no longer a picture of its own; in the feed, his new crest picture takes the circle.
      if (w === "article") ownArticle = undefined;
      else { ownFeed = undefined; if (avatarId) pics = pickFeed(pics, { kind: "preset", id: avatarId, source: id }); }
      followName();
      render();
      if (!avatarId) return sheetSay(w, `Als Teamfoto für ${player} gemerkt, ohne Teamfoto-Bild: ${note}`, "error");
      sheetSay(w, `Als Teamfoto für ${player} gemerkt.`);
    });
  }

  /**
   * Makes the crest picture for a photo in the browser and stores it: its id, a sentence when it didn't work, null
   * when signed out. The cutting tool loads only now (never for the readers).
   */
  async function makeAvatar(url: string, w: Which): Promise<{ id: string } | { error: string } | null> {
    sheetSay(w, "Teamfoto-Bild wird erstellt …");
    let mod: typeof import("./teamAvatar.ts") | undefined;
    try {
      mod = await import("./teamAvatar.ts");
      const blob = await mod.makeTeamAvatar(url, CLUB.crest);
      const id = await upload(blob, mod.AVATAR, mod.AVATAR);
      sheetSay(w, "");
      return id ? { id } : null;
    } catch (err) {
      const known = mod && err instanceof mod.AvatarError;
      return { error: known ? (err as Error).message : "Das Teamfoto-Bild hat nicht geklappt." };
    }
  }

  // --- Wiring ----------------------------------------------------------------------------------------------
  q("[data-new]").addEventListener("click", () => openEditor());
  q("[data-back]").addEventListener("click", () => { renderList(); show("list"); });
  q("[data-type-seg]").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-type]");
    if (b) setType(b.dataset.type as CoachType);
  });
  q("[data-when-seg]").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-when]");
    if (b) setWhen(b.dataset.when as "now" | "later");
  });
  q("[data-home-seg]").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-home]");
    if (b) { setHome(b.dataset.home === "1"); render(); }
  });
  q("[data-planned-now]").addEventListener("click", async () => {
    if (!editing) return;
    const id = editing.id;
    const r = await api<{ moved?: number }>(`/api/coach/bots/${id}/?now=1`, { method: "POST" });
    if (r.status === 401) return signedOut();
    if (!r.ok) return say(r.data.error ?? "Hat nicht geklappt.", "error");
    say(`${r.data.moved} Bot-Kommentare kommen ab jetzt.`, "ok");
    void loadPlanned(id);
    setTimeout(() => void loadComments(id), 8000);
  });
  q("[data-moods]").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-mood]");
    if (b) setMood(b.dataset.mood as BotMood);
  });
  q("[data-badges]").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-badge]");
    if (b) setBadge(b.dataset.badge as NewsType);
  });
  form.addEventListener("input", later);
  // A known player's photo comes with his name, in each spot the coach hasn't chosen himself.
  input("playerName").addEventListener("input", () => { followName(); render(); });
  feedSpot.addEventListener("click", () => openSheet("feed", feedSpot));
  banner.addEventListener("click", () => openSheet("article", banner));

  // "Teamfoto-Bild erstellen": the crest picture for the photo the circle is cut from; a team photo keeps it too.
  q("[data-avatar-make]").addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const pic = cut()?.src;
    if (!pic || b.disabled) return;
    b.disabled = true;
    const r = await makeAvatar(pic.url, "feed");
    b.disabled = false;
    if (r === null) return;
    if ("error" in r) return sheetSay("feed", `${r.error} Im Feed bleibt das Foto.`, "error");
    made.set(pic.id, r.id);
    const t = team.find((x) => x.imageId === pic.id);
    if (t) {
      const saved = await api<{ photos?: TeamPhoto[] }>("/api/coach/team-photos/", { method: "PUT", body: JSON.stringify({ player: t.player, imageId: pic.id, avatarId: r.id }) });
      if (saved.status === 401) return signedOut();
      if (saved.ok && saved.data.photos) team = saved.data.photos;
    }
    if (cut()?.src.id !== pic.id) return render();
    const preset: Feed = { kind: "preset", id: r.id, source: pic.id };
    if (!t) ownFeed = preset;
    pics = pickFeed(pics, preset);
    render();
  });
  q("[data-crop-toggle]").addEventListener("click", () => setCropOpen(!cropOpen));
  input("bots").addEventListener("change", () => (q("[data-context]").hidden = !input("bots").checked));

  // Framing: one finger moves the photo, two (or the trackpad, or the slider) zoom; the preview follows directly.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; zoom: number } | undefined;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  stage.addEventListener("pointerdown", (e) => {
    if (!framing()) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch = pointers.size === 2 ? { dist: spread(), zoom: framing()!.zoom } : undefined;
  });
  stage.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    const c = framing();
    if (!p || !c || !face) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch && pointers.size === 2) return setCrop({ ...c, zoom: (pinch.zoom * spread()) / pinch.dist });
    // The photo follows the finger: k screen px per photo px.
    const { naturalWidth: w, naturalHeight: h } = face.img;
    const k = RING / square(w, h, c).side;
    setCrop({ ...c, x: c.x - dx / k / w, y: c.y - dy / k / h });
  });
  const lift = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    pinch = undefined;
    if (!pointers.size) render();
  };
  stage.addEventListener("pointerup", lift);
  stage.addEventListener("pointercancel", lift);
  stage.addEventListener("wheel", (e) => {
    const c = framing();
    if (!e.ctrlKey || !c) return;
    e.preventDefault();
    setCrop({ ...c, zoom: c.zoom * Math.exp(-e.deltaY / 100) });
  }, { passive: false });
  q("[data-zoom]").addEventListener("input", (e) => {
    const c = framing();
    if (c) setCrop({ ...c, zoom: Number((e.target as HTMLInputElement).value) });
  });
  new ResizeObserver(() => drawFace()).observe(stage);

  q("[data-delete]").addEventListener("click", async () => {
    if (!editing || !confirm("Diesen Beitrag löschen? Er verschwindet in ein paar Minuten aus den News.")) return;
    const r = await api(`/api/coach/posts/${editing.id}/`, { method: "DELETE" });
    if (r.status === 401) return signedOut();
    if (!r.ok) return say(r.data.error ?? "Löschen hat nicht geklappt.", "error");
    posts.splice(posts.findIndex((x) => x.id === editing!.id), 1);
    renderList();
    show("list");
  });

  /** Writes (or, with bots off, removes) the post's bot comments. */
  async function bots(post: CoachPost, saved: string) {
    if (!post.data.bots?.on) {
      if (editing) await api(`/api/coach/bots/${post.id}/`, { method: "POST" });
      return;
    }
    say(`${saved} Bot-Kommentare werden geschrieben … Das dauert meist eine Minute. Du kannst die Seite auch schließen, sie werden trotzdem fertig.`, "ok");
    const r = await api<{ bots?: number }>(`/api/coach/bots/${post.id}/`, { method: "POST" });
    if (r.status === 401) return signedOut();
    if (r.ok) return say(`${saved} ${r.data.bots} Bot-Kommentare geplant.`, "ok");
    say(`${saved} ${r.data.error ?? "Bot-Kommentare konnten nicht erstellt werden."}`, "error");
    const retry = el("button", "press ml-1 font-semibold underline underline-offset-2", "Nochmal versuchen");
    retry.type = "button";
    retry.addEventListener("click", () => void bots(post, saved));
    status.append(" ", retry);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const save = q<HTMLButtonElement>("[data-save]");
    if (save.disabled) return;
    save.disabled = true;
    say("Wird gespeichert …");
    // The feed picture first (a new framing is a small upload); if that fails, the old one stays if it still fits.
    const thumb = type === "player" ? await feedThumb().catch(() => {
      const f = feedOf(pics);
      return f && savedThumb && (f.kind === "preset" ? f.id === savedThumb.imageId : f.src.id === savedThumb.source) ? savedThumb : undefined;
    }) : undefined;
    if (thumb === null) { save.disabled = false; return; }
    const body = toBody(values(), new Date(), pics.article?.id, thumb);
    const r = await api<{ post?: CoachPost }>(editing ? `/api/coach/posts/${editing.id}/` : "/api/coach/posts/", {
      method: editing ? "PUT" : "POST", body: JSON.stringify(body),
    });
    save.disabled = false;
    if (r.status === 401) return signedOut();
    if (!r.ok || !r.data.post) return say(r.data.error ?? "Speichern hat nicht geklappt.", "error");
    const post = r.data.post;
    savedThumb = post.data.thumb;
    const i = posts.findIndex((x) => x.id === post.id);
    if (i >= 0) posts[i] = post; else posts.unshift(post);
    posts.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const planned = statusOf(post.publishedAt, new Date());
    const saved = planned.planned ? `Gespeichert. Erscheint ${planned.label.replace("Geplant: ", "am ")}.` : "Gespeichert. In ein paar Minuten in den News.";
    say(saved, "ok");
    const wasEditing = !!editing;
    editing = post;
    q("[data-delete]").hidden = false;
    await bots(post, saved);
    if (!wasEditing) renderList();
  });

  renderList();
}
