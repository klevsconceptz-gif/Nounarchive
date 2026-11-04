# Owner-assisted admin password recovery

The **Reset password** button at `/admin.html` accepts a 15-minute, single-use recovery token. It does not send email and does not allow anonymous visitors to obtain a token. Only the hosting owner can enable recovery by configuring a private runtime secret. No default password or recovery key exists.

## Deploy once before using this feature

Deploy the updated application and apply `cloudflare/migrations/0002_admin_recovery.sql` to the existing D1 database. The normal GitHub deployment workflow applies pending migrations before deployment. For a CLI deployment, use the configured account and run `npm run cf:db:remote` before publishing. Node automatically creates the local SQLite recovery tables at startup.

This feature is not available on an older deployment just by adding a secret. The deployment workflow still requires a correctly formatted `CLOUDFLARE_ADMIN_PASSWORD_HASH` in GitHub's `production` environment. Fix that existing setting before deploying this update; do not remove the validation.

## Recover access

1. In a **trusted interactive local terminal**, with Node 22.22.3+, run:
   ```sh
   npm ci
   npm run admin:recovery-token
   ```
2. The command displays **two different values**:
   - An `expiry$token-digest` value: configure this as **`ADMIN_RESET_TOKEN_HASH`** in the private **runtime secrets** of the exact app/environment serving your admin page.
   - A separate 64-character **raw recovery token**: enter this only in the reset form. It is not the runtime secret and is never put in a URL.
3. For a **Worker**, use Cloudflare → Workers & Pages → your Worker → Settings → Variables and Secrets → add an encrypted secret named `ADMIN_RESET_TOKEN_HASH`, then save/deploy. Alternatively, from the project terminal:
   ```sh
   npx wrangler secret put ADMIN_RESET_TOKEN_HASH
   ```
   Paste only the `expiry$token-digest` when prompted. Never include a secret as a command argument.
4. For **Pages**, configure that secret in the correct Production or Preview environment and create a new deployment for that environment. Alternatively:
   ```sh
   npx wrangler pages secret put ADMIN_RESET_TOKEN_HASH --project-name nounarchive
   ```
   Then deploy Pages. For **Node**, set `ADMIN_RESET_TOKEN_HASH` in the server's private environment and restart the server. Do not put these credentials in public files or GitHub build output.
5. Within 15 minutes of generation, open `/admin.html`, choose **Reset password**, paste the **raw token**, and enter/confirm a new password (12–1024 characters).
6. Sign in with the **new password**. All previous sessions are invalidated. Delete `ADMIN_RESET_TOKEN_HASH` from the hosting environment after success; redeploy/restart if required by that hosting platform.

If deployment/setup takes more than 15 minutes, generate a fresh token and replace the secret. A used token cannot be replayed, even after app restart. A fresh token must be generated for each recovery. Recovery is rate-limited to five submissions per IP per 15 minutes; login and recovery have separate counters. Missing, invalid, expired, or consumed tokens cannot change a password. Cloudflare uses its trusted connecting-IP header; Node keys limits by the direct socket address (a reverse proxy may therefore share a limit across users). Recovery must be used over HTTPS outside local development.

## Credential storage and future deployments

New credentials are PBKDF2-SHA256 hashes with unique random salts, persisted in the existing private D1/SQLite database. Raw passwords and raw recovery tokens are not stored. Token digests are consumed atomically alongside credential updates. Do not delete/recreate D1 or the local database during deployment.

The reset credential takes precedence over the original configured password **only while the original credential configuration remains unchanged**. Normal redeployments using the same `ADMIN_PASSWORD_HASH` retain the reset password. Deliberately changing the original Worker/Pages `ADMIN_PASSWORD_HASH` invalidates the database override and old sessions, making the newly configured operator credential authoritative. Node behaves similarly when `ADMIN_PASSWORD` or the file produced by `admin:setup` changes. This leaves hosting owners an out-of-band recovery path.

A recovery token can also bootstrap a missing runtime password if the new code and recovery tables are already deployed. Do not use this as a substitute for fixing GitHub's deployment-secret validation.

Never share passwords, raw tokens, generated hashes, or secret values in chat, screenshots, logs, issues, or pull requests. The command refuses redirected/noninteractive output to reduce accidental leakage. Treat database backups as sensitive, and keep ownership of the hosting account secure: someone who controls runtime secrets already controls admin recovery.
