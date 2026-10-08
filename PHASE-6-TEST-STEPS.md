# Phase 6 deferred live test steps

Run only after Phase 7 and after applying migrations 011 then 012 to the test project.

1. **Explicit dry-run first:** run `npm run dry-run` in `worker/`. Confirm one call per configured label, the exact model, and no key text in output or `grading_log`.
2. **Prompt harness:** run `npm run test:prompt`; a Sinhala reader checks the canonical Sinhala/Singlish cases and repeated scores stay within 0.5.
3. **Real 429 capture:** with a disposable spare key, capture the real Google response into a clearly real fixture. Do not relabel the checked-in synthetic fixtures.
4. **Broken-key failover:** break one test key; confirm it disables, one in-app alert appears, and another label continues.
5. **All keys exhausted:** confirm `keys_exhausted` pauses with `resume_at` and auto-resumes. `all_keys_disabled` and `model_not_found` require correction and manual Resume.
6. **Crash mid-write:** stop after score insertion and before job completion, restart, and confirm zero duplicate score rows.
7. **Full written run:** include blanks and more than ten written answers; check auto-zero rows, chunked jobs and per-attempt chunk indexes.
8. **Regrade and override:** confirm override remains current and duplicate queued single regrade returns `regrade_in_progress`.
9. **Regular-admin progress:** confirm a regular admin can view progress/review, cannot see Health, and polling pauses while hidden.

## Exact SQL checks

```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='grading_runs'
  and column_name in ('pause_reason','resume_at') order by column_name;

select indexname from pg_indexes where schemaname='public'
  and indexname in ('idx_grading_runs_paused_resume','idx_grading_jobs_pending_created');

select r.id, r.status, r.pause_reason, r.resume_at,
  count(*) filter (where j.status='pending') pending,
  count(*) filter (where j.status='running') running,
  count(*) filter (where j.status='done') done,
  count(*) filter (where j.status='failed') failed
from grading_runs r left join grading_jobs j on j.run_id=r.id
group by r.id order by r.started_at desc;

select attempt_id, chunk_index, question_ids, status, tries
from grading_jobs order by attempt_id, chunk_index;

select attempt_id, question_id, source, count(*)
from question_scores group by attempt_id, question_id, source order by attempt_id, question_id;

select job_id, question_id, count(*) from question_scores
where job_id is not null group by job_id, question_id having count(*) > 1;

select attempt_id, mcq_marks, written_marks, total_marks, total_percent from results order by attempt_id;
select event, key_label, model, detail, at from grading_log order by at desc limit 50;

select has_function_privilege('service_role','public.start_grading(uuid,uuid,integer,boolean)','EXECUTE') service_role,
       has_function_privilege('anon','public.start_grading(uuid,uuid,integer,boolean)','EXECUTE') anon,
       has_function_privilege('authenticated','public.start_grading(uuid,uuid,integer,boolean)','EXECUTE') authenticated;

select p.proname, p.proconfig,
       has_function_privilege('service_role', p.oid, 'EXECUTE') service_role,
       has_function_privilege('anon', p.oid, 'EXECUTE') anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'recompute_results','recompute_exam_results','start_grading',
  'start_question_regrade','start_attempt_regrade','resume_grading_run'
) order by p.proname;

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.grading_runs'::regclass
  and conname = 'grading_runs_pause_reason_check';
```
