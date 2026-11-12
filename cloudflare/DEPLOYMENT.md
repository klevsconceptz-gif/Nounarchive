# Deploy Nounarchive to Cloudflare

Choose **one** web deployment: Worker (recommended, simplest) or Pages. Both serve the same frontend and API on one origin and use a persistent Cloudflare D1 database. The existing Node/SQLite server remains available for conventional hosting, but is **not** the Cloudflare entry point.

## What is ready

- `wrangler.jsonc`: complete Worker + static assets + D1 + daily Cron Trigger.
- `wrangler.pages.jsonc`: Pages configuration template; `pages:build` stages it with the frontend and an advanced-mode Functions Worker in `dist/pages-site`.
- `wrangler.scheduler.jsonc`: daily collector for the Pages option (Pages itself has no scheduled handler).
- `cloudflare/migrations/0001_initial.sql`, `0002_admin_recovery.sql` and `0003_resources.sql`: tables/indexes for news, resources, posts, sessions, login throttles and password recovery.
- Cookie auth, CSRF protection, draft privacy and single-row post updates, without filesystem or native SQLite dependencies in the edge bundle.

No remote resources have been created, no secrets installed, and no production deployment is implied by successful local builds. The GitHub production workflow injects `D1_DATABASE_ID` before applying migrations and deploying; direct CLI deployments must configure the actual D1 UUID for the target account. Cloudflare account access is required for remote operations. Use the dashboard/CLI for secrets; never paste them into chat or commit them.

## 1. Install and validate

Node.js 22.22.3+ (CI uses 22.22.3):

```sh
npm ci
npm test
```

The traditional Node server and migration export use Node's built-in `node:sqlite`; there is no third-party native SQLite addon. Node 22 emits an experimental SQLite warning. The Cloudflare bundle uses D1 exclusively and does not import `node:sqlite`.

`npm test` builds both targets and tests both bundles in the local Workers runtime with D1, in addition to the Node server, parsers, storage and UI tests. No Cloudflare account or network source access is needed for these tests.

## 2. Authenticate, create D1 and configure the real ID

From your own authenticated terminal:

```sh
npx wrangler login
npm run cf:db:create
# Copy the actual database_id printed by Cloudflare:
npm run cf:configure -- <actual-database-uuid>
npm run cf:db:remote
```

The configure command writes the same ID into all three templates. D1 IDs are identifiers, not API secrets. Deployment and remote-migration commands validate the UUID, but only an authenticated Cloudflare request can confirm that it exists in the intended account. For automation, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your CI secret store with least-privilege D1, Workers and/or Pages permissions, instead of interactive login. Do not hardcode credentials in the repository.

For a **separate staging environment**, create a separate D1 database and configure its ID in a separate checkout/config. Do not point untrusted preview deployments at the production D1 database: preview admins could modify production posts.

## 3A. Worker deployment (recommended)

```sh
npm run cf:deploy
npm run cf:admin-hash
# Copy only the generated pbkdf2-sha256$... value into the next interactive prompt:
npx wrangler secret put ADMIN_PASSWORD_HASH
```

`cf:admin-hash` prompts for a strong password without terminal echo and generates a salted PBKDF2-SHA256 hash. The Worker accepts `ADMIN_PASSWORD_HASH`, **not** the Node server's `ADMIN_PASSWORD` or scrypt credential file. The password itself is never embedded in the client. Hash output is sensitive; do not save it in tracked files.

Deploying the secret creates a new Worker version. Visit the URL reported by Wrangler, then `/admin.html`. Cron runs daily at 00:00 UTC; no always-on process is needed. You do not need the standalone scheduler for this option.

## 3B. Pages deployment

```sh
npx wrangler pages project create nounarchive --production-branch main
npm run pages:deploy -- --branch main
npm run cf:admin-hash
npx wrangler pages secret put ADMIN_PASSWORD_HASH --project-name nounarchive
# Publish again so the new secret is available to the deployment:
npm run pages:deploy -- --branch main
# Pages cannot run cron. Deploy this collector against the SAME D1 database:
npm run cf:deploy:scheduler
```

The Pages script compiles `functions/api/[[path]].js`, stages an advanced-mode `_worker.js` alongside assets, and runs Wrangler **from the staged Pages root**. This prevents the repository's standalone Worker config from being mistaken for a Pages config. Deploy using this script rather than uploading `public/` alone: a static-only upload would have no APIs. `public/_routes.json` sends only `/api/*` to Functions; static assets remain static. No cross-origin URL, CORS configuration, localhost backend or frontend API key is required.

For dashboard/Git build integration, use the CLI workflow above first. The repository-root config intentionally targets Workers; a Pages Git integration needs its own configured project root/config so it does not select `wrangler.jsonc`. Do not select `server.js` as a Pages entry point.

Production and preview secrets/bindings can differ in Cloudflare. Set the admin hash only in the environment you intend to use, and use separate databases for previews. The staged config binds a database; verify it before deploying.

The standalone scheduler has no public ingestion endpoint and needs no admin secret. Do not also enable the full Worker cron against the same database; deploy one scheduler, not both.

## 4. Existing content migration (optional)

A fresh D1 installation has no editorial posts; the app explicitly labels the bundled fourteen-headline snapshot until live imports succeed. Import your existing SQLite archive and drafts before switching production traffic:

```sh
# Run where your current SQLite database exists; stop editorial writes during migration.
npm run cf:export
npx wrangler d1 execute nounarchive --remote --file data/cloudflare-export.sql
```

