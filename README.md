# tonisInsider

Private, ad-free reader for ligainsider.de news and predicted Bundesliga XIs. Only for me and friends: not indexed, not public.

## How it works

A GitHub Actions cron (every 5 min) scrapes LigaInsider. Data lives in the Actions cache, never in git. When something changed, it builds the Astro site and deploys it to Cloudflare Pages. See `docs/superpowers/specs/2026-10-07-tonisinsider-design.md`.

## Local development

```bash
npm install
npm run scrape     # first run: ~5–8 min backfill; later runs: seconds
npm run dev        # http://localhost:4321
npm test           # needs scraper/__fixtures__/ (git-ignored, real pages)
```

## One-time setup (owner)

1. **Cloudflare:** create an API token with the "Cloudflare Pages: Edit" permission, and note your account ID.
2. **Pick an unguessable project name**, e.g. `tonisinsider-7f3k9q`. The site URL becomes `https://<name>.pages.dev`, and nobody can find it without the link.
   ```bash
   npx wrangler login
   npx wrangler pages project create <name> --production-branch=main
   ```
3. **GitHub:** create a **public** repo (public = unlimited free Actions minutes; it only contains code) and push.
4. In the repo settings → Secrets and variables → Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables: `CF_PAGES_PROJECT` = `<name>`, `SITE_URL` = `https://<name>.pages.dev`
5. Actions tab → `scrape-and-deploy` → "Run workflow" once. The first run backfills (~8 min).

## When GitHub emails "run failed"

The Scrape step log lists `PROBLEM:` lines. Usually LigaInsider changed their HTML. Save the affected page into `scraper/__fixtures__/`, update the parser until `npm test` passes, then push.
