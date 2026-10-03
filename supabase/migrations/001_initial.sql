-- =====================================================================
-- 001_initial.sql  —  Exam platform: consolidated initial migration
-- Target: a FRESH Supabase project (current project: PostgreSQL 17.11).
-- Run once in the Supabase SQL editor, or place in supabase/migrations/.
-- Order: extensions -> tables -> indexes -> functions/triggers
--        -> RLS/policies -> views -> realtime/storage -> seed -> hardening
-- Conventions:
--   * all timestamps are timestamptz (UTC)
--   * "position" / "current_position" are 0-based indexes
--   * candidates never use Supabase directly; the Next.js API and the
--     worker use the service role (bypasses RLS). Admins use Supabase Auth.
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- 1. TABLES
-- =====================================================================

create table public.admin_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  role        text not null default 'admin' check (role in ('admin', 'super_admin')),
  created_at  timestamptz not null default now()
);

create table public.candidates (
  id          uuid primary key default gen_random_uuid(),
  mer_code    text not null unique,            -- API normalizes (trim + upper) before insert/lookup
  full_name   text not null,
  outlet      text,
  nic_hash    text not null,                   -- argon2 hash of the normalized ID; never the ID itself
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.exams (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  instructions        text,
  scheduled_start_at  timestamptz,
  started_at          timestamptz,             -- set when the exam goes live
  ends_at             timestamptz,             -- set when live; +minutes on extend; = now() on force-end
  force_ended_at      timestamptz,             -- non-null only if an admin force-ended the exam
  duration_min        int  not null check (duration_min > 0),
  status              text not null default 'draft'
                      check (status in ('draft', 'scheduled', 'live', 'ended', 'finalized')),
  navigation_mode     text not null default 'free' check (navigation_mode in ('free', 'sequential')),
  questions_per_paper int  check (questions_per_paper is null or questions_per_paper > 0),
  shuffle             boolean not null default false,
  flag_threshold      int  not null default 10 check (flag_threshold between 1 and 100),
  is_practice         boolean not null default false,
  created_by          uuid references public.admin_profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint exams_scheduled_has_time
    check (status <> 'scheduled' or scheduled_start_at is not null),
  constraint exams_live_has_times
    check (status not in ('live', 'ended', 'finalized') or (started_at is not null and ends_at is not null))
);

create table public.exam_candidates (
  exam_id       uuid not null references public.exams (id) on delete cascade,
  candidate_id  uuid not null references public.candidates (id) on delete cascade,
  primary key (exam_id, candidate_id)
);

create table public.questions (
  id         uuid primary key default gen_random_uuid(),
  exam_id    uuid not null references public.exams (id) on delete cascade,
  position   int  not null,                    -- admin ordering; not unique so drag-and-drop reorders are simple
  type       text not null check (type in ('mcq', 'written')),
  body_html  text not null,                    -- sanitized server-side (sanitize-html) before insert
  image_path text,                             -- path in private 'question-images' bucket
  image_alt_text text,                         -- required when an image is present
  image_mime text,
  image_size_bytes int,
  marks      numeric(5,2) not null default 1 check (marks > 0),
  created_at timestamptz not null default now(),
  constraint questions_image_all_or_none check (
    num_nonnulls(image_path, image_alt_text, image_mime, image_size_bytes) = 0
    or (
      num_nonnulls(image_path, image_alt_text, image_mime, image_size_bytes) = 4
      and btrim(image_path) <> ''
      and char_length(btrim(image_alt_text)) between 1 and 500
      and image_mime in ('image/jpeg', 'image/png', 'image/webp')
      and image_size_bytes between 1 and 4194304
    )
  )
);

create table public.mcq_options (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions (id) on delete cascade,
  position     int  not null,
  label        text not null,                  -- a, b, c, d, ...
  text_html    text not null
);

-- Examiner answers. NEVER read by candidate routes.
create table public.answer_keys (
  question_id        uuid primary key references public.questions (id) on delete cascade,
  correct_option_id  uuid references public.mcq_options (id) on delete set null,   -- MCQ
  model_answer       text,                                                           -- written
  grading_notes      text,
  calibration        jsonb                      -- [{ "answer": "...", "marks": 1.5, "note": "..." }]
);

create table public.attempts (
  id               uuid primary key default gen_random_uuid(),
  exam_id          uuid not null references public.exams (id) on delete cascade,
  candidate_id     uuid not null references public.candidates (id) on delete cascade,
  status           text not null default 'not_started'
                   check (status in ('not_started', 'acknowledged', 'in_progress', 'submitted', 'finalized')),
  submit_reason    text check (submit_reason in ('manual', 'auto', 'forced')),
  current_position int  not null default 0 check (current_position >= 0),   -- sequential mode only
  extra_minutes    int  not null default 0 check (extra_minutes >= 0),
  acknowledged_at  timestamptz,
  joined_at        timestamptz,
  submitted_at     timestamptz,
  last_seen_at     timestamptz,
  violation_count  int  not null default 0,    -- incidents that count toward the flag threshold
  created_at       timestamptz not null default now(),
  unique (exam_id, candidate_id),
  constraint attempts_submitted_has_reason
    check (status not in ('submitted', 'finalized') or (submit_reason is not null and submitted_at is not null))
);

-- The candidate's own paper: which questions, in which order, with which option order.
create table public.attempt_questions (
  attempt_id    uuid not null references public.attempts (id) on delete cascade,
  question_id   uuid not null references public.questions (id) on delete cascade,
  position      int  not null,                 -- 0-based; matches attempts.current_position
  option_order  jsonb,                         -- array of mcq_options ids (null for written)
  primary key (attempt_id, question_id),
  unique (attempt_id, position)
);

create table public.sessions (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references public.candidates (id) on delete cascade,
  attempt_id    uuid references public.attempts (id) on delete cascade,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  ip            text,
  user_agent    text
);

create table public.answers (
  id                  uuid primary key default gen_random_uuid(),
  attempt_id          uuid not null references public.attempts (id) on delete cascade,
  question_id         uuid not null references public.questions (id) on delete cascade,
  answer_text         text check (answer_text is null or char_length(answer_text) <= 20000),
  selected_option_id  uuid references public.mcq_options (id) on delete set null,
  flagged             boolean not null default false,
  revision            int  not null default 0,  -- client counter; only a higher revision overwrites
  updated_at          timestamptz not null default now(),
  unique (attempt_id, question_id)
);

-- One row = one INCIDENT (events within ~3 s are merged client-side into one row).
create table public.violation_events (
  id             uuid primary key default gen_random_uuid(),
  attempt_id     uuid not null references public.attempts (id) on delete cascade,
  type           text not null check (type in (
                   'TAB_HIDDEN', 'FOCUS_LOST', 'FULLSCREEN_EXIT', 'VIEWPORT_CHANGED', 'MULTI_SCREEN',
                   'CAMERA_LOST', 'MIC_LOST', 'DISCONNECTED', 'RECONNECTED', 'MULTI_LOGIN',
                   'COPY', 'PASTE', 'CONTEXT_MENU', 'RELOAD')),
  merged_types   text[] not null default '{}',   -- other event types merged into this incident
  counts         boolean not null default true,  -- false for informational rows (e.g. RECONNECTED)
  occurred_at    timestamptz not null default now(),
  duration_ms    int check (duration_ms is null or duration_ms >= 0),
  meta           jsonb,
  snapshot_path  text                            -- path in the private 'snapshots' bucket
);

create table public.grading_runs (
  id           uuid primary key default gen_random_uuid(),
  exam_id      uuid not null references public.exams (id) on delete cascade,
  kind         text not null default 'full' check (kind in ('full', 'regrade')),
  status       text not null default 'running' check (status in ('running', 'paused', 'done', 'failed')),
  started_by   uuid references public.admin_profiles (id) on delete set null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

-- One job = one Gemini call for one candidate and a chunk (<= ~10) of their written questions.
-- A single-question regrade is its own run (kind = 'regrade') with one job.
create table public.grading_jobs (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.grading_runs (id) on delete cascade,
  attempt_id    uuid not null references public.attempts (id) on delete cascade,
  chunk_index   int  not null default 0,
  question_ids  jsonb not null,                 -- array of question ids this job covers
  status        text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  key_label     text,
  tries         int  not null default 0,
  error         text,
  locked_at     timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  unique (run_id, attempt_id, chunk_index)
);

-- Per-question scores. Rows are never edited: regrade/override INSERT a new row.
create table public.question_scores (
  id            uuid primary key default gen_random_uuid(),
  attempt_id    uuid not null references public.attempts (id) on delete cascade,
  question_id   uuid not null references public.questions (id) on delete cascade,
  source        text not null check (source in ('mcq', 'ai', 'override')),
  marks         numeric(5,2) not null,
  max_marks     numeric(5,2) not null,
  reason        text,
  note          text,                           -- admin note on an override
  details       jsonb,                          -- { matched_points, missing_points, incorrect_claims, confidence, language, candidate_meaning_english, verdict }
  needs_review  boolean not null default false,
  job_id        uuid references public.grading_jobs (id) on delete set null,
  created_by    uuid references public.admin_profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint question_scores_marks_in_range check (marks >= 0 and marks <= max_marks)
);

create table public.results (
  attempt_id     uuid primary key references public.attempts (id) on delete cascade,
  mcq_marks      numeric(6,2) not null default 0,
  written_marks  numeric(6,2) not null default 0,
  total_marks    numeric(6,2) not null default 0,   -- sum of max marks of THIS candidate's paper
  total_percent  numeric(5,2),
  updated_at     timestamptz not null default now()
);

create table public.api_key_state (
  label           text primary key,               -- 'key1' .. 'key3'; the key text lives only in worker env vars
  status          text not null default 'active' check (status in ('active', 'cooldown', 'disabled')),
  cooldown_until  timestamptz,
  last_error      text,
  updated_at      timestamptz not null default now()
);

create table public.grading_log (
  id         bigserial primary key,
  run_id     uuid references public.grading_runs (id) on delete cascade,
  job_id     uuid references public.grading_jobs (id) on delete set null,
  key_label  text,
  event      text not null,                       -- started, done, rate_limited, key_disabled, retry, paused, resumed
  detail     text,
  at         timestamptz not null default now()
);

create table public.login_attempts (
  id            bigserial primary key,
  mer_code      text,
  ip            text,
  success       boolean not null,
  attempted_at  timestamptz not null default now()
);

create table public.alerts (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,
  severity     text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  message      text not null,
  unique_key   text,                              -- dedup: one ACTIVE alert per key
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz                        -- null = active
);

create table public.system_health (
  component          text primary key,            -- 'worker'
  status             text not null default 'down' check (status in ('ok', 'degraded', 'down')),
  last_heartbeat_at  timestamptz,
  detail             text
);

create table public.admin_actions (
  id        bigserial primary key,
  admin_id  uuid references public.admin_profiles (id) on delete set null,
  action    text not null,                        -- start, extend, force_end, force_submit, kick, broadcast, override, ...
  target    text,
  detail    jsonb,
  at        timestamptz not null default now()
);

create table public.broadcasts (
  id               uuid primary key default gen_random_uuid(),
  exam_id          uuid not null references public.exams (id) on delete cascade,
  message          text not null check (char_length(btrim(message)) between 1 and 5000),
  audience         text not null check (audience in ('all', 'custom')),
  sent_at          timestamptz not null default now()
);

-- A row is created for every intended recipient, including an "all candidates" send.
-- This snapshots the audience at send time and makes one-time display durable.
create table public.broadcast_recipients (
  broadcast_id  uuid not null references public.broadcasts (id) on delete cascade,
  candidate_id  uuid not null references public.candidates (id) on delete cascade,
  shown_at      timestamptz,
  claim_token   uuid,
  constraint broadcast_recipients_claim_all_or_none check (num_nonnulls(shown_at, claim_token) in (0, 2)),
  primary key (broadcast_id, candidate_id)
);

-- =====================================================================
-- 2. INDEXES
-- =====================================================================

create index idx_questions_exam            on public.questions (exam_id, position);
create index idx_mcq_options_question      on public.mcq_options (question_id, position);
create index idx_exam_candidates_candidate on public.exam_candidates (candidate_id);
create index idx_attempts_exam_status      on public.attempts (exam_id, status);
create index idx_attempts_candidate        on public.attempts (candidate_id);
create index idx_attempt_questions_attempt on public.attempt_questions (attempt_id);
create index idx_sessions_candidate        on public.sessions (candidate_id, revoked_at);
create index idx_answers_attempt           on public.answers (attempt_id);
create index idx_violation_events_attempt  on public.violation_events (attempt_id, occurred_at);
create index idx_grading_jobs_run_status   on public.grading_jobs (run_id, status);
create index idx_grading_jobs_locked       on public.grading_jobs (status, locked_at);
create index idx_question_scores_current   on public.question_scores (attempt_id, question_id, created_at desc);
create index idx_grading_log_run           on public.grading_log (run_id, at);
create index idx_login_attempts_mer        on public.login_attempts (mer_code, attempted_at) where success = false;
create index idx_login_attempts_ip         on public.login_attempts (ip, attempted_at) where success = false;
create index idx_broadcast_recipients_unshown on public.broadcast_recipients (candidate_id, broadcast_id) where shown_at is null;
-- Alert dedup: at most one ACTIVE alert per unique_key
create unique index uq_alerts_active_key   on public.alerts (unique_key) where resolved_at is null and unique_key is not null;

-- =====================================================================
-- 3. FUNCTIONS AND TRIGGERS
-- =====================================================================

-- 3.1 results.updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_results_updated_at
  before update on public.results
  for each row execute function public.set_updated_at();

-- 3.2 Count incidents toward the flag threshold (admin badges update via Realtime on attempts)
create or replace function public.bump_violation_count()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.counts then
      update public.attempts set violation_count = violation_count + 1 where id = new.attempt_id;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.counts = false and new.counts = true then
      update public.attempts set violation_count = violation_count + 1 where id = new.attempt_id;
    elsif old.counts = true and new.counts = false then
      update public.attempts set violation_count = greatest(violation_count - 1, 0) where id = new.attempt_id;
    end if;
  end if;
  return new;
end $$;

create trigger trg_violation_events_count
  after insert or update of counts on public.violation_events
  for each row execute function public.bump_violation_count();

create or replace function public.resolve_disconnects()
returns void language plpgsql as $$
begin
  update public.violation_events ve
  set meta = jsonb_set(ve.meta, '{count_reason}', '"overlap"')
  from public.attempts a
  where a.id = ve.attempt_id
    and ve.type = 'DISCONNECTED'
    and ve.counts = false
    and ve.meta->>'count_reason' is null
    and (ve.meta->>'last_seen_at')::timestamptz < now() - interval '2 minutes'
    and a.last_seen_at = (ve.meta->>'last_seen_at')::timestamptz
    and a.status = 'in_progress'
    and exists (
      select 1 from public.violation_events f
      where f.attempt_id = ve.attempt_id
        and f.type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED')
        and f.occurred_at + (coalesce(f.duration_ms, 0) * interval '1 millisecond')
            >= (ve.meta->>'last_seen_at')::timestamptz - interval '10 seconds'
    );

  update public.violation_events ve
  set counts = true,
      meta = jsonb_set(ve.meta, '{count_reason}', '"long_gap"')
  from public.attempts a
  where a.id = ve.attempt_id
    and a.status = 'in_progress'
    and ve.type = 'DISCONNECTED'
    and ve.counts = false
    and ve.meta->>'count_reason' is null
    and (ve.meta->>'last_seen_at')::timestamptz < now() - interval '2 minutes'
    and a.last_seen_at = (ve.meta->>'last_seen_at')::timestamptz;
end $$;

create or replace function public.reverse_disconnects_for_incident(p_event_id uuid)
returns int language plpgsql as $$
declare
  v_n int;
begin
  with inc as (
    select attempt_id,
           occurred_at,
           occurred_at + (coalesce(duration_ms, 0) * interval '1 millisecond') as ends_at
    from public.violation_events
    where id = p_event_id
      and type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED')
  ), upd as (
    update public.violation_events d
    set counts = false,
        meta = jsonb_set(d.meta, '{count_reason}', '"reversed_by_focus"')
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
            now())
    returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end $$;

-- 3.3 Assigning a candidate to an exam creates their (not_started) attempt, so the admin grid
--     can show "Not joined" for everyone. Unassigning removes it only if they never started.
create or replace function public.sync_attempt_on_assign()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.attempts (exam_id, candidate_id)
    values (new.exam_id, new.candidate_id)
    on conflict (exam_id, candidate_id) do nothing;
    return new;
  else
    delete from public.attempts
     where exam_id = old.exam_id and candidate_id = old.candidate_id and status = 'not_started';
    return old;
  end if;
end $$;

create trigger trg_exam_candidates_sync
  after insert or delete on public.exam_candidates
  for each row execute function public.sync_attempt_on_assign();

-- 3.4 Role helpers for RLS (security definer so policies on admin_profiles cannot recurse)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_profiles where id = auth.uid());
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_profiles where id = auth.uid() and role = 'super_admin');
$$;

