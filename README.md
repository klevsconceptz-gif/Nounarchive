# Nounarchive

**GitHub deployment with functional admin:** [Admin deployment walkthrough](cloudflare/GITHUB-ADMIN-DEPLOYMENT.md).

**GitHub + Cloudflare quick start:** [Deployment checklist](DEPLOYMENT.md).

**Cloudflare deployment:** See [Workers & Pages deployment guide](cloudflare/DEPLOYMENT.md). Both edge targets use D1; the Node/SQLite instructions below apply only to conventional server hosting.

Independent, searchable NOUN headline archive for BBCNOUN, NOUN Update and Puredu. Original content stays with the publishers; only titles, short excerpts and source links are indexed.

## Run

Requires Node.js 22.22.3 or newer (CI uses 22.22.3).

```sh
npm ci
npm test
npm start
```

Open port 3000. `PORT` overrides it; server binds to `0.0.0.0`. No API keys or browser-side external requests are needed.

## Updates and persistence

The Node server checks sources on startup and every hour, concurrently with per-request timeouts and response-size limits. It merges by canonical source URL and never removes existing articles on failure. The browser reloads the index every minute. No public ingestion endpoint is exposed.

Mount a persistent disk at `data/` in production. The app stores articles, source status and admin posts in `data/nounarchive.sqlite` (gitignored). Existing `archive.json` and `posts.json` files are imported once on first database initialization. Run a **single always-on instance**: an ephemeral/serverless host will not reliably execute timers or retain the archive. On restart the saved archive is loaded from SQLite. `DISABLE_SYNC=1` disables network ingestion for offline UI development. Use HTTPS at the hosting proxy.

## Source adapters and limitations

- BBCNOUN: public `/feed/` RSS.
- Puredu: public homepage article headings with `/post/` links.
- NOUN Update: public `/news/` listing. Its homepage loads news dynamically and `/feed/` returns 404; this adapter requires live-host verification and may need updating if news is client-rendered. A missing/changed listing is reported as a source error, never as a successful empty feed.

This environment restricts direct outbound connections to these domains, so fully live ingestion could not be validated here. Source errors are visible in the UI. No bypass of access restrictions, login, or anti-bot measures is attempted. Confirm publisher terms/robots policy before deploying ongoing collection, and obtain permission if needed.

`data/seed.json` contains a **labeled initial snapshot** of ten headlines and source links inspected on 2026-10-30, with concise paraphrased excerpts. It contains no NOUN Update news records because that listing has not been verified. This is not a full historical import. The collectors track recent publicly listed articles on subsequent runs; articles no longer in a source listing remain in the archive. Undated HTML items are explicitly labeled as such. Seeded publication dates use the calendar dates shown at source. Snapshot status is not a live-sync claim.

## Interface

Search titles/excerpts/categories, filter by publisher/category, sort, paginate and save bookmarks on the current browser. Every article links to its publisher. Abstract category artwork is decorative, not an original article photo. Source health shows last attempt and last successful import. Bookmarks do not sync across devices.

## Tests

`npm test` tests feed parsing, HTML extraction/deduplication, URL safety and classification. For a production rollout, verify live adapter output on your host; check all three source statuses after startup and monitor them when publishers change layouts. No full-text scraping, file mirroring, accounts or paid-source access is included.

## Admin panel and original posts

Visit `/admin.html` (also linked in the public footer). Admin access is **disabled until configured**. On the server, run:

```sh
npm run admin:setup
# Enter and confirm a strong password (at least 12 characters), then restart npm start.
```

Alternatively, supply `ADMIN_PASSWORD` through the host's secret environment settings; it takes precedence over the local credential file. Do not commit secrets or paste them into chat. To reset a file-based password, run `npm run admin:setup -- --reset` and restart. Admin setup stores only a salted scrypt hash in the ignored `data/admin-credential.json` file. Changing credentials requires restarting the process and invalidates existing sessions.

The panel supports creating/editing posts, optional summaries, categories, drafts, plain-text previews, publication, unpublishing and permanent deletion. Published updates join the public feed under the Nounarchive source and link to a full article page. Drafts are excluded from public APIs, including direct article URLs. Text is rendered without HTML execution. Bookmarks are device-local and do not preserve deleted posts.

Authentication uses HTTP-only, SameSite=Strict cookies, eight-hour in-memory sessions, CSRF tokens for mutations and login throttling (five failures per remote address per 15 minutes). Cookies are Secure when accessed over HTTPS; configure a trusted HTTPS reverse proxy that overwrites `X-Forwarded-Proto` and do not expose the backend directly. There is one admin role, not multi-user accounts. Sessions expire on server restart. Login throttling uses socket IP, so users behind a single proxy share a rate limit.

Mount all of `data/` on persistent storage, including `nounarchive.sqlite` and credentials. SQLite writes use transactions and WAL journaling; admin mutations are serialized in one server process. Continue using a single instance; multiple replicas require a shared database/session store. Back up this directory securely. Admin posts are kept separate from imported data so feed refreshes cannot overwrite them. These records are intentionally not tracked by Git.

## Publication-style homepage

The public homepage follows the information hierarchy visible in Puredu's public listing: a lead story, chronological article list, publication date, category, short excerpt and read-more link. Nounarchive keeps its own identity and adds publisher attribution, source filters, recent updates and transparent import status. Search, bookmarks and the admin desk remain available. Decorative category panels are not source photographs.

Reading time appears only when provided in imported listing metadata (including the initial Puredu snapshot), or is estimated from the complete text of an original admin post at 200 words/minute. External article reading time is not guessed from a short excerpt. Undated source listings remain labeled as date unavailable. The featured story is the newest dated article available in the archive, not a claim that a source has just been synced.


## SQLite storage (current backend)

Runtime dependencies are installed and locked in `package-lock.json`. Node's built-in `node:sqlite` supplies transactional local storage (it emits an experimental warning on Node 22); `dotenv` loads optional local environment settings. Existing Express, feed-parser and UI-test dependencies remain installed. Use Node 22.22.3+. No third-party native SQLite addon or C++ build toolchain is required.

```sh
npm ci
cp .env.example .env  # optional; keep secrets out of Git
npm run db:init
npm start
```

`db:init` creates indexed `articles` and `posts` tables, archive metadata and a migration ledger. It imports legacy JSON files once, or uses the bundled snapshot when there is no legacy archive. It never reimports over subsequent edits or deleted posts. Database initialization also runs automatically on server startup. Invalid legacy JSON causes initialization to fail rather than silently discard data. `/api/health` checks a database query.

Set `DATABASE_PATH` to a persistent, non-public file path; the default is `data/nounarchive.sqlite`. The directory must be writable by the application. Keep a single application instance because feed/admin read caches and sessions are process-local. For hosted multi-instance operation, migrate to a shared database and session store. This implementation does **not** provision or connect to Supabase.

Create a consistent online backup with:

```sh
npm run db:backup -- data/backups/archive.sqlite
```

Treat backups as private: they contain drafts. To restore, stop the server, preserve a backup of the current database, remove its old WAL/SHM sidecars, and replace the database file with the backup before restarting. Do not copy only the main live SQLite file while writes are in progress; use the backup command. Database files and backups are excluded from Git. Recreated development workspaces can regenerate the seed database; production must retain its persistent volume and backups.
