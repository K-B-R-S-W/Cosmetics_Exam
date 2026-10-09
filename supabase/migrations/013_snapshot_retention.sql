-- =====================================================================
-- 013_snapshot_retention.sql - durable 14-day snapshot retention queue.
-- Run after 012_grading_runtime.sql. Safe to re-run before any rollback.
-- =====================================================================

begin;

alter table public.violation_events
  add column if not exists snapshot_captured_at timestamptz;

-- Legacy rows do not record the real capture time. Start a fresh, conservative
-- 14-day retention window when this migration is applied rather than risk
-- deleting a TAB_HIDDEN snapshot too early from its incident occurred_at.
update public.violation_events
   set snapshot_captured_at = transaction_timestamp()
 where snapshot_path is not null
   and snapshot_captured_at is null;

create or replace function public.normalize_violation_snapshot_capture()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.snapshot_path is null then
    new.snapshot_captured_at := null;
  elsif tg_op = 'INSERT' then
    new.snapshot_captured_at := least(
      coalesce(new.snapshot_captured_at, clock_timestamp()),
      clock_timestamp()
    );
  elsif old.snapshot_path is null then
    -- An explicitly supplied timestamp is preserved for a documented rollback
    -- from snapshot_purge_queue, but neither inserts nor restores may put a
    -- capture time in the future. Ordinary null-to-path writes use capture time.
    new.snapshot_captured_at := least(
      coalesce(new.snapshot_captured_at, clock_timestamp()),
      clock_timestamp()
    );
  elsif new.snapshot_path is distinct from old.snapshot_path then
    new.snapshot_captured_at := clock_timestamp();
  elsif new.snapshot_captured_at is null then
    new.snapshot_captured_at := clock_timestamp();
  end if;
  return new;
end $$;

drop trigger if exists violation_snapshot_capture on public.violation_events;
create trigger violation_snapshot_capture
before insert or update of snapshot_path, snapshot_captured_at
on public.violation_events
for each row execute function public.normalize_violation_snapshot_capture();

alter table public.violation_events
  drop constraint if exists violation_events_snapshot_capture_all_or_none;
alter table public.violation_events
  add constraint violation_events_snapshot_capture_all_or_none check (
    num_nonnulls(snapshot_path, snapshot_captured_at) in (0, 2)
  );

create index if not exists idx_violation_events_snapshot_retention
  on public.violation_events (snapshot_captured_at, id)
  where snapshot_path is not null;

create table if not exists public.snapshot_purge_queue (
  event_id uuid primary key references public.violation_events (id) on delete cascade,
  snapshot_path text not null unique check (btrim(snapshot_path) <> ''),
  snapshot_captured_at timestamptz not null,
  queued_at timestamptz not null default clock_timestamp(),
  claim_token uuid,
  claimed_at timestamptz,
  constraint snapshot_purge_queue_claim_all_or_none check (
    num_nonnulls(claim_token, claimed_at) in (0, 2)
  )
);

alter table public.snapshot_purge_queue enable row level security;

create index if not exists idx_snapshot_purge_queue_unclaimed
  on public.snapshot_purge_queue (queued_at, event_id)
  where claim_token is null;
create index if not exists idx_snapshot_purge_queue_claimed
  on public.snapshot_purge_queue (claimed_at, event_id)
  where claim_token is not null;

-- Count both already-queued files and newly eligible event references. Exactly
-- 14 days old is retained; only a strictly older capture is eligible.
create or replace function public.preview_snapshot_purge(
  p_exam_id uuid default null
)
returns bigint
language sql
security invoker
set search_path = public, pg_temp
as $$
  select count(*)::bigint
    from (
      select q.event_id
        from public.snapshot_purge_queue q
        join public.violation_events ve on ve.id = q.event_id
        join public.attempts a on a.id = ve.attempt_id
        join public.exams e on e.id = a.exam_id
       where (p_exam_id is null or e.id = p_exam_id)
         and e.status in ('ended', 'finalized')
         and not exists (
           select 1 from public.attempts open_attempt
            where open_attempt.exam_id = e.id
              and open_attempt.status = 'in_progress'
         )
      union all
      select ve.id
        from public.violation_events ve
        join public.attempts a on a.id = ve.attempt_id
        join public.exams e on e.id = a.exam_id
       where ve.snapshot_path is not null
         and ve.snapshot_captured_at < transaction_timestamp() - interval '14 days'
         and (p_exam_id is null or e.id = p_exam_id)
         and e.status in ('ended', 'finalized')
         and not exists (
           select 1 from public.attempts open_attempt
            where open_attempt.exam_id = e.id
              and open_attempt.status = 'in_progress'
         )
         and not exists (
           select 1 from public.snapshot_purge_queue queued
            where queued.event_id = ve.id
         )
    ) eligible;
$$;