-- 3.5 A candidate's deadline = exam end + their extra minutes. Saves are accepted for 15 s more.
create or replace function public.attempt_deadline(p_attempt_id uuid)
returns timestamptz language sql stable as $$
  select e.ends_at + make_interval(mins => a.extra_minutes)
    from public.attempts a join public.exams e on e.id = a.exam_id
   where a.id = p_attempt_id;
$$;

-- 3.6 generate_paper(): atomic, idempotent paper creation (question pool + shuffle + option order).
--     Locks the attempt row so a double refresh at exam start cannot create two different papers.
--     Raises: attempt_not_found, not_acknowledged, attempt_closed, exam_not_live, exam_has_no_questions.
create or replace function public.generate_paper(p_attempt_id uuid)
returns setof public.attempt_questions
language plpgsql as $$
declare
  v_attempt  public.attempts%rowtype;
  v_exam     public.exams%rowtype;
  v_total    int;
  v_take     int;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if not found then raise exception 'attempt_not_found'; end if;

  select * into v_exam from public.exams where id = v_attempt.exam_id;

  if v_attempt.status = 'not_started'              then raise exception 'not_acknowledged'; end if;
  if v_attempt.status in ('submitted', 'finalized') then raise exception 'attempt_closed';    end if;
  if v_exam.status <> 'live' or v_exam.force_ended_at is not null then raise exception 'exam_not_live'; end if;

  if not exists (select 1 from public.attempt_questions where attempt_id = p_attempt_id) then
    select count(*) into v_total from public.questions where exam_id = v_exam.id;
    if v_total = 0 then raise exception 'exam_has_no_questions'; end if;
    v_take := least(coalesce(v_exam.questions_per_paper, v_total), v_total);

    insert into public.attempt_questions (attempt_id, question_id, position, option_order)
    with picked as (
      select q.id, q.type, q.position as qpos
        from public.questions q
       where q.exam_id = v_exam.id
       order by random()
       limit v_take
    ), ordered as (
      select p.id, p.type,
             (row_number() over (order by case when v_exam.shuffle then random() else p.qpos::float8 end) - 1)::int as pos
        from picked p
    )
    select p_attempt_id, o.id, o.pos,
           case when o.type = 'mcq' then
             (select jsonb_agg(op.id order by case when v_exam.shuffle then random() else op.position::float8 end)
                from public.mcq_options op
               where op.question_id = o.id)
           end
      from ordered o;
  end if;

  update public.attempts
     set status = 'in_progress', joined_at = coalesce(joined_at, now())
   where id = p_attempt_id and status = 'acknowledged';

  return query
    select aq.* from public.attempt_questions aq
     where aq.attempt_id = p_attempt_id
     order by aq.position;
