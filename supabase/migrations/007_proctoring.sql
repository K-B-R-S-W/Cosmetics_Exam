begin;

-- Phase 3 proctoring writes use a consistent order. Functions that need exam
-- data lock the exam first, then the attempt. Attempt-only functions lock the
-- attempt before violation_events. The count trigger therefore only updates an
-- attempt row already owned by its caller.

create or replace function public.record_candidate_event(
  p_session_id uuid,
  p_event_id uuid,
  p_type text,
  p_merged_types text[],
  p_occurred_ago_ms int,
  p_duration_ms int,
  p_meta jsonb,
  p_snapshot_requested boolean
)
returns table (
  out_result text,
  out_event_id uuid,
  out_counts boolean,
  out_snapshot_path text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_exam public.exams%rowtype;
  v_attempt public.attempts%rowtype;
  v_now timestamptz := clock_timestamp();
  v_allowed_types constant text[] := array[
    'TAB_HIDDEN', 'FOCUS_LOST', 'FULLSCREEN_EXIT', 'VIEWPORT_CHANGED',
    'MULTI_SCREEN', 'CAMERA_LOST', 'MIC_LOST', 'COPY', 'PASTE',
    'CONTEXT_MENU', 'RELOAD'
  ];
  v_counting_types constant text[] := array[
    'TAB_HIDDEN', 'FOCUS_LOST', 'FULLSCREEN_EXIT', 'VIEWPORT_CHANGED',
    'MULTI_SCREEN', 'CAMERA_LOST', 'MIC_LOST', 'RELOAD'
  ];
  v_attention_types constant text[] := array[
    'TAB_HIDDEN', 'FOCUS_LOST', 'FULLSCREEN_EXIT', 'VIEWPORT_CHANGED'
  ];
  v_snapshot_types constant text[] := array[
    'TAB_HIDDEN', 'FOCUS_LOST', 'FULLSCREEN_EXIT', 'VIEWPORT_CHANGED',
    'MULTI_SCREEN'
  ];
  v_ago_ms int;
  v_counts boolean;
  v_snapshot_path text;
begin
  select s.* into v_session
    from public.sessions s
   where s.id = p_session_id
   for share;

  if not found then
    return query select 'unauthenticated'::text, p_event_id, false, null::text;
    return;
  end if;
  if v_session.revoked_at is not null or v_session.attempt_id is null then
    return query select 'session_revoked'::text, p_event_id, false, null::text;
    return;
  end if;

  select e.* into v_exam
    from public.attempts a
    join public.exams e on e.id = a.exam_id
   where a.id = v_session.attempt_id
     and a.candidate_id = v_session.candidate_id
   for share of e;

  if not found then
    return query select 'session_revoked'::text, p_event_id, false, null::text;
    return;
  end if;

  select a.* into v_attempt
    from public.attempts a
   where a.id = v_session.attempt_id
     and a.exam_id = v_exam.id
     and a.candidate_id = v_session.candidate_id
   for update;

  if not found then
    return query select 'session_revoked'::text, p_event_id, false, null::text;
    return;
  end if;
  v_now := clock_timestamp();

  if exists (select 1 from public.violation_events ve where ve.id = p_event_id) then
    return query select 'duplicate'::text, p_event_id, false, null::text;
    return;
  end if;

  if p_type is null or not (p_type = any(v_allowed_types))
     or exists (
       select 1 from unnest(coalesce(p_merged_types, array[]::text[])) mt
        where not (mt = any(v_allowed_types)) or mt = p_type
     ) then
    return query select 'invalid_type'::text, p_event_id, false, null::text;
    return;
  end if;

  if p_duration_ms is not null and p_duration_ms < 0 then
    return query select 'validation_failed'::text, p_event_id, false, null::text;
    return;
  end if;
  if p_meta is not null and jsonb_typeof(p_meta) <> 'object' then
    return query select 'validation_failed'::text, p_event_id, false, null::text;
    return;
  end if;
  if p_meta is not null and octet_length(p_meta::text) > 2048 then
    return query select 'validation_failed'::text, p_event_id, false, null::text;
    return;
  end if;

  if v_attempt.status not in ('acknowledged', 'in_progress') then
    return query select 'ignored'::text, p_event_id, false, null::text;
    return;
  end if;

  if (
    select count(*)
      from public.violation_events ve
     where ve.attempt_id = v_attempt.id
       and ve.type = any(v_allowed_types)
       and ve.occurred_at >= v_now - interval '60 seconds'
  ) >= 30 then
    return query select 'rate_limited'::text, p_event_id, false, null::text;
    return;
  end if;

  v_ago_ms := least(
    greatest(coalesce(p_occurred_ago_ms, 0), 0),
    v_exam.duration_min * 60000
  );
  v_counts := p_type = any(v_counting_types)
    and (
      p_type not in ('CAMERA_LOST', 'MIC_LOST')
      or coalesce(p_meta->>'source' = 'track', false)
    )
    and v_attempt.status = 'in_progress'
    and v_attempt.joined_at is not null
    and v_now - (v_ago_ms * interval '1 millisecond') >= v_attempt.joined_at;

  if coalesce(p_snapshot_requested, false)
     and p_type = any(v_snapshot_types)
     and (
    select count(*) from public.violation_events ve
     where ve.attempt_id = v_attempt.id and ve.snapshot_path is not null
  ) < 60 then
    v_snapshot_path := format(
      'snapshots/%s/%s/%s.jpg', v_exam.id, v_attempt.id, p_event_id
    );
  end if;

  insert into public.violation_events (
    id, attempt_id, type, merged_types, counts, occurred_at,
    duration_ms, meta, snapshot_path
  ) values (
    p_event_id,
    v_attempt.id,
    p_type,
    coalesce(p_merged_types, array[]::text[]),
    v_counts,
    v_now - (v_ago_ms * interval '1 millisecond'),
    p_duration_ms,
    case
      when coalesce(p_snapshot_requested, false)
           and p_type = any(v_snapshot_types)
           and v_snapshot_path is null
        then jsonb_set(coalesce(p_meta, '{}'::jsonb), '{snapshot_skipped}', '"limit"')
      else p_meta
    end,
    v_snapshot_path
  )
  on conflict (id) do nothing;

  if not found then
    return query select 'duplicate'::text, p_event_id, false, null::text;
    return;
  end if;

  if p_type = any(v_attention_types) then
    perform public.reverse_disconnects_for_incident(p_event_id);
  end if;

  return query select 'inserted'::text, p_event_id, v_counts, v_snapshot_path;
end $$;

create or replace function public.mark_violation_snapshot_failed(p_event_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt_id uuid;
begin
  select ve.attempt_id into v_attempt_id
    from public.violation_events ve
   where ve.id = p_event_id;
  if not found then return false; end if;

  perform a.id from public.attempts a where a.id = v_attempt_id for update;

  update public.violation_events ve
     set snapshot_path = null,
         meta = jsonb_set(coalesce(ve.meta, '{}'::jsonb), '{snapshot_error}', 'true'::jsonb)
   where ve.id = p_event_id
     and ve.attempt_id = v_attempt_id;
  return found;
end $$;

-- Both heartbeat and worker Pass 2 call this helper while holding (or before
-- acquiring) the same attempt lock. It is the sole authority for the exact
-- two-minute boundary and the attention-overlap rule.
create or replace function public.classify_disconnect(
  p_attempt_id uuid,
  p_disconnect_id uuid,
  p_now timestamptz
)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt_last_seen timestamptz;
  v_disconnect_last_seen timestamptz;
  v_existing_reason text;
begin
  select a.last_seen_at into v_attempt_last_seen
    from public.attempts a
   where a.id = p_attempt_id
     and a.status = 'in_progress'
   for update;
  if not found then return 'ignored'; end if;

  select (d.meta->>'last_seen_at')::timestamptz,
         d.meta->>'count_reason'
    into v_disconnect_last_seen, v_existing_reason
    from public.violation_events d
   where d.id = p_disconnect_id
     and d.attempt_id = p_attempt_id
     and d.type = 'DISCONNECTED'
   for update;
  if not found then return 'not_found'; end if;
  if v_existing_reason is not null then return v_existing_reason; end if;
  if v_disconnect_last_seen is null
     or v_attempt_last_seen is distinct from v_disconnect_last_seen then
    return 'stale';
  end if;

  if p_now - v_disconnect_last_seen < interval '2 minutes' then
    update public.violation_events d
       set meta = jsonb_set(coalesce(d.meta, '{}'::jsonb), '{count_reason}', '"short_gap"')
     where d.id = p_disconnect_id
       and d.attempt_id = p_attempt_id
       and d.counts = false
       and d.meta->>'count_reason' is null;
    return 'short_gap';
  end if;

  if exists (
    select 1
      from public.violation_events f
     where f.attempt_id = p_attempt_id
       and f.type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED')
       and f.occurred_at + (coalesce(f.duration_ms, 0) * interval '1 millisecond')
           >= v_disconnect_last_seen - interval '10 seconds'
  ) then
    update public.violation_events d
       set meta = jsonb_set(coalesce(d.meta, '{}'::jsonb), '{count_reason}', '"overlap"')
     where d.id = p_disconnect_id
       and d.attempt_id = p_attempt_id
       and d.counts = false
       and d.meta->>'count_reason' is null;
    return 'overlap';
  end if;

  update public.violation_events d
     set counts = true,
         meta = jsonb_set(coalesce(d.meta, '{}'::jsonb), '{count_reason}', '"long_gap"')
   where d.id = p_disconnect_id
     and d.attempt_id = p_attempt_id
     and d.counts = false
     and d.meta->>'count_reason' is null;
  return 'long_gap';
end $$;

create or replace function public.candidate_heartbeat(p_session_id uuid)
returns table (out_result text, out_state jsonb)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_exam public.exams%rowtype;
  v_attempt public.attempts%rowtype;
  v_previous_seen timestamptz;
  v_now timestamptz := clock_timestamp();
  v_deadline timestamptz;
  v_phase text;
  v_disconnect_id uuid;
  v_gap_ms int;
begin
  select s.* into v_session
    from public.sessions s
   where s.id = p_session_id
   for share;
  if not found then
    return query select 'unauthenticated'::text, null::jsonb;
    return;
  end if;
  if v_session.revoked_at is not null or v_session.attempt_id is null then
    return query select 'session_revoked'::text, null::jsonb;
    return;
  end if;

  select e.* into v_exam
    from public.attempts a
    join public.exams e on e.id = a.exam_id
   where a.id = v_session.attempt_id
     and a.candidate_id = v_session.candidate_id
   for share of e;
  if not found then
    return query select 'session_revoked'::text, null::jsonb;
    return;
  end if;

  select a.* into v_attempt
    from public.attempts a
   where a.id = v_session.attempt_id
     and a.exam_id = v_exam.id
     and a.candidate_id = v_session.candidate_id
   for update;
  if not found then
    return query select 'session_revoked'::text, null::jsonb;
    return;
  end if;

  v_now := clock_timestamp();
  v_previous_seen := v_attempt.last_seen_at;
  if v_attempt.status = 'in_progress'
     and v_previous_seen is not null
     and v_previous_seen < v_now - interval '30 seconds' then
    select ve.id into v_disconnect_id
      from public.violation_events ve
     where ve.attempt_id = v_attempt.id
       and ve.type in ('DISCONNECTED', 'RECONNECTED')
     order by ve.occurred_at desc, ve.id desc
     limit 1;

    if v_disconnect_id is not null
       and (select ve.type from public.violation_events ve where ve.id = v_disconnect_id) = 'DISCONNECTED' then
      perform public.classify_disconnect(v_attempt.id, v_disconnect_id, v_now);
      v_gap_ms := least(
        floor(extract(epoch from (v_now - v_previous_seen)) * 1000)::bigint,
        2147483647
      )::int;
      insert into public.violation_events (
        attempt_id, type, counts, occurred_at, duration_ms
      ) values (
        v_attempt.id, 'RECONNECTED', false, v_now, v_gap_ms
      );
    end if;
  end if;

  if v_attempt.status in ('acknowledged', 'in_progress') then
    update public.attempts a set last_seen_at = v_now where a.id = v_attempt.id;
    v_attempt.last_seen_at := v_now;
  end if;

  v_deadline := case when v_exam.ends_at is null then null
    else v_exam.ends_at + make_interval(mins => v_attempt.extra_minutes) end;
  v_phase := case
    when v_attempt.status in ('submitted', 'finalized') then 'submitted'
    when v_exam.status = 'live' and v_exam.force_ended_at is null
         and v_deadline is not null and v_now <= v_deadline then 'live'
    when v_exam.status in ('draft', 'scheduled') then 'waiting'
    else 'closed'
  end;

  return query select 'ok'::text, jsonb_build_object(
    'server_time', v_now,
    'phase', v_phase,
    'exam', jsonb_build_object(
      'id', v_exam.id,
      'title', v_exam.title,
      'status', v_exam.status,
      'navigation_mode', v_exam.navigation_mode,
      'scheduled_start_at', v_exam.scheduled_start_at,
      'started_at', v_exam.started_at,
      'ends_at', v_exam.ends_at,
      'force_ended', v_exam.force_ended_at is not null,
      'question_count', (select count(*) from public.questions q where q.exam_id = v_exam.id)
    ),
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'status', v_attempt.status,
      'current_position', v_attempt.current_position,
      'extra_minutes', v_attempt.extra_minutes,
      'deadline', v_deadline,
      'submit_reason', v_attempt.submit_reason
    ),
    'announcements', '[]'::jsonb
  );
end $$;

create or replace function public.record_login_violation(
  p_attempt_id uuid,
  p_type text,
  p_meta jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt public.attempts%rowtype;
  v_event_id uuid;
begin
  select a.* into v_attempt
    from public.attempts a
   where a.id = p_attempt_id
   for update;
  if not found then return null; end if;
  if p_type is null or p_type not in ('MULTI_LOGIN', 'RECONNECTED') then
    raise exception 'invalid_type';
  end if;

  -- RECONNECTED participates in latest-row ordering, so use the wall clock
  -- rather than the transaction-start default.
  insert into public.violation_events (attempt_id, type, counts, occurred_at, meta)
  values (
    v_attempt.id,
    p_type,
    p_type = 'MULTI_LOGIN' and v_attempt.status = 'in_progress',
    clock_timestamp(),
    p_meta
  )
  returning id into v_event_id;
  return v_event_id;
end $$;

create or replace function public.record_disconnects()
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt record;
  v_inserted int := 0;
  v_last_type text;
  v_now timestamptz := clock_timestamp();
begin
  -- The eligibility predicate is part of the locking SELECT. The 500-row cap
  -- drains across ticks because an inserted DISCONNECTED makes that attempt
  -- ineligible until a RECONNECTED row exists.
  for v_attempt in
    select a.id, a.last_seen_at
      from public.attempts a
     where a.status = 'in_progress'
       and a.last_seen_at is not null
       and a.last_seen_at < v_now - interval '30 seconds'
       and coalesce((
         select ve.type
           from public.violation_events ve
          where ve.attempt_id = a.id
            and ve.type in ('DISCONNECTED', 'RECONNECTED')
          order by ve.occurred_at desc, ve.id desc
          limit 1
       ), '') <> 'DISCONNECTED'
     order by a.id
     limit 500
     for update skip locked
  loop
    v_last_type := null;
    select ve.type into v_last_type
      from public.violation_events ve
     where ve.attempt_id = v_attempt.id
       and ve.type in ('DISCONNECTED', 'RECONNECTED')
     order by ve.occurred_at desc, ve.id desc
     limit 1;

    if v_last_type is distinct from 'DISCONNECTED' then
      -- Every DISCONNECTED/RECONNECTED writer must use clock_timestamp():
      -- latest-row lookups order by occurred_at, including inside one transaction.
      insert into public.violation_events (
        attempt_id, type, counts, occurred_at, meta
      )
      values (
        v_attempt.id,
        'DISCONNECTED',
        false,
        clock_timestamp(),
        jsonb_build_object('last_seen_at', v_attempt.last_seen_at)
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;
  return v_inserted;
end $$;

create or replace function public.resolve_disconnects()
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt record;
  v_disconnect record;
  v_now timestamptz := clock_timestamp();
begin
  -- Resolved rows leave this eligibility set, so batches beyond 500 remain
  -- eligible and drain on later worker ticks.
  for v_attempt in
    select a.id, a.last_seen_at
      from public.attempts a
     where a.status = 'in_progress'
       and exists (
         select 1 from public.violation_events d
          where d.attempt_id = a.id
            and d.type = 'DISCONNECTED'
            and d.counts = false
            and d.meta->>'count_reason' is null
            and (d.meta->>'last_seen_at')::timestamptz <= v_now - interval '2 minutes'
            and a.last_seen_at = (d.meta->>'last_seen_at')::timestamptz
       )
     order by a.id
     limit 500
     for update skip locked
  loop
    for v_disconnect in
      select d.id
        from public.violation_events d
       where d.attempt_id = v_attempt.id
         and d.type = 'DISCONNECTED'
         and d.counts = false
         and d.meta->>'count_reason' is null
         and (d.meta->>'last_seen_at')::timestamptz <= v_now - interval '2 minutes'
         and v_attempt.last_seen_at = (d.meta->>'last_seen_at')::timestamptz
       order by d.id
    loop
      perform public.classify_disconnect(v_attempt.id, v_disconnect.id, v_now);
    end loop;
  end loop;
end $$;

create or replace function public.reverse_disconnects_for_incident(p_event_id uuid)
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt_id uuid;
  v_n int;
begin
  select ve.attempt_id into v_attempt_id
    from public.violation_events ve
   where ve.id = p_event_id
     and ve.type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED');
  if not found then return 0; end if;

  perform a.id from public.attempts a where a.id = v_attempt_id for update;

  with inc as (
    select ve.attempt_id,
           ve.occurred_at,
           ve.occurred_at + (coalesce(ve.duration_ms, 0) * interval '1 millisecond') as ends_at
      from public.violation_events ve
     where ve.id = p_event_id
       and ve.attempt_id = v_attempt_id
  ), upd as (
    update public.violation_events d
       set counts = false,
           meta = jsonb_set(coalesce(d.meta, '{}'::jsonb), '{count_reason}', '"reversed_by_focus"')
      from inc
     where d.attempt_id = inc.attempt_id
       and d.type = 'DISCONNECTED'
       and d.counts = true
       and d.meta->>'count_reason' = 'long_gap'
       and inc.ends_at >= (d.meta->>'last_seen_at')::timestamptz - interval '10 seconds'
       and inc.occurred_at <= coalesce(
         (select min(r.occurred_at) from public.violation_events r
           where r.attempt_id = d.attempt_id
             and r.type = 'RECONNECTED'
             and r.occurred_at > d.occurred_at),
         clock_timestamp()
       )
    returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end $$;

create or replace function public.reverse_recent_disconnects()
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt record;
  v_event record;
  v_total int := 0;
begin
  -- This function retains row locks until it returns. Lock distinct attempts
  -- in UUID order, matching finalize_exam_if_closed and every other batch path.
  for v_attempt in
    select distinct ve.attempt_id
      from public.violation_events ve
     where ve.type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED')
       and ve.occurred_at >= clock_timestamp() - interval '5 minutes'
       and exists (
         select 1
           from public.violation_events d
          where d.attempt_id = ve.attempt_id
            and d.type = 'DISCONNECTED'
            and d.counts = true
            and d.meta->>'count_reason' = 'long_gap'
            and ve.occurred_at
                + (coalesce(ve.duration_ms, 0) * interval '1 millisecond')
                >= (d.meta->>'last_seen_at')::timestamptz - interval '10 seconds'
            and ve.occurred_at <= coalesce(
              (select min(r.occurred_at)
                 from public.violation_events r
                where r.attempt_id = d.attempt_id
                  and r.type = 'RECONNECTED'
                  and r.occurred_at > d.occurred_at),
              clock_timestamp()
            )
       )
     order by ve.attempt_id
     limit 500
  loop
    perform a.id from public.attempts a
     where a.id = v_attempt.attempt_id
     for update;

    for v_event in
      select ve.id
        from public.violation_events ve
       where ve.attempt_id = v_attempt.attempt_id
         and ve.type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED')
         and ve.occurred_at >= clock_timestamp() - interval '5 minutes'
         and exists (
           select 1
             from public.violation_events d
            where d.attempt_id = ve.attempt_id
              and d.type = 'DISCONNECTED'
              and d.counts = true
              and d.meta->>'count_reason' = 'long_gap'
              and ve.occurred_at
                  + (coalesce(ve.duration_ms, 0) * interval '1 millisecond')
                  >= (d.meta->>'last_seen_at')::timestamptz - interval '10 seconds'
              and ve.occurred_at <= coalesce(
                (select min(r.occurred_at)
                   from public.violation_events r
                  where r.attempt_id = d.attempt_id
                    and r.type = 'RECONNECTED'
                    and r.occurred_at > d.occurred_at),
                clock_timestamp()
              )
         )
       order by ve.id
    loop
      v_total := v_total + public.reverse_disconnects_for_incident(v_event.id);
    end loop;
  end loop;
  return v_total;
end $$;

create or replace function public.dismiss_violation_event(
  p_event_id uuid,
  p_admin_id uuid,
  p_dismissed boolean,
  p_note text
)
returns table (out_result text, out_counts boolean, out_violation_count int)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt_id uuid;
  v_event public.violation_events%rowtype;
  v_meta jsonb;
  v_count int;
begin
  if p_note is null or char_length(btrim(p_note)) not between 1 and 300 then
    return query select 'note_required'::text, false, 0;
    return;
  end if;
  if not exists (select 1 from public.admin_profiles ap where ap.id = p_admin_id) then
    return query select 'forbidden'::text, false, 0;
    return;
  end if;

  select ve.attempt_id into v_attempt_id
    from public.violation_events ve where ve.id = p_event_id;
  if not found then
    return query select 'not_found'::text, false, 0;
    return;
  end if;

  perform a.id from public.attempts a where a.id = v_attempt_id for update;
  select ve.* into v_event
    from public.violation_events ve
   where ve.id = p_event_id and ve.attempt_id = v_attempt_id
   for update;
  if not found then
    return query select 'not_found'::text, false, 0;
    return;
  end if;

  v_meta := coalesce(v_event.meta, '{}'::jsonb);
  if p_dismissed then
    if not v_event.counts then
      return query select 'not_dismissable'::text, v_event.counts,
        (select a.violation_count from public.attempts a where a.id = v_attempt_id);
      return;
    end if;
    v_meta := jsonb_set(v_meta, '{dismissed}', jsonb_build_object(
      'by', p_admin_id, 'at', clock_timestamp(), 'note', btrim(p_note)
    ));
    if v_event.type = 'DISCONNECTED' then
      v_meta := jsonb_set(v_meta, '{count_reason}', '"dismissed"');
    end if;
    update public.violation_events set counts = false, meta = v_meta where id = p_event_id;
    insert into public.admin_actions (admin_id, action, target, detail)
    values (p_admin_id, 'event_dismiss', p_event_id::text,
            jsonb_build_object('event_id', p_event_id, 'note', btrim(p_note)));
  else
    if not (v_meta ? 'dismissed') then
      return query select 'not_restorable'::text, v_event.counts,
        (select a.violation_count from public.attempts a where a.id = v_attempt_id);
      return;
    end if;
    v_meta := v_meta - 'dismissed';
    if v_event.type = 'DISCONNECTED' then
      v_meta := jsonb_set(v_meta, '{count_reason}', '"restored"');
    end if;
    update public.violation_events set counts = true, meta = v_meta where id = p_event_id;
    insert into public.admin_actions (admin_id, action, target, detail)
    values (p_admin_id, 'event_restore', p_event_id::text,
            jsonb_build_object('event_id', p_event_id, 'note', btrim(p_note)));
  end if;

  select a.violation_count into v_count from public.attempts a where a.id = v_attempt_id;
  return query select 'updated'::text, not p_dismissed, v_count;
end $$;

create index if not exists idx_violation_disconnect_timeline
  on public.violation_events (attempt_id, occurred_at desc)
  where type in ('DISCONNECTED', 'RECONNECTED');

create index if not exists idx_violation_unresolved_disconnects
  on public.violation_events (attempt_id, occurred_at)
  where type = 'DISCONNECTED' and counts = false and meta->>'count_reason' is null;

create index if not exists idx_violation_recent_attention
  on public.violation_events (occurred_at, id)
  where type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED');

-- Do not index attempts.last_seen_at: heartbeat rewrites it every 10 seconds,
-- while an exam has at most the expected 23 attempt rows to scan.

revoke execute on function public.record_candidate_event(uuid, uuid, text, text[], int, int, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.record_candidate_event(uuid, uuid, text, text[], int, int, jsonb, boolean)
  to service_role;

revoke execute on function public.mark_violation_snapshot_failed(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_violation_snapshot_failed(uuid) to service_role;

revoke execute on function public.classify_disconnect(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.classify_disconnect(uuid, uuid, timestamptz) to service_role;

revoke execute on function public.candidate_heartbeat(uuid)
  from public, anon, authenticated;
grant execute on function public.candidate_heartbeat(uuid) to service_role;

revoke execute on function public.record_login_violation(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_login_violation(uuid, text, jsonb) to service_role;

revoke execute on function public.record_disconnects()
  from public, anon, authenticated;
grant execute on function public.record_disconnects() to service_role;

revoke execute on function public.resolve_disconnects()
  from public, anon, authenticated;
grant execute on function public.resolve_disconnects() to service_role;

revoke execute on function public.reverse_disconnects_for_incident(uuid)
  from public, anon, authenticated;
grant execute on function public.reverse_disconnects_for_incident(uuid) to service_role;

revoke execute on function public.reverse_recent_disconnects()
  from public, anon, authenticated;
grant execute on function public.reverse_recent_disconnects() to service_role;

revoke execute on function public.dismiss_violation_event(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.dismiss_violation_event(uuid, uuid, boolean, text) to service_role;

commit;
