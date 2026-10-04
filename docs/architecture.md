# Architecture

## Runtime flow

Browser → Worker (Next.js API) → PayHero → signed webhook → job rows in Supabase → in-Worker extraction engine (inline via waitUntil, retried by Cron) → XML validator → Postgres (result_xml) → download streamed by the Worker.

## Planned production modules

- Web application
- API layer
- Extraction worker
- Source adapter registry
- Canonical bot model
- XML parser/generator/validator
- Payment provider abstraction
- Job persistence
- Object storage abstraction
- Bulk job orchestration
- Security controls
- Observability

## Extraction policy

Adapters may use direct public downloads, public APIs, HTML/JSON inspection, embedded page data, browser rendering, public repositories, user-uploaded files, and documented source-specific formats.

Adapters must not bypass authentication, encryption, CAPTCHA, DRM, paywalls, access controls, rate limits, or private/internal network boundaries.

## Job lifecycle

CREATED → PAYMENT_PENDING → PAID → QUEUED → EXTRACTING → PARSING → NORMALIZING → GENERATING → VALIDATING → COMPLETED

Failure states are explicit and must never produce a fake or invented bot.