end $$;

-- 3.7 save_answer(): the single write path for answers. Enforces, atomically and with the DATABASE clock:
--     attempt in progress; normal live deadline or the 15 s force-end collection window; question belongs to the
--     paper, sequential position guard (only the CURRENT question), option belongs to the question,
--     and "only a higher revision overwrites".
--     Returns: saved | stale_revision | closed | not_found | not_in_paper | wrong_position | bad_option
create or replace function public.save_answer(
  p_attempt_id         uuid,
  p_question_id        uuid,
  p_answer_text        text,
  p_selected_option_id uuid,
  p_flagged            boolean,
  p_revision           int
) returns text
language plpgsql as $$
declare
  v_attempt  public.attempts%rowtype;
  v_exam     public.exams%rowtype;
  v_pos      int;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id;
  if not found then return 'not_found'; end if;
  select * into v_exam from public.exams where id = v_attempt.exam_id;

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
     )
  then
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
       select 1 from public.mcq_options o where o.id = p_selected_option_id and o.question_id = p_question_id) then
    return 'bad_option';
  end if;

  insert into public.answers as an (attempt_id, question_id, answer_text, selected_option_id, flagged, revision, updated_at)
  values (p_attempt_id, p_question_id, p_answer_text, p_selected_option_id, coalesce(p_flagged, false), p_revision, now())
  on conflict (attempt_id, question_id) do update
     set answer_text        = excluded.answer_text,
         selected_option_id = excluded.selected_option_id,
         flagged            = excluded.flagged,
         revision           = excluded.revision,
         updated_at         = now()
   where an.revision < excluded.revision;

  if not found then return 'stale_revision'; end if;
  return 'saved';
