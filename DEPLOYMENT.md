# Nounarchive: GitHub → Cloudflare deployment checklist

**Recommended:** one Cloudflare Worker serves the complete site and API, D1 stores articles, resource listings, and posts, and a daily Cron Trigger refreshes news and tools. Pages is also supported, using a separate scheduler Worker. Choose **one** web target; do not enable two collectors against the same database.

No remote D1 instance or production deployment is created by this guide. All remote commands require your authorized Cloudflare account. Keep passwords and API tokens in secret settings, not chat or Git.

## 1. Install and verify locally

Use Node **22.22.3+** (the workflows pin **22.22.3**) and npm.

```bash
npm ci
npm run db:init       # traditional local SQLite storage, optional for Cloudflare
npm run cf:db:local   # local D1 migrations
npm test             # builds Worker + Pages and runs all tests
npm audit
```

`npm ci` installs the locked Express, Hono, feed parsing, Wrangler, Miniflare and test dependencies. Local SQLite uses Node's built-in module; no native addon compilation is needed. Its experimental warning on Node 22 is expected. D1 is Cloudflare-managed, so it has no installable database server.

## 2. Save the project to GitHub

The repository is `klevsconceptz-gif/Nounarchive`. Work in the feature branch provided by your coding session and open a pull request to `main`; production deployment is restricted to `main`. Keep `.env`, `.dev.vars`, database files, and SQL exports out of Git.

Included workflows:

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Tests pull requests and pushes to `main`; no Cloudflare credentials required |
| `.github/workflows/deploy-cloudflare.yml` | Production deployment on `main` and manual Worker/Pages deployments from `main` |

The deployment workflow is present on the default branch. For a manual production deployment, select `main` and choose `worker` or `pages`; feature branches are not deployed to production.

## 3. Create and configure production D1

From your own terminal:

```bash
npx wrangler login
npm run cf:db:create
# Use the real database_id printed by that command:
npm run cf:configure -- <actual-database-uuid>
npm run cf:db:remote
```

`cf:configure` updates the D1 `DB` binding in all three Cloudflare configurations. The ID is not a password. Remote scripts deliberately refuse to deploy while an ID is unset.

The checked-in migrations create:

- `articles` and `source_status` — imported news and provider health
- `resources` and `resource_status` — discovered directory records and provider health
- `posts` — original draft/published admin updates
- `admin_sessions` and `login_attempts` — persistent sessions and rate-limit records
- `admin_credentials` and `admin_reset_tokens` — durable password overrides and single-use recovery-token claims

Wrangler maintains the D1 migration history; later deploys apply only pending migrations. A fresh site shows the explicitly labeled headline snapshot until source checks succeed; it does not invent editorial posts.

Use a separate D1 instance for staging/previews. Do not bind untrusted preview deployments to production data.

## 4. Set admin credentials and GitHub deployment settings

Generate a Cloudflare-compatible password hash locally:

```bash
npm run cf:admin-hash
```

Enter and confirm a strong password. Keep the password for signing into `/admin.html`. The command outputs a salted `pbkdf2-sha256$100000$...` hash; treat that value as a secret too. The Node admin password file is not used by the Cloudflare backend.

In GitHub, open **Settings → Environments → New environment**, name it **production**, and restrict deployment branches to `main`. Add required reviewer approval if your plan supports it.

Add these **environment secrets**:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Scoped Cloudflare deployment token |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID from the Cloudflare dashboard |
| `CLOUDFLARE_ADMIN_PASSWORD_HASH` | Complete generated hash, without surrounding quotes |

Add this **environment variable**:

| Name | Value |
|---|---|
| `D1_DATABASE_ID` | Actual D1 UUID from section 3 |

Scope the Cloudflare token to the account and the capabilities required: **D1 Edit** (migration/export), **Workers Scripts Edit** (Worker, scheduler and secrets), and **Cloudflare Pages Edit** if deploying Pages. Some Wrangler discovery operations may also require account/membership read access. Do not use a global API key. Add domain/zone permissions only if you automate custom-domain changes.

Do not add any of these secrets to browser JavaScript or `.env.example`. The workflow checks configuration without printing secret values, tests before deployment, exports a D1 backup to its temporary runner, applies migrations, and deploys the selected target. It serializes production jobs and does not cancel migrations in flight. The runner backup is **not** a durable backup; keep a separate D1 export/Cloudflare recovery policy for production.

## 5A. Deploy from your terminal (no GitHub Actions needed)

### Workers — simplest

```bash
npm run cf:deploy
npx wrangler secret put ADMIN_PASSWORD_HASH
# At the secret prompt, paste the generated hash, not your password.
```

The resulting Worker includes the site, APIs and daily collection. Wrangler reports the live URL. No separate scheduler is needed.

### Pages — alternative

Create the Pages project once:

```bash
npx wrangler pages project create nounarchive --production-branch main
npx wrangler pages secret put ADMIN_PASSWORD_HASH --project-name nounarchive
npm run pages:deploy -- --branch main
npm run cf:deploy:scheduler
```

The Pages command compiles/stages an advanced-mode Functions Worker alongside static assets, using the configured D1 binding. Do not deploy `public/` alone or set the Pages build command to `npm start`: that would not provide this application's backend. Pages does not support Cron Triggers itself; `nounarchive-sync` provides daily collection against the same D1 database.

The repository-root `wrangler.jsonc` is intentionally the **Workers** configuration. Use the supplied Pages CLI staging workflow rather than a naive dashboard Git import pointed at the repository root.

