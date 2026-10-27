import { EASE_GLIDE as EASE } from "./motion.ts";

/**
 * Live values (scores, Kickbase points): when the text really changes, the old one fades out quickly and the
 * new one in, so a change is seen without a jump. Same text: nothing happens. Reduced motion: just set.
 */
/** The text an element gets once its fade-out is done (a newer value during the fade replaces it). */
const pending = new WeakMap<Element, string>();

declare global {
  interface Window {
    __swapText?: (el: Element, text: string) => void;
    __imgLoaded: Set<string>;
  }
}

export function swapText(el: Element, text: string) {
  if (pending.has(el)) {
    pending.set(el, text);
    return;
  }
  if (el.textContent === text) return;
  if (!el.isConnected || !("animate" in el) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = text;
    return;
  }
  pending.set(el, text);
  const out = (el as HTMLElement).animate([{ opacity: 1 }, { opacity: 0.25 }], { duration: 110, easing: "ease-in" });
  out.onfinish = out.oncancel = () => {
    el.textContent = pending.get(el) ?? text;
    pending.delete(el);
    (el as HTMLElement).animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 280, easing: EASE });
  };
}
