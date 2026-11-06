# Nounarchive pre-deployment code review

**Reviewed:** 2026-11-06  
**Checkout:** `53619a9b1f670eb2624dbb66ee34af823dbfade9`  
**Working branch:** `arena/bd047e2b-nounarchive`  
**Recommendation:** resolve the release-workflow and readiness issues below before relying on unattended production deployment. No application code, passwords, secrets, database migrations in production, or deployment settings were changed during this review.

## Findings, highest priority first

### 1. High — additional CI templates conflict with the application's runtime and build system

**Locations:** `.github/workflows/node.js.yml:19-31`, `.github/workflows/webpack.yml:15-28`, `.github/workflows/npm-publish-github-packages.yml:17-34`; compare `package.json:4,36-43`.

The application requires Node >=22.22.3 and uses `node:sqlite`. The extra Node CI and Webpack templates run Node 18 and 20 as well. The Webpack job calls `npx webpack`, although the repository has no Webpack dependency, configuration, or `src` entry; it is a directly served Node/Workers/Pages application. The release template also uses Node 20 and attempts `npm publish` even though the package is explicitly private and not configured as a GitHub Packages-scoped distributable.

**Impact:** incompatible and extraneous checks can fail otherwise valid changes, waste CI capacity, and confuse which check establishes release readiness. These are static configuration defects; they are not asserted to be the cause of the current Actions startup failures.

**Recommended correction:** consolidate around `ci.yml` and the supported Node runtime. Remove or manually disable the unrelated templates rather than introducing Webpack or making the application publishable solely to satisfy them. Keep package `private: true`.

### 2. High — the GitHub Pages/Jekyll workflow cannot deploy the functional application

**Location:** `.github/workflows/jekyll-gh-pages.yml:33-50` (repository-root Jekyll build and GitHub Pages deployment).

The app depends on `/api/archive`, authenticated admin routes, and SQLite/D1. A Jekyll-generated GitHub Pages site cannot execute those services. The workflow builds the repository root, not the staged Cloudflare Pages artifact.

**Impact:** another publicly presented deployment target may have broken news, assets or admin functionality even if its publishing job succeeds. This is distinct from **Cloudflare Pages**, which has a proper Worker artifact and D1-backed API.

**Recommended correction:** disable/remove the unrelated Jekyll release workflow unless a separate documentation site is intended. Choose a primary functional deployment: full Cloudflare Worker, or Cloudflare Pages plus its dedicated scheduler. If documentation hosting is desired, isolate its source and label it clearly.

### 3. Medium — the health endpoint gives a false readiness signal before migrations

**Locations:** `cloudflare/api.js:26-28` and `cloudflare/api.js:13-16`.

`/api/health` executes only `SELECT 1`. This verifies a reachable D1 binding but not the tables needed by news, login or recovery.

**Reproduced against the built Worker with a real local Miniflare/D1 runtime and an empty database:**

| Request | Result |
|---|---|
| `/api/health` | 200 |
| `/api/archive` | 500 (`no such table: articles`) |

**Recommended correction:** keep a lightweight liveness check if wanted, but add a schema-aware readiness check for the required tables/migrations. Gate production verification on readiness, the archive endpoint and admin-session behavior, not just `/api/health`. Ensure migrations `0001_initial.sql` and `0002_admin_recovery.sql` run for any deployment path, including dashboard-driven Workers Builds; do not assume the successful dashboard build ran the GitHub migration step.

### 4. Medium — Worker code and admin secret are published in separate operations

**Location:** `.github/workflows/deploy-cloudflare.yml:55-63`.

The workflow deploys code first, then writes `ADMIN_PASSWORD_HASH`. If the second command fails, new application code can be live with an absent or stale admin credential while the workflow reports failure. On a first installation, this leaves admin access unconfigured.

**Recommended correction:** provision/validate runtime secret availability before routing traffic to a first deployment, or use a tested staged-version/secret release process. Add post-deploy checks for a configured admin runtime without logging or collecting credentials. Do not generate a replacement password automatically, remove hash validation, or put recovery tokens into `ADMIN_PASSWORD_HASH`.

### 5. Medium — the workflow's pre-migration SQL backup is temporary only

**Location:** `.github/workflows/deploy-cloudflare.yml:48-54`.