## 5B. Deploy through GitHub Actions

After the environment settings are configured and the workflow is available:

1. Open **Actions → Deploy to Cloudflare → Run workflow**.
2. Select branch **main**.
3. Choose target **worker** or **pages**.
4. Approve the `production` environment deployment if prompted.
5. Review the test, migration and deployment job logs for the reported URL.

For Pages, create the `nounarchive` Pages project once with the command in section 5A before running the workflow. The workflow installs the admin hash as a Pages secret before the new deployment. Worker deployment publishes the Worker, then installs the hash as a Worker secret. Failures are reported by the job; deployments are not automatically retried or rolled back after a schema migration.

If changing targets later, disable the previous scheduler via the Cloudflare dashboard before enabling the new one. Switching the workflow input does not remove an earlier deployment or cron trigger.

## 6. Move existing posts, if needed

The original SQLite file is not uploaded or committed. On the machine holding that database, pause editorial writes, back up, and export:

```bash
npm run db:backup -- data/backups/before-cloudflare.sqlite
npm run cf:export
npx wrangler d1 execute nounarchive --remote --file data/cloudflare-export.sql
```

This private export may include drafts. It preserves existing D1 rows, excludes credentials/sessions, and must stay out of Git. Confirm article/post counts and a sample of published and draft records before switching traffic. Skip this step for a fresh installation.

## 7. Verify production

- `/api/health` returns `{"ok":true,"database":"d1"}` only after all required D1 tables exist; it returns HTTP 503 if a migration is missing.
- `/` loads the feed and can search/filter updates.
- `/admin.html` signs in with your chosen password.
- Save a draft: it must not appear in the public feed or direct public article API.
- Publish it: it should appear in the feed and open as a full article.
- Sign out: admin API access must return 401.
- After the daily Cron Trigger runs, inspect source health and last-success times.
- Add your custom domain and verify HTTPS and login cookies.

External source ingestion, especially NOUN Update's dynamic listing, still needs live-host verification. A passing deployment health check does not imply all three sources are reachable. Choose a Cloudflare plan/CPU allowance appropriate for feed parsing and password hashing, and monitor errors and D1 usage.

For architecture, local edge preview, backups and operational details, see [cloudflare/DEPLOYMENT.md](cloudflare/DEPLOYMENT.md).

## Cloudflare dashboard build failure: invalid D1 ID (10021)

For dashboard-connected Workers Builds, add a **build variable** named `D1_DATABASE_ID` containing the actual D1 database UUID and set the deploy command to **`npm run cf:deploy`**, not `npx wrangler deploy`. The npm script injects the ID before deploying. Apply the remote migrations before using the site. See [the detailed error-10021 checklist](cloudflare/DEPLOYMENT.md#workers-builds-dashboard-resolving-d1-error-10021).

## Consolidated production deployment

The deployment workflow runs automatically after changes merge into `main`, deploying the complete Worker. Manual runs also deploy from `main` and can select Worker or Pages. The GitHub `production` environment must allow `main` and contain the required Cloudflare secrets and `D1_DATABASE_ID` variable. Pages remains a manual alternative; deploy only one collector against a production D1 database.

## GitHub Actions ownership policy

The supported CI and deployment workflows intentionally use **no `uses:` action references**. They fetch the exact event commit as a GitHub API source archive using the workflow's read-only `github.token`, then use a compatible Node.js version from the runner tool cache or bootstrap the exact `.nvmrc` Linux x64 runtime from npm when no suitable version is cached. This avoids third-party action ownership requirements without weakening the repository's action policy. The manual deployment trigger uses the runner's preinstalled GitHub CLI.

If actions are added later, they must come from a repository owned by `klevsconceptz-gif` and be pinned to a full 40-character commit SHA. Do not reintroduce external `actions/checkout` or `actions/setup-node` references unless the repository/organization policy is changed to allow them.

The current workflows need no action-owner approval. Workflow-dispatch permission is independent of the action allowlist and is not changed by these workflow files.

## Repository-level admin password hash

The deployment workflow accepts a GitHub **repository secret named `Admin_password_hash`**, not only the older Cloudflare-specific secret name. Set it under **Repository Settings → Secrets and variables → Actions → New repository secret**. Use the complete PBKDF2 hash generated by `npm run cf:admin-hash`; enter your existing admin password when generating it if you want to retain that password. Never commit the hash to a repository file, use a repository variable for it, or substitute a recovery token.

Every validation and Worker/Pages deployment step uses the same precedence: `secrets.Admin_password_hash || secrets.CLOUDFLARE_ADMIN_PASSWORD_HASH`. The generic name takes priority when nonempty; the Cloudflare-prefixed name remains a compatibility fallback. An invalid nonempty generic hash fails validation rather than silently using a different password. GitHub environment secrets of the same name override repository secrets, so remove or correct any stale `ADMIN_PASSWORD_HASH` in the `production` environment if you intend the repository value to be used.

This adds repository-secret support; it does not set an actual secret or change the password. The app's runtime secret is still named `ADMIN_PASSWORD_HASH`, and Node's existing local credential configuration is unchanged. GitHub's action-ownership approval and workflow-dispatch permission remain independent requirements.

GitHub secret names are case-insensitive and may be stored/displayed in uppercase: `Admin_password_hash` refers to the same GitHub secret as `ADMIN_PASSWORD_HASH`. The workflow maps it into the case-sensitive runtime environment variable `ADMIN_PASSWORD_HASH`; do not rename that application variable. No `Admin_password_harsh` secret is used.
