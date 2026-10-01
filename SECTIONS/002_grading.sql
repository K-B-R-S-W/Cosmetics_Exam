-- =====================================================================
-- 002_grading.sql  —  PROPOSED, NOT RUN. Run after 001_initial.sql.
-- Small additions the grading worker needs (Section 5, Appendix A).
-- =====================================================================

-- 1. Record which model served each call and job (usage is counted per key + model + Pacific day)
alter table public.grading_log  add column if not exists model text;
alter table public.grading_jobs add column if not exists model text;

-- 2. Fast "calls used today" lookup for the worker and the progress page
create index if not exists idx_grading_log_usage
  on public.grading_log (key_label, model, at)
  where event = 'call';

-- 3. Idempotent AI writes: a job can score a question only once.
--    The worker inserts with ON CONFLICT DO NOTHING, so a crash between "insert scores" and
--    "mark job done" is safe to retry. Regrade rows (new job) and override rows (job_id null) are unaffected.
create unique index if not exists uq_question_scores_job_question
  on public.question_scores (job_id, question_id)
  where job_id is not null;
