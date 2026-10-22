# Whale Trades security rollout

Prepared 22 October 2026. These changes must be previewed and the caller must be
configured before merging into `main`. Production is not fixed until that rollout
has completed and been verified.

## Changes

- Require `Authorization: Bearer <secret>` for POST requests to `/api/analyze-pnl`.
  Configure a random secret of at least 32 characters as `ANALYZE_PNL_SECRET` in
  Vercel. Never put the secret in Webflow, client-side JavaScript, GitHub, URLs, or
  this document. Missing configuration fails closed with HTTP 401.
- Preserve public GET health responses and CORS preflight. Preserve the successful
  analysis response format and the Zapier string, CSV, object and array inputs.
- Accept up to 100 HTTPS image URLs per request and reserve a shared atomic Redis
  budget of 200 images per clock hour. Redis unavailability returns HTTP 503;
  exhausted budget returns HTTP 429. Confirm these limits against recent real
  Zap runs before production rollout. Signed Discord attachment URLs are supported.
- Remove image URLs, submitted names, model responses, stack traces and private
  upstream errors from analysis logs/responses.
- Return HTTP 404 and `Cache-Control: no-store` for both `debug-env` and
  `api-usage-debug`, without changing public market-data responses.
- Lock the existing dependency ranges. The installed lockfile was audited with no
  known vulnerabilities reported at preparation time.
- Log `runtime-security-check` on cold starts of the data and analysis functions.
  The log contains the actual Node version, patch comparison and deployment SHA;
  it contains no credentials.
- Fail the deployment build on versions below 22.23.4, 24.22.1, or 26.12.1, or
  unsupported major versions. Target Node 24 in this security branch because
  three Node 22 previews built on 22.23.4 but actually ran 22.23.2. Node 24 must
  report at least 24.22.1 in actual runtime logs before any production rollout.
- Run the regression checks during Vercel builds.

## Required coordinated sequence

1. Publish a separate security branch and open a PR. Leave `main` running.
2. Enable Dependabot vulnerability alerts in GitHub. Leave secret scanning enabled.
3. Build a Vercel Preview and confirm the runtime build check and regression tests
   pass. If the managed runtime is below the required patch, stop and ask Vercel
   to confirm/update its rollout; do not weaken the check to obtain a green build.
4. The account owner must enter and save the same new secret in Vercel (Production
   and Preview for `whale-trades`) and in the Authorization header of Zapier
   `Trade of the Day V2`, step 5, POST. The existing URL is
   `https://whale-trades.vercel.app/api/analyze-pnl`. Keep all body mappings intact.
   If desired, publish the Zap header first: the old endpoint ignores the header.
   This avoids the auth-enforcement window breaking the daily update.
5. Verify a recent Zap run's image count is within the selected limit. Keep draft
   changes separate until the owner finishes saving the credential.
6. Verify the preview: unauthenticated POST returns 401; both diagnostic types
   return 404; normal market data works; actual runtime logs show a patched Node
   version. Do not disclose keys or use a public diagnostic route to verify Node.
7. After the caller is configured, merge and verify production routes and runtime
   logs again. Test the analysis request with a small known sample through Zapier,
   without rerunning downstream steps that publish or overwrite trade content.
8. Confirm Webflow dashboard widgets and the existing daily automation work.

## Firewall and secondary widget

The inspected Vercel rule bypasses checks only for `/api/data`, the public
market-data endpoint used by Webflow. It does not authenticate analysis. Do not
remove it blindly: bot challenges can interrupt browser chart requests. This
patch leaves it unchanged while removing both diagnostic modes.

The public FOMO widget repository is a Vite/React static frontend. Its source does
not establish a live Node server. Confirm its deployed resource list separately
if claiming coverage of every server associated with the website.

## Rollback

Record the current production deployment before merging. If regression occurs,
use Vercel Instant Rollback to the previous deployment, then investigate in the
preview. The added Zapier header is harmless to the previous code. Rolling back
also restores the old vulnerabilities, so keep that interval brief.

## Validation performed locally

Nine automated checks pass, covering authentication, rejected input without paid
calls, supported Zapier formats, author mapping, banned authors, shared budget
requests, storage failure behavior, diagnostic removal, unchanged cached market
data, sanitized errors and Node patch comparisons. The OpenAI and Redis SDK
interfaces were checked using non-network dummy configuration. These checks do
not substitute for the required Vercel preview and production verification.