end $$;

-- 3.8 advance_position(): sequential-mode "Next". Atomic and idempotent via p_expected_position.
--     Saves the current answer, then moves current_position forward by one.
--     out_result: advanced | already_advanced | out_of_sync | last_question | closed | not_found
--                 | not_sequential | wrong_question | (any non-saved result from save_answer)
create or replace function public.advance_position(
  p_attempt_id         uuid,
  p_expected_position  int,
  p_question_id        uuid,
  p_answer_text        text,
  p_selected_option_id uuid,
  p_revision           int
) returns table (out_result text, out_position int)
language plpgsql as $$
declare
  v_attempt  public.attempts%rowtype;
  v_exam     public.exams%rowtype;
  v_total    int;
  v_qid      uuid;
  v_save     text;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;
  select * into v_exam from public.exams where id = v_attempt.exam_id;

  if v_exam.navigation_mode <> 'sequential' then
    return query select 'not_sequential'::text, v_attempt.current_position;
    return;
  end if;

  if v_attempt.status <> 'in_progress'
     or v_exam.status <> 'live'
     or v_exam.force_ended_at is not null
     or v_exam.ends_at is null
     or now() > v_exam.ends_at + make_interval(mins => v_attempt.extra_minutes) + interval '15 seconds'
  then
    return query select 'closed'::text, v_attempt.current_position;
    return;
  end if;

  -- Idempotency: a retried or double-tapped Next never skips a question
  if v_attempt.current_position > p_expected_position then
    return query select 'already_advanced'::text, v_attempt.current_position;
    return;
  elsif v_attempt.current_position < p_expected_position then
    return query select 'out_of_sync'::text, v_attempt.current_position;
    return;
  end if;

  select count(*) into v_total from public.attempt_questions aq where aq.attempt_id = p_attempt_id;
  select aq.question_id into v_qid
    from public.attempt_questions aq
   where aq.attempt_id = p_attempt_id and aq.position = v_attempt.current_position;

  if v_qid is null or v_qid <> p_question_id then
    return query select 'wrong_question'::text, v_attempt.current_position;
    return;
  end if;

  if v_attempt.current_position >= v_total - 1 then
    return query select 'last_question'::text, v_attempt.current_position;   -- the last question uses Submit
    return;
  end if;

  if (p_answer_text is not null and btrim(p_answer_text) <> '') or p_selected_option_id is not null then
    v_save := public.save_answer(p_attempt_id, p_question_id, p_answer_text, p_selected_option_id, false, p_revision);
    if v_save not in ('saved', 'stale_revision') then
      return query select v_save, v_attempt.current_position;
      return;
    end if;
  end if;

  update public.attempts set current_position = current_position + 1 where id = p_attempt_id;
  return query select 'advanced'::text, v_attempt.current_position + 1;
