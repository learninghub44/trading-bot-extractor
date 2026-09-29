# Trading Bot Extractor

Production-oriented SaaS for extracting supported trading bot XML from public or user-authorized sources.

## Production architecture

- Next.js web/API layer
- Supabase/Postgres for orders, payments, jobs, attempts, bulk jobs and webhook idempotency
- Python/FastAPI extraction engine
- Playwright/Chromium for browser-rendered public pages
- Cloudflare R2 private object storage
- PayHero Africa for Kenyan payment collection
- Long-running worker with database-backed job claiming and leases
- Signed temporary downloads
- Bulk ZIP + CSV manifest generation
- GitHub Actions CI
- Docker deployment

## Extraction pipeline

The engine tries direct XML, downloadable links, embedded XML, embedded JSON, public page data, browser-rendered pages, source-specific adapters and uploaded supported XML files as applicable. Every candidate is validated before it becomes a result. Missing trading logic is never invented.

The platform does not bypass authentication, encryption, CAPTCHA, DRM, paywalls, access controls, rate limits, or private/internal network boundaries.

## Payment lifecycle

Order -> PayHero request -> verified server callback -> paid order -> extraction job -> validated XML -> private R2 object -> short-lived signed download.

The browser is never trusted as proof of payment. Webhook events are idempotent.

## Security

- SSRF destination and redirect validation
- HTTP(S)-only remote sources
- private/loopback/link-local/reserved/multicast destination blocking
- response and upload size limits
- redirect limits and request timeouts
- safe XML parsing with external entities and network access disabled
- private R2 objects and short-lived signed URLs
- guest access bound to an HTTP-only order token
- Supabase RLS enabled on application tables
- service-role credentials remain server-side

## Setup

Copy .env.example to .env. Configure Supabase, R2, PayHero, the public site URL and the extractor shared secret. Run docs/database.sql in the dedicated Supabase project.

### Web

    npm install
    npm run typecheck
    npm run lint
    npm run build
    npm start

### Extraction service

    cd services/extractor
    python -m venv .venv
    pip install -r requirements.txt
    playwright install chromium
    uvicorn app.main:app --host 0.0.0.0 --port 8000

### Worker

    cd services/extractor
    python -m app.worker

### Docker

    docker compose up --build

## Production checklist

Before going live: create a dedicated Supabase project; run and review docs/database.sql; create a private R2 bucket; configure PayHero credentials and enabled Kenya network configuration; configure the PayHero callback URL as /api/webhooks/payhero; configure the extractor secret; deploy web, extractor and worker; run CI; test successful and failed payment callbacks including duplicates; test extraction failures; test SSRF and XML security; test bulk ZIP generation; verify download expiry and ownership; configure logs, alerts, backups and retention.

## Pricing

Pricing is environment-configurable. Defaults: Single KES 100; 10 KES 900; 25 KES 2,000; 50 KES 3,750; 100 KES 7,000.

Do not commit credentials or production .env files.
