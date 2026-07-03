# Omnilib — Rules for Claude Code

AI & tech news blog at **omnilib.app** (the home page), with an AI tools directory at `/tools` earning affiliate commissions.
The blog is the focus: daily AI-generated posts, SEO traffic, newsletter. Tools directory is secondary.

## The Operator

Maz (MAZMS). Solo founder. Works fast, thinks visually, delegates everything.

- Screenshots = instructions. Read them, understand them, act.
- "Do it" means DO IT. No clarification needed.
- After every meaningful change: **commit + push to main**.
- Railway auto-deploys from main. Check `railway logs` if it crashes.

## Architecture

```
omnilib/
├── server.js           # Express server — routes, affiliate redirects, admin auth, SEO injection, blog cron
├── db.js               # PostgreSQL connection, queries, table init (blog_posts, site_stats, ...)
├── generate-blog.js    # Daily AI blog post generation (OpenAI)
├── generate-bulk.js    # Bulk backdated post generation
├── data/
│   └── tools.json      # Static tools catalog (committed to git)
├── public/
│   ├── blog.html       # HOME PAGE — blog listing, search, category filters, newsletter
│   ├── post.html       # Blog post template (server injects content + meta)
│   ├── index.html      # Tools directory (served at /tools)
│   ├── tool.html       # Tool detail page (server injects meta tags for SEO)
│   ├── compare.html    # Tool comparison page
│   ├── admin.html      # Admin panel — Blog traffic dashboard (default tab) + tools CRUD
│   ├── css/style.css   # Full design system, single file
│   └── js/
│       ├── blog.js     # Home/blog: posts, filters, AI search
│       ├── app.js      # Tools page: search, filter, render cards
│       ├── tool.js     # Tool detail page logic
│       ├── compare.js  # Compare page logic
│       └── admin.js    # Admin dashboard + CRUD logic
├── package.json        # express + multer + pg + node-cron — no build step
├── .env.example        # ADMIN_KEY, PORT, DATABASE_URL, OPENAI_API_KEY
└── CLAUDE.md           # This file
```

**Key routes in server.js:**
- `GET /` — **blog listing (home page)**, serves blog.html
- `GET /blog/:slug` — blog post page with SEO meta injection (increments views + daily blog stats)
- `GET /blog` — 301 redirect to `/` (legacy URL)
- `GET /blog/rss.xml` — RSS feed
- `GET /api/blog` — list/search blog posts (?page=, ?category=, ?tag=, ?q=)
- `GET /api/blog/ai-search` — AI-powered blog search
- `GET /tools` — tools directory (formerly the home page), serves index.html
- `GET /api/tools` — list/search/filter tools (?q=, ?category=, ?pricing=, ?tag=, ?sort=)
- `GET /go/:slug` — **affiliate redirect** (increments clicks, 302 to affiliateUrl)
- `GET /tool/:slug` — tool detail page with SEO meta injection
- `GET /api/admin/blog-stats` — blog traffic dashboard data (Bearer auth)
- `POST/PUT/DELETE /api/admin/blog` + `/api/admin/tools` — admin CRUD (Bearer auth)
- `POST /api/admin/generate-blog` — trigger AI post generation
- `GET /sitemap.xml` — auto-generated sitemap
- `GET /health` — health check

**Blog traffic tracking:** `blog_posts.views` (all-time per post) + `site_stats.blog_views`/`top_posts` (daily). Admin panel opens on the Blog tab with the traffic dashboard.

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
