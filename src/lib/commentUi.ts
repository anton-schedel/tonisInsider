import { ago, initials } from "./format.ts";
import { wholePercents } from "./ownVotes.ts";

/**
 * What LigaInsider's comments (Comments.astro) and the comments under our own posts (OwnComments.astro) draw
 * alike in the browser: comments, polls, the ▲ vote, the composer and the calm motion between states.
 * Each component keeps its own transport.
 */

export const FIELD = "w-full rounded-xl bg-surface px-4 py-3 text-[16px] outline-none focus:ring-2 focus:ring-[var(--accent)]";
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const MAX_ANSWERS = 6;
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Builds DOM with textContent only: comment text is untrusted and never parsed as HTML.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Grows a just-inserted element open from nothing (the house glide) instead of letting the page jump. */
export function revealIn(el: HTMLElement) {
  if (still()) return;
  const s = getComputedStyle(el);
  const open = { height: `${el.offsetHeight}px`, paddingTop: s.paddingTop, paddingBottom: s.paddingBottom, marginTop: s.marginTop, opacity: s.opacity, transform: "none" };
  el.style.overflow = "clip";
  const anim = el.animate(
    [{ height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", opacity: 0, transform: "translateY(4px)" }, open],
    { duration: 280, easing: EASE },
  );
  anim.onfinish = anim.oncancel = () => el.style.removeProperty("overflow");
}

export type PollLike = {
  question: string;
  total: number;
  /** This viewer voted (LigaInsider says only that). */
  voted?: boolean;
  /** The option this viewer chose, when known. */
  mine?: number;
  options: { id?: number; label: string; pct: number }[];
};
/** key: the box's data-poll (what a vote is sent for); loginHref: answers link there when voting needs a login. */
export type PollOpts = { key?: number; canVote: boolean; loginHref?: string };

const polls = new WeakMap<HTMLElement, PollLike>();
export const pollOf = (box: HTMLElement) => polls.get(box);
const votes = (n: number) => `${n} ${n === 1 ? "Stimme" : "Stimmen"}`;
const fillScale = (pct: number) => `scaleX(${pct / 100})`;

/** Answers to tap, or bars with ✓ once voted. Results always show; `from` draws the bars where they start. */
export function renderPoll(view: PollLike, opts: PollOpts, from?: number[]): HTMLElement {
  const box = h("div", "poll mt-2 rounded-xl bg-surface p-3");
  polls.set(box, view);
  if (opts.key) box.dataset.poll = String(opts.key);
  box.append(h("p", "mb-2 text-[14px] font-semibold", view.question));
  const voted = view.voted || view.mine !== undefined;
  const best = Math.max(...view.options.map((o) => o.pct));
  view.options.forEach((o, i) => {
    const tap = !voted && opts.canVote && !!o.id;
    // Tailwind only sees whole class words, so classes must not touch a ${…} placeholder.
    const row = h(voted ? "div" : tap ? "button" : opts.loginHref ? "a" : "div", "poll-choice relative mb-1.5 w-full overflow-hidden rounded-xl px-3 py-3 text-left text-[15px]");
    if (row instanceof HTMLAnchorElement) {
      row.classList.add("press");
      row.href = opts.loginHref!;
    } else if (row instanceof HTMLButtonElement) {
      row.type = "button";
      row.classList.add("press");
      row.dataset.option = String(o.id);
    }
    const fill = h("span", "poll-fill absolute inset-0");
    fill.style.transform = fillScale(from?.[i] ?? o.pct);
    if (o.pct === best && o.pct > 0) fill.classList.add("is-best");
    const label = h("span", "relative", o.label);
    if (view.mine !== undefined && o.id === view.mine) {
      row.classList.add("is-mine");
      label.append(h("span", "poll-check", " ✓"));
    }
    row.append(fill, label, h("span", "poll-pct relative float-right font-semibold tabular-nums", `${o.pct}%`));
    box.append(row);
  });
  box.append(h("p", "poll-total mt-1 text-xs text-muted", votes(view.total)));
  return box;
}

/** New numbers in place: the bars glide (CSS transition), the figures change. */
export function showResults(box: HTMLElement, view: PollLike) {
  polls.set(box, view);
  const best = Math.max(...view.options.map((o) => o.pct));
  box.querySelectorAll(".poll-choice").forEach((row, i) => {
    const o = view.options[i];
    if (!o) return;
    const fill = row.querySelector<HTMLElement>(".poll-fill")!;
    fill.style.transform = fillScale(o.pct);
    fill.classList.toggle("is-best", o.pct === best && o.pct > 0);
    row.querySelector(".poll-pct")!.textContent = `${o.pct}%`;
  });
  box.querySelector(".poll-total")!.textContent = votes(view.total);
}

/** Replaces a poll (e.g. answers → results) with its bars starting where the old ones stood. */
export function swapPoll(box: HTMLElement, view: PollLike, opts: PollOpts): HTMLElement {
  const next = renderPoll(view, opts, pollOf(box)?.options.map((o) => o.pct));
  box.replaceWith(next);
  void next.offsetWidth; // the start widths take effect, so the change below transitions
  showResults(next, view);
  return next;
}

/** The poll as it looks right after this viewer's vote, before the server answers. */
export function withVote<P extends PollLike>(poll: P, optionId: number): P {
  const counts = poll.options.map((o) => Math.round((o.pct * poll.total) / 100) + (o.id === optionId ? 1 : 0));
  const pct = wholePercents(counts);
  return { ...poll, voted: true, mine: optionId, total: poll.total + 1, options: poll.options.map((o, i) => ({ ...o, pct: pct[i] })) };
}

/** ▲ with the count (always visible, voted or not). vote: this viewer's vote, 1 = up. */
export function voteButton(id: number, vote: number, score: number): HTMLButtonElement {
  const up = h("button", "vote-btn press");
  up.type = "button";
  up.dataset.up = String(id);
  up.append(h("span", "vote-chevron", "▲"), h("span", "vote-count"));
  setVote(up, vote === 1, score);
  up.dataset.vote = String(vote);
  return up;
}

// Changes show at once; the request runs in the background and a failure undoes the change.
export function setVote(btn: HTMLElement, on: boolean, score: number) {
  btn.dataset.vote = on ? "1" : "0";
  btn.dataset.score = String(score);
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "Deine Stimme" : "Hochvoten");
  btn.querySelector(".vote-count")!.textContent = score ? String(score) : "";
}

export type CommentLike<C> = { id: number; user: string; date: string; text: string; poll?: PollLike; replies: C[] };
export type RenderOpts<C> = {
  reply?: boolean;
  /** Still being sent: greyed out, no vote or reply yet. */
  pending?: boolean;
  /** The control at the right of a sent comment. */
  vote: (c: C) => HTMLElement;
  poll: (c: C) => HTMLElement;
  canReply: (c: C, reply: boolean) => boolean;
};

export function renderComment<C extends CommentLike<C>>(c: C, now: Date, opts: RenderOpts<C>): HTMLElement {
  const { reply = false, pending = false } = opts;
  const li = h("li", reply ? "comment comment-reply" : "comment");
  if (pending) li.classList.add("is-pending");
  const row = h("div", "flex items-start gap-2");
  const main = h("div", "min-w-0 flex-1");
  const head = h("div", "flex items-center gap-2.5");
  const size = reply ? "size-7 text-[10px]" : "size-8 text-[11px]";
  head.append(
    h("span", `flex ${size} shrink-0 items-center justify-center rounded-full bg-surface font-semibold text-muted`, initials(c.user) || "?"),
    h("b", "min-w-0 truncate text-[14px] font-semibold", c.user),
    h("span", "shrink-0 text-xs text-muted", pending ? "Wird gesendet …" : c.date ? ago(c.date, now) : ""),
  );
  main.append(head);
  // A poll's question can be its text too: shown once, in the poll.
  if (c.text && c.text !== c.poll?.question) main.append(h("p", "mt-1 text-[15px] leading-[1.45] whitespace-pre-line break-words", c.text));
  if (c.poll) main.append(opts.poll(c));
  const sent = c.id && !pending;
  if (sent && opts.canReply(c, reply)) {
    const btn = h("button", "press mt-1 text-xs font-medium text-muted", "Antworten");
    btn.type = "button";
    btn.dataset.reply = String(c.id);
    main.append(btn);
  }
  row.append(main);
  if (sent) row.append(opts.vote(c));
  li.append(row);
  // Always there (hidden while empty), so a new reply has its place.
  const ul = h("ul", "mt-3 flex flex-col gap-3 border-l-2 border-hairline pl-3 ml-[15px]");
  ul.dataset.replies = "";
  ul.hidden = c.replies.length === 0;
  for (const r of c.replies) ul.append(renderComment(r, now, { ...opts, reply: true, pending: false }));
  li.append(ul);
  return li;
}

/** Turns the greyed-out comment into the sent one in place: it fades to full (CSS transition), nothing jumps. */
export function settle(pending: HTMLElement, sent: HTMLElement) {
  pending.replaceChildren(...sent.childNodes);
  pending.className = sent.className;
}

export type Draft = { text: string; question: string; answers: string[] };

/**
 * The Kommentar | Umfrage box (CommentComposer.astro): the switch, "Weitere Antwort", and reading, clearing and
 * restoring what's typed.
 */
export function wireComposer(form: HTMLElement, { answerMax }: { answerMax: number }) {
  const q = <T extends HTMLElement>(sel: string) => form.querySelector<T>(sel)!;
  const fields = q("[data-fields]");
  const text = q<HTMLTextAreaElement>("[data-text]");
  const poll = q("[data-poll-fields]");
  const question = q<HTMLInputElement>("[data-question]");
  const options = q("[data-options]");
  const add = q<HTMLButtonElement>("[data-add]");
  const seg = q("[data-seg]");
  const modes = form.querySelectorAll<HTMLButtonElement>("[data-mode]");

  const option = (value: string) => {
    const input = h("input", FIELD);
    input.maxLength = answerMax;
    input.placeholder = "Antwort…";
    input.value = value;
    return input;
  };
  const setAnswers = (values: string[]) => {
    options.replaceChildren(...values.map(option));
    // Six answers at most: the button goes once they're there.
    add.hidden = values.length >= MAX_ANSWERS;
  };
  setAnswers(["", ""]);
  add.addEventListener("click", () => {
    if (options.children.length < MAX_ANSWERS) setAnswers([...read().answers, ""]);
  });

  modes.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-pressed") === "true") return;
      const on = btn.dataset.mode === "poll";
      seg.style.setProperty("--i", on ? "1" : "0");
      modes.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      // The box changes height in one glide while the new fields fade in, instead of jumping.
      const from = fields.offsetHeight;
      poll.classList.toggle("hidden", !on);
      text.classList.toggle("hidden", on);
      const to = fields.offsetHeight;
      if (still()) return;
      fields.style.overflow = "clip";
      const anim = fields.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 280, easing: EASE });
      anim.onfinish = anim.oncancel = () => fields.style.removeProperty("overflow");
      (on ? poll : text).animate(
        [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
        { duration: 220, delay: 40, easing: "ease-out", fill: "backwards" },
      );
    });
  });

  const read = (): Draft => ({ text: text.value, question: question.value, answers: [...options.querySelectorAll("input")].map((i) => i.value) });
  const polling = () => !poll.classList.contains("hidden");
  return {
    polling,
    read,
    /** Empties what was just sent (the other mode's fields keep what's in them). */
    clear() {
      if (!polling()) return void (text.value = "");
      question.value = "";
      setAnswers(["", ""]);
    },
    /** Puts a draft back after a failed send. */
    restore(d: Draft) {
      text.value = d.text;
      question.value = d.question;
      setAnswers(d.answers.length >= 2 ? d.answers : ["", ""]);
    },
  };
}