end $$;

-- 3.9 submit_attempt(): idempotent submit for manual / auto / forced paths. Returns true if it changed anything.
create or replace function public.submit_attempt(p_attempt_id uuid, p_reason text)
returns boolean
language plpgsql as $$
begin
  if p_reason not in ('manual', 'auto', 'forced') then
    raise exception 'invalid_reason';
  end if;
  update public.attempts
     set status = 'submitted', submit_reason = p_reason, submitted_at = now()
   where id = p_attempt_id and status in ('not_started', 'acknowledged', 'in_progress');
  return found;
end $$;

-- 3.10 create_broadcast(): validate and snapshot all/custom recipients atomically.
drop function if exists public.create_broadcast(uuid, text, smallint, text, uuid[]);
drop function if exists public.create_broadcast(uuid, text, text, uuid[]);
create function public.create_broadcast(
  p_exam_id uuid,
  p_message text,
  p_audience text,
  p_candidate_ids uuid[] default null
)
returns table(out_broadcast_id uuid, out_recipient_count int)
language plpgsql as $$
declare
  v_broadcast_id uuid;
  v_recipient_count int;
  v_exam_status text;
begin
  select status into v_exam_status from public.exams where id = p_exam_id;
  if not found then raise exception 'exam_not_found'; end if;
  if v_exam_status not in ('scheduled', 'live') then raise exception 'invalid_status'; end if;
  if p_message is null or char_length(btrim(p_message)) not between 1 and 5000 then
    raise exception 'invalid_message';
  end if;
  if p_audience not in ('all', 'custom') then raise exception 'invalid_audience'; end if;
  if p_audience = 'all' and p_candidate_ids is not null then
    raise exception 'candidate_ids_not_allowed';
  end if;
  if p_audience = 'custom' then
    if p_candidate_ids is null or cardinality(p_candidate_ids) = 0 then
      raise exception 'no_recipients';
    end if;
    if exists (
      select 1
        from unnest(p_candidate_ids) as requested(candidate_id)
        left join public.exam_candidates assigned
          on assigned.exam_id = p_exam_id and assigned.candidate_id = requested.candidate_id
       where assigned.candidate_id is null
    ) then
      raise exception 'invalid_recipient';
    end if;
  end if;

  insert into public.broadcasts (exam_id, message, audience)
  values (p_exam_id, btrim(p_message), p_audience)
  returning id into v_broadcast_id;

  if p_audience = 'all' then
    insert into public.broadcast_recipients (broadcast_id, candidate_id)
    select v_broadcast_id, candidate_id
      from public.exam_candidates
     where exam_id = p_exam_id;
  else
    insert into public.broadcast_recipients (broadcast_id, candidate_id)
    select v_broadcast_id, requested.candidate_id
      from (select distinct unnest(p_candidate_ids) as candidate_id) requested;
  end if;

  get diagnostics v_recipient_count = row_count;
  if v_recipient_count = 0 then raise exception 'no_recipients'; end if;
  return query select v_broadcast_id, v_recipient_count;
