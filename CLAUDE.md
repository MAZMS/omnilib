# Omnilib — Rules for Claude Code

Public AI tools directory at **omnilib.app** with affiliate links.
Users search and browse AI tools, click through affiliate links, owner earns commissions.

## The Operator

Maz (MAZMS). Solo founder. Works fast, thinks visually, delegates everything.

- Screenshots = instructions. Read them, understand them, act.
- "Do it" means DO IT. No clarification needed.
- After every meaningful change: **commit + push to main**.
- Railway auto-deploys from main. Check `railway logs` if it crashes.

## Architecture

```
omnilib/
├── server.js           # Express server — API routes, affiliate redirects, admin auth, SEO injection
├── data/
│   └── tools.json      # All AI tool entries — the entire "database"
├── public/
│   ├── index.html      # Main page — hero, search, card grid
│   ├── tool.html       # Tool detail page (server injects meta tags for SEO)
│   ├── admin.html      # Admin panel — add/edit/delete tools
│   ├── css/style.css   # Full design system, single file
│   └── js/
│       ├── app.js      # Main page: search, filter, render cards
│       ├── tool.js     # Tool detail page logic
│       └── admin.js    # Admin CRUD logic
├── db.js               # PostgreSQL connection, queries, table init
├── package.json        # express + multer + pg — no build step
├── .env.example        # ADMIN_KEY, PORT, DATABASE_URL
└── CLAUDE.md           # This file
```

**Key routes in server.js:**
- `GET /api/tools` — list/search/filter tools (?q=, ?category=, ?pricing=, ?tag=, ?sort=)
- `GET /api/tools/:slug` — single tool data
- `GET /api/categories` — category list
- `GET /go/:slug` — **affiliate redirect** (increments clicks, 302 to affiliateUrl)
- `GET /tool/:slug` — tool detail page with SEO meta injection
- `POST/PUT/DELETE /api/admin/tools` — admin CRUD (Bearer auth)
- `POST /api/admin/upload` — image upload
- `GET /sitemap.xml` — auto-generated sitemap
- `GET /health` — health check

## Invariants

1. **No build step.** Plain HTML + CSS + vanilla JS in `public/`. No React, no bundler, no TypeScript.
2. **PostgreSQL for mutable data.** Subscribers, submissions, feedback, stats, clicks stored in PostgreSQL. `data/tools.json` is the static tools catalog (committed to git).
3. **Clean & minimal design.** White background, card grid, monospace font.
4. **Secrets in `process.env` only.** Never commit, log, or echo API keys.
5. **Admin at `/admin`** — always accessible, auth via ADMIN_KEY env var.
6. **New env var → add to `.env.example`** in the same commit.
7. **Affiliate links go through `/go/:slug`** — never expose raw affiliate URLs to the frontend.

## Security

- **Security headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Body size limit:** `express.json({ limit: '50kb' })`.
- **Graceful shutdown:** `SIGTERM` handler.
- **Admin auth:** Bearer token via ADMIN_KEY env var.
- **Image upload:** 5MB limit, allowed extensions only.

## Design Rules

- **Font stack:** `'SF Mono', 'Fira Code', 'Consolas', monospace`.
- **Micro-animations:** fadeUp entrance, card hover lift, smooth transitions (200ms ease).
- **No visible scrollbars.** `scrollbar-width: none` globally.
- **Mobile responsive.** 640px breakpoint. Touch targets >= 44px.
- **Color-coded pricing badges:** green=free, blue=freemium, orange=paid, purple=open-source.
- **Card grid:** CSS Grid with `auto-fill, minmax(320px, 1fr)`.

## Data Model

Each tool in `data/tools.json`:
- `id`, `slug`, `name`, `description`, `longDescription`
- `url` (real), `affiliateUrl` (tracked — what users click)
- `category`, `tags[]`, `pricing` (free/paid/freemium/open-source), `pricingDetails`
- `rating` (1-5), `logo`, `screenshots[]`
- `featured`, `dateAdded`, `clicks` (auto-incremented on redirect)

## Railway Deployment

- Domain: **omnilib.app**
- Auto-deploys on push to `main`
- Build: `npm install` → `npm start`
- Check: `railway status`, `railway logs`

## When in Doubt

- Ship it. Fix later.
- Simple beats clever.
- Commit and push. Always.
