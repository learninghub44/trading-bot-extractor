-- Run this SQL yourself in your dedicated Supabase project.
-- This is a schema blueprint; adapt provider-specific payment fields as needed.

create extension if not exists pgcrypto;

create table if not exists public.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  source_url text,
  source_type text,
  status text not null default 'CREATED',
  payment_status text not null default 'PENDING',
  price_kes integer not null default 100,
  filename text,
  result_key text,
  error_code text,
  error_message text,
  adapter text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.extraction_jobs(id) on delete set null,
  provider text not null,
  provider_reference text,
  amount_kes integer not null,
  status text not null default 'PENDING',
  raw_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.extraction_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.extraction_jobs(id) on delete cascade,
  adapter text not null,
  strategy text not null,
  status text not null,
  duration_ms integer,
  error_code text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.download_tokens (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.extraction_jobs(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, event_key)
);

create index if not exists extraction_jobs_status_idx on public.extraction_jobs(status, created_at desc);
create index if not exists extraction_attempts_job_idx on public.extraction_attempts(job_id, created_at desc);
create index if not exists payments_reference_idx on public.payments(provider, provider_reference);
