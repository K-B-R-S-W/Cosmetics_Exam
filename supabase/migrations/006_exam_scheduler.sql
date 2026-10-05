begin;

-- Scheduler and candidate-write transactions use one lock order: exam row first,
-- then attempt rows in UUID order. This prevents finalization from racing a final
-- answer save and avoids attempt -> exam lock inversions.

-- Shared by the admin Start route and the worker. The worker passes true so only
-- a due scheduled exam can start; the database clock is authoritative.
create or replace function public.start_exam(
  p_exam_id uuid,
  p_scheduled_only boolean default false
)
returns table (
  out_result text,
  out_status text,
  out_started_at timestamptz,
  out_ends_at timestamptz,
  out_missing text[]
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam public.exams%rowtype;
  v_now timestamptz := clock_timestamp();
  v_missing text[] := array[]::text[];
begin
  select * into v_exam
    from public.exams
   where id = p_exam_id
   for update;

  if not found then
    return query select 'not_found'::text, null::text, null::timestamptz,
                        null::timestamptz, v_missing;
    return;
  end if;

  if v_exam.status not in ('draft', 'scheduled')
     or (p_scheduled_only and v_exam.status <> 'scheduled') then
    return query select 'invalid_status'::text, v_exam.status, v_exam.started_at,
                        v_exam.ends_at, v_missing;
    return;
  end if;

  if p_scheduled_only
     and (v_exam.scheduled_start_at is null or v_exam.scheduled_start_at > v_now) then
    return query select 'not_due'::text, v_exam.status, v_exam.started_at,
                        v_exam.ends_at, v_missing;
    return;
  end if;

  if not exists (select 1 from public.questions q where q.exam_id = p_exam_id) then
    v_missing := array_append(v_missing, 'questions');
  end if;
  if not exists (select 1 from public.exam_candidates ec where ec.exam_id = p_exam_id) then
    v_missing := array_append(v_missing, 'candidates');
  end if;

  if cardinality(v_missing) > 0 then
    return query select 'not_ready'::text, v_exam.status, v_exam.started_at,
                        v_exam.ends_at, v_missing;
    return;
  end if;

  update public.exams e
     set status = 'live',
         started_at = v_now,
         ends_at = v_now + make_interval(mins => v_exam.duration_min),
         force_ended_at = null
   where e.id = p_exam_id
     and e.status in ('draft', 'scheduled')
  returning e.status, e.started_at, e.ends_at
       into v_exam.status, v_exam.started_at, v_exam.ends_at;

  if not found then
    return query select 'invalid_status'::text, null::text, null::timestamptz,
                        null::timestamptz, v_missing;
    return;
  end if;

  return query select 'started'::text, v_exam.status, v_exam.started_at,
                      v_exam.ends_at, v_missing;
end $$;

-- Submit one attempt only when the database clock says its collection window has
-- closed. not_started and acknowledged attempts are deliberately included; no
-- answer rows are synthesized.
create or replace function public.submit_due_attempt(p_attempt_id uuid)
returns table (out_result text, out_reason text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_id uuid;
  v_exam public.exams%rowtype;
  v_attempt public.attempts%rowtype;
  v_now timestamptz := clock_timestamp();
  v_reason text;
begin
  select a.exam_id into v_exam_id
    from public.attempts a
   where a.id = p_attempt_id;

  if not found then
    return query select 'not_found'::text, null::text;
    return;
  end if;

  select * into v_exam
    from public.exams e
   where e.id = v_exam_id
   for share;

  if not found then
    return query select 'not_found'::text, null::text;
    return;
  end if;

  select * into v_attempt
    from public.attempts a
   where a.id = p_attempt_id
     and a.exam_id = v_exam.id
   for update;

  if not found then
    return query select 'not_found'::text, null::text;
    return;
  end if;

  if v_attempt.status in ('submitted', 'finalized') then
    return query select 'already_submitted'::text, v_attempt.submit_reason;
    return;
  end if;

  if v_exam.status = 'ended'
     and v_exam.force_ended_at is not null
     and v_now > v_exam.force_ended_at + interval '15 seconds' then
    v_reason := 'forced';
  elsif v_exam.status = 'live'
        and v_exam.force_ended_at is null
        and v_exam.ends_at is not null
        and v_now > v_exam.ends_at
                    + make_interval(mins => v_attempt.extra_minutes)
                    + interval '15 seconds' then
    v_reason := 'auto';
  else
    return query select 'not_due'::text, null::text;
    return;
  end if;

  if public.submit_attempt(p_attempt_id, v_reason) then
    return query select 'submitted'::text, v_reason;
  else
    return query select 'already_submitted'::text,
                        (select a.submit_reason from public.attempts a where a.id = p_attempt_id);
  end if;
end $$;

-- End a live exam only after every per-attempt grace deadline has passed and all
-- attempts have been submitted. An ordinary exam remains observably ended for one
-- worker tick; the next call finalizes it. A force-ended exam is already ended and
-- can finalize as soon as its 15-second collection window is closed.
create or replace function public.finalize_exam_if_closed(p_exam_id uuid)
returns table (
  out_result text,
  out_exam_status text,
  out_finalized_attempts int
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam public.exams%rowtype;
  v_now timestamptz := clock_timestamp();
  v_open int;
  v_finalized int := 0;
begin
  select * into v_exam
    from public.exams e
   where e.id = p_exam_id
   for update;

  if not found then
    return query select 'not_found'::text, null::text, 0;
    return;
  end if;

  if v_exam.status = 'finalized' then
    return query select 'already_finalized'::text, v_exam.status, 0;
    return;
  end if;

  if v_exam.status not in ('live', 'ended') then
    return query select 'not_closed'::text, v_exam.status, 0;
    return;
  end if;

  -- Wait, do not skip locked rows. UUID ordering matches every other multi-attempt
  -- operation and makes overlapping lifecycle calls deterministic.
  perform a.id
    from public.attempts a
   where a.exam_id = p_exam_id
   order by a.id
   for update;

  select count(*) into v_open
    from public.attempts a
   where a.exam_id = p_exam_id
     and a.status in ('not_started', 'acknowledged', 'in_progress');

  if v_exam.force_ended_at is not null then
    if v_now <= v_exam.force_ended_at + interval '15 seconds' then
      return query select 'not_closed'::text, v_exam.status, 0;
      return;
    end if;
  elsif v_exam.ends_at is null or exists (
    select 1
      from public.attempts a
     where a.exam_id = p_exam_id
       and v_now <= v_exam.ends_at
                   + make_interval(mins => a.extra_minutes)
                   + interval '15 seconds'
  ) then
    return query select 'not_closed'::text, v_exam.status, 0;
    return;
  end if;

  if v_open > 0 then
    return query select 'pending_attempts'::text, v_exam.status, 0;
    return;
  end if;

  if v_exam.status = 'live' then
    update public.exams e
       set status = 'ended'
     where e.id = p_exam_id and e.status = 'live';
    return query select 'ended'::text, 'ended'::text, 0;
    return;
  end if;

  update public.attempts a
     set status = 'finalized'
   where a.exam_id = p_exam_id
     and a.status = 'submitted';
  get diagnostics v_finalized = row_count;

  update public.exams e
     set status = 'finalized'
   where e.id = p_exam_id and e.status = 'ended';

  return query select 'finalized'::text, 'finalized'::text, v_finalized;
end $$;

-- Replacements below preserve the public signatures and current API contract while
-- taking the exam lock before the attempt lock.
create or replace function public.generate_paper(p_attempt_id uuid)
returns setof public.attempt_questions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_id uuid;
  v_attempt public.attempts%rowtype;
  v_exam public.exams%rowtype;
  v_inserted int;
begin
  select a.exam_id into v_exam_id from public.attempts a where a.id = p_attempt_id;
  if not found then raise exception 'attempt_not_found'; end if;

  select * into v_exam from public.exams e where e.id = v_exam_id for share;
  if not found then raise exception 'attempt_not_found'; end if;

  select * into v_attempt
    from public.attempts a
   where a.id = p_attempt_id and a.exam_id = v_exam.id
   for update;
  if not found then raise exception 'attempt_not_found'; end if;

  if v_attempt.status = 'not_started' then raise exception 'not_acknowledged'; end if;
  if v_attempt.status in ('submitted', 'finalized') then raise exception 'attempt_closed'; end if;
  if v_exam.status <> 'live' or v_exam.force_ended_at is not null then
    raise exception 'exam_not_live';
  end if;

  if not exists (
    select 1 from public.attempt_questions aq where aq.attempt_id = p_attempt_id
  ) then
    insert into public.attempt_questions (attempt_id, question_id, position, option_order)
    select
      p_attempt_id,
      q.id,
      (row_number() over (
        order by
          case when v_exam.shuffle then random() end,
          case when not v_exam.shuffle then q.position end,
          q.id
      ) - 1)::int,
      case when q.type = 'mcq' then (
        select jsonb_agg(
          op.id order by
            case when v_exam.shuffle then random() end,
            case when not v_exam.shuffle then op.position end,
            op.id
        )
          from public.mcq_options op
         where op.question_id = q.id
      ) end
    from public.questions q
    where q.exam_id = v_exam.id;

    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then raise exception 'exam_has_no_questions'; end if;
  end if;

  update public.attempts
     set status = 'in_progress', joined_at = coalesce(joined_at, now())
   where id = p_attempt_id and status = 'acknowledged';

  return query
    select aq.*
      from public.attempt_questions aq
     where aq.attempt_id = p_attempt_id
     order by aq.position;
end $$;

create or replace function public.save_answer(
  p_attempt_id uuid,
  p_question_id uuid,
  p_answer_text text,
  p_selected_option_id uuid,
  p_flagged boolean,
  p_revision int
) returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_id uuid;
  v_attempt public.attempts%rowtype;
  v_exam public.exams%rowtype;
  v_pos int;
begin
  select a.exam_id into v_exam_id from public.attempts a where a.id = p_attempt_id;
  if not found then return 'not_found'; end if;

  select * into v_exam from public.exams e where e.id = v_exam_id for share;
  if not found then return 'not_found'; end if;

  select * into v_attempt
    from public.attempts a
   where a.id = p_attempt_id and a.exam_id = v_exam.id
   for update;
  if not found then return 'not_found'; end if;

  if v_attempt.status <> 'in_progress'
     or v_exam.ends_at is null
     or not (
       (v_exam.status = 'live'
        and v_exam.force_ended_at is null
        and now() <= v_exam.ends_at + make_interval(mins => v_attempt.extra_minutes) + interval '15 seconds')
       or
       (v_exam.status = 'ended'
        and v_exam.force_ended_at is not null
        and now() <= v_exam.force_ended_at + interval '15 seconds')
     ) then
    return 'closed';
  end if;

  select aq.position into v_pos
    from public.attempt_questions aq
   where aq.attempt_id = p_attempt_id and aq.question_id = p_question_id;
  if not found then return 'not_in_paper'; end if;

  if v_exam.navigation_mode = 'sequential' and v_pos <> v_attempt.current_position then
    return 'wrong_position';
  end if;

  if p_selected_option_id is not null and not exists (
    select 1 from public.mcq_options o
     where o.id = p_selected_option_id and o.question_id = p_question_id
  ) then
    return 'bad_option';
  end if;

  insert into public.answers as an (
    attempt_id, question_id, answer_text, selected_option_id, flagged, revision, updated_at
  ) values (
    p_attempt_id, p_question_id, p_answer_text, p_selected_option_id,
    coalesce(p_flagged, false), p_revision, now()
  )
  on conflict (attempt_id, question_id) do update
     set answer_text = excluded.answer_text,
         selected_option_id = excluded.selected_option_id,
         flagged = excluded.flagged,
         revision = excluded.revision,
         updated_at = now()
   where an.revision < excluded.revision;

  if not found then return 'stale_revision'; end if;
  return 'saved';
end $$;

create or replace function public.advance_position(
  p_attempt_id uuid,
  p_expected_position int,
  p_question_id uuid,
  p_answer_text text,
  p_selected_option_id uuid,
  p_revision int
) returns table (out_result text, out_position int)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_id uuid;
  v_attempt public.attempts%rowtype;
  v_exam public.exams%rowtype;
  v_total int;
  v_qid uuid;
  v_save text;
begin
  select a.exam_id into v_exam_id from public.attempts a where a.id = p_attempt_id;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;

  select * into v_exam from public.exams e where e.id = v_exam_id for share;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;

  select * into v_attempt
    from public.attempts a
   where a.id = p_attempt_id and a.exam_id = v_exam.id
   for update;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;

  if v_exam.navigation_mode <> 'sequential' then
    return query select 'not_sequential'::text, v_attempt.current_position;
    return;
  end if;

  if v_attempt.status <> 'in_progress'
     or v_exam.status <> 'live'
     or v_exam.force_ended_at is not null
     or v_exam.ends_at is null
     or now() > v_exam.ends_at + make_interval(mins => v_attempt.extra_minutes) + interval '15 seconds' then
    return query select 'closed'::text, v_attempt.current_position;
    return;
  end if;

  if v_attempt.current_position > p_expected_position then
    return query select 'already_advanced'::text, v_attempt.current_position;
    return;
  elsif v_attempt.current_position < p_expected_position then
    return query select 'out_of_sync'::text, v_attempt.current_position;
    return;
  end if;

  select count(*) into v_total
    from public.attempt_questions aq
   where aq.attempt_id = p_attempt_id;
  select aq.question_id into v_qid
    from public.attempt_questions aq
   where aq.attempt_id = p_attempt_id and aq.position = v_attempt.current_position;

  if v_qid is null or v_qid <> p_question_id then
    return query select 'wrong_question'::text, v_attempt.current_position;
    return;
  end if;

  if v_attempt.current_position >= v_total - 1 then
    if (p_answer_text is not null and btrim(p_answer_text) <> '')
       or p_selected_option_id is not null then
      v_save := public.save_answer(
        p_attempt_id, p_question_id, p_answer_text, p_selected_option_id, false, p_revision
      );
      if v_save not in ('saved', 'stale_revision') then
        return query select v_save, v_attempt.current_position;
        return;
      end if;
    end if;
    return query select 'last_question'::text, v_attempt.current_position;
    return;
  end if;

  if (p_answer_text is not null and btrim(p_answer_text) <> '')
     or p_selected_option_id is not null then
    v_save := public.save_answer(
      p_attempt_id, p_question_id, p_answer_text, p_selected_option_id, false, p_revision
    );
    if v_save not in ('saved', 'stale_revision') then
      return query select v_save, v_attempt.current_position;
      return;
    end if;
  end if;

  update public.attempts
     set current_position = current_position + 1
   where id = p_attempt_id;
  return query select 'advanced'::text, v_attempt.current_position + 1;
end $$;

create index if not exists idx_exams_scheduled_start
  on public.exams (scheduled_start_at, id)
  where status = 'scheduled';

revoke execute on function public.start_exam(uuid, boolean) from public, anon, authenticated;
grant execute on function public.start_exam(uuid, boolean) to service_role;

revoke execute on function public.submit_due_attempt(uuid) from public, anon, authenticated;
grant execute on function public.submit_due_attempt(uuid) to service_role;

revoke execute on function public.finalize_exam_if_closed(uuid) from public, anon, authenticated;
grant execute on function public.finalize_exam_if_closed(uuid) to service_role;

revoke execute on function public.generate_paper(uuid) from public, anon, authenticated;
grant execute on function public.generate_paper(uuid) to service_role;

revoke execute on function public.save_answer(uuid, uuid, text, uuid, boolean, int)
  from public, anon, authenticated;
grant execute on function public.save_answer(uuid, uuid, text, uuid, boolean, int)
  to service_role;

revoke execute on function public.advance_position(uuid, int, uuid, text, uuid, int)
  from public, anon, authenticated;
grant execute on function public.advance_position(uuid, int, uuid, text, uuid, int)
  to service_role;

commit;