The export goes to `data/d1-backup.sql` on the ephemeral GitHub runner. Nothing in the workflow retains it after the job ends. This does not establish a recoverable workflow backup if a migration or deployment goes wrong. Independently configured Cloudflare recovery features may exist but were not inspected.

**Recommended correction:** establish and verify durable recovery (for example, appropriate Cloudflare D1 recovery retention and a restore procedure, or restricted encrypted backup storage). SQL exports can include private drafts and authentication records; do not publish them as public artifacts or commit them to Git. Exercise restoration before production schema changes.

## Additional improvements (not immediate release blockers)

- `cloudflare/api.js:28-31` returns the entire archive and all published originals, and the browser polls it every minute. Pagination currently limits rendered cards rather than database/network work. Introduce server-side filtering/pagination as the archive grows.
- Restrict deployment to the intended production branch. `.github/workflows/deploy-cloudflare.yml:20` still explicitly permits the obsolete `arena/bf9d8ef8-nounarchive` branch alongside `main`; its snapshots can be manually deployed if environment rules permit it. Update the associated test/docs together if changing this policy.
- Document which deployment owns the hourly cron. Worker and standalone scheduler configurations both specify `0 * * * *`; avoid deploying both collectors against the same production database unintentionally.
- Public admin HTML currently has no explicit `noindex` metadata. Add it as search hygiene; this is not a substitute for authentication.

## Validation actually completed

- `npm ci`: successful.
- `npm test`: **40/40 passed**.
- Cloudflare Worker dry-run: successful.
- Cloudflare Pages artifact build: successful.
- `npm audit`: **0 known vulnerabilities reported** for the installed lockfile.
- `git diff --check`: clean before adding this report.
- Tests exercise Node, Worker and Pages authentication, CSRF, draft visibility, publication/deletion, password recovery, token replay/concurrency, persistence, hourly configuration and frontend interactions.
- Additional runtime reproduction confirmed the missing-schema readiness issue above.

Passing these checks is not a full penetration test, real-device accessibility certification, successful live news import, production D1 migration verification, or production admin sign-in test.

## Current remote evidence

The latest Actions runs inspected for this checkout's commit report **`startup_failure`**, including:

- [Deploy to Cloudflare — 42303036420](https://github.com/klevsconceptz-gif/Nounarchive/actions/runs/42303036420)
- [Test application — 42303034333](https://github.com/klevsconceptz-gif/Nounarchive/actions/runs/42303034333)

These runs did not establish a passing release. Their startup-failure cause was not exposed by the inspected metadata; do not assume this is the old invalid-password-hash error, a workflow syntax error, or billing without checking the run annotations/settings.

**Separate Cloudflare evidence:** the commit's `Workers Builds: nounarchive` check reports **success**, build `e8583fac-494a-400e-8575-5e802873f369`, version `967f6d8e-434b-4ca4-a75d-591f04b50fac`. [Cloudflare build](https://dash.cloudflare.com/c92f85ff2938830c935680255a656359/workers/services/view/nounarchive/production/builds/e8583fac-494a-400e-8575-5e802873f369). This is newer evidence than earlier failed build checks, but it does not prove production schema, credentials, CRUD, live source connectivity or cron operation. No such authenticated production checks were performed here.

Secret values were not read or modified. The historical invalid `CLOUDFLARE_ADMIN_PASSWORD_HASH` must be validated through the secure deployment path; its current validity is unknown, not assumed fixed or still broken. Password hashes and owner recovery-token digests must remain separate settings.

## Release checklist

1. Consolidate workflows onto the actual application build/runtime and remove the unintended Jekyll deployment path.
2. Resolve the GitHub Actions startup failures and verify the expected production branch/environment rules.
3. Securely validate the existing admin password hash, Cloudflare token/account, and D1 UUID. Preserve the owner's chosen password.
4. Confirm durable recovery, then apply both D1 migrations against the correct production database.
5. Deploy through the chosen primary path with runtime secrets available; establish schema-aware readiness and post-deploy verification.
6. Verify homepage, resource directory, a genuine published original, admin login/logout, draft privacy, CSRF protection and sign-out after password reset. Use an owner-approved test record and clean it up.
7. Check real source-status timestamps and new imports after a scheduled hourly run; do not treat the 14 seeded headlines or a build success as proof of fresh imports.

**Scope of changes from this review:** this report only. Fixes have not been implemented, merged or deployed.