end $$;

-- 3.11 claim_broadcast(): exactly-once display with safe replay of a lost HTTP response.
drop function if exists public.claim_broadcast(uuid, uuid, uuid);
create function public.claim_broadcast(
  p_broadcast_id uuid,
  p_candidate_id uuid,
  p_claim_token uuid
)
returns table(out_display boolean, out_message text, out_sent_at timestamptz)
language plpgsql as $$
declare
  v_message text;
  v_sent_at timestamptz;
begin
  if p_claim_token is null then raise exception 'invalid_claim_token'; end if;

  update public.broadcast_recipients recipient
     set shown_at = now(), claim_token = p_claim_token
    from public.broadcasts broadcast
   where recipient.broadcast_id = p_broadcast_id
     and recipient.candidate_id = p_candidate_id
     and recipient.shown_at is null
     and broadcast.id = recipient.broadcast_id
     and broadcast.sent_at >= now() - interval '10 minutes'
  returning broadcast.message, broadcast.sent_at
       into v_message, v_sent_at;

  if found then
    return query select true, v_message, v_sent_at;
    return;
  end if;

  -- The same token may replay after a lost response; a new token may not show it again.
  select broadcast.message, broadcast.sent_at
    into v_message, v_sent_at
    from public.broadcast_recipients recipient
    join public.broadcasts broadcast on broadcast.id = recipient.broadcast_id
   where recipient.broadcast_id = p_broadcast_id
     and recipient.candidate_id = p_candidate_id
     and recipient.claim_token = p_claim_token
     and broadcast.sent_at >= now() - interval '10 minutes';

  if found then
    return query select true, v_message, v_sent_at;
  else
    return query select false, null::text, null::timestamptz;
  end if;
