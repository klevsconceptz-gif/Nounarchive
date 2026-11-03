# Deploy through GitHub Actions, including the admin panel

## What gets deployed

**Choose `worker` for the simplest complete deployment.** The Worker serves the public website, `/admin.html`, article pages and API. Cloudflare D1 holds drafts, published posts, imported news and admin sessions. Cron checks news sources hourly. No separate admin hosting is necessary.

The admin panel supports password login, creating/editing updates, categories, summaries, plain-text previews, drafts, publishing, unpublishing and deletion. There is one admin role/password, not public admin registration. Uploaded images and multi-user accounts are not part of this build.

## 1. Replace the exposed token

Revoke the token previously posted in chat. Generate a replacement Cloudflare API token scoped to your account with Workers Scripts Edit and D1 Edit permissions (Pages Edit too if using Pages). Add only discovery/read permissions requested by Wrangler. Never paste the token into chat or commit it.

## 2. Create production D1

In Cloudflare, open **Storage & databases → D1 → Create database**. Name it `nounarchive`. Copy its **Database ID**, a UUID. This is not the account ID, database name, or API token.

The GitHub workflow will inject the ID and apply `cloudflare/migrations/0001_initial.sql` before deploying. It does not create the remote database itself. Existing local posts require the optional export/import procedure in `DEPLOYMENT.md`.

## 3. Generate the single admin password hash

From your project terminal with Node 22.22.3+:

```sh
npm ci
npm run cf:admin-hash
```

Enter and confirm a strong password when prompted. Keep this password for signing into `/admin.html`. Copy the complete generated hash beginning with `pbkdf2-sha256$100000$`.

**The password is for the login screen; the hash is only for secret configuration.** No username or second password is required.

## 4. Configure GitHub's production environment

Repository: `klevsconceptz-gif/Nounarchive`.

Go to **Settings → Environments → New environment**, name it `production`, and allow deployment from **arena/1ab57b0b-nounarchive**. Optional: require reviewer approval.

Add these environment secrets:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Replacement Cloudflare token |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_ADMIN_PASSWORD_HASH` | Complete generated admin hash; no surrounding quotes |

Add this environment variable:

| Variable | Value |
|---|---|
| `D1_DATABASE_ID` | Real UUID of the `nounarchive` D1 database |

These are **GitHub Actions environment settings**. Dashboard Workers Builds variables are separate and are not needed when deploying with this workflow. Never put secrets into the code or frontend settings.

## 5. Publish the workflow changes

The fix must be committed/pushed on `arena/1ab57b0b-nounarchive`. The workflow file generally also needs to exist on GitHub's default branch to appear in the Actions manual-run UI; review and merge a pull request with the changes if necessary. Do not switch or rename the active branch.

The deployment job explicitly requires and checks out `arena/1ab57b0b-nounarchive`. Run it on that branch; choosing `main` will skip this branch-restricted deployment. CI tests both Worker and Pages bundles with local D1, including admin authentication, CSRF enforcement, draft privacy, publishing, deletion and logout.

## 6. Run the deployment

Open **Actions → Deploy to Cloudflare → Run workflow**:

- Branch: **arena/1ab57b0b-nounarchive**
- Target: **worker**

Approve the `production` environment if prompted. The job:

1. Installs dependencies and tests the app.
2. Validates all required secrets and the admin hash format.
3. Replaces the D1 placeholder with the real ID.
4. Exports a temporary database backup and applies pending D1 migrations.
5. Deploys the full Worker with static assets and hourly cron.
6. Installs `ADMIN_PASSWORD_HASH` as a Worker secret.

A workflow is successful only when all steps succeed. The default database backup stays on the temporary CI runner, so configure durable backups separately. Review the deploy log for the resulting Worker URL. If using a custom domain rather than workers.dev, use that address.

For **Pages**, create the `nounarchive` Pages project first with production branch `arena/1ab57b0b-nounarchive` (see the main deployment guide), then select `pages`. The workflow sets the Pages admin secret before deploying and deploys the standalone cron Worker. Disable any previously deployed full Worker cron to avoid duplicate collectors.

## 7. Confirm the admin panel is functional

At the deployed address:

1. Open `/api/health`; it should return `{"ok":true,"database":"d1"}`.
2. Open `/admin.html` and enter the **original password**, not the hash.
3. Create a post titled “Admin deployment check” with at least 20 characters of article text. Save it as a **draft**.
4. Refresh the admin page: the draft should remain. It must not appear in the public feed.
5. Change visibility to **Published** and save. Open the public site: the post should appear under **Nounarchive**, with a working full article page.
6. Edit and save it; verify the updated text on the article page.
7. Delete the test post; it should disappear from the public site.
8. Sign out. Opening the admin API `/api/admin/posts` must return 401.

Passing local tests confirms implementation behavior; this checklist confirms your production database and secrets are configured correctly. No default admin password is included.

## Troubleshooting

| Symptom | Action |
|---|---|
| D1 error 10021 / invalid `database_id` | Check GitHub `production` variable `D1_DATABASE_ID`; it must be a real D1 UUID in the token's account. Run the workflow, not a direct unconfigured `wrangler deploy`. |
| Job skipped | Run on `arena/1ab57b0b-nounarchive`; permit this branch in environment rules. |
| Missing setting | Check environment secret/variable names exactly, including `CLOUDFLARE_ADMIN_PASSWORD_HASH`. |
| Invalid hash format | Regenerate with `cf:admin-hash`; store the entire output hash without quotes or whitespace. |
| Admin says not configured | Confirm the final secret-install step succeeded on the same Worker/Pages project that serves the URL. |
| Incorrect password | Use the original password. To reset, generate a new hash, update the GitHub secret and rerun deployment. |
| Too many attempts | Wait 15 minutes; repeated login failures trigger throttling. |
| Database table missing | Inspect the migration step; apply migrations to the bound D1 instance. |
| Workflow not listed | Ensure the workflow file exists on the default branch, then manually select the active branch. |
| Source unavailable | Check source status independently of admin deployment; live ingestion still needs source-host verification. |

Nothing in this guide provisions or deploys resources automatically until you explicitly run the authorized workflow.
