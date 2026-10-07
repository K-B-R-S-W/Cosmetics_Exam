begin;

-- Force-end is a database-clock transition. It locks the exam first, matching
-- the project-wide exam -> attempt lock order. Attempts remain open for the
-- fixed 15-second final collection window; the worker submits them afterwards.
create or replace function public.force_end_exam(p_exam_id uuid)
returns table (
  out_result text,
  out_status text,
  out_ends_at timestamptz,
  out_force_ended_at timestamptz,
  out_collection_deadline timestamptz,
  out_collecting int,
  out_already_submitted int
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam public.exams%rowtype;
  v_now timestamptz;
  v_collecting int;
  v_submitted int;
begin
  select * into v_exam
    from public.exams
   where id = p_exam_id
   for update;

  if not found then
    return query select 'not_found'::text, null::text, null::timestamptz,
      null::timestamptz, null::timestamptz, 0, 0;
    return;
  end if;

  if v_exam.status in ('ended', 'finalized') and v_exam.force_ended_at is not null then
    select count(*) filter (where status in ('not_started', 'acknowledged', 'in_progress')),
           count(*) filter (where status in ('submitted', 'finalized'))
      into v_collecting, v_submitted
      from public.attempts where exam_id = p_exam_id;
    return query select 'already_ended'::text, v_exam.status, v_exam.ends_at,
      v_exam.force_ended_at, v_exam.force_ended_at + interval '15 seconds',
      v_collecting, v_submitted;
    return;
  end if;

  if v_exam.status <> 'live' then
    return query select 'invalid_status'::text, v_exam.status, v_exam.ends_at,
      v_exam.force_ended_at, null::timestamptz, 0, 0;
    return;
  end if;

  v_now := clock_timestamp();
  update public.exams
     set status = 'ended', ends_at = v_now, force_ended_at = v_now
   where id = p_exam_id and status = 'live'
  returning * into v_exam;

  if not found then
    return query select 'invalid_status'::text, null::text, null::timestamptz,
      null::timestamptz, null::timestamptz, 0, 0;
    return;
  end if;

  select count(*) filter (where status in ('not_started', 'acknowledged', 'in_progress')),
         count(*) filter (where status in ('submitted', 'finalized'))
    into v_collecting, v_submitted
    from public.attempts where exam_id = p_exam_id;

  return query select 'ended'::text, v_exam.status, v_exam.ends_at,
    v_exam.force_ended_at, v_exam.force_ended_at + interval '15 seconds',
    v_collecting, v_submitted;
end $$;

revoke execute on function public.force_end_exam(uuid) from public, anon, authenticated;
grant execute on function public.force_end_exam(uuid) to service_role;

commit;
