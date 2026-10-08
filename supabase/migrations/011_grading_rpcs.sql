-- =====================================================================
-- 011_grading_rpcs.sql  -  Phase 6 (grading) database functions.
-- Run after 010_exam_end_deadline.sql. Safe to re-run (create or replace).
--
-- Why functions: each of these is a multi-step change that must be
-- atomic and must not race with save_answer_key (which takes FOR SHARE
-- on the exam row). Routes stay thin and map the exception codes below.
--
--   recompute_results(attempt)          single source of the results formula
--   recompute_exam_results(exam)        same, for every attempt with a paper
--   start_grading(...)                  6D.1  grade route
--   start_question_regrade(...)         6D.8  bulk regrade of one question
--   start_attempt_regrade(...)          6D.6  single-candidate regrade
--   resume_grading_run(...)             6D.2  resume route
--
-- Job claiming (6A.4) needs no function: supabase-js does the conditional
-- UPDATE ... WHERE status='pending' AND tries=<read value> directly.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Results formula (Section 3 contract 4.6.1). Reads current_scores,
--    never question_scores, so overrides always win.
--    Returns the upserted row; every column is null when the attempt has
--    no paper (a candidate who never joined has no results row).
-- ---------------------------------------------------------------------
create or replace function public.recompute_results(p_attempt_id uuid)
returns public.results
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.results;
begin
  insert into public.results (
    attempt_id, mcq_marks, written_marks, total_marks, total_percent, updated_at
  )
  select p.attempt_id,
         p.mcq_marks,
         p.written_marks,
         p.total_marks,
         case when p.total_marks > 0
              then round((p.mcq_marks + p.written_marks) / p.total_marks * 100, 2)
         end,
         now()
    from (
      select a.id as attempt_id,
             coalesce(sum(cs.marks) filter (where q.type = 'mcq'), 0)     as mcq_marks,
             coalesce(sum(cs.marks) filter (where q.type = 'written'), 0) as written_marks,
             sum(coalesce(cs.max_marks, q.marks))                         as total_marks
        from public.attempts a
        join public.attempt_questions aq on aq.attempt_id = a.id
        join public.questions q on q.id = aq.question_id
        left join public.current_scores cs
               on cs.attempt_id = a.id and cs.question_id = q.id
       where a.id = p_attempt_id
       group by a.id
    ) p
  on conflict (attempt_id) do update
     set mcq_marks     = excluded.mcq_marks,
         written_marks = excluded.written_marks,
         total_marks   = excluded.total_marks,
         total_percent = excluded.total_percent,
         updated_at    = excluded.updated_at
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.recompute_exam_results(p_exam_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt uuid;
  v_count integer := 0;
begin
  for v_attempt in
    select a.id
      from public.attempts a
     where a.exam_id = p_exam_id
       and exists (select 1 from public.attempt_questions aq where aq.attempt_id = a.id)
  loop
    perform public.recompute_results(v_attempt);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 2. Start grading (6D.1).
--    Errors (message codes): validation_failed, not_found,
--    exam_not_finalized, grading_in_progress (detail = run id),
--    missing_answer_keys (detail = JSON array of question ids).
--    p_mcq_only = true rescored MCQs only: no written rows, no jobs, the
--    run is 'done' at once.
-- ---------------------------------------------------------------------
create or replace function public.start_grading(
  p_exam_id uuid,
  p_started_by uuid,
  p_chunk_size integer,
  p_mcq_only boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam public.exams%rowtype;
  v_active uuid;
  v_missing uuid[];
  v_run_id uuid;
  v_attempts integer := 0;
  v_mcq integer := 0;
  v_zero integer := 0;
  v_jobs integer := 0;
begin
  if p_chunk_size is null or p_chunk_size < 1 or p_chunk_size > 20 then
    raise exception 'validation_failed';
  end if;

  -- FOR UPDATE conflicts with save_answer_key's FOR SHARE: a key edit
  -- cannot slip in between the key check and the run creation.
  select * into v_exam from public.exams e where e.id = p_exam_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_exam.status <> 'finalized' then raise exception 'exam_not_finalized'; end if;

  select r.id into v_active
    from public.grading_runs r
   where r.exam_id = p_exam_id and r.status in ('running', 'paused')
   limit 1;
  if v_active is not null then
    raise exception 'grading_in_progress' using detail = v_active::text;
  end if;

  select coalesce(array_agg(distinct q.id), '{}'::uuid[]) into v_missing
    from public.attempt_questions aq
    join public.attempts a on a.id = aq.attempt_id and a.exam_id = p_exam_id
    join public.questions q on q.id = aq.question_id
    left join public.answer_keys ak on ak.question_id = q.id
   where (q.type = 'mcq' and ak.correct_option_id is null)
      or (q.type = 'written' and not p_mcq_only
          and (ak.model_answer is null or btrim(ak.model_answer) = ''));
  if cardinality(v_missing) > 0 then
    raise exception 'missing_answer_keys' using detail = to_jsonb(v_missing)::text;
  end if;

  insert into public.grading_runs (exam_id, kind, status, started_by)
  values (p_exam_id, 'full', 'running', p_started_by)
  returning id into v_run_id;

  select count(distinct aq.attempt_id) into v_attempts
    from public.attempt_questions aq
    join public.attempts a on a.id = aq.attempt_id
   where a.exam_id = p_exam_id;

  -- MCQ scored in SQL: full marks only for the correct option, else 0.
  with scored as (
    insert into public.question_scores (
      attempt_id, question_id, source, marks, max_marks, reason, needs_review, created_by
    )
    select aq.attempt_id, aq.question_id, 'mcq',
           case when an.selected_option_id is not null
                 and an.selected_option_id = ak.correct_option_id
                then q.marks else 0 end,
           q.marks,
           case when an.selected_option_id is null then 'No answer' end,
           false,
           p_started_by
      from public.attempt_questions aq
      join public.attempts a on a.id = aq.attempt_id and a.exam_id = p_exam_id
      join public.questions q on q.id = aq.question_id and q.type = 'mcq'
      join public.answer_keys ak on ak.question_id = q.id
      left join public.answers an
             on an.attempt_id = aq.attempt_id and an.question_id = aq.question_id
    returning 1
  )
  select count(*) into v_mcq from scored;

  if not p_mcq_only then
    -- Blank written answers: zero, no Gemini call.
    with zeroed as (
      insert into public.question_scores (
        attempt_id, question_id, source, marks, max_marks, reason, details, needs_review, created_by
      )
      select aq.attempt_id, aq.question_id, 'ai', 0, q.marks,
             'No answer submitted', jsonb_build_object('auto_zero', true), false, p_started_by
        from public.attempt_questions aq
        join public.attempts a on a.id = aq.attempt_id and a.exam_id = p_exam_id
        join public.questions q on q.id = aq.question_id and q.type = 'written'
        left join public.answers an
               on an.attempt_id = aq.attempt_id and an.question_id = aq.question_id
       where an.answer_text is null or btrim(an.answer_text) = ''
      returning 1
    )
    select count(*) into v_zero from zeroed;

    -- Non-blank written answers: one job per attempt per chunk, in the
    -- candidate's own paper order.
    with chunked as (
      select aq.attempt_id, aq.question_id, aq.position,
             ((row_number() over (partition by aq.attempt_id order by aq.position) - 1)
               / p_chunk_size)::integer as chunk_index
        from public.attempt_questions aq
        join public.attempts a on a.id = aq.attempt_id and a.exam_id = p_exam_id
        join public.questions q on q.id = aq.question_id and q.type = 'written'
        join public.answers an
          on an.attempt_id = aq.attempt_id and an.question_id = aq.question_id
       where btrim(coalesce(an.answer_text, '')) <> ''
    ),
    created as (
      insert into public.grading_jobs (run_id, attempt_id, chunk_index, question_ids)
      select v_run_id, c.attempt_id, c.chunk_index,
             jsonb_agg(c.question_id order by c.position)
        from chunked c
       group by c.attempt_id, c.chunk_index
      returning 1
    )
    select count(*) into v_jobs from created;
  end if;

  perform public.recompute_exam_results(p_exam_id);

  if v_jobs = 0 then
    update public.grading_runs
       set status = 'done', finished_at = now()
     where id = v_run_id;
  end if;

  return jsonb_build_object(
    'run_id', v_run_id,
    'attempts', v_attempts,
    'jobs', v_jobs,
    'estimated_calls', v_jobs,
    'mcq_scored', v_mcq,
    'auto_zero', v_zero
  );
end $$;

-- ---------------------------------------------------------------------
-- 3. Bulk regrade of one question for every candidate (6D.8).
--    Errors: not_found, exam_not_finalized, grading_in_progress,
--    not_written, missing_answer_key.
-- ---------------------------------------------------------------------
create or replace function public.start_question_regrade(
  p_exam_id uuid,
  p_question_id uuid,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam public.exams%rowtype;
  v_type text;
  v_active uuid;
  v_run_id uuid;
  v_jobs integer := 0;
  v_overrides integer := 0;
begin
  select * into v_exam from public.exams e where e.id = p_exam_id for update;
  if not found then raise exception 'not_found'; end if;

  select q.type into v_type
    from public.questions q
   where q.id = p_question_id and q.exam_id = p_exam_id;
  if not found then raise exception 'not_found'; end if;

  if v_exam.status <> 'finalized' then raise exception 'exam_not_finalized'; end if;

  select r.id into v_active
    from public.grading_runs r
   where r.exam_id = p_exam_id and r.status in ('running', 'paused')
   limit 1;
  if v_active is not null then
    raise exception 'grading_in_progress' using detail = v_active::text;
  end if;

  if v_type <> 'written' then raise exception 'not_written'; end if;
  if not exists (
    select 1 from public.answer_keys ak
     where ak.question_id = p_question_id
       and ak.model_answer is not null and btrim(ak.model_answer) <> ''
  ) then
    raise exception 'missing_answer_key';
  end if;

  insert into public.grading_runs (exam_id, kind, status, started_by)
  values (p_exam_id, 'regrade', 'running', p_admin_id)
  returning id into v_run_id;

  with created as (
    insert into public.grading_jobs (run_id, attempt_id, chunk_index, question_ids)
    select v_run_id, aq.attempt_id, 0, jsonb_build_array(p_question_id)
      from public.attempt_questions aq
      join public.attempts a on a.id = aq.attempt_id and a.exam_id = p_exam_id
      join public.answers an
        on an.attempt_id = aq.attempt_id and an.question_id = aq.question_id
     where aq.question_id = p_question_id
       and btrim(coalesce(an.answer_text, '')) <> ''
    returning 1
  )
  select count(*) into v_jobs from created;

  select count(distinct qs.attempt_id) into v_overrides
    from public.question_scores qs
    join public.attempts a on a.id = qs.attempt_id and a.exam_id = p_exam_id
   where qs.question_id = p_question_id and qs.source = 'override';

  if v_jobs = 0 then
    update public.grading_runs
       set status = 'done', finished_at = now()
     where id = v_run_id;
  end if;

  insert into public.admin_actions (admin_id, action, target, detail)
  values (
    p_admin_id, 'regrade_question', p_question_id::text,
    jsonb_build_object(
      'exam_id', p_exam_id, 'run_id', v_run_id,
      'jobs', v_jobs, 'overrides_kept', v_overrides
    )
  );

  return jsonb_build_object('run_id', v_run_id, 'jobs', v_jobs, 'overrides_kept', v_overrides);
end $$;

-- ---------------------------------------------------------------------
-- 4. Single-candidate regrade (6D.6).
--    Errors: not_found, not_finalized, nothing_to_grade, missing_answer_key.
--    Does not block on other running runs (the worker handles several);
--    the exam-row lock only serialises it against answer-key edits.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 5. Resume a paused or failed run (6D.2).
--    Errors: not_found, not_resumable.
--    Failed jobs and 'running' jobs stuck for over 2 minutes go back to
--    pending with tries reset. p_failed_only = false also resets the
--    try counter on pending jobs that already used tries.
-- ---------------------------------------------------------------------
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
  v_requeued integer := 0;
begin
  select * into v_run from public.grading_runs r where r.id = p_run_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_run.status not in ('paused', 'failed') then raise exception 'not_resumable'; end if;

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
     set status = 'running', finished_at = null
   where id = p_run_id;

  insert into public.grading_log (run_id, event, detail)
  values (p_run_id, 'resumed', 'requeued=' || v_requeued);

  return jsonb_build_object('run_id', p_run_id, 'status', 'running', 'requeued_jobs', v_requeued);
end $$;

-- ---------------------------------------------------------------------
-- 6. Only the server (service_role) may call these.
-- ---------------------------------------------------------------------
revoke execute on function public.recompute_results(uuid)
  from public, anon, authenticated;
grant execute on function public.recompute_results(uuid) to service_role;

revoke execute on function public.recompute_exam_results(uuid)
  from public, anon, authenticated;
grant execute on function public.recompute_exam_results(uuid) to service_role;

revoke execute on function public.start_grading(uuid, uuid, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.start_grading(uuid, uuid, integer, boolean) to service_role;

revoke execute on function public.start_question_regrade(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.start_question_regrade(uuid, uuid, uuid) to service_role;

revoke execute on function public.start_attempt_regrade(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.start_attempt_regrade(uuid, uuid, uuid) to service_role;

revoke execute on function public.resume_grading_run(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.resume_grading_run(uuid, boolean) to service_role;

commit;
