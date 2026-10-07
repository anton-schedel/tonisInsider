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
