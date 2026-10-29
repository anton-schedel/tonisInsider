import type { NewsType } from "../../scraper/types.ts";
import type { BotMood, CoachPost, CoachThumb, CoachType } from "./coachPosts.ts";
import { CLUB } from "./coachPosts.ts";
import { localInput, namesOf, statusOf, toBody, type FormValues } from "./coachForm.ts";
import { NEWS_TYPE, toneClass } from "./newsTypes.ts";
import { time } from "./format.ts";
import { defaultCrop, fit, rounded, sameCrop, square, type Crop } from "./coachCrop.ts";
import { EASE_GLIDE } from "./motion.ts";

/** The coach's page (/schnoeselmob/): sign in, the list of posts, the editor with its preview. */

const LINEUP_HEADLINE = "Aufstellung des TuS Schnöselmob";
const TYPE_LABEL: Record<CoachType, string> = { lineup: "Aufstellung", result: "Ergebnis", player: "Spielernews" };
const imageUrl = (id: string) => `/api/coach/images/${id}/`;
/** The feed picture's size as stored (the feed shows it at 64 px, 40 on the article; sharp on 3x screens). */
const THUMB = 256;
/** The circle in the framing box (and the feed's at real size beside it). */
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

  let editing: CoachPost | undefined;
  let type: CoachType = "lineup";
  let when: "now" | "later" = "later";
  let home = true;
  let badge: NewsType = "angeschlagen";
  let mood: BotMood = "gemischt";
  let imageId: string | undefined;
  let photoUrl: string | undefined;
  /** The feed picture: a photo of its own (else the article photo's), the framing (unset: defaultCrop), the one saved. */
  let thumbSrc: { id: string; url: string } | undefined;
  let crop: Crop | undefined;
  let savedThumb: CoachThumb | undefined;
  /** The photo being framed, once loaded: its size, and what the canvas draws when saving. */
  let face: { id: string; url: string; img: HTMLImageElement; ready: Promise<unknown> } | undefined;
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
    // The lineup's usual headline comes and goes with the type, unless the coach wrote their own.
    const h = input("headline");
    if (t === "lineup" && !h.value.trim()) h.value = LINEUP_HEADLINE;
    else if (before === "lineup" && t !== "lineup" && h.value === LINEUP_HEADLINE) h.value = "";
    preview();
  };
  const setWhen = (w: "now" | "later") => {
    when = w;
    setSeg(q("[data-when-seg]"), "data-when", w);
    q("[data-at]").hidden = w === "now";
    preview();
  };
  const setHome = (h: boolean) => { home = h; setSeg(q("[data-home-seg]"), "data-home", h ? "1" : "0"); };
  const setBadge = (b: NewsType) => {
    badge = b;
    root.querySelectorAll<HTMLElement>("[data-badge]").forEach((c) => c.classList.toggle("is-on", c.dataset.badge === b));
    preview();
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

  const setPhoto = (id: string | undefined, url?: string) => {
    imageId = id;
    photoUrl = url ?? (id ? imageUrl(id) : undefined);
    const img = q<HTMLImageElement>("[data-photo-preview]");
    img.hidden = !photoUrl;
    if (photoUrl) img.src = photoUrl;
    q("[data-photo-label]").textContent = photoUrl ? "Anderes Foto" : "Foto hinzufügen";
    loadFace();
    preview();
  };

  // --- The feed picture ------------------------------------------------------------------------------------
  const source = () => thumbSrc ?? (imageId && photoUrl ? { id: imageId, url: photoUrl } : undefined);
  const framing = (): Crop | undefined => {
    if (!face?.img.naturalWidth) return undefined;
    const { naturalWidth: w, naturalHeight: h } = face.img;
    return crop ? fit(w, h, crop) : defaultCrop(w, h);
  };
  const stage = q("[data-crop]");
  const stageImg = q<HTMLImageElement>("[data-crop-img]");

  /** The circle in the box, the small one beside it and the preview's, all from the same framing. */
  function drawFace() {
    const c = framing();
    if (!c || !face) return;
    const { naturalWidth: w, naturalHeight: h } = face.img;
    place(stageImg, w, h, c, RING, stage.clientWidth, stage.clientHeight);
    place(q<HTMLImageElement>("[data-crop-face] img"), w, h, c, FACE);
    const row = q("[data-preview]").querySelector<HTMLImageElement>(".coach-face img");
    if (row) place(row, w, h, c, FACE);
    q<HTMLInputElement>("[data-zoom]").value = String(c.zoom);
  }
  const setCrop = (c: Crop) => {
    if (!face?.img.naturalWidth) return;
    crop = fit(face.img.naturalWidth, face.img.naturalHeight, c);
    drawFace();
  };

  /** Shows the framing for the current photo (hidden without one), loading it first if it's a new one. */
  function loadFace() {
    const src = source();
    q("[data-thumb]").hidden = !src;
    q("[data-thumb-reset]").hidden = !thumbSrc;
    q("[data-thumb-label]").textContent = thumbSrc ? "Anderes Bild für den Feed" : "Eigenes Bild für den Feed";
    if (!src) { face = undefined; return; }
    if (face?.url === src.url) return drawFace();
    const img = new Image();
    img.src = src.url;
    const f = { ...src, img, ready: img.decode() };
    face = f;
    f.ready.then(() => {
      if (face !== f) return;
      stageImg.src = q<HTMLImageElement>("[data-crop-face] img").src = src.url;
      drawFace();
      // A new photo settles in; dragging after that is immediate.
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) stageImg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE_GLIDE });
    }, () => {});
  }

  /** What to save as data.thumb: the saved one if nothing changed, else the circle drawn at 256 px and uploaded (null: signed out). */
  async function feedThumb(): Promise<CoachThumb | undefined | null> {
    const f = face;
    if (!f || !source()) return undefined;
    await f.ready;
    const c = rounded(framing()!);
    if (savedThumb && savedThumb.source === f.id && sameCrop(savedThumb, c)) return savedThumb;
    const s = square(f.img.naturalWidth, f.img.naturalHeight, c);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = THUMB;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(f.img, s.left, s.top, s.side, s.side, 0, 0, THUMB, THUMB);
    const blob = await jpeg(canvas, 0.86);
    if (!blob) throw new Error("Bild konnte nicht gelesen werden.");
    const imageId = await upload(blob, THUMB, THUMB);
    return imageId ? { imageId, source: f.id, ...c } : null;
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
      // The saved framing comes back; a picture of its own is loaded from its source.
      savedThumb = d.thumb;
      thumbSrc = d.thumb && d.thumb.source !== p.image?.id ? { id: d.thumb.source, url: imageUrl(d.thumb.source) } : undefined;
      crop = d.thumb && { x: d.thumb.x, y: d.thumb.y, zoom: d.thumb.zoom };
      setPhoto(p.image?.id);
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
      savedThumb = thumbSrc = crop = undefined;
      setPhoto(undefined);
      setMood("gemischt");
      q("[data-comments-box]").hidden = true;
      q("[data-planned]").hidden = true;
      setWhen("later");
    }
    setType(type);
    // The Kommentare part only shows "edit" wording once there is something to replace.
    show("edit");
  }

  // --- Preview: the same row as in the news feed ------------------------------------------------------------
  function preview() {
    const v = values();
    const box = q("[data-preview]");
    const lineup = v.type === "lineup";
    // Like ArticleRow: the crest as it is for a lineup or a post without photo; a photo round, the crest on its corner.
    const row = el("div", "flex items-center " + (lineup ? "gap-2" : "gap-4"));
    const size = lineup ? 72 : 64;
    const photo = v.type === "player" ? source()?.url : undefined;
    const pic = el("span", "relative shrink-0");
    const img = el("img", photo ? "" : "object-contain");
    img.style.cssText = `width:${size}px;height:${size}px;object-fit:cover;object-position:50% 15%`;
    img.src = photo || CLUB.crest;
    img.alt = "";
    if (photo) {
      // The circle as it will be cut (drawFace places the photo in it).
      const circle = el("span", "coach-face relative block overflow-hidden rounded-full bg-surface");
      circle.style.cssText = `width:${size}px;height:${size}px`;
      circle.append(img);
      pic.append(circle);
    } else pic.append(img);
    if (photo) {
      const crest = el("img", "crest-overlay -right-1.5 -bottom-1 size-[26px]");
      crest.src = CLUB.crest;
      crest.alt = "";
      pic.append(crest);
    }
    const text = el("div", "min-w-0 flex-1");
    text.append(el("div", "feed-title", v.headline.trim() || "Überschrift"));
    const meta = el("div", "feed-meta");
    const pill = v.type === "player" ? NEWS_TYPE[v.badge] : undefined;
    if (pill) meta.append(el("span", `pill ${toneClass(pill.tone)}`, pill.label));
    const at = v.when === "now" || !v.at ? new Date() : new Date(v.at);
    meta.append(el("span", "min-w-[3.5em] truncate", v.type === "player" && v.playerName.trim() ? v.playerName.trim() : CLUB.name));
    meta.append(el("span", "-ml-0.5 shrink-0 tabular-nums", `·\u00a0${Number.isNaN(at.getTime()) ? "" : time(at.toISOString())}`));
    text.append(meta);
    if (lineup) {
      const lines = v.lines.map(namesOf).filter((l) => l.length);
      if (lines.length) text.append(el("div", "mt-2 text-[15px] leading-snug", lines.map((l) => l.join(", ")).join(" – ")));
    }
    if (v.type === "result" && v.opponent.trim()) {
      text.append(el("div", "mt-1 text-[15px] tabular-nums", home ? `${CLUB.name} – ${v.opponent.trim()} ${v.ours}:${v.theirs}` : `${v.opponent.trim()} – ${CLUB.name} ${v.theirs}:${v.ours}`));
    }
    row.append(pic, text);
    const item = el("div", "py-3.5");
    item.append(row);
    const bench = namesOf(v.bench);
    if (lineup && bench.length) item.append(el("div", "mt-2 text-[13px] leading-snug text-muted", `Bank: ${bench.join(", ")}`));
    box.replaceChildren(item);
    if (photo) drawFace();
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
    if (b) { setHome(b.dataset.home === "1"); preview(); }
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
  form.addEventListener("input", preview);
  input("bots").addEventListener("change", () => (q("[data-context]").hidden = !input("bots").checked));

  q<HTMLInputElement>("[data-photo]").addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const label = q("[data-photo-label]");
    label.textContent = "Foto wird hochgeladen …";
    try {
      const { blob, width, height } = await shrink(file);
      const id = await upload(blob, width, height);
      if (!id) return;
      // A new article photo: the feed picture cut from it starts over (one of its own stays as it is).
      if (!thumbSrc) crop = undefined;
      setPhoto(id, URL.createObjectURL(blob));
    } catch (err) {
      setPhoto(imageId);
      label.textContent = (err as Error).message || "Foto konnte nicht hochgeladen werden.";
    }
  });

  // Framing: one finger moves the photo, two (or the trackpad, or the slider) zoom; the preview follows on release.
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
    if (!pointers.size) preview();
  };
  stage.addEventListener("pointerup", lift);
  stage.addEventListener("pointercancel", lift);
  stage.addEventListener("wheel", (e) => {
    const c = framing();
    if (!e.ctrlKey || !c) return;
    e.preventDefault();
    setCrop({ ...c, zoom: c.zoom * Math.exp(-e.deltaY / 100) });
  }, { passive: false });
  // The slider moves the circles itself (no rebuilding the preview on every step).
  q("[data-zoom]").addEventListener("input", (e) => {
    e.stopPropagation();
    const c = framing();
    if (c) setCrop({ ...c, zoom: Number((e.target as HTMLInputElement).value) });
  });
  new ResizeObserver(() => drawFace()).observe(stage);

  q<HTMLInputElement>("[data-thumb-file]").addEventListener("change", async (e) => {
    const picker = e.target as HTMLInputElement;
    const file = picker.files?.[0];
    picker.value = "";
    if (!file) return;
    const label = q("[data-thumb-label]");
    label.textContent = "Bild wird hochgeladen …";
    try {
      const { blob, width, height } = await shrink(file);
      const id = await upload(blob, width, height);
      if (!id) return;
      thumbSrc = { id, url: URL.createObjectURL(blob) };
      crop = undefined;
      loadFace();
      preview();
    } catch (err) {
      label.textContent = (err as Error).message || "Bild konnte nicht hochgeladen werden.";
    }
  });
  q("[data-thumb-reset]").addEventListener("click", () => {
    // Back to the article photo, framed as last saved if that was cut from it.
    thumbSrc = undefined;
    crop = savedThumb?.source === imageId ? savedThumb : undefined;
    loadFace();
    preview();
  });

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
    const thumb = type === "player" ? await feedThumb().catch(() => (savedThumb?.source === source()?.id ? savedThumb : undefined)) : undefined;
    if (thumb === null) { save.disabled = false; return; }
    const body = toBody(values(), new Date(), type === "player" ? imageId : undefined, thumb);
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
