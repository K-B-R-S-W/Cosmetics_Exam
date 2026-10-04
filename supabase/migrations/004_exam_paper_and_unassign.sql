begin;

-- Every candidate receives every composed question. The attempt row lock makes the
-- first paper creation atomic, while reconnects return the saved order unchanged.
create or replace function public.generate_paper(p_attempt_id uuid)
returns setof public.attempt_questions
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_attempt  public.attempts%rowtype;
  v_exam     public.exams%rowtype;
  v_inserted int;
begin
  select * into v_attempt
    from public.attempts
   where id = p_attempt_id
   for update;

  if not found then raise exception 'attempt_not_found'; end if;

  select * into v_exam from public.exams where id = v_attempt.exam_id;

  if v_attempt.status = 'not_started' then raise exception 'not_acknowledged'; end if;
  if v_attempt.status in ('submitted', 'finalized') then raise exception 'attempt_closed'; end if;
  if v_exam.status <> 'live' or v_exam.force_ended_at is not null then
    raise exception 'exam_not_live';
  end if;

  if not exists (
    select 1
      from public.attempt_questions
     where attempt_id = p_attempt_id
  ) then
    insert into public.attempt_questions (attempt_id, question_id, position, option_order)
    select
      p_attempt_id,
      q.id,
      (
        row_number() over (
          order by
            case when v_exam.shuffle then random() end,
            case when not v_exam.shuffle then q.position end,
            q.id
        ) - 1
      )::int,
      case
        when q.type = 'mcq' then (
          select jsonb_agg(
            op.id
            order by
              case when v_exam.shuffle then random() end,
              case when not v_exam.shuffle then op.position end,
              op.id
          )
            from public.mcq_options op
           where op.question_id = q.id
        )
      end
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

-- generate_paper no longer depends on this column, so it is now safe to remove.
alter table public.exams drop column questions_per_paper;

-- Atomically remove only candidates whose attempts have not started. Attempt rows
-- are locked in candidate-id order and waited on, so login/start and unassign cannot
-- race into an orphaned attempt. Unknown and already-unassigned ids are ignored.
create or replace function public.unassign_exam_candidates(
  p_exam_id uuid,
  p_candidate_ids uuid[]
)
returns table (removed uuid[], blocked uuid[])
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_exam_status text;
  v_requested   uuid[];
  v_removed     uuid[];
  v_blocked     uuid[];
begin
  select e.status into v_exam_status
    from public.exams e
   where e.id = p_exam_id
   for update;

  if not found then raise exception 'exam_not_found'; end if;
  if v_exam_status in ('ended', 'finalized') then raise exception 'exam_locked'; end if;

  select coalesce(array_agg(requested.candidate_id order by requested.candidate_id), array[]::uuid[])
    into v_requested
    from (
      select distinct candidate_id
        from unnest(coalesce(p_candidate_ids, array[]::uuid[])) as input(candidate_id)
       where candidate_id is not null
    ) requested;

  -- FOR UPDATE intentionally waits. Sorting gives concurrent calls a consistent
  -- lock order and reduces deadlock risk.
  perform a.id
    from public.attempts a
    join public.exam_candidates ec
      on ec.exam_id = a.exam_id and ec.candidate_id = a.candidate_id
   where a.exam_id = p_exam_id
     and a.candidate_id = any(v_requested)
   order by a.candidate_id
   for update of a;

  select coalesce(array_agg(a.candidate_id order by a.candidate_id), array[]::uuid[])
    into v_blocked
    from public.attempts a
    join public.exam_candidates ec
      on ec.exam_id = a.exam_id and ec.candidate_id = a.candidate_id
   where a.exam_id = p_exam_id
     and a.candidate_id = any(v_requested)
     and a.status <> 'not_started';

  with deleted as (
    delete from public.exam_candidates ec
    using public.attempts a
     where ec.exam_id = p_exam_id
       and a.exam_id = ec.exam_id
       and a.candidate_id = ec.candidate_id
       and a.status = 'not_started'
       and ec.candidate_id = any(v_requested)
    returning ec.candidate_id
  )
  select coalesce(array_agg(candidate_id order by candidate_id), array[]::uuid[])
    into v_removed
    from deleted;

  return query select v_removed, v_blocked;
end $$;

revoke execute on function public.generate_paper(uuid) from public, anon, authenticated;
grant execute on function public.generate_paper(uuid) to service_role;

revoke execute on function public.unassign_exam_candidates(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.unassign_exam_candidates(uuid, uuid[]) to service_role;

commit;