-- Claim queued work first, then stage old event references into the durable
-- queue. Claims are leased for ten minutes. Storage calls occur only after this
-- short transaction has committed, so no database locks span network I/O.
create or replace function public.claim_snapshot_purge_batch(
  p_claim_token uuid,
  p_batch_size integer default 100,
  p_exam_id uuid default null
)
returns table (
  out_event_id uuid,
  out_snapshot_path text,
  out_snapshot_captured_at timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := transaction_timestamp();
  v_claimed integer := 0;
  v_remaining integer;
begin
  if p_claim_token is null or p_batch_size not between 1 and 100 then
    raise exception 'validation_failed';
  end if;

  return query
  with claimable as (
    select q.event_id
      from public.snapshot_purge_queue q
      join public.violation_events ve on ve.id = q.event_id
      join public.attempts a on a.id = ve.attempt_id
      join public.exams e on e.id = a.exam_id
     where (q.claim_token is null or q.claimed_at <= v_now - interval '10 minutes')
       and (p_exam_id is null or e.id = p_exam_id)
       and e.status in ('ended', 'finalized')
       and not exists (
         select 1 from public.attempts open_attempt
          where open_attempt.exam_id = e.id
            and open_attempt.status = 'in_progress'
       )
     order by q.queued_at, q.event_id
     for update of q skip locked
     limit p_batch_size
  ), claimed as (
    update public.snapshot_purge_queue q
       set claim_token = p_claim_token,
           claimed_at = v_now
      from claimable c
     where q.event_id = c.event_id
    returning q.event_id, q.snapshot_path, q.snapshot_captured_at
  )
  select c.event_id, c.snapshot_path, c.snapshot_captured_at
    from claimed c
   order by c.snapshot_captured_at, c.event_id;
  get diagnostics v_claimed = row_count;

  v_remaining := p_batch_size - v_claimed;
  if v_remaining <= 0 then return; end if;

  return query
  with eligible as (
    select ve.id, ve.snapshot_path, ve.snapshot_captured_at
      from public.violation_events ve
      join public.attempts a on a.id = ve.attempt_id
      join public.exams e on e.id = a.exam_id
     where ve.snapshot_path is not null
       and ve.snapshot_captured_at < v_now - interval '14 days'
       and (p_exam_id is null or e.id = p_exam_id)
       and e.status in ('ended', 'finalized')
       and not exists (
         select 1 from public.attempts open_attempt
          where open_attempt.exam_id = e.id
            and open_attempt.status = 'in_progress'
       )
       and not exists (
         select 1 from public.snapshot_purge_queue queued
          where queued.event_id = ve.id
       )
     order by ve.snapshot_captured_at, ve.id
     for update of ve skip locked
     limit v_remaining
  ), staged as (
    insert into public.snapshot_purge_queue (
      event_id, snapshot_path, snapshot_captured_at,
      queued_at, claim_token, claimed_at
    )
    select id, snapshot_path, snapshot_captured_at,
           v_now, p_claim_token, v_now
      from eligible
    on conflict (event_id) do nothing
    returning event_id, snapshot_path, snapshot_captured_at
  ), detached as (
    update public.violation_events ve
       set snapshot_path = null,
           meta = jsonb_set(
             coalesce(ve.meta, '{}'::jsonb),
             '{snapshot_purge_queued_at}',
             to_jsonb(v_now),
             true
           )
      from staged s
     where ve.id = s.event_id
       and ve.snapshot_path = s.snapshot_path
    returning s.event_id, s.snapshot_path, s.snapshot_captured_at
  )
  select d.event_id, d.snapshot_path, d.snapshot_captured_at
    from detached d
   order by d.snapshot_captured_at, d.event_id;
end $$;

-- Commit only paths that Storage confirmed absent/removed. Partial failures
-- release their leases and remain durable for a later retry.
create or replace function public.finish_snapshot_purge_batch(
  p_claim_token uuid,
  p_deleted_event_ids uuid[] default '{}',
  p_failed_event_ids uuid[] default '{}'
)
returns table (out_deleted integer, out_released integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_deleted integer := 0;
  v_released integer := 0;
begin
  if p_claim_token is null then raise exception 'validation_failed'; end if;
  if coalesce(p_deleted_event_ids, '{}'::uuid[]) && coalesce(p_failed_event_ids, '{}'::uuid[]) then
    raise exception 'validation_failed';
  end if;

  update public.violation_events ve
     set meta = jsonb_set(
       coalesce(ve.meta, '{}'::jsonb) - 'snapshot_purge_queued_at',
       '{snapshot_deleted_at}',
       to_jsonb(v_now),
       true
     )
    from public.snapshot_purge_queue q
   where q.event_id = ve.id
     and q.claim_token = p_claim_token
     and q.event_id = any(coalesce(p_deleted_event_ids, '{}'::uuid[]));

  delete from public.snapshot_purge_queue q
   where q.claim_token = p_claim_token
     and q.event_id = any(coalesce(p_deleted_event_ids, '{}'::uuid[]));
  get diagnostics v_deleted = row_count;

  update public.snapshot_purge_queue q
     set claim_token = null,
         claimed_at = null
   where q.claim_token = p_claim_token
     and q.event_id = any(coalesce(p_failed_event_ids, '{}'::uuid[]));
  get diagnostics v_released = row_count;

  return query select v_deleted, v_released;
end $$;

revoke all on table public.snapshot_purge_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.snapshot_purge_queue to service_role;

revoke execute on function public.normalize_violation_snapshot_capture()
  from public, anon, authenticated;
grant execute on function public.normalize_violation_snapshot_capture() to service_role;

revoke execute on function public.preview_snapshot_purge(uuid)
  from public, anon, authenticated;
grant execute on function public.preview_snapshot_purge(uuid) to service_role;

revoke execute on function public.claim_snapshot_purge_batch(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_snapshot_purge_batch(uuid, integer, uuid) to service_role;

revoke execute on function public.finish_snapshot_purge_batch(uuid, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.finish_snapshot_purge_batch(uuid, uuid[], uuid[]) to service_role;

commit;

-- Manual rollback (only while every Storage object in the queue still exists):
-- 1. Pause the worker and admin purge route.
-- 2. In one transaction, restore violation_events.snapshot_path AND
--    snapshot_captured_at from snapshot_purge_queue, and remove the two purge
--    metadata keys. The trigger preserves the explicitly restored timestamp.
-- 3. Verify the queue is empty, then drop the RPCs, trigger/function, indexes,
--    constraint, queue table and snapshot_captured_at column in dependency order.
