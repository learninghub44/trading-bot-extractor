-- Trading Bot Extractor production schema
-- Run in the dedicated Supabase/Postgres project.

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  bulk_job_id uuid,
  product_code text not null,
  quantity integer not null check (quantity > 0 and quantity <= 100),
  amount_kes integer not null check (amount_kes >= 0),
  currency text not null default 'KES',
  status text not null default 'PAYMENT_PENDING',
  customer_phone text,
  customer_email text,
  source_url text,
  external_reference text not null unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  provider_reference text,
  amount_kes integer not null,
  status text not null default 'PENDING',
  raw_response jsonb,
  callback_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  source_url text,
  source_type text,
  status text not null default 'CREATED',
  payment_status text not null default 'PENDING',
  bot_name text,
  filename text,
  result_key text,
  result_sha256 text,
  result_size bigint,
  validation_status text,
  adapter text,
  attempts integer not null default 0,
  error_code text,
  error_message text,
  worker_id text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
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

create table if not exists public.bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  product_code text not null,
  quantity integer not null,
  amount_kes integer not null,
  status text not null default 'PAYMENT_PENDING',
  zip_key text,
  manifest_key text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.bulk_items (
  id uuid primary key default gen_random_uuid(),
  bulk_job_id uuid not null references public.bulk_jobs(id) on delete cascade,
  position integer not null,
  source_url text not null,
  status text not null default 'WAITING_FOR_PAYMENT',
  extraction_job_id uuid references public.extraction_jobs(id) on delete set null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  unique(bulk_job_id, position)
);

create table if not exists public.download_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.extraction_jobs(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.download_tokens (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.extraction_jobs(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  max_downloads integer not null default 3,
  download_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null,
  payload jsonb not null,
  payload_hash text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, event_key)
);

create table if not exists public.system_health (
  name text primary key,
  status text not null default 'ok',
  metadata jsonb,
  checked_at timestamptz not null default now()
);

alter table public.orders drop constraint if exists orders_bulk_job_id_fkey;
alter table public.orders add constraint orders_bulk_job_id_fkey foreign key (bulk_job_id) references public.bulk_jobs(id) on delete set null;
create index if not exists orders_bulk_job_idx on public.orders(bulk_job_id);

create index if not exists extraction_jobs_status_lease_idx on public.extraction_jobs(status, lease_until);
create index if not exists extraction_jobs_order_idx on public.extraction_jobs(order_id);
create index if not exists extraction_attempts_job_idx on public.extraction_attempts(job_id, created_at desc);
create index if not exists payments_order_idx on public.payments(order_id, created_at desc);
create index if not exists webhook_events_provider_idx on public.webhook_events(provider, event_key);

create or replace function public.claim_extraction_jobs(p_worker_id text, p_limit integer default 5)
returns setof public.extraction_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.extraction_jobs
    where
      (status = 'PAID' or (status = 'EXTRACTING' and lease_until < now()))
      and (lease_until is null or lease_until < now())
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 20))
  )
  update public.extraction_jobs j
  set status='EXTRACTING',
      worker_id=p_worker_id,
      lease_until=now() + interval '3 minutes',
      attempts=j.attempts + 1,
      started_at=coalesce(j.started_at, now()),
      updated_at=now()
  from candidates c
  where j.id=c.id
  returning j.*;
end;
$$;

create or replace function public.touch_extraction_job(p_id uuid, p_worker_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.extraction_jobs
  set lease_until=now()+interval '3 minutes', updated_at=now()
  where id=p_id and worker_id=p_worker_id and status='EXTRACTING';
$$;

create or replace function public.complete_extraction_job(
  p_id uuid, p_worker_id text, p_status text, p_result_key text default null,
  p_filename text default null, p_bot_name text default null,
  p_sha256 text default null, p_size bigint default null,
  p_error_code text default null, p_error_message text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.extraction_jobs
  set status=p_status,
      result_key=p_result_key,
      filename=p_filename,
      bot_name=p_bot_name,
      result_sha256=p_sha256,
      result_size=p_size,
      validation_status=case when p_status='COMPLETED' then 'VALID' else 'INVALID' end,
      error_code=p_error_code,
      error_message=p_error_message,
      lease_until=null,
      completed_at=case when p_status in ('COMPLETED','FAILED','CANCELLED') then now() else completed_at end,
      updated_at=now()
  where id=p_id and worker_id=p_worker_id;
$$;

-- Exposed tables are locked down. The server/worker uses the service role.
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.extraction_jobs enable row level security;
alter table public.extraction_attempts enable row level security;
alter table public.bulk_jobs enable row level security;
alter table public.bulk_items enable row level security;
alter table public.download_events enable row level security;
alter table public.download_tokens enable row level security;
alter table public.webhook_events enable row level security;
alter table public.system_health enable row level security;

-- No anon/authenticated policies are created intentionally.
-- Add narrowly scoped auth.uid() policies only if direct client-side table access is ever introduced.
