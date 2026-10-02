# Section 1 — Database Migration (Phase 1A)

This section replaces the scattered schema tasks in Phase 1A (1A.1, 1A.3–1A.20). Everything the schema needs is in **one migration file**, plus a smoke test that proves the rules work.

**Files**
- `001_initial.sql` → save as `supabase/migrations/001_initial.sql`
- `001_smoke_test.sql` → run once after the migration, in the SQL editor (it rolls itself back)

> **Local verification:** `001_initial.sql`, `002_grading.sql`, and `001_smoke_test.sql` passed together in a clean temporary PostgreSQL 17 container on 2 Oct 2026, using minimal mocks for Supabase `auth`, `storage`, roles, and Realtime publication. This proves PostgreSQL syntax, constraints, functions, triggers, and the smoke assertions (including the half-filled image regression), but it is not hosted Supabase acceptance. Run the same smoke test against the current Supabase PostgreSQL **17.11** project before building on it.

---

## 1. How to run it

1. Use a **fresh** Supabase project (the file creates tables and a Realtime publication entry, so it is not meant to be run twice).
2. SQL editor → paste `001_initial.sql` → Run.
3. Dashboard → Authentication → Users → create the admin and super-admin users, then run for each:
   `insert into public.admin_profiles (id, name, role) values ('<auth user uuid>', 'Name', 'super_admin');` (use `'admin'` for the others).
4. SQL editor → paste `001_smoke_test.sql` → Run. Expect the notice **SMOKE TEST PASSED**.
5. Dashboard → Database → Replication: confirm `attempts`, `violation_events`, `grading_jobs`, `grading_log`, `alerts`, `exams` are in the `supabase_realtime` publication.

**Existing Supabase project:** do not rerun `001_initial.sql`. During implementation, create a new reviewed migration for the delta (question-image columns/constraint and bucket, 5,000-character announcement constraint, force-end collection rule, and any other changed objects). The deployment migration must include the already-decided threshold change:

```sql
alter table public.exams
alter column flag_threshold
set default 10;
```

Run that migration only after implementation and its local PostgreSQL 17 smoke tests pass.

---

## 2. What changed compared with the plan

| Change | Why |
|---|---|
| **Photos removed** (`photo_url` gone) | Everyone is in the office |
| **Optional question images added** | MCQ and written questions may reference one private `question-images` object. Metadata is all-or-none; the smoke test proves a half-filled record is rejected despite PostgreSQL `CHECK`/`NULL` semantics |
| **Announcements are 1–5,000 characters with no count cap** | Matches the current in-app announcement requirement |
| **`violation_events` = one row per incident**, with `merged_types` and `counts` | The plan merges events within ~3 s into one incident, but nothing stored that. `attempts.violation_count` is bumped by a trigger only for counting rows (`RECONNECTED` etc. use `counts = false`) |
| **`grading_jobs` has `chunk_index`**, unique on `(run_id, attempt_id, chunk_index)` | The plan said 2–3 jobs per candidate per run but keyed jobs by `(run_id, attempt_id)`, which collides. A single-question regrade is its own run (`kind = 'regrade'`) |
| **Attempts are created when a candidate is assigned** (trigger) | The live grid must show "Not joined" for all 23 before anyone logs in |
| **Rules enforced inside the database**: `generate_paper()`, `save_answer()`, `advance_position()`, `submit_attempt()` | Revision check, deadline + 15 s grace, force-end, sequential position guard and Next idempotency all run atomically with the database clock instead of being re-implemented in several routes |
| **`alerts`**: `severity` added, active = `resolved_at is null` (old `resolved` boolean removed) | Matches the partial unique index used for dedup |
| **`results`**: override columns removed | Overrides are per question, in `question_scores` |
| **Views**: `current_scores`, `attempt_progress`, `attempt_deadlines` | Override-wins rule; "Q 7/20" / "14 answered" on the grid; the scheduler's per-attempt deadline |
| **Hardening**: the browser `anon` key is revoked from all tables and the four engine functions are service-role only | The anon key is public (the browser has it) |
| **`ON DELETE CASCADE`** from exams and candidates | Cleaning test data after testing is one delete (see section 5) |