end $$;

-- =====================================================================
-- 4. ROW-LEVEL SECURITY
--    Candidates use the API (service role, bypasses RLS). The browser anon key gets NOTHING.
-- =====================================================================

-- 4.1 Enable RLS on every application table. Direct authenticated access is read-only
--     and limited to the tables needed for admin identity and Realtime subscriptions.
do $$
declare t text;
begin
  foreach t in array array[
    'admin_profiles', 'candidates', 'exams', 'exam_candidates', 'questions', 'mcq_options',
    'answer_keys', 'attempts', 'attempt_questions', 'sessions', 'answers', 'violation_events',
    'grading_runs', 'grading_jobs', 'question_scores', 'results', 'api_key_state',
    'grading_log', 'login_attempts', 'alerts', 'system_health', 'admin_actions',
    'broadcasts', 'broadcast_recipients'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 4.2 Admin Realtime reads. All initial loads and all writes go through server routes.
do $$
declare t text;
begin
  foreach t in array array['attempts', 'violation_events', 'grading_jobs', 'grading_log', 'exams'] loop
    execute format(
      'create policy "admins read realtime" on public.%I for select to authenticated
         using ((select public.is_admin()))', t);
  end loop;
end $$;

create policy "super admins read alerts" on public.alerts
  for select to authenticated using ((select public.is_super_admin()));

-- 4.3 admin_profiles: authenticated admins may read only their own row.
create policy "read own profile" on public.admin_profiles
  for select to authenticated using (id = auth.uid());

-- =====================================================================
-- 5. VIEWS  (security_invoker so RLS applies to the caller)
-- =====================================================================

-- Current score per (attempt, question): an override ALWAYS wins; otherwise the latest row wins.
create view public.current_scores with (security_invoker = true) as
select distinct on (attempt_id, question_id)
       id, attempt_id, question_id, source, marks, max_marks, reason, note, details, needs_review, created_at
  from public.question_scores
 order by attempt_id, question_id, (source = 'override') desc, created_at desc, id desc;

-- Per-candidate progress for the admin live grid ("Q 7/20" or "14 answered")
create view public.attempt_progress with (security_invoker = true) as
select a.id as attempt_id, a.exam_id, a.status, a.current_position,
       (select count(*) from public.attempt_questions aq where aq.attempt_id = a.id) as total_questions,
       (select count(*) from public.answers an
         where an.attempt_id = a.id
           and ((an.answer_text is not null and btrim(an.answer_text) <> '') or an.selected_option_id is not null)) as answered_count,
       (select count(*) from public.answers an where an.attempt_id = a.id and an.flagged) as flagged_count
  from public.attempts a;

-- Deadlines for the worker scheduler (force-submit uses grace_deadline)
create view public.attempt_deadlines with (security_invoker = true) as
select a.id as attempt_id, a.exam_id, a.status,
       e.ends_at + make_interval(mins => a.extra_minutes)                          as deadline,
       e.ends_at + make_interval(mins => a.extra_minutes) + interval '15 seconds' as grace_deadline
  from public.attempts a join public.exams e on e.id = a.exam_id;

-- =====================================================================
-- 6. REALTIME AND STORAGE
-- =====================================================================

alter publication supabase_realtime add table
  public.attempts, public.violation_events, public.grading_jobs, public.grading_log,
  public.alerts, public.exams;

insert into storage.buckets (id, name, public)
values ('snapshots', 'snapshots', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-images', 'question-images', false, 4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "admins read snapshots" on storage.objects
  for select to authenticated
  using (bucket_id = 'snapshots' and public.is_admin());

create policy "admins read question images" on storage.objects
  for select to authenticated
  using (bucket_id = 'question-images' and public.is_admin());
-- Uploads and deletes happen through the API / worker (service role). Candidates receive
-- question images only through an authenticated API route that verifies attempt membership.

-- =====================================================================
-- 7. SEED
-- =====================================================================

insert into public.api_key_state (label) values ('key1'), ('key2'), ('key3')
on conflict (label) do nothing;

insert into public.system_health (component, status) values ('worker', 'down')
on conflict (component) do nothing;

-- Admins: create each user in Supabase Dashboard -> Authentication -> Users, then run:
--   insert into public.admin_profiles (id, name, role)
--   values ('<auth user uuid>', 'Your Name', 'super_admin');   -- or 'admin'

-- =====================================================================
-- 8. DATA API GRANTS
--    This is the only grants block. It runs after every object exists.
-- =====================================================================

revoke all on schema public from public, anon, authenticated, service_role;
revoke all on all tables in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke execute on all functions in schema public from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;

grant usage on schema public to authenticated, service_role;

grant select on table
  public.admin_profiles,
  public.attempts,
  public.violation_events,
  public.grading_jobs,
  public.grading_log,
  public.alerts,
  public.exams
to authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_super_admin() to authenticated;

grant select, insert, update, delete on table
  public.admin_profiles,
  public.candidates,
  public.exams,
  public.exam_candidates,
  public.questions,
  public.mcq_options,
  public.answer_keys,
  public.attempts,
  public.attempt_questions,
  public.sessions,
  public.answers,
  public.violation_events,
  public.grading_runs,
  public.grading_jobs,
  public.question_scores,
  public.results,
  public.api_key_state,
  public.grading_log,
  public.login_attempts,
  public.alerts,
  public.system_health,
  public.admin_actions,
  public.broadcasts,
  public.broadcast_recipients
to service_role;

grant select on table
  public.current_scores,
  public.attempt_progress,
  public.attempt_deadlines
to service_role;

grant usage, select on sequence
  public.grading_log_id_seq,
  public.login_attempts_id_seq,
  public.admin_actions_id_seq
to service_role;

grant execute on function public.resolve_disconnects() to service_role;
grant execute on function public.reverse_disconnects_for_incident(uuid) to service_role;
grant execute on function public.attempt_deadline(uuid) to service_role;
grant execute on function public.generate_paper(uuid) to service_role;
grant execute on function public.save_answer(uuid, uuid, text, uuid, boolean, int) to service_role;
grant execute on function public.advance_position(uuid, int, uuid, text, uuid, int) to service_role;
grant execute on function public.submit_attempt(uuid, text) to service_role;
grant execute on function public.create_broadcast(uuid, text, text, uuid[]) to service_role;
grant execute on function public.claim_broadcast(uuid, uuid, uuid) to service_role;
