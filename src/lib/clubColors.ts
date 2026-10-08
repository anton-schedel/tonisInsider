/** Main club colour per LigaInsider slug, for the subtle tint on match cards. Unknown clubs get none. */
const COLORS: Record<string, string> = {
  "1-fc-koeln": "#ed1c24",
  "1-fc-union-berlin": "#eb1923",
  "1-fsv-mainz-05": "#c3141e",
  "bayer-04-leverkusen": "#e32221",
  "borussia-dortmund": "#fde100",
  "borussia-moenchengladbach": "#00a651",
  "eintracht-frankfurt": "#e1000f",
  "fc-augsburg": "#ba3733",
  "fc-bayern-muenchen": "#dc052d",
  "fc-schalke-04": "#004d9d",
  "hamburger-sv": "#0a3f86",
  "rb-leipzig": "#dd0741",
  "sc-freiburg": "#e2001a",
  "sc-paderborn-07": "#005ca9",
  "sv-07-elversberg": "#6b6b6b",
  "sv-werder-bremen": "#1d9053",
  "tsg-hoffenheim": "#1c63b7",
  "vfb-stuttgart": "#e32219",
};

export const clubColor = (slug: string | undefined): string | undefined => (slug ? COLORS[slug] : undefined);

/** Card background: each club's colour fades in from its side, the middle stays the plain surface. */
export function matchTint(home: string | undefined, away: string | undefined): string | undefined {
  const h = clubColor(home), a = clubColor(away);
  if (!h && !a) return undefined;
  const side = (c: string | undefined) => (c ? `color-mix(in srgb, ${c} var(--tint), var(--surface))` : "var(--surface)");
  return `background:linear-gradient(100deg, ${side(h)} 0%, var(--surface) 42%, var(--surface) 58%, ${side(a)} 100%)`;
}
