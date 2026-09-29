# Trading Bot Extractor

Production-oriented platform for extracting supported trading bot XML from public or user-authorized sources.

## Core flow

URL/file → extraction strategies → bot detection → XML validation → private download

The system must never bypass authentication, encryption, CAPTCHA, DRM, paywalls, access controls, or private/internal network protections.

## Structure

- `apps/web` — Next.js web application
- `services/extractor` — Python extraction service
- `packages/shared` — shared TypeScript types
- `infra` — deployment and local infrastructure

## Development

Web:
```bash
npm install
npm run dev
```

Extractor:
```bash
cd services/extractor
python -m venv .venv
# activate the environment, then:
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Required production integrations are configured through environment variables. No credentials are committed.
