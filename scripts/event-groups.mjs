// Groups Kickbase's event types (shots, duels, …) for the team summary's point profile:
// writes src/lib/summary/eventGroups.json ({ "<event type id>": "<group>" }) by keyword rules on the German names.
// Run when Kickbase adds event types: set -a; . ./.env; set +a; node scripts/event-groups.mjs
import { writeFileSync } from "node:fs";
import { env } from "node:process";

const API = "https://api.kickbase.com";
// First match wins, so the order matters: "Tor kassiert" is a mistake before it's attack, "(TW)" always keeper.
const RULES = [
  ["keeper", /\(TW\)|Parade|gehalten|Torwart|Abwurf|Abschlag|Rauslaufen/],
  ["mistake", /Karte|Foul|Ballverlust|vergeben|Eigentor|Fehler|verloren|Abseits|verursacht|verschossen|verschuldet|kassiert|Platzverweis|Handspiel|Ausgespielt|zu weit/],
  ["team", /Spiel gewonnen|Teamtor|Unentschieden/],
  ["attack", /Tor|Schuss|schuss|Assist|Torvorlage|Pass des Todes|Großchance|Elfmeter|Penalty|Dribbling|ausgedribbelt|Aluminium|Latte|Pfosten|Eins-gegen-Eins/],
  ["duel", /Zweikampf|Duell/],
  ["defence", /Tackling|Abgefangen|abgefangen|Klärung|geklärt|Geklärt|Block|geblockt|Zu Null|Ballgewinn|Balleroberung|gestört/],
  ["pass", /Pass|Flanke|Ecke|Freistoß|Vorlage/],
  ["time", /Minuten|Startelf|Einwechsl|eingewechselt/],
];

const login = await fetch(`${API}/v4/user/login`, {
  method: "POST",
  headers: { accept: "application/json", "content-type": "application/json" },
  body: JSON.stringify({ em: env.KICKBASE_EMAIL, pass: env.KICKBASE_PASSWORD, loy: false, rep: {} }),
});
if (!login.ok) throw new Error(`login: HTTP ${login.status}`);
const { tkn } = await login.json();
const res = await fetch(`${API}/v4/live/eventtypes`, { headers: { accept: "application/json", "accept-language": "de-DE", authorization: `Bearer ${tkn}` } });
if (!res.ok) throw new Error(`eventtypes: HTTP ${res.status}`);
const { it } = await res.json();

const groups = {};
const count = {};
for (const { i, ti } of it.filter((t) => t.i > 0).sort((a, b) => a.i - b.i)) {
  const group = RULES.find(([, re]) => re.test(ti))?.[0] ?? "other";
  groups[i] = group;
  count[group] = (count[group] ?? 0) + 1;
}
writeFileSync(new URL("../src/lib/summary/eventGroups.json", import.meta.url), JSON.stringify(groups, null, 0) + "\n");
console.log(`${Object.keys(groups).length} event types:`, count);