The export preserves existing D1 rows (`INSERT OR IGNORE`) and does not migrate passwords, sessions or throttles. Keep the SQL private because it can contain drafts. Export an online source backup first with `npm run db:backup -- data/backups/before-cloudflare.sqlite`. Verify row counts and published articles on D1 before switching traffic. The fallback snapshot is read-only and never overwrites D1 data.

Back up D1 via Cloudflare's database export before migrations:

```sh
npx wrangler d1 export nounarchive --remote --output data/d1-backup.sql
```

Keep export files out of Git and out of the `public/` asset directory.

## 5. Local edge development

```sh
npm run cf:db:local
npm run cf:dev -- --ip 0.0.0.0
```

For local login, put the generated hash in an ignored root `.dev.vars` file:

```dotenv
ADMIN_PASSWORD_HASH="pbkdf2-sha256$100000$...generated-salt...$...generated-key..."
```

This is an illustrative format, not a usable credential. Pages staging uses a different project root: put local secrets in `dist/pages-site/.dev.vars` **after** `npm run pages:build`, and run `node scripts/pages-command.js dev`. Do not deploy that local secret file. Both CLI dev modes can share the root `.wrangler/state` D1 persistence. Cloudflare local dev uses SQLite internally, not your Node server's database.

For local cron testing with the installed Wrangler version, run `npm run cf:dev` and request `/cdn-cgi/local/scheduled?cron=0+0+*+*+*`. This invokes the collector and contacts all three source sites. It cannot succeed in this sandbox's restricted network; production source availability and publisher layout/permission still need verification.

## 6. Launch checks

1. `/api/health` returns `{"ok":true,"database":"d1"}` only after all required tables exist; it returns HTTP 503 if D1 is reachable but migrations are incomplete.
2. `/api/archive` returns the archive and source statuses.
3. `/admin.html` signs in with your configured password.
4. A saved draft is absent from `/api/archive` and its `/api/posts/<id>` returns 404.
5. Publish the draft; verify it appears in the feed and opens a full article page.
6. Sign out; admin API calls return 401.
7. After a scheduled run, review each source's status and last-success time. A reachable app is not evidence that all sources can be imported.
8. Add a custom domain through Cloudflare and verify HTTPS cookies and same-origin APIs.

## Operations and limits

- D1 reads each request, and sessions/throttles are persistent: no process-local cache/session store is used in the edge backend.
- Changing `ADMIN_PASSWORD_HASH` invalidates all existing sessions on their next request. Sessions expire after eight hours and are cleaned up by cron.
- Login is limited to five attempts per client IP in 15 minutes; IPs are hashed before storage. Cloudflare supplies `CF-Connecting-IP`. Add Cloudflare Access/WAF controls if stronger perimeter restrictions are needed.
- Source refreshes upsert only imported articles and preserve editorial posts and last-success data when a source fails. Simultaneous scheduled attempts are idempotent by article ID, but source health reflects the last completed attempt.
- HTML/feed parsing and password hashing consume CPU. Select a Worker plan/CPU allowance suitable for the workload and monitor Cron/Functions errors and D1 usage. A successful build is not a production capacity test.
- The full archive is returned in one API response, as in the Node build. Plan server-side pagination before the archive grows large; Cloudflare/D1 query and response limits still apply.
- Source-specific ingestion restrictions remain: NOUN Update's dynamic listing is not yet live-verified. No anti-bot, paywall or authentication bypass is provided.

## Workers Builds dashboard: resolving D1 error 10021

If the log says `binding DB of type d1 must have a valid database_id specified`, the Wrangler configuration does not point to a valid D1 database in the deployment account. Installing dependencies, uploading assets, or adding a binding only in the dashboard does not replace the ID in the Wrangler file. The GitHub deployment workflow injects the production `D1_DATABASE_ID`; dashboard builds must provide that ID at build time and run `npm run cf:deploy`. The remote configuration-difference warning is not the fatal error.

1. In **Storage & databases → D1**, create `nounarchive` if it does not exist. Open it and copy its **Database ID** (UUID), not the account ID or database name.
2. In the Worker's **Settings → Build → Variables and secrets** (build-time environment), add `D1_DATABASE_ID` with that UUID. This is an identifier, not a secret, and must be available to the build command, not just runtime `env`.
3. Set the **deploy command** to `npm run cf:deploy`, replacing `npx wrangler deploy`. The npm script validates and injects the build variable into all three Wrangler configurations before calling Wrangler. A direct Wrangler command bypasses that preparation.
4. Apply D1 migrations from an authorized terminal before serving traffic:
   ```sh
   npm run cf:configure -- YOUR_ACTUAL_DATABASE_UUID
   npm run cf:db:remote
   ```
   Alternatively, after validating the intended production database and granting the build token D1 migration permissions, use this dashboard deploy command:
   ```sh
   npm run cf:db:remote && npm run cf:deploy
   ```
   Both commands read the same `D1_DATABASE_ID` build variable. Back up an existing production database before applying new migrations.
5. Retry the build. Then configure the runtime `ADMIN_PASSWORD_HASH` secret and check `/api/health`.

If you prefer no build variable, run `cf:configure` locally with the real UUID, commit the changed Wrangler files and deploy that commit. Do not commit passwords or tokens. A syntactically valid UUID is not enough: it must identify a real D1 database in the account used by the deployment token.
