import type { NewsType } from "../../scraper/types.ts";
import type { CoachPost, CoachType } from "./coachPosts.ts";
import { CLUB } from "./coachPosts.ts";
import { localInput, namesOf, statusOf, toBody, type FormValues } from "./coachForm.ts";
import { NEWS_TYPE } from "./newsTypes.ts";
import { time } from "./format.ts";

/** The coach's page (/schnoeselmob/): sign in, the list of posts, the editor with its preview. */

const LINEUP_HEADLINE = "Aufstellung des TuS Schnöselmob";
const TYPE_LABEL: Record<CoachType, string> = { lineup: "Aufstellung", result: "Ergebnis", player: "Spielernews" };
const imageUrl = (id: string) => `/api/coach/images/${id}/`;

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
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  if (!blob) throw new Error("Bild konnte nicht gelesen werden.");
  return { blob, width, height };
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
  let imageId: string | undefined;
  let photoUrl: string | undefined;
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
      img.src = p.image ? imageUrl(p.image.id) : CLUB.crest;
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
    type, when, home, badge,
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
  const setPhoto = (id: string | undefined, url?: string) => {
    imageId = id;
    photoUrl = url ?? (id ? imageUrl(id) : undefined);
    const img = q<HTMLImageElement>("[data-photo-preview]");
    img.hidden = !photoUrl;
    if (photoUrl) img.src = photoUrl;
    q("[data-photo-label]").textContent = photoUrl ? "Anderes Foto" : "Foto hinzufügen";
    preview();
  };

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
      type = p.type;
      setHome(d.result?.home ?? true);
      setBadge(d.player?.newsType ?? "angeschlagen");
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
      setPhoto(undefined);
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
    const row = el("div", "flex items-center py-3.5 " + (lineup ? "gap-2" : "gap-4"));
    const pic = el("img", "shrink-0 rounded-full object-cover");
    const size = lineup ? 72 : 64;
    pic.style.cssText = `width:${size}px;height:${size}px`;
    pic.src = v.type === "player" && photoUrl ? photoUrl : CLUB.crest;
    pic.alt = "";
    const text = el("div", "min-w-0 flex-1");
    text.append(el("div", "mb-1 text-[17px] leading-snug font-semibold tracking-[-0.015em]", v.headline.trim() || "Überschrift"));
    const meta = el("div", "flex items-center gap-1.5 text-[13px] text-muted");
    const pill = v.type === "player" ? NEWS_TYPE[v.badge] : undefined;
    if (pill) {
      const p = el("span", "rounded-full px-2 py-[1px] text-[13px] font-semibold", pill.label);
      p.style.cssText = `background:var(--${pill.tone}-bg);color:var(--${pill.tone}-fg)`;
      meta.append(p);
    }
    const at = v.when === "now" || !v.at ? new Date() : new Date(v.at);
    meta.append(el("span", "min-w-0 truncate", v.type === "player" && v.playerName.trim() ? v.playerName.trim() : CLUB.name));
    meta.append(el("span", "-ml-0.5 shrink-0 tabular-nums", `· ${Number.isNaN(at.getTime()) ? "" : time(at.toISOString())}`));
    text.append(meta);
    if (lineup) {
      const lines = v.lines.map(namesOf).filter((l) => l.length);
      if (lines.length) text.append(el("div", "mt-2 text-[15px] leading-snug", lines.map((l) => l.join(", ")).join(" – ")));
    }
    if (v.type === "result" && v.opponent.trim()) {
      text.append(el("div", "mt-1 text-[15px] tabular-nums", home ? `${CLUB.name} – ${v.opponent.trim()} ${v.ours}:${v.theirs}` : `${v.opponent.trim()} – ${CLUB.name} ${v.theirs}:${v.ours}`));
    }
    row.append(pic, text);
    const parts: HTMLElement[] = [row];
    const bench = namesOf(v.bench);
    if (lineup && bench.length) parts.push(el("div", "-mt-1.5 pb-3.5 text-[13px] leading-snug text-muted", `Bank: ${bench.join(", ")}`));
    box.replaceChildren(...parts);
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
      if (blob.size > 600 * 1024) throw new Error("Bild zu groß.");
      const res = await fetch(`/api/coach/images/?w=${width}&h=${height}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string; signedOut?: boolean };
      if (res.status === 401) { signedOut(); return; }
      if (!res.ok || !data.id) throw new Error(data.error ?? "Foto konnte nicht hochgeladen werden.");
      setPhoto(data.id, URL.createObjectURL(blob));
    } catch (err) {
      setPhoto(imageId);
      label.textContent = (err as Error).message || "Foto konnte nicht hochgeladen werden.";
    }
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
    say(`${saved} Bot-Kommentare werden geschrieben … (meist eine Minute, wenn Morpheus viel zu tun hat auch ein paar)`, "ok");
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
    const body = toBody(values(), new Date(), type === "player" ? imageId : undefined);
    const r = await api<{ post?: CoachPost }>(editing ? `/api/coach/posts/${editing.id}/` : "/api/coach/posts/", {
      method: editing ? "PUT" : "POST", body: JSON.stringify(body),
    });
    save.disabled = false;
    if (r.status === 401) return signedOut();
    if (!r.ok || !r.data.post) return say(r.data.error ?? "Speichern hat nicht geklappt.", "error");
    const post = r.data.post;
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