`position` and `current_position` are **0-based** everywhere.

---

## 3. Edits to make in `implementation-plan.md`

| Task | Change |
|---|---|
| 1A.1 | Replace with: "Save Section 1's `001_initial.sql` as `supabase/migrations/001_initial.sql`. Do not hand-write schema from the task rows." |
| 1A.3–1A.4 | Done in the file (RLS on every table; admins full access; super-admin-only for `alerts`, `system_health`, `api_key_state`; `sessions` and `login_attempts` are service-role only) |
| 1A.5 | Realtime tables are now `attempts`, `violation_events`, `grading_jobs`, `grading_log`, `alerts`, **`exams`** |
| 1A.6 | Done in the file (private `snapshots` and `question-images` buckets and admin read policies; candidate image reads go through the authenticated API) |
| 1A.7 | Admin users are created in the dashboard, then add their `admin_profiles` row (step 3 above). `api_key_state` (key1–key3) and `system_health` (`worker`) are seeded by the file |
| 1A.8–1A.20 | Done in the file |
| 1C.3 | No photo field |
| 1D.3 | Assigning a candidate **creates the attempt automatically** (trigger); unassigning removes it if still `not_started` |
| 2C.2 | Call `supabase.rpc('generate_paper', { p_attempt_id })`. It raises `not_acknowledged`, `attempt_closed`, `exam_not_live`, `exam_has_no_questions`; map them to HTTP 403/409. It also moves the attempt to `in_progress` |
| 2E.4 | The answers route calls `rpc('save_answer', …)` and only maps the returned text (table below). Position guard, revision, deadline, force-end and option checks are inside |
| 2F.1 / 2F.2 | Call `rpc('submit_attempt', { p_attempt_id, p_reason })` with `'manual'` or `'auto'` |
| 2F.5 / 5A.3 | Ordinary timeout uses `'auto'`. Admin force-end locks screens immediately, accepts final pending answers for 15 seconds, then the worker uses `'forced'` for remaining attempts and finalizes. Per-attempt ordinary deadlines come from `attempt_deadlines` |
| 2F.6 | Call `rpc('advance_position', { p_attempt_id, p_expected_position, p_question_id, p_answer_text, p_selected_option_id, p_revision })` (see results table) |
| 3A.1 / 3B.1 | The client merges events within ~3 s and sends **one** row: `type` = first event, `merged_types` = the rest. Informational events (`RECONNECTED`) send `counts: false` |
| 3C.2 | The badge reads `attempts.violation_count` (Realtime on `attempts`) |
| 4C.2 | The progress label reads the `attempt_progress` view (`current_position`/`total_questions`, or `answered_count`) |
| 6B.1 | Job key is `(run_id, attempt_id, chunk_index)`. A full run creates chunk 0..n per candidate (≤ ~10 questions each). Regrade creates a new run with `kind = 'regrade'` |
| 6C.2 / 6D.4 / 7.3 | Read scores from `current_scores`, never `question_scores` directly |
| **5B.10** | Fix the second clause. `'ontouchstart' in window && !UA.includes('Android')` would **block touchscreen Windows, Mac and ChromeOS laptops**. Use: touch-capable **and** the UA contains none of `Android`, `Windows`, `Macintosh`, `CrOS` (Chrome's "Desktop site" mode on Android reports a Linux X11 UA) |

**`save_answer` result → HTTP**

| Returned text | Meaning | Response |
|---|---|---|
| `saved` | Stored | 200 |
| `stale_revision` | A newer revision already stored | 200, client drops its queued write |
| `closed` | Not in progress, outside the normal deadline grace, or outside the 15-second admin force-end collection window | 409 `exam_closed` (client locks the UI) |
| `wrong_position` | Sequential mode, not the current question | 409 |
| `not_in_paper`, `bad_option` | Invalid input | 400 |
| `not_found` | Unknown attempt | 404 |

**`advance_position` result → client**

| `out_result` | Client action |
|---|---|
| `advanced` | Fetch and show the question at `out_position` |
| `already_advanced` | Same: the earlier reply was lost, just show `out_position` |
| `out_of_sync` | Reload the current question from the server |
| `last_question` | Show Submit instead of Next |
| `closed` | Lock the UI |
| `wrong_question`, `not_sequential` | Programming error; reload state |

---

## 4. Full migration SQL (`001_initial.sql`)

```sql
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
      and btrim(image_alt_text) <> ''
      and image_mime in ('image/jpeg', 'image/png', 'image/webp')
      and image_size_bytes between 1 and 5242880
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
  id       uuid primary key default gen_random_uuid(),
  exam_id  uuid not null references public.exams (id) on delete cascade,
  message  text not null check (char_length(btrim(message)) between 1 and 5000),
  sent_at  timestamptz not null default now()
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

revoke execute on function public.resolve_disconnects() from public, anon, authenticated;
grant  execute on function public.resolve_disconnects() to service_role;

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

revoke execute on function public.reverse_disconnects_for_incident(uuid) from public, anon, authenticated;
grant  execute on function public.reverse_disconnects_for_incident(uuid) to service_role;


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

-- =====================================================================
-- 4. ROW-LEVEL SECURITY
--    Candidates use the API (service role, bypasses RLS). The browser anon key gets NOTHING.
-- =====================================================================

-- 4.1 Tables with full admin access
do $$
declare t text;
begin
  foreach t in array array[
    'candidates', 'exams', 'exam_candidates', 'questions', 'mcq_options', 'answer_keys',
    'attempts', 'attempt_questions', 'answers', 'violation_events',
    'grading_runs', 'grading_jobs', 'grading_log', 'question_scores', 'results',
    'admin_actions', 'broadcasts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "admins full access" on public.%I for all to authenticated
         using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- 4.2 Super-admin-only tables
do $$
declare t text;
begin
  foreach t in array array['alerts', 'system_health', 'api_key_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "super admin only" on public.%I for all to authenticated
         using (public.is_super_admin()) with check (public.is_super_admin())', t);
  end loop;
end $$;

-- 4.3 admin_profiles: read your own row; super admin manages all
alter table public.admin_profiles enable row level security;
create policy "read own profile" on public.admin_profiles
  for select to authenticated using (id = auth.uid());
create policy "super admin manages profiles" on public.admin_profiles
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- 4.4 Service-role only (RLS on, NO policies = nobody but the service role)
alter table public.sessions       enable row level security;
alter table public.login_attempts enable row level security;

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
  'question-images', 'question-images', false, 5242880,
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
-- 8. HARDENING
-- =====================================================================

-- The anon key is public (it is in the browser). It must never touch tables.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Exam-engine functions: service role only
revoke execute on function public.generate_paper(uuid)                                   from public, anon, authenticated;
revoke execute on function public.save_answer(uuid, uuid, text, uuid, boolean, int)      from public, anon, authenticated;
revoke execute on function public.advance_position(uuid, int, uuid, text, uuid, int)     from public, anon, authenticated;
revoke execute on function public.submit_attempt(uuid, text)                             from public, anon, authenticated;
grant  execute on function public.generate_paper(uuid)                                   to service_role;
grant  execute on function public.save_answer(uuid, uuid, text, uuid, boolean, int)      to service_role;
grant  execute on function public.advance_position(uuid, int, uuid, text, uuid, int)     to service_role;
grant  execute on function public.submit_attempt(uuid, text)                             to service_role;
```

---

## 5. Smoke test (`001_smoke_test.sql`)

It checks: optional-image metadata all-or-none (including the `CHECK`/`NULL` regression), attempt auto-creation, paper refusal before acknowledge, dynamic paper generation, sequential Next and its idempotency, revision and closed-save rules, override-wins scoring, incident counting and reversal, disconnect overlap/race guards, alert dedup, multi-chunk grading jobs, idempotent AI-score writes, and the 15-second admin force-end collection window for partial answers.

```sql
-- =====================================================================
-- 001_smoke_test.sql  —  run AFTER 001_initial.sql, in the Supabase SQL editor.
-- Everything runs inside a transaction that is ROLLED BACK, so no data is left behind.
-- Success = the last notice says "SMOKE TEST PASSED". Any failure raises an error naming the check.
-- =====================================================================
begin;

do $$
declare
  v_exam    uuid := gen_random_uuid();
  v_cand    uuid := gen_random_uuid();
  v_q1      uuid := gen_random_uuid();
  v_q2      uuid := gen_random_uuid();
  v_q3      uuid := gen_random_uuid();
  v_opt     uuid := gen_random_uuid();
  v_att     uuid;
  v_first   uuid;
  v_second  uuid;
  v_res     text;
  v_pos     int;
begin
  -- Live sequential exam, 3 questions in the pool, 2 per paper
  insert into public.exams (id, title, duration_min, status, started_at, ends_at, navigation_mode, questions_per_paper)
  values (v_exam, 'Smoke test', 30, 'live', now(), now() + interval '30 minutes', 'sequential', 2);

  insert into public.questions (id, exam_id, position, type, body_html, marks) values
    (v_q1, v_exam, 0, 'mcq',     '<p>Q1</p>', 1),
    (v_q2, v_exam, 1, 'written', '<p>Q2</p>', 2),
    (v_q3, v_exam, 2, 'written', '<p>Q3</p>', 2);

  -- 0. Optional question-image metadata is all-or-none. This specifically guards against
  -- SQL CHECK expressions accidentally accepting a half-filled row because they evaluate NULL.
  begin
    update public.questions set image_path = 'questions/half-filled.png' where id = v_q2;
    assert false, '0a: half-filled question image metadata must be rejected';
  exception when check_violation then
    null; -- expected
  end;
  update public.questions
     set image_path = 'questions/complete.png', image_alt_text = 'Product label',
         image_mime = 'image/png', image_size_bytes = 1024
   where id = v_q2;
  assert (select image_path from public.questions where id = v_q2) = 'questions/complete.png',
    '0b: complete question image metadata must be accepted';
  update public.questions
     set image_path = null, image_alt_text = null, image_mime = null, image_size_bytes = null
   where id = v_q2;
  insert into public.mcq_options (id, question_id, position, label, text_html) values (v_opt, v_q1, 0, 'a', 'Yes');

  insert into public.candidates (id, mer_code, full_name, nic_hash) values (v_cand, 'SMOKE-1', 'Smoke Tester', 'x');
  insert into public.exam_candidates (exam_id, candidate_id) values (v_exam, v_cand);

  -- 1. Assigning a candidate creates their attempt
  select id into v_att from public.attempts where exam_id = v_exam and candidate_id = v_cand;
  assert v_att is not null, '1: attempt should be created on assignment';

  -- 2. Paper generation: refuses before acknowledge, then is idempotent
  begin
    perform public.generate_paper(v_att);
    assert false, '2a: generate_paper must refuse before acknowledge';
  exception when others then
    assert sqlerrm = 'not_acknowledged', '2a: expected not_acknowledged, got ' || sqlerrm;
  end;

  update public.attempts set status = 'acknowledged', acknowledged_at = now() where id = v_att;
  perform public.generate_paper(v_att);
  perform public.generate_paper(v_att);   -- second call must not create a second paper
  assert (select count(*) from public.attempt_questions where attempt_id = v_att) = 2, '2b: pool should give 2 of 3 questions';
  assert (select status from public.attempts where id = v_att) = 'in_progress', '2c: attempt should be in_progress';

  -- 3. Sequential navigation
  select question_id into v_first  from public.attempt_questions where attempt_id = v_att and position = 0;
  select question_id into v_second from public.attempt_questions where attempt_id = v_att and position = 1;

  select out_result, out_position into v_res, v_pos from public.advance_position(v_att, 0, v_first, 'answer one', null, 1);
  assert v_res = 'advanced' and v_pos = 1, '3a: first Next should advance to 1, got ' || v_res;

  select out_result, out_position into v_res, v_pos from public.advance_position(v_att, 0, v_first, 'answer one', null, 1);
  assert v_res = 'already_advanced' and v_pos = 1, '3b: retried Next must not skip a question, got ' || v_res;

  assert public.save_answer(v_att, v_first, 'edit after next', null, false, 2) = 'wrong_position',
    '3c: editing an earlier question must be rejected';

  select out_result, out_position into v_res, v_pos from public.advance_position(v_att, 1, v_second, 'answer two', null, 1);
  assert v_res = 'last_question', '3d: last question should use Submit, got ' || v_res;

  -- 4. Revision rule: a stale revision never overwrites
  assert public.save_answer(v_att, v_second, 'rev 5', null, false, 5) = 'saved',          '4a: first save';
  assert public.save_answer(v_att, v_second, 'old',   null, false, 3) = 'stale_revision', '4b: stale revision';
  assert (select answer_text from public.answers where attempt_id = v_att and question_id = v_second) = 'rev 5',
    '4c: stale revision must not overwrite';

  -- 5. Submit, then everything is closed
  assert public.submit_attempt(v_att, 'manual') = true,  '5a: submit';
  assert public.submit_attempt(v_att, 'manual') = false, '5b: second submit is a no-op';
  assert public.save_answer(v_att, v_second, 'late', null, false, 9) = 'closed', '5c: save after submit must be closed';

  -- 6. Scores: an override always wins, even over a later AI row
  insert into public.question_scores (attempt_id, question_id, source, marks, max_marks) values (v_att, v_first, 'ai', 1, 2);
  insert into public.question_scores (attempt_id, question_id, source, marks, max_marks) values (v_att, v_first, 'override', 2, 2);
  insert into public.question_scores (attempt_id, question_id, source, marks, max_marks) values (v_att, v_first, 'ai', 0, 2);
  assert (select marks from public.current_scores where attempt_id = v_att and question_id = v_first) = 2,
    '6: override must win over later AI rows';

  -- 7. Violation incidents: only counting rows bump the badge number
  insert into public.violation_events (attempt_id, type, merged_types) values (v_att, 'FULLSCREEN_EXIT', array['FOCUS_LOST', 'VIEWPORT_CHANGED']);
  insert into public.violation_events (attempt_id, type, counts)       values (v_att, 'RECONNECTED', false);
  assert (select violation_count from public.attempts where id = v_att) = 1, '7a: only counting incidents are counted';

  -- 7b-d. Trigger UPDATE OF counts path (two-pass DISCONNECTED rule)
  declare v_evt uuid;
  begin
    insert into public.violation_events (attempt_id, type, counts) values (v_att, 'DISCONNECTED', false) returning id into v_evt;
    assert (select violation_count from public.attempts where id = v_att) = 1, '7b: insert with counts=false must not increment';

    update public.violation_events set counts = true where id = v_evt;
    assert (select violation_count from public.attempts where id = v_att) = 2, '7c: flip false->true must increment (+1)';

    update public.violation_events set counts = false where id = v_evt;
    assert (select violation_count from public.attempts where id = v_att) = 1, '7d: flip true->false must decrement (-1)';
  end;

  -- 8. Alert dedup: one ACTIVE alert per key
  insert into public.alerts (type, message, unique_key) values ('keys', 'all keys exhausted', 'keys-exhausted');
  begin
    insert into public.alerts (type, message, unique_key) values ('keys', 'again', 'keys-exhausted');
    assert false, '8: duplicate active alert must be rejected';
  exception when unique_violation then
    null;   -- expected
  end;

  -- 9. Grading job shape: several chunk jobs per candidate in one run
  declare v_run uuid := gen_random_uuid();
  begin
    insert into public.grading_runs (id, exam_id) values (v_run, v_exam);
    insert into public.grading_jobs (run_id, attempt_id, chunk_index, question_ids) values (v_run, v_att, 0, '[]'::jsonb), (v_run, v_att, 1, '[]'::jsonb);
  end;

  -- 10. resolve_disconnects(): overlap, flip, guard, and positive case
  declare v_disc uuid; v_disc2 uuid; v_disc3 uuid; v_disc4 uuid; v_vc_before int;
  begin
    update public.attempts set status = 'in_progress', violation_count = 0 where id = v_att;

    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false, jsonb_build_object('last_seen_at', (now() - interval '5 minutes')::timestamptz::text))
    returning id into v_disc;

    update public.attempts set last_seen_at = (now() - interval '5 minutes') where id = v_att;

    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '5 minutes' - interval '5 seconds', 30000, false);

    perform public.resolve_disconnects();
    assert (select meta->>'count_reason' from public.violation_events where id = v_disc) = 'overlap',
      '10a: overlapping DISCONNECTED must get count_reason=overlap';
    assert (select violation_count from public.attempts where id = v_att) = 0,
      '10b: overlapping row must not increment violation_count';

    update public.violation_events set meta = jsonb_set(meta, '{count_reason}', 'null'::jsonb) where id = v_disc;

    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false, jsonb_build_object('last_seen_at', (now() - interval '4 minutes')::timestamptz::text))
    returning id into v_disc2;

    update public.attempts set last_seen_at = (now() - interval '4 minutes') where id = v_att;

    update public.violation_events
    set meta = jsonb_set(meta, '{count_reason}', '"short_gap"')
    where id = v_disc2 and counts = false and meta->>'count_reason' is null;

    perform public.resolve_disconnects();
    assert (select counts from public.violation_events where id = v_disc2) = false,
      '10c: short_gap guard must prevent flip';
    assert (select meta->>'count_reason' from public.violation_events where id = v_disc2) = 'short_gap',
      '10d: short_gap must not be overwritten by long_gap';

    v_vc_before := (select violation_count from public.attempts where id = v_att);

    delete from public.violation_events where attempt_id = v_att and type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED');

    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false, jsonb_build_object('last_seen_at', (now() - interval '10 minutes')::timestamptz::text))
    returning id into v_disc3;

    update public.attempts set last_seen_at = (now() - interval '10 minutes') where id = v_att;

    perform public.resolve_disconnects();
    assert (select counts from public.violation_events where id = v_disc3) = true,
      '10e: clean disconnect must flip to counts=true';
    assert (select meta->>'count_reason' from public.violation_events where id = v_disc3) = 'long_gap',
      '10f: clean disconnect must get count_reason=long_gap';
    assert (select violation_count from public.attempts where id = v_att) = v_vc_before + 1,
      '10g: clean disconnect must increment violation_count by 1';

    update public.attempts set status = 'submitted' where id = v_att;

    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false, jsonb_build_object('last_seen_at', (now() - interval '15 minutes')::timestamptz::text))
    returning id into v_disc4;

    update public.attempts set last_seen_at = (now() - interval '15 minutes') where id = v_att;

    perform public.resolve_disconnects();
    assert (select counts from public.violation_events where id = v_disc4) = false,
      '10h: submitted attempt disconnect must not flip';
  end;

  -- 11. One absence counts once (section 4, section 5)
  declare v_d1 uuid; v_d2 uuid; v_f2 uuid; v_d3 uuid; v_f3 uuid;
  begin
    delete from public.violation_events where attempt_id = v_att;
    update public.attempts
      set status = 'in_progress', violation_count = 0,
          last_seen_at = now() - interval '6 minutes'
      where id = v_att;
    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false,
            jsonb_build_object('last_seen_at', (now() - interval '6 minutes')::timestamptz::text))
    returning id into v_d1;
    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '5 minutes', 30000, false);
    perform public.resolve_disconnects();
    assert (select meta->>'count_reason' from public.violation_events where id = v_d1) = 'overlap',
      '11a: incident inside the gap must mark the disconnect overlap';

    delete from public.violation_events where attempt_id = v_att;
    update public.attempts
      set violation_count = 0, last_seen_at = now() - interval '6 minutes'
      where id = v_att;
    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false,
            jsonb_build_object('last_seen_at', (now() - interval '6 minutes')::timestamptz::text))
    returning id into v_d2;
    perform public.resolve_disconnects();
    assert (select counts from public.violation_events where id = v_d2) = true, '11b-pre: flips to counted';
    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '5 minutes', 30000, true)
    returning id into v_f2;
    assert public.reverse_disconnects_for_incident(v_f2) = 1, '11b: one disconnect reversed';
    assert (select meta->>'count_reason' from public.violation_events where id = v_d2) = 'reversed_by_focus',
      '11b: reason must be reversed_by_focus';
    assert (select violation_count from public.attempts where id = v_att) = 1,
      '11b: net count must be 1 (the tab switch), not 2';

    delete from public.violation_events where attempt_id = v_att;
    update public.attempts
      set violation_count = 0, last_seen_at = now() - interval '6 minutes'
      where id = v_att;
    insert into public.violation_events (attempt_id, type, occurred_at, counts, meta)
    values (v_att, 'DISCONNECTED', now() - interval '5 minutes', false,
            jsonb_build_object('last_seen_at', (now() - interval '6 minutes')::timestamptz::text))
    returning id into v_d3;
    perform public.resolve_disconnects();
    insert into public.violation_events (attempt_id, type, occurred_at, counts, duration_ms)
    values (v_att, 'RECONNECTED', now() - interval '2 minutes', false, 240000);
    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '1 minute', 10000, true)
    returning id into v_f3;
    assert public.reverse_disconnects_for_incident(v_f3) = 0,
      '11c: incident after the reconnect must not reverse the disconnect';
    assert (select counts from public.violation_events where id = v_d3) = true,
      '11c: disconnect stays counted';
  end;

  -- 12. Idempotent AI writes: one job can score a question only once (needs 002_grading.sql)
  declare v_run2 uuid := gen_random_uuid(); v_job uuid := gen_random_uuid();
  begin
    insert into public.grading_runs (id, exam_id) values (v_run2, v_exam);
    insert into public.grading_jobs (id, run_id, attempt_id, chunk_index, question_ids)
    values (v_job, v_run2, v_att, 0, '[]'::jsonb);

    insert into public.question_scores (attempt_id, question_id, source, marks, max_marks, job_id)
    values (v_att, v_first, 'ai', 1, 2, v_job);
    insert into public.question_scores (attempt_id, question_id, source, marks, max_marks, job_id)
    values (v_att, v_first, 'ai', 1, 2, v_job)
    on conflict do nothing;                      -- how the worker writes
    assert (select count(*) from public.question_scores where job_id = v_job) = 1,
      '12a: a duplicate score for the same job and question must be ignored';

    begin
      insert into public.question_scores (attempt_id, question_id, source, marks, max_marks, job_id)
      values (v_att, v_first, 'ai', 2, 2, v_job);
      assert false, '12b: a plain duplicate insert must violate the unique index';
    exception when unique_violation then
      null;                                      -- expected
    end;
  end;

  -- 13. Admin force-end collection window accepts the candidate's final partial answer,
  -- then closes after 15 seconds.
  update public.attempts
     set status = 'in_progress', submit_reason = null, submitted_at = null, current_position = 1
   where id = v_att;
  update public.exams
     set status = 'ended', ends_at = now(), force_ended_at = now()
   where id = v_exam;
  assert public.save_answer(v_att, v_second, 'partial final answer', null, false, 10) = 'saved',
    '13a: force-end window must accept the latest partial answer';
  update public.exams set force_ended_at = now() - interval '16 seconds' where id = v_exam;
  assert public.save_answer(v_att, v_second, 'too late', null, false, 11) = 'closed',
    '13b: force-end window must close after 15 seconds';

  raise notice 'SMOKE TEST PASSED';
end $$;

rollback;
```

### Test-data cleanup (after testing, before the real exam)

```sql
delete from public.exams where is_practice or title ilike 'test%';   -- cascades: attempts, answers, scores, violations, grading runs
delete from public.candidates where mer_code ilike 'TEST%';
delete from public.login_attempts;
delete from public.alerts;
delete from public.admin_actions;
-- Snapshot image files are NOT removed by SQL: empty the Storage > snapshots bucket in the dashboard.
```
