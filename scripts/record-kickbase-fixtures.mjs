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
