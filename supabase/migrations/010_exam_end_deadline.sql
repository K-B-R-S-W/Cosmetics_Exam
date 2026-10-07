begin;

-- A live ordinary exam must honor its own collection deadline even when it has
-- no attempt rows. The maximum per-candidate extension still extends that floor.
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
  elsif v_exam.ends_at is null
     or v_now <= v_exam.ends_at
                  + make_interval(mins => greatest(coalesce((
                      select max(a.extra_minutes)
                        from public.attempts a
                       where a.exam_id = p_exam_id
                    ), 0), 0))
                  + interval '15 seconds' then
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

revoke execute on function public.finalize_exam_if_closed(uuid) from public, anon, authenticated;
grant execute on function public.finalize_exam_if_closed(uuid) to service_role;

commit;
