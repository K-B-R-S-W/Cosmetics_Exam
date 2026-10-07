begin;

-- Keep announcement discovery inside the heartbeat transaction so the 10-second
-- delivery fallback adds no Data API round trip. Message text is revealed only
-- by claim_broadcast immediately before display.
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
    'announcements', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', pending.id, 'sent_at', pending.sent_at)
        order by pending.sent_at, pending.id
      )
      from (
        select b.id, b.sent_at
          from public.broadcast_recipients br
          join public.broadcasts b on b.id = br.broadcast_id
         where br.candidate_id = v_session.candidate_id
           and br.shown_at is null
           and b.exam_id = v_exam.id
           and b.sent_at >= v_now - interval '10 minutes'
         order by b.sent_at, b.id
         limit 50
      ) pending
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function public.candidate_heartbeat(uuid)
  from public, anon, authenticated;
grant execute on function public.candidate_heartbeat(uuid) to service_role;

commit;
