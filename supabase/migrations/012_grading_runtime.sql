-- =====================================================================
-- 012_grading_runtime.sql - Phase 6 grading runtime hardening.
-- Run after 011_grading_rpcs.sql. Safe to re-run.
-- =====================================================================

begin;

alter table public.grading_runs
  add column if not exists pause_reason text,
  add column if not exists resume_at timestamptz;

alter table public.grading_runs
  drop constraint if exists grading_runs_pause_reason_check;
alter table public.grading_runs
  add constraint grading_runs_pause_reason_check
  check (pause_reason is null or pause_reason in (
    'keys_exhausted', 'all_keys_disabled', 'model_not_found'
  ));

create index if not exists idx_grading_runs_paused_resume
  on public.grading_runs (resume_at, id)
  where status = 'paused';

create index if not exists idx_grading_jobs_pending_created
  on public.grading_jobs (created_at, id)
  where status = 'pending';

-- Reject an attempt/question regrade already covered by queued work in an
-- active run. The exam row remains the first lock, matching 011.
create or replace function public.start_attempt_regrade(
  p_attempt_id uuid,
  p_question_id uuid,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_id uuid;
  v_status text;
  v_run_id uuid;
  v_job_id uuid;
  v_override boolean;
begin
  select a.exam_id, a.status into v_exam_id, v_status
    from public.attempts a
    join public.exams e on e.id = a.exam_id
   where a.id = p_attempt_id
   for update of e;
  if not found then raise exception 'not_found'; end if;
  if v_status <> 'finalized' then raise exception 'not_finalized'; end if;

  if exists (
    select 1
      from public.grading_jobs j
      join public.grading_runs r on r.id = j.run_id
     where j.attempt_id = p_attempt_id
       and j.status in ('pending', 'running')
       and r.status in ('running', 'paused')
       and j.question_ids @> jsonb_build_array(p_question_id)
  ) then
    raise exception 'regrade_in_progress';
  end if;

  if not exists (
    select 1
      from public.attempt_questions aq
      join public.questions q on q.id = aq.question_id and q.type = 'written'
      join public.answers an
        on an.attempt_id = aq.attempt_id and an.question_id = aq.question_id
     where aq.attempt_id = p_attempt_id
       and aq.question_id = p_question_id
       and btrim(coalesce(an.answer_text, '')) <> ''
  ) then
    raise exception 'nothing_to_grade';
  end if;

  if not exists (
    select 1 from public.answer_keys ak
     where ak.question_id = p_question_id
       and ak.model_answer is not null and btrim(ak.model_answer) <> ''
  ) then
    raise exception 'missing_answer_key';
  end if;

  insert into public.grading_runs (exam_id, kind, status, started_by)
  values (v_exam_id, 'regrade', 'running', p_admin_id)
  returning id into v_run_id;

  insert into public.grading_jobs (run_id, attempt_id, chunk_index, question_ids)
  values (v_run_id, p_attempt_id, 0, jsonb_build_array(p_question_id))
  returning id into v_job_id;

  select exists (
    select 1 from public.question_scores qs
     where qs.attempt_id = p_attempt_id
       and qs.question_id = p_question_id
       and qs.source = 'override'
  ) into v_override;

  insert into public.admin_actions (admin_id, action, target, detail)
  values (
    p_admin_id, 'regrade', p_attempt_id::text,
    jsonb_build_object('question_id', p_question_id, 'run_id', v_run_id, 'job_id', v_job_id)
  );

  return jsonb_build_object('run_id', v_run_id, 'job_id', v_job_id, 'override_present', v_override);
end $$;

-- Only one active run may exist for an exam when a paused or failed run is
-- resumed. Pause metadata is cleared atomically with the status change.
create or replace function public.resume_grading_run(
  p_run_id uuid,
  p_failed_only boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.grading_runs%rowtype;
  v_exam_id uuid;
  v_active uuid;
  v_requeued integer := 0;
begin
  -- Preserve the project-wide lock order: exam row before grading/run-owned
  -- rows. This also serializes two concurrent resume requests for one exam.
  select r.exam_id into v_exam_id from public.grading_runs r where r.id = p_run_id;
  if not found then raise exception 'not_found'; end if;
  perform 1 from public.exams e where e.id = v_exam_id for update;

  select * into v_run from public.grading_runs r where r.id = p_run_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_run.status not in ('paused', 'failed') then raise exception 'not_resumable'; end if;

  select r.id into v_active
    from public.grading_runs r
   where r.exam_id = v_run.exam_id
     and r.id <> p_run_id
     and r.status in ('running', 'paused')
   order by r.id
   limit 1;
  if v_active is not null then
    raise exception 'grading_in_progress' using detail = v_active::text;
  end if;

  update public.grading_jobs j
     set status = 'pending', tries = 0, error = null, locked_at = null, finished_at = null
   where j.run_id = p_run_id
     and (
       j.status = 'failed'
       or (j.status = 'running'
           and coalesce(j.locked_at, now() - interval '1 day') < now() - interval '2 minutes')
       or (not p_failed_only and j.status = 'pending' and j.tries > 0)
     );
  get diagnostics v_requeued = row_count;

  update public.grading_runs
     set status = 'running', finished_at = null,
         pause_reason = null, resume_at = null
   where id = p_run_id;

  insert into public.grading_log (run_id, event, detail)
  values (p_run_id, 'resumed', 'requeued=' || v_requeued);

  return jsonb_build_object('run_id', p_run_id, 'status', 'running', 'requeued_jobs', v_requeued);
end $$;

revoke execute on function public.start_attempt_regrade(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.start_attempt_regrade(uuid, uuid, uuid) to service_role;

revoke execute on function public.resume_grading_run(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.resume_grading_run(uuid, boolean) to service_role;

commit;
