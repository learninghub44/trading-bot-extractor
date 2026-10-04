# Trading Bot Extractor

Production-oriented SaaS for extracting supported trading bot XML from public or user-authorized sources. Runs entirely on Cloudflare Workers.

## Production architecture (Cloudflare Workers)

One Worker (Next.js via OpenNext) serves the UI/API **and** runs extraction. No servers, no Python, no containers.

- Next.js web/API on Cloudflare Workers (`@opennextjs/cloudflare`)
- Supabase/Postgres for orders, payments, jobs, attempts, bulk jobs and webhook audit
- TypeScript extraction engine in the Worker (`lib/engine`) — SSRF-safe fetch, XML validation, strategy chain
- Results are kept in Supabase Postgres (`extraction_jobs.result_xml`) until collected, then purged after 30 days; downloads stream through the Worker to the buyer's browser, and bulk ZIPs are built on demand
- Cron Trigger (every minute) drives retries and heals anything the webhook missed
- Optional Cloudflare Browser Rendering (REST) for JavaScript-rendered pages
- PayHero Kenya (M-Pesa STK Push) for payment collection

## After payment: what happens

1. PayHero calls the signed webhook (`response.ResultCode = 0` means paid). If the callback is lost or late, the payment-return page and the cron ask PayHero's `transaction-status` endpoint, so the buyer is never stuck. The order moves `PAYMENT_PENDING → PAID` atomically (duplicates and retries are harmless).
2. Jobs are created idempotently (job id = order / bulk item id) and an extraction run starts immediately via `waitUntil`.
3. Jobs are claimed with row locks + 3-minute leases. Transient failures (timeouts, 429/5xx, network) retry with backoff up to `MAX_JOB_ATTEMPTS`; "no bot found" on the fast pass is retried once with browser rendering; permanent errors (404, blocked destination) fail immediately with a clear code.
4. The every-minute cron re-claims expired leases, retries delayed jobs, and creates jobs for PAID orders that somehow have none.
5. The payment-return page polls `/api/orders/:id` and offers the download as soon as the job completes. If extraction fails, the buyer can upload the bot file against the same paid order (`/api/uploads`) — failed jobs don't consume the quota.

## Extraction pipeline

Strategy chain (cheap → expensive) under one fetch/time budget: public share-link rewrites (Google Drive/Docs, Dropbox, GitHub, Gist, Pastebin, GitLab) → the URL itself (raw XML, JSON, HTML, ZIP) → XML hidden as escaped JSON/JS strings, HTML-entity text, URL-encoded text, base64, `<script>` JSON blobs → best-scored linked files up to two levels deep → browser rendering. Every candidate must be well-formed, DTD/entity-free and bot-shaped (Blockly/Deriv Bot Builder or bot/strategy schemas) before it is accepted. The original document is delivered unchanged; missing trading logic is never invented.

The platform does not bypass authentication, encryption, CAPTCHA, DRM, paywalls, access controls, rate limits, or private/internal network boundaries.

## Payment lifecycle

Order -> PayHero request -> verified server callback -> paid order -> extraction job -> validated XML saved in Postgres -> streamed to the buyer's browser.

The browser is never trusted as proof of payment. Webhook events are idempotent.

## Security

- SSRF destination and redirect validation
- HTTP(S)-only remote sources
- private/loopback/link-local/reserved/multicast destination blocking
- response and upload size limits
- redirect limits and request timeouts
- safe XML parsing with external entities and network access disabled
- results stored privately in Postgres, served only to the order's owner, and purged after 30 days
- guest access bound to an HTTP-only order token
- Supabase RLS enabled on application tables
- service-role credentials remain server-side

## Setup & deploy (Cloudflare)

Requires a Workers **Paid** plan (the bundle exceeds the free size limit and extraction makes many subrequests). No file storage to set up: Supabase holds everything.

    npm install
    # run docs/database.sql in your Supabase project (once)

    # secrets (each prompts for the value)
    npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
    npx wrangler secret put PAYHERO_API_USERNAME
    npx wrangler secret put PAYHERO_API_PASSWORD
    # PAYHERO_CHANNEL_ID (number) is a plain variable, from PayHero → Payment Channels
    npx wrangler secret put PAYHERO_WEBHOOK_SECRET             # openssl rand -hex 32
    npx wrangler secret put CF_BROWSER_RENDERING_TOKEN         # optional, enables browser strategy

Set the non-secret vars from `.env.example` (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `PAYHERO_CHANNEL_ID`, `PAYHERO_PROVIDER`, `CF_ACCOUNT_ID`) in the Worker's settings or `wrangler.jsonc`. `NEXT_PUBLIC_*` must also be present in the build environment.

    npm run deploy        # build with OpenNext + wrangler deploy
    npm run preview       # local Workers runtime (uses .dev.vars)
    npm run cf:check      # build + `wrangler deploy --dry-run`, no credentials needed

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and `cf:check`. `deploy.yml` is a manual deploy using `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets. Hit `/api/health` after deploy: it reports the database and any missing settings.

Before going live: test a real payment end to end (check the logs for `[payhero webhook]` and `unrecognised PayHero status` — the transaction-status response format isn't published, so the first real payment confirms it), a failed payment, a duplicate callback, an extraction that needs a retry, and a bulk ZIP.
